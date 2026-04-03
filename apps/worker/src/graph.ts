import axios from 'axios';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

/**
 * Exchange a user access token for a Graph token via OBO (On-Behalf-Of) flow.
 */
export async function getOboToken(userAccessToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: process.env.AZURE_CLIENT_ID!,
    client_secret: process.env.AZURE_CLIENT_SECRET!,
    assertion: userAccessToken,
    scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access',
    requested_token_use: 'on_behalf_of',
  });

  const resp = await axios.post<{ access_token: string }>(
    TOKEN_ENDPOINT,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return resp.data.access_token;
}

/**
 * Download an Excel file from OneDrive/SharePoint via Microsoft Graph.
 */
export async function downloadExcel(
  driveId: string,
  itemId: string,
  token: string,
): Promise<Buffer> {
  const resp = await axios.get<ArrayBuffer>(
    `${GRAPH}/drives/${driveId}/items/${itemId}/content`,
    {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    },
  );
  return Buffer.from(resp.data);
}

/**
 * Upload a .docx file to a specified OneDrive folder via Microsoft Graph.
 * Returns the webUrl of the uploaded item.
 */
export async function uploadDocx(
  driveId: string,
  folderId: string,
  fileName: string,
  buffer: Buffer,
  token: string,
): Promise<string> {
  const sanitized = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  const resp = await axios.put<{ webUrl: string; id: string }>(
    `${GRAPH}/drives/${driveId}/items/${folderId}:/${encodeURIComponent(sanitized)}:/content`,
    buffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  );
  return resp.data.webUrl;
}

/**
 * Create a read-only share link for an uploaded item (for the status output link).
 */
export async function createShareLink(
  driveId: string,
  itemId: string,
  token: string,
): Promise<string> {
  const resp = await axios.post<{ link?: { webUrl?: string } }>(
    `${GRAPH}/drives/${driveId}/items/${itemId}/createLink`,
    { type: 'view', scope: 'organization' },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return resp.data.link?.webUrl ?? '';
}
