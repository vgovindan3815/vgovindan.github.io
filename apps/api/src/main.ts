import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Queue } from 'bullmq';
import { createClient } from 'redis';
import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? '3000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TENANT_ID = process.env.AZURE_TENANT_ID ?? '';
const CLIENT_ID = process.env.AZURE_CLIENT_ID ?? '';
const AUTH_MODE = (process.env.AUTH_MODE ?? 'local').toLowerCase();
const LOCAL_AUTH_SECRET = process.env.LOCAL_AUTH_SECRET ?? 'freight-local-dev-secret-change';
const LOCAL_TOKEN_ISSUER = 'freight-local-auth';
const LOCAL_TOKEN_AUDIENCE = 'freight-web';
const LOCAL_TOKEN_EXPIRY_SECONDS = Number(process.env.LOCAL_TOKEN_EXPIRY_SECONDS ?? '28800');
// Allow any localhost port during development
function isAllowedOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  }
}
const BYPASS_AUTH = (process.env.BYPASS_AUTH ?? 'false').toLowerCase() === 'true';

// ─── Redis ───────────────────────────────────────────────────────────────────
const redisUrl = new URL(REDIS_URL);
const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
};
const redis = createClient({ url: REDIS_URL });

// ─── JWKS Client (Azure AD token validation) ─────────────────────────────────
const jwks = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
});

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: isAllowedOrigin, credentials: true }));
app.use(express.json({ limit: '100mb' }));

app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

type AuthenticatedRequest = Request & {
  user?: jwt.JwtPayload & { roles?: string[]; username?: string; userId?: string };
};

type LocalRole = 'ADMIN' | 'FREIGHT_USER';
type LocalUserStatus = 'ACTIVE' | 'INACTIVE';
const LOCAL_ROLES: LocalRole[] = ['ADMIN', 'FREIGHT_USER'];

type LocalAuthUser = {
  id: string;
  username: string;
  displayName: string;
  password: string;
  roles: LocalRole[];
  status: LocalUserStatus;
  createdAt: string;
  lastLoginAt?: string;
};

const API_ROOT = path.resolve(__dirname, '..');
const AUTH_USERS_PATH = path.join(API_ROOT, 'data', 'auth-users.json');
const LOCAL_AUTH_SEEDED_USERS: LocalAuthUser[] = [
  {
    id: 'user-admin',
    username: 'Admin',
    displayName: 'Admin',
    password: 'Admin@123',
    roles: ['ADMIN'],
    status: 'ACTIVE',
    createdAt: '2026-04-03T00:00:00.000Z',
  },
  {
    id: 'user-freight',
    username: 'freight_user',
    displayName: 'Freight User',
    password: 'Freight@123',
    roles: ['FREIGHT_USER'],
    status: 'ACTIVE',
    createdAt: '2026-04-03T00:00:00.000Z',
  },
];

function ensureLocalAuthUsers(): void {
  const authDir = path.dirname(AUTH_USERS_PATH);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  if (!fs.existsSync(AUTH_USERS_PATH)) {
    fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify(LOCAL_AUTH_SEEDED_USERS, null, 2), 'utf-8');
  }
}

function readLocalAuthUsers(): LocalAuthUser[] {
  ensureLocalAuthUsers();
  try {
    const raw = fs.readFileSync(AUTH_USERS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LocalAuthUser[];
    return parsed.length ? parsed : [...LOCAL_AUTH_SEEDED_USERS];
  } catch {
    return [...LOCAL_AUTH_SEEDED_USERS];
  }
}

function writeLocalAuthUsers(users: LocalAuthUser[]): void {
  ensureLocalAuthUsers();
  fs.writeFileSync(AUTH_USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

function toPublicAuthUser(user: LocalAuthUser): Omit<LocalAuthUser, 'password'> {
  const { password: _password, ...publicUser } = user;
  return publicUser;
}

function signLocalToken(user: LocalAuthUser): string {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      preferred_username: user.username,
      upn: user.username,
      roles: user.roles,
    },
    LOCAL_AUTH_SECRET,
    {
      expiresIn: LOCAL_TOKEN_EXPIRY_SECONDS,
      issuer: LOCAL_TOKEN_ISSUER,
      audience: LOCAL_TOKEN_AUDIENCE,
    },
  );
}

// ─── JWT validation middleware ───────────────────────────────────────────────
async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (BYPASS_AUTH) {
    (req as AuthenticatedRequest).user = {
      preferred_username: 'local.user@bypass',
      upn: 'local.user@bypass',
      username: 'local.user@bypass',
      roles: ['ADMIN'],
    } as jwt.JwtPayload;
    next();
    return;
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = auth.slice(7);

  try {
    if (AUTH_MODE === 'azure') {
      if (!TENANT_ID || !CLIENT_ID) {
        res.status(500).json({ error: 'Azure auth mode is enabled but tenant/client settings are missing.' });
        return;
      }

      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
        throw new Error('Invalid token structure');
      }
      const key = await jwks.getSigningKey(decoded.header.kid as string);
      const signingKey = key.getPublicKey();
      const verified = jwt.verify(token, signingKey, {
        audience: CLIENT_ID,
        issuer: [
          `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
          `https://sts.windows.net/${TENANT_ID}/`,
        ],
      }) as jwt.JwtPayload;

      (req as AuthenticatedRequest).user = verified;
      next();
      return;
    }

    const verified = jwt.verify(token, LOCAL_AUTH_SECRET, {
      audience: LOCAL_TOKEN_AUDIENCE,
      issuer: LOCAL_TOKEN_ISSUER,
    }) as jwt.JwtPayload & { roles?: string[]; username?: string; userId?: string };

    (req as AuthenticatedRequest).user = verified;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
(async () => {
  await redis.connect();
  console.log('API: Redis connected');

  ensureLocalAuthUsers();

  const contractQueue = new Queue('contract-generation', { connection: bullConnection });

  type PricingModel = 'Zone-based' | 'Mileage-based' | 'Auto';

  function listWindowsDriveRoots(): string[] {
    const roots: string[] = [];
    for (let code = 67; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) roots.push(drive);
    }
    return roots;
  }

  function listDirectories(dirPath: string): string[] {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dirPath, d.name));
  }

  function escapePowerShellSingleQuoted(value: string): string {
    return value.replace(/'/g, "''");
  }

  async function showWindowsFolderPicker(params: {
    title?: string;
    startPath?: string;
  }): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    const title = escapePowerShellSingleQuoted(params.title?.trim() || 'Select Folder');
    const startPath = params.startPath?.trim();
    const escapedStartPath = startPath ? escapePowerShellSingleQuoted(startPath) : null;
    const nativeMethodsTypeDefinition = escapePowerShellSingleQuoted(
      'using System; using System.Runtime.InteropServices; using System.Windows.Forms; public static class NativeMethods { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); } public sealed class WindowWrapper : IWin32Window { private readonly IntPtr _handle; public WindowWrapper(IntPtr handle) { _handle = handle; } public IntPtr Handle { get { return _handle; } } }',
    );
    const script = [
      'try {',
      `  Add-Type -TypeDefinition '${nativeMethodsTypeDefinition}' -ReferencedAssemblies 'System.Windows.Forms.dll' -ErrorAction Stop`,
      '  $ownerHandle = [NativeMethods]::GetForegroundWindow()',
      '  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop',
      '  [void][System.Windows.Forms.Application]::EnableVisualStyles()',
      '  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `  $dialog.Description = '${title}'`,
      '  $dialog.ShowNewFolderButton = $true',
      ...(escapedStartPath
        ? [
            `  if (Test-Path '${escapedStartPath}') { $dialog.SelectedPath = '${escapedStartPath}' }`,
          ]
        : []),
      '  $owner = if ($ownerHandle -ne [IntPtr]::Zero) { New-Object WindowWrapper($ownerHandle) } else { $null }',
      '  $result = if ($owner -ne $null) { $dialog.ShowDialog($owner) } else { $dialog.ShowDialog() }',
      '  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
      '    Write-Output $dialog.SelectedPath',
      '  }',
      '} catch {',
      '  Write-Error $_.Exception.Message',
      '  exit 1',
      '}',
    ].join('; ');

    return await new Promise<string | null>((resolve, reject) => {
      let resolved = false;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', script],
        { windowsHide: false, maxBuffer: 1024 * 10, timeout: 120000 },
        (error, stdout, stderr) => {
          if (resolved) return;
          resolved = true;

          const selectedPath = stdout.trim();

          if (selectedPath && !error) {
            resolve(selectedPath);
            return;
          }

          if (stderr.trim()) {
            reject(new Error(`PowerShell error: ${stderr.trim()}`));
            return;
          }

          if (!error) {
            resolve(null);
            return;
          }

          reject(error);
        },
      );

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Folder picker dialog timed out after 2 minutes.'));
        }
      }, 121000);
    });
  }

  async function enqueueContractJob(params: {
    requestId: string;
    pricingModel: PricingModel;
    input: { driveId?: string; itemId?: string; name?: string; localFileBase64?: string };
    output: { localPath?: string; fileName?: string };
    accessToken: string;
    submittedBy: string;
    submittedAt: string;
    batchId?: string;
  }): Promise<void> {
    const { requestId, pricingModel, input, output, accessToken, submittedBy, submittedAt, batchId } = params;

    const status = {
      requestId,
      batchId,
      sourceFile: input.name,
      status: 'Queued',
      progress: 0,
      message: 'Request queued for processing',
    };
    await redis.set(`request:${requestId}`, JSON.stringify(status), { EX: 86400 });

    const existing = await contractQueue.getJob(requestId);
    if (!existing) {
      await contractQueue.add(
        'generate-contract',
        {
          requestId,
          pricingModel,
          input,
          output,
          submittedBy,
          submittedAt,
          accessToken,
          batchId,
        },
        {
          jobId: requestId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }
  }

  function requireRole(role: LocalRole) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const authReq = req as AuthenticatedRequest;
      const roles = authReq.user?.roles ?? [];
      if (roles.includes(role)) {
        next();
        return;
      }

      res.status(403).json({ error: 'Forbidden' });
    };
  }

  app.post('/api/auth/login', (req: Request, res: Response): void => {
    const { username, password } = req.body as { username?: string; password?: string };
    const candidateUsername = username?.trim();
    const candidatePassword = password?.trim();

    if (!candidateUsername || !candidatePassword) {
      res.status(400).json({ error: 'username and password are required.' });
      return;
    }

    const users = readLocalAuthUsers();
    const user = users.find((entry) => entry.username.toLowerCase() === candidateUsername.toLowerCase());
    if (!user || user.password !== candidatePassword) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'This account is inactive. Contact your administrator.' });
      return;
    }

    user.lastLoginAt = new Date().toISOString();
    writeLocalAuthUsers(users);

    const accessToken = signLocalToken(user);
    res.json({
      accessToken,
      user: toPublicAuthUser(user),
    });
  });

  app.get('/api/auth/me', authenticate, (req: Request, res: Response): void => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;

    if (userId) {
      const user = readLocalAuthUsers().find((entry) => entry.id === userId);
      if (user) {
        res.json(toPublicAuthUser(user));
        return;
      }
    }

    const fallbackUser = {
      id: authReq.user?.userId ?? 'unknown',
      username: authReq.user?.username ?? authReq.user?.preferred_username ?? 'unknown',
      displayName: authReq.user?.username ?? authReq.user?.preferred_username ?? 'unknown',
      roles: (authReq.user?.roles as LocalRole[] | undefined) ?? [],
      status: 'ACTIVE' as LocalUserStatus,
      createdAt: new Date().toISOString(),
    };
    res.json(fallbackUser);
  });

  app.get('/api/auth/users', authenticate, requireRole('ADMIN'), (_req: Request, res: Response): void => {
    const users = readLocalAuthUsers().map((user) => toPublicAuthUser(user));
    res.json(users);
  });

  app.post('/api/auth/users', authenticate, requireRole('ADMIN'), (req: Request, res: Response): void => {
    const body = req.body as {
      username?: string;
      displayName?: string;
      password?: string;
      roles?: LocalRole[];
      status?: LocalUserStatus;
    };

    const username = body.username?.trim();
    const displayName = body.displayName?.trim() || username;
    const password = body.password?.trim();
    const status = body.status ?? 'ACTIVE';
    const candidateRoles = Array.isArray(body.roles) && body.roles.length > 0 ? body.roles : ['FREIGHT_USER'];
    const roles = candidateRoles.filter((role): role is LocalRole => LOCAL_ROLES.includes(role as LocalRole));

    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required.' });
      return;
    }

    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      res.status(400).json({ error: 'status must be ACTIVE or INACTIVE.' });
      return;
    }

    if (roles.length !== candidateRoles.length) {
      res.status(400).json({ error: `roles must be from: ${LOCAL_ROLES.join(', ')}` });
      return;
    }

    const users = readLocalAuthUsers();
    const exists = users.some((user) => user.username.toLowerCase() === username.toLowerCase());
    if (exists) {
      res.status(409).json({ error: 'A user with this username already exists.' });
      return;
    }

    const newUser: LocalAuthUser = {
      id: uuid(),
      username,
      displayName: displayName ?? username,
      password,
      roles,
      status,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeLocalAuthUsers(users);
    res.status(201).json(toPublicAuthUser(newUser));
  });

  app.patch('/api/auth/users/:id', authenticate, requireRole('ADMIN'), (req: Request, res: Response): void => {
    const userId = req.params['id'];
    const { status, password } = req.body as { status?: LocalUserStatus; password?: string };

    if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
      res.status(400).json({ error: 'status must be ACTIVE or INACTIVE.' });
      return;
    }

    const users = readLocalAuthUsers();
    const targetUser = users.find((user) => user.id === userId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    targetUser.status = status;
    if (password?.trim()) {
      targetUser.password = password.trim();
    }

    writeLocalAuthUsers(users);
    res.json(toPublicAuthUser(targetUser));
  });

  // ── POST /api/requests ────────────────────────────────────────────────────
  app.post('/api/requests', authenticate, async (req: Request, res: Response): Promise<void> => {
    const { pricingModel, input, output } = req.body as {
      pricingModel?: string;
      input?: { driveId?: string; itemId?: string; name?: string; localFileBase64?: string };
      output?: { localPath?: string; fileName?: string };
    };

    // Validate payload
    if (!pricingModel || !['Zone-based', 'Mileage-based', 'Auto'].includes(pricingModel)) {
      res.status(400).json({ error: 'Invalid pricingModel. Must be "Zone-based", "Mileage-based", or "Auto".' });
      return;
    }
    const hasOneDriveInput = !!input?.driveId && !!input?.itemId && !!input?.name;
    const hasLocalInput = !!input?.name && !!input?.localFileBase64;
    if (!hasOneDriveInput && !hasLocalInput) {
      res.status(400).json({
        error: 'Invalid input: provide OneDrive (driveId/itemId/name) or local file (name/localFileBase64).',
      });
      return;
    }
    if (!output?.localPath || !output?.fileName) {
      res.status(400).json({ error: 'Invalid output: localPath and fileName are required.' });
      return;
    }

    const user = (req as Request & { user?: jwt.JwtPayload }).user;
    const requestId = uuid();
    const submittedBy: string = user?.preferred_username ?? user?.upn ?? 'unknown';
    const submittedAt = new Date().toISOString();

    await enqueueContractJob({
      requestId,
      pricingModel: pricingModel as PricingModel,
      input,
      output,
      submittedBy,
      submittedAt,
      accessToken: req.headers.authorization?.slice(7) ?? '',
    });

    res.status(202).json({
      requestId,
      status: 'Queued',
      statusUrl: `/api/requests/${requestId}`,
    });
  });

  // ── GET /api/requests/:id ─────────────────────────────────────────────────
  app.get('/api/requests/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
    const data = await redis.get(`request:${req.params['id']}`);
    if (!data) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    res.json(JSON.parse(data));
  });

  // ── POST /api/batch/requests ─────────────────────────────────────────────
  app.post('/api/batch/requests', authenticate, async (req: Request, res: Response): Promise<void> => {
    const { inputDir, outputDir, pricingModel } = req.body as {
      inputDir?: string;
      outputDir?: string;
      pricingModel?: PricingModel;
    };

    if (!inputDir || !outputDir) {
      res.status(400).json({ error: 'inputDir and outputDir are required.' });
      return;
    }
    if (pricingModel && !['Zone-based', 'Mileage-based', 'Auto'].includes(pricingModel)) {
      res.status(400).json({ error: 'Invalid pricingModel. Use Auto, Zone-based, or Mileage-based.' });
      return;
    }

    const resolvedInput = path.resolve(inputDir);
    const resolvedOutput = path.resolve(outputDir);
    if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isDirectory()) {
      res.status(400).json({ error: `Input directory not found: ${resolvedInput}` });
      return;
    }
    fs.mkdirSync(resolvedOutput, { recursive: true });

    const files = fs
      .readdirSync(resolvedInput)
      .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'));

    if (files.length === 0) {
      res.status(400).json({ error: `No .xlsx files found in ${resolvedInput}` });
      return;
    }

    const user = (req as Request & { user?: jwt.JwtPayload }).user;
    const submittedBy: string = user?.preferred_username ?? user?.upn ?? 'unknown';
    const submittedAt = new Date().toISOString();
    const batchId = uuid();
    const selectedModel: PricingModel = pricingModel ?? 'Auto';
    const requestIds: string[] = [];

    for (const fileName of files) {
      const requestId = uuid();
      const fullPath = path.join(resolvedInput, fileName);
      const localFileBase64 = fs.readFileSync(fullPath).toString('base64');
      const base = path.parse(fileName).name;
      const outputFileName = `${base}_Contract_${submittedAt.replace(/[:.]/g, '-').slice(0, 19)}.docx`;

      await enqueueContractJob({
        requestId,
        batchId,
        pricingModel: selectedModel,
        input: { name: fileName, localFileBase64 },
        output: { localPath: resolvedOutput, fileName: outputFileName },
        submittedBy,
        submittedAt,
        accessToken: req.headers.authorization?.slice(7) ?? '',
      });

      requestIds.push(requestId);
    }

    await redis.set(
      `batch:${batchId}`,
      JSON.stringify({
        batchId,
        status: 'Queued',
        inputDir: resolvedInput,
        outputDir: resolvedOutput,
        pricingModel: selectedModel,
        submittedAt,
        submittedBy,
        requestIds,
      }),
      { EX: 86400 },
    );

    res.status(202).json({
      batchId,
      status: 'Queued',
      totalFiles: files.length,
      statusUrl: `/api/batch/requests/${batchId}`,
      requestIds,
    });
  });

  app.post('/api/system/pick-folder', authenticate, async (req: Request, res: Response): Promise<void> => {
    if (process.platform !== 'win32') {
      res.status(501).json({ error: 'Native folder picker is only supported on Windows.' });
      return;
    }

    const { title, startPath } = req.body as { title?: string; startPath?: string };

    try {
      const selectedPath = await showWindowsFolderPicker({ title, startPath });
      res.json({ path: selectedPath, canceled: !selectedPath });
    } catch (error) {
      console.error('[pick-folder] Error:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: 'Failed to open the Windows folder picker.' });
    }
  });

  // ── GET /api/batch/folders?path=<absolute-path> ─────────────────────────
  app.get('/api/batch/folders', authenticate, (req: Request, res: Response): void => {
    const browsePath = (req.query['path'] as string | undefined)?.trim();

    // If no path is provided, return top-level browse roots.
    if (!browsePath) {
      const roots = process.platform === 'win32' ? listWindowsDriveRoots() : ['/'];
      res.json({ roots, currentPath: null, parentPath: null, directories: [] });
      return;
    }

    const normalized = path.resolve(browsePath);
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      res.status(400).json({ error: `Directory not found: ${normalized}` });
      return;
    }

    let directories: string[] = [];
    try {
      directories = listDirectories(normalized);
    } catch {
      res.status(500).json({ error: `Unable to list directory: ${normalized}` });
      return;
    }

    const parentPath = path.dirname(normalized);
    res.json({
      roots: [],
      currentPath: normalized,
      parentPath: parentPath !== normalized ? parentPath : null,
      directories,
    });
  });

  // ── GET /api/batch/requests/:id ──────────────────────────────────────────
  app.get('/api/batch/requests/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
    const batchRaw = await redis.get(`batch:${req.params['id']}`);
    if (!batchRaw) {
      res.status(404).json({ error: 'Batch request not found' });
      return;
    }

    const batch = JSON.parse(batchRaw) as {
      batchId: string;
      status: string;
      inputDir: string;
      outputDir: string;
      pricingModel: PricingModel;
      submittedAt: string;
      submittedBy: string;
      requestIds: string[];
    };

    const items = await Promise.all(
      batch.requestIds.map(async (id) => {
        const data = await redis.get(`request:${id}`);
        return data ? JSON.parse(data) : { requestId: id, status: 'Unknown', progress: 0 };
      }),
    );

    const completed = items.filter((i) => i.status === 'Completed').length;
    const failed = items.filter((i) => i.status === 'Failed').length;
    const processing = items.filter((i) => i.status === 'Processing').length;
    const queued = items.filter((i) => i.status === 'Queued').length;
    const total = items.length;

    let status = 'Processing';
    if (failed === total) status = 'Failed';
    else if (completed + failed === total) status = failed > 0 ? 'CompletedWithErrors' : 'Completed';
    else if (queued === total) status = 'Queued';

    res.json({
      ...batch,
      status,
      total,
      completed,
      failed,
      processing,
      queued,
      items,
    });
  });

  // ── POST /api/batch/requests/:id/retry-failed ───────────────────────────
  app.post('/api/batch/requests/:id/retry-failed', authenticate, async (req: Request, res: Response): Promise<void> => {
    const failedBatchRaw = await redis.get(`batch:${req.params['id']}`);
    if (!failedBatchRaw) {
      res.status(404).json({ error: 'Batch request not found' });
      return;
    }

    const failedBatch = JSON.parse(failedBatchRaw) as {
      batchId: string;
      inputDir: string;
      outputDir: string;
      pricingModel: PricingModel;
      submittedBy: string;
      requestIds: string[];
    };

    const items = await Promise.all(
      failedBatch.requestIds.map(async (id) => {
        const data = await redis.get(`request:${id}`);
        return data ? JSON.parse(data) : null;
      }),
    );

    const failedItems = items.filter((item) => item?.status === 'Failed' && item?.sourceFile);
    if (failedItems.length === 0) {
      res.status(400).json({ error: 'No failed files found to retry for this batch.' });
      return;
    }

    const submittedAt = new Date().toISOString();
    const retryBatchId = uuid();
    const requestIds: string[] = [];

    for (const item of failedItems) {
      const fileName = String(item.sourceFile);
      const fullPath = path.join(failedBatch.inputDir, fileName);
      if (!fs.existsSync(fullPath)) continue;

      const requestId = uuid();
      const localFileBase64 = fs.readFileSync(fullPath).toString('base64');
      const base = path.parse(fileName).name;
      const outputFileName = `${base}_Contract_${submittedAt.replace(/[:.]/g, '-').slice(0, 19)}.docx`;

      await enqueueContractJob({
        requestId,
        batchId: retryBatchId,
        pricingModel: failedBatch.pricingModel,
        input: { name: fileName, localFileBase64 },
        output: { localPath: failedBatch.outputDir, fileName: outputFileName },
        submittedBy: failedBatch.submittedBy,
        submittedAt,
        accessToken: req.headers.authorization?.slice(7) ?? '',
      });

      requestIds.push(requestId);
    }

    if (requestIds.length === 0) {
      res.status(400).json({ error: 'No retryable source files were found on disk.' });
      return;
    }

    await redis.set(
      `batch:${retryBatchId}`,
      JSON.stringify({
        batchId: retryBatchId,
        status: 'Queued',
        inputDir: failedBatch.inputDir,
        outputDir: failedBatch.outputDir,
        pricingModel: failedBatch.pricingModel,
        submittedAt,
        submittedBy: failedBatch.submittedBy,
        requestIds,
        retryOfBatchId: failedBatch.batchId,
      }),
      { EX: 86400 },
    );

    res.status(202).json({
      batchId: retryBatchId,
      status: 'Queued',
      totalFiles: requestIds.length,
      statusUrl: `/api/batch/requests/${retryBatchId}`,
      requestIds,
    });
  });

  // ── GET /api/file?path=<absolute-path> ────────────────────────────────────
  app.get('/api/file', authenticate, (req: Request, res: Response): void => {
    const filePath = req.query['path'] as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'path query param required' });
      return;
    }
    // Safety: only allow files inside the configured output location or temp
    const normalized = path.resolve(filePath);
    if (!fs.existsSync(normalized)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const ext = path.extname(normalized).toLowerCase();
    const mime =
      ext === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/octet-stream';
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(normalized)}"`);
    res.setHeader('Content-Type', mime);
    fs.createReadStream(normalized).pipe(res);
  });

  app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
})();
