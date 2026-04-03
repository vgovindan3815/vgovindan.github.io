import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RequestsApiService } from './services/requests-api.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-folder-browser',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="folder-browser">
      <div class="header">
        <h2>Select Folder</h2>
        <button mat-icon-button (click)="onCancel()" class="close-btn">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="path-bar">
        <input [(ngModel)]="manualPath" placeholder="Or type path..." class="path-input" />
        <button mat-raised-button (click)="navigateTo(manualPath)" [disabled]="loading">
          Go
        </button>
      </div>

      <div class="content">
        <div *ngIf="loading" class="loading">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Loading directories...</p>
        </div>

        <div *ngIf="!loading && error" class="error">
          <mat-icon>error</mat-icon>
          <p>{{ error }}</p>
          <button mat-raised-button (click)="clearError()">Clear</button>
        </div>

        <div *ngIf="!loading && !error" class="browser">
          <div class="breadcrumb" *ngIf="currentPath">
            <span class="label">Current: </span>
            <span class="path">{{ currentPath }}</span>
          </div>

          <div class="directories">
            <button
              *ngIf="parentPath"
              mat-stroked-button
              (click)="goUp()"
              class="directory-item parent"
            >
              <mat-icon>arrow_upward</mat-icon>
              <span>..</span>
            </button>

            <button
              *ngFor="let dir of directories"
              mat-stroked-button
              (click)="navigateTo(dir)"
              class="directory-item"
            >
              <mat-icon>folder</mat-icon>
              <span>{{ getDirectoryName(dir) }}</span>
            </button>
          </div>

          <div *ngIf="directories.length === 0 && !parentPath" class="no-dirs">
            <p>No subdirectories found</p>
          </div>
        </div>
      </div>

      <div class="actions">
        <button mat-raised-button (click)="onCancel()">Cancel</button>
        <button
          mat-raised-button
          color="primary"
          (click)="selectCurrent()"
          [disabled]="!currentPath || loading"
        >
          Select Current Folder
        </button>
      </div>
    </div>
  `,
  styles: [`
    .folder-browser {
      display: flex;
      flex-direction: column;
      height: 500px;
      width: 600px;
      max-width: 90vw;
      gap: 0;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
      }

      .close-btn {
        margin: 0;
      }
    }

    .path-bar {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid #e0e0e0;

      .path-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #d0d0d0;
        border-radius: 4px;
        font-size: 14px;

        &:focus {
          outline: none;
          border-color: #7c3aed;
          box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
        }
      }

      button {
        min-width: 60px;
      }
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;

      &.loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;

        p {
          margin: 0;
          color: #666;
        }
      }

      &.error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        text-align: center;

        mat-icon {
          font-size: 48px;
          color: #d32f2f;
        }

        p {
          margin: 0;
          color: #d32f2f;
        }
      }
    }

    .browser {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .breadcrumb {
        display: flex;
        gap: 8px;
        padding: 8px;
        background: #f5f5f5;
        border-radius: 4px;
        word-break: break-all;

        .label {
          font-weight: 500;
          min-width: max-content;
        }

        .path {
          font-family: monospace;
          font-size: 12px;
        }
      }

      .directories {
        display: flex;
        flex-direction: column;
        gap: 4px;

        .directory-item {
          justify-content: flex-start;
          text-align: left;
          padding: 8px 12px;

          mat-icon {
            margin-right: 8px;
            margin-left: -4px;
          }

          &.parent {
            margin-bottom: 8px;
            border-top: 1px solid #e0e0e0;
            padding-top: 12px;
          }
        }
      }

      .no-dirs {
        text-align: center;
        padding: 24px;
        color: #999;

        p {
          margin: 0;
        }
      }
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
      color: #d32f2f;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
      }

      button {
        margin-top: 8px;
      }
    }

    .actions {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-top: 1px solid #e0e0e0;
      justify-content: flex-end;

      button {
        min-width: 100px;
      }
    }
  `],
})
export class FolderBrowserComponent implements OnInit {
  private readonly api = inject(RequestsApiService);
  private readonly dialogRef = inject(MatDialogRef<FolderBrowserComponent>);
  private readonly data = inject(MAT_DIALOG_DATA, { optional: true }) as { startPath?: string } | null;

  currentPath: string | null = null;
  parentPath: string | null = null;
  directories: string[] = [];
  loading = false;
  error: string | null = null;
  manualPath = '';

  ngOnInit(): void {
    this.loadDirectory(this.data?.startPath?.trim() || 'C:\\');
  }

  async loadDirectory(path: string): Promise<void> {
    try {
      this.loading = true;
      this.error = null;

      const response = await firstValueFrom(this.api.listFolders(path, ''));

      this.currentPath = response.currentPath;
      this.parentPath = response.parentPath;
      this.directories = response.directories || [];
      this.manualPath = '';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load directories';
      console.error('Folder browser error:', err);
    } finally {
      this.loading = false;
    }
  }

  goUp(): void {
    if (this.parentPath) {
      this.loadDirectory(this.parentPath);
    }
  }

  navigateTo(path: string): void {
    this.loadDirectory(path);
  }

  selectCurrent(): void {
    if (this.currentPath) {
      this.dialogRef.close({ selectedPath: this.currentPath });
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }

  clearError(): void {
    this.error = null;
  }

  getDirectoryName(fullPath: string): string {
    const parts = fullPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || fullPath;
  }
}
