import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export interface PickedFile {
  driveId: string;
  itemId: string;
  name: string;
}

export interface PickedFolder {
  driveId: string;
  folderId: string;
  path: string;
}

@Injectable({ providedIn: 'root' })
export class GraphPickerService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  /**
   * Open the OneDrive file picker (v8 API) in a popup window.
   * Returns selected file's driveId, itemId and name, or null if cancelled.
   */
  async openFilePicker(filters: string[] = ['.xlsx']): Promise<PickedFile | null> {
    const token = await this.auth.getToken();
    if (!token) return null;

    const baseUrl = await this.getOdbBaseUrl(token);
    if (!baseUrl) return null;

    return this.openPicker(
      {
        sdk: '8.0',
        entry: { oneDrive: { files: {} } },
        authentication: {},
        messaging: { origin: window.location.origin, channelId: `pick-file-${Date.now()}` },
        typesAndSources: { mode: 'files', filters },
        selection: { mode: 'single' },
      },
      baseUrl,
      token,
      (item) => ({
        driveId:
          ((item['parentReference'] as { driveId?: string } | undefined)?.['driveId'] as string) ??
          '',
        itemId: item['id'] as string,
        name: item['name'] as string,
      }),
    );
  }

  /**
   * Open the OneDrive folder picker (v8 API) in a popup window.
   * Returns selected folder's driveId, folderId and path, or null if cancelled.
   */
  async openFolderPicker(): Promise<PickedFolder | null> {
    const token = await this.auth.getToken();
    if (!token) return null;

    const baseUrl = await this.getOdbBaseUrl(token);
    if (!baseUrl) return null;

    return this.openPicker(
      {
        sdk: '8.0',
        entry: { oneDrive: {} },
        authentication: {},
        messaging: { origin: window.location.origin, channelId: `pick-folder-${Date.now()}` },
        typesAndSources: { mode: 'folders' },
        selection: { mode: 'single' },
      },
      baseUrl,
      token,
      (item) => ({
        driveId:
          ((item['parentReference'] as { driveId?: string } | undefined)?.['driveId'] as string) ??
          '',
        folderId: item['id'] as string,
        path: (item['webUrl'] as string) ?? '/Documents/Contracts',
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Resolve the user's OneDrive for Business (ODB) base URL, e.g. https://contoso-my.sharepoint.com */
  private async getOdbBaseUrl(token: string): Promise<string | null> {
    try {
      const me = await firstValueFrom(
        this.http.get<{ mySite?: string }>('https://graph.microsoft.com/v1.0/me?$select=mySite', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      if (!me.mySite) return null;
      const url = new URL(me.mySite);
      return `${url.protocol}//${url.hostname}`;
    } catch {
      return null;
    }
  }

  /** Generic OneDrive Picker v8 popup helper */
  private openPicker<T>(
    params: Record<string, unknown>,
    baseUrl: string,
    token: string,
    mapItem: (item: Record<string, unknown>) => T,
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const channelId = (params['messaging'] as { channelId: string }).channelId;
      const uri = new URL('/_layouts/15/FilePicker.aspx', baseUrl);
      uri.searchParams.set('pickerSettings', JSON.stringify(params));

      const popup = window.open(uri.toString(), 'OneDrivePicker', 'width=1100,height=700');
      if (!popup) {
        resolve(null);
        return;
      }

      let msgSeq = 0;

      const handler = (event: MessageEvent): void => {
        // Only accept messages from our picker popup
        if (event.source !== popup) return;

        // Normalize origin check: picker sends from SharePoint origin
        const msg = event.data as { type: string; id?: string; channelId?: string; data?: Record<string, unknown> };
        if (!msg?.type) return;

        if (msg.type === 'initialize' && msg.channelId === channelId) {
          popup.postMessage({ type: 'acknowledge', id: msg.id }, baseUrl);
        } else if (msg.type === 'command') {
          popup.postMessage({ type: 'acknowledge', id: msg.id }, baseUrl);
          const cmd = (msg.data as { command?: string })?.command;
          if (cmd === 'authenticate') {
            popup.postMessage(
              { type: 'result', id: ++msgSeq, data: { result: 'token', token } },
              baseUrl,
            );
          }
        } else if (msg.type === 'result') {
          window.removeEventListener('message', handler);
          clearInterval(closedCheck);
          popup.close();

          const result = (msg.data as { result?: string; items?: Record<string, unknown>[] });
          if (result?.result === 'success' && result.items?.[0]) {
            resolve(mapItem(result.items[0]));
          } else {
            resolve(null);
          }
        }
      };

      window.addEventListener('message', handler);

      // Clean up if user closes the popup manually
      const closedCheck = setInterval(() => {
        if (popup.closed) {
          clearInterval(closedCheck);
          window.removeEventListener('message', handler);
          resolve(null);
        }
      }, 800);
    });
  }
}
