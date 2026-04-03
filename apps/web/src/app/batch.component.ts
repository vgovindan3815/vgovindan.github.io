import { ChangeDetectorRef, Component, NgZone, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription, switchMap, takeWhile, timeout, timer } from 'rxjs';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import {
  BatchSubmitResponse,
  BatchStatusResponse,
  RequestsApiService,
} from './services/requests-api.service';

@Component({
  selector: 'app-batch',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './batch.component.html',
  styleUrl: './batch.component.scss',
})
export class BatchComponent implements OnDestroy {
  private readonly api = inject(RequestsApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);

  inputDir = 'C:\\Input';
  outputDir = 'C:\\output';
  pricingModel: 'Auto' | 'Zone-based' | 'Mileage-based' = 'Auto';

  submitting = false;
  error: string | null = null;
  batchStatus: BatchStatusResponse | null = null;

  browsing = false;

  private pollSub?: Subscription;

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  private syncView(): void {
    this.zone.run(() => {
      this.cdr.detectChanges();
    });
  }

  get canSubmit(): boolean {
    return !!this.inputDir.trim() && !!this.outputDir.trim() && !this.submitting;
  }

  get hasFailedItems(): boolean {
    return !!this.batchStatus && this.batchStatus.failed > 0;
  }

  async runBatch(): Promise<void> {
    if (!this.canSubmit) return;

    this.error = null;
    this.submitting = true;
    this.syncView();

    try {
      const response = await firstValueFrom(
        this.api.submitBatch(
          {
            inputDir: this.inputDir.trim(),
            outputDir: this.outputDir.trim(),
            pricingModel: this.pricingModel,
          },
          '',
        ).pipe(timeout(15000)),
      );
      this.startPolling(response.batchId);
      this.syncView();
    } catch (err) {
      const e = err as { error?: { error?: string } };
      this.error = e.error?.error ?? 'Failed to start batch process.';
      this.syncView();
    } finally {
      this.submitting = false;
      this.syncView();
    }
  }

  private startPolling(batchId: string): void {
    this.pollSub?.unsubscribe();
    this.pollSub = timer(0, 5000)
      .pipe(
        switchMap(() => this.api.getBatchStatus(batchId, '')),
        takeWhile((status) => status.status !== 'Completed' && status.status !== 'CompletedWithErrors' && status.status !== 'Failed', true),
      )
      .subscribe({
        next: (status) => {
          this.zone.run(() => {
            this.batchStatus = status;
            this.cdr.detectChanges();
          });
        },
        error: () => {
          this.zone.run(() => {
            this.error = 'Failed to poll batch status.';
            this.cdr.detectChanges();
          });
        },
      });
  }

  async openFolderBrowser(target: 'input' | 'output'): Promise<void> {
    this.error = null;
    this.browsing = true;
    this.syncView();
    try {
      const response = await firstValueFrom(
        this.api
          .pickFolder(
            {
              title: target === 'input' ? 'Select batch input folder' : 'Select batch output folder',
              startPath: target === 'input' ? this.inputDir.trim() || undefined : this.outputDir.trim() || undefined,
            },
            '',
          )
          .pipe(timeout(130000)),
      );

      if (response.path) {
        if (target === 'input') {
          this.inputDir = response.path;
        } else {
          this.outputDir = response.path;
        }
      }
    } catch {
      this.error = 'Failed to open the native Windows folder picker. You can still type the full folder path manually.';
    } finally {
      this.browsing = false;
      this.syncView();
    }
  }

  async retryFailedFiles(): Promise<void> {
    if (!this.batchStatus?.batchId) return;
    this.error = null;
    this.submitting = true;
    this.syncView();
    try {
      const response: BatchSubmitResponse = await firstValueFrom(
        this.api.retryFailedBatch(this.batchStatus.batchId, '').pipe(timeout(15000)),
      );
      this.startPolling(response.batchId);
      this.syncView();
    } catch (err) {
      const e = err as { error?: { error?: string } };
      this.error = e.error?.error ?? 'Failed to retry failed files.';
      this.syncView();
    } finally {
      this.submitting = false;
      this.syncView();
    }
  }

  exportBatchCsv(): void {
    if (!this.batchStatus) return;

    const lines = [
      ['Batch ID', this.batchStatus.batchId],
      ['Status', this.batchStatus.status],
      ['Input Dir', this.batchStatus.inputDir],
      ['Output Dir', this.batchStatus.outputDir],
      ['Pricing Model', this.batchStatus.pricingModel],
      ['Total', String(this.batchStatus.total)],
      ['Completed', String(this.batchStatus.completed)],
      ['Failed', String(this.batchStatus.failed)],
      ['Processing', String(this.batchStatus.processing)],
      ['Queued', String(this.batchStatus.queued)],
      [],
      ['Source File', 'Request ID', 'Status', 'Progress', 'Message', 'Output Path'],
      ...this.batchStatus.items.map((item) => [
        item.sourceFile ?? '',
        item.requestId,
        item.status,
        String(item.progress),
        item.message ?? '',
        item.outputPath ?? '',
      ]),
    ];

    const csv = lines
      .map((row) =>
        row
          .map((cell) => {
            const v = String(cell ?? '');
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(','),
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-${this.batchStatus.batchId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  readonly appBaseHref = '/apps/freight';
}
