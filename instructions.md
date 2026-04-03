# instructions.md — Current Build and Maintenance Instructions

You are GitHub Copilot (VS Code) working on the Freight Pricing Contract Generator in its current, locally testable state.

## Objective

Maintain and extend the existing three-part application:
- `apps/web`: Angular front end
- `apps/api`: Express API
- `apps/worker`: BullMQ background worker

The current product behavior is:
1. User selects `Zone-based` or `Mileage-based`
2. User browses a local `.xlsx` file from the local drive
3. User optionally selects a local browser output folder
4. Front end validates the workbook by checking `0_ReadMe!B4`
5. Request is submitted to the API with workbook content as base64
6. Worker parses the workbook using the mapping JSON and generates a `.docx`
7. Result is written to a local output path and can be opened from the UI

## Current Constraints

- Authentication is intentionally bypassed for local testing
- Do not reintroduce a hard dependency on OneDrive picker flows for the primary path
- Keep the app usable without Azure AD, Graph, or cloud storage setup
- Preserve the current local output default path behavior
- Keep the UI in the light theme unless the user explicitly asks to redesign it

## Core Inputs

- Mapping: `shared/mapping/PricingTemplate_To_Contract_Mapping.json`
- Excel input: local `.xlsx` file selected in the browser
- Default output folder: `C:\output`

## Implementation Guidance

### Step 1 — Front-end workflow

Preserve this form flow in `apps/web`:
- pricing model select
- local file picker
- optional local folder picker using the File System Access API
- output filename
- validation state
- submit action
- request status panel
- open document action

UI requirements:
- prevent visual overlap between form sections and dropdown overlays
- keep Angular Material overlays styled for the light theme
- keep validation diagnostics off the page unless explicitly requested again

### Step 2 — Validation behavior

Keep validation intentionally minimal and fast:
- read `0_ReadMe!B4`
- compare it to the selected pricing model

Implementation requirements:
- run workbook validation in a Web Worker
- preserve timeout handling so the spinner cannot hang forever
- preserve validation timing metrics and slow-file warning support
- if updating async UI state, ensure Angular zone/change detection is handled correctly

### Step 3 — API contract

In `apps/api`, preserve these endpoints:
- `POST /api/requests`
- `GET /api/requests/:id`
- `GET /api/file?path=...`

The POST payload should follow the current local-input contract:

```json
{
  "pricingModel": "Zone-based|Mileage-based",
  "input": {
    "name": "input.xlsx",
    "contentBase64": "..."
  },
  "output": {
    "localPath": "C:\\output",
    "fileName": "input_Contract_2026-04-02-143005.docx"
  }
}
```

Operational requirements:
- keep the higher JSON body size limit for workbook uploads
- keep localhost CORS working for the Angular app
- keep auth bypass enabled unless the user explicitly asks to restore full auth

### Step 4 — Worker generation flow

In `apps/worker`, keep the worker responsible for all generation logic:
- decode local workbook input
- load the mapping JSON
- parse workbook data with ExcelJS
- extract placeholders from `1_Customer_Profile`
- extract mapped tables from the relevant worksheets
- build the Word document using `docx`
- save the generated file locally
- update job status, progress, output path, and output bytes

Graph/OBO support may remain in code paths for later use, but local processing is the primary supported path.

### Step 5 — Table extraction rules

Preserve the session fixes for multi-table worksheets:
- support `tableDelimiter` values such as `emptyLine` and `newHeader`
- stop table extraction when another known header block is detected on the same worksheet
- do not merge adjacent logical tables into a single output table

This is especially important for sheets like `2_Lanes_Locations`.

### Step 6 — Word rendering rules

Preserve the session fixes for table rendering:
- normalize rows to the maximum detected column count
- use fixed layout tables
- emit non-breaking spaces for otherwise empty cells
- preserve full borders for empty trailing columns

## Status and Polling

Keep the current status model:
- `Queued`
- `Processing`
- `Completed`
- `Failed`

Front-end polling requirements:
- start immediately after submit
- continue every 30 seconds
- ensure UI refreshes correctly when async callbacks complete

## Coding Standards

- TypeScript throughout
- strict mode preserved
- UI components should call services, not backend/storage implementations directly
- API should enqueue work rather than generating documents inline
- worker should remain the single owner of document-generation logic
- prefer targeted fixes over broad refactors

## Acceptance Checks

1. A workbook whose `0_ReadMe!B4` value mismatches the dropdown shows an error and disables submit.
2. Validation completes without hanging the page.
3. Submit immediately shows request status.
4. Completed requests produce a `.docx` in the configured local output folder.
5. The UI can open or download the generated file.
6. Tables from worksheets with multiple logical tables remain separated correctly.
7. Generated Word tables keep visible borders even when source cells are blank.

## Library and Runtime Notes

- Use BullMQ for queueing.
- Use a Redis-compatible backend that satisfies BullMQ requirements; Memurai is the current local runtime.
- Use ExcelJS in the worker for workbook parsing.
- Use SheetJS/xlsx in the front end for lightweight validation.
- Use Angular Material for controls and current light-theme styling.

## Deliverables to Keep in Sync

- `specs.md`
- `instructions.md`
- `apps/web`
- `apps/api`
- `apps/worker`
- `shared/mapping/PricingTemplate_To_Contract_Mapping.json`

Whenever the behavior changes, update these docs so they describe the implemented system rather than the original OneDrive-first plan.

---

## Step 7 — Adding a New Document Template / Pricing Model

Complete these sub-steps in order.  Every file path is relative to
`freight-contract-generator/`.

### 7.1 Create the Word contract template

Copy the closest existing contract template from `shared/contracts/` and edit
it for the new model.  Save as:
```
shared/contracts/Freight_Logistics_Contract_<MODEL>_AllTables.docx
```
Insert `{{PlaceholderName}}` tokens in the body for every dynamic field.
Token names must match the keys declared in `placeholders` in Step 7.2.

> If the new contract requires a different body text structure, add a new
> template string array in `apps/worker/src/contract-builder.ts` keyed by
> `templateId` and select it in `buildContract()` based on that key.

### 7.2 Add the mapping entry

Open `shared/mapping/PricingTemplate_To_Contract_Mapping.json` and append to
the `"templates"` array.  The minimum required structure:

```jsonc
{
  "templateId": "FREIGHT_PRICING_<MODEL>",
  "pricingModel": "<Human label shown in UI>",
  "detection": {
    "primary":   { "sheet": "_Meta",             "key":   "TemplateID",   "expected": "FREIGHT_PRICING_<MODEL>" },
    "secondary": { "sheet": "0_ReadMe",          "cell":  "B4",           "expected": "<Human label>" },
    "tertiary":  { "sheet": "1_Customer_Profile","field": "Pricing Model","expected": "<Human label>" }
  },
  "artifacts": {
    "excel":    "Freight_Pricing_Contract_Template_<MODEL>.xlsx",
    "contract": "Freight_Logistics_Contract_<MODEL>_AllTables.docx"
  },
  "placeholders": {
    // copy from ZONE template and modify as needed
  },
  "tables": [
    // one entry per worksheet that should appear in the output document
  ]
}
```

See **Section 12** of `specs.md` for a full annotated example.

### 7.3 Add the model to the Angular dropdown

In `apps/web/src/app/home.component.ts`, add the new label to `pricingModels`:

```typescript
pricingModels = ['Zone-based', 'Mileage-based', '<Human label>'];
```

### 7.4 Extend model detection in the worker

If the new label is not already handled in `detectPricingModelFromWorkbook()`
(`apps/worker/src/worker.ts`), add a detection branch:

```typescript
if (b4.includes('<keyword>')) return '<Human label>';
```

Also add `'<Human label>'` to the `pricingModel` union in `JobData`.

### 7.5 Smoke-test

1. Start API, Worker, and Frontend.
2. Select the new model in the UI dropdown.
3. Upload a workbook whose `0_ReadMe!B4` matches the new label.
4. Validate → confirm success; Submit → confirm `.docx` written to output path.

---

## Step 8 — Enterprise Active Directory (Azure AD / Entra ID) Integration

The codebase ships with both auth paths already implemented.  Follow these
steps to switch from local auth to Azure AD.

### 8.1 Register the app in Azure Entra

1. **Azure Portal → Entra ID → App registrations → New registration**
   - Name: `Freight Contract Generator`
   - Account types: `This organization only`
   - Redirect URIs (SPA): `http://localhost:4200`, `http://localhost:8080`,
     and the production URL when deployed
2. Note **Application (client) ID** → `AZURE_CLIENT_ID`
3. Note **Directory (tenant) ID** → `AZURE_TENANT_ID`

### 8.2 Create app roles

In **App roles**, add two roles:

| Display name | Value | Allowed member types |
|---|---|---|
| Admin | `ADMIN` | Users / Groups |
| Freight User | `FREIGHT_USER` | Users / Groups |

Assign users/groups in **Enterprise Applications → Users and groups**.

### 8.3 Update the API environment

In `apps/api/.env` (or the server environment):

```env
AUTH_MODE=azure
AZURE_TENANT_ID=<tenant id>
AZURE_CLIENT_ID=<client id>
BYPASS_AUTH=false
```

No code changes to `main.ts` are required; the existing `authenticate()`
middleware already handles Azure AD token validation via JWKS.

### 8.4 Configure the Angular frontend

`@azure/msal-browser` is already installed.

1. Create `apps/web/src/app/msal.config.ts` with `clientId` / `authority`
   from Step 8.1 (see **Section 13.5** of `specs.md` for the full template).
2. Update `AuthService`:
   - `login()` → call `MsalService.loginPopup(loginRequest)`
   - `getToken()` → call `MsalService.acquireTokenSilent(loginRequest).then(r => r.accessToken)`
   - `isLoggedIn` → `MsalService.getAllAccounts().length > 0`
3. In `app.config.ts`, register `MsalModule.forRoot(...)` (see `specs.md` §13.5).

### 8.5 Validate end-to-end

1. Start the API with `AUTH_MODE=azure`.
2. Open the frontend; confirm the login popup appears.
3. Log in with an Entra account that has the `FREIGHT_USER` role.
4. Submit a contract generation request; confirm the JWT is accepted by the API.
5. Verify role enforcement: a user without `ADMIN` role cannot access admin
   endpoints.

### 8.6 Keep local auth available for offline development

Maintain `AUTH_MODE=local` in a local `.env.local` file so developers without
Azure subscriptions can run the stack without a live Entra tenant.
The local `POST /api/auth/login` endpoint remains but is never reached when
`AUTH_MODE=azure`.
