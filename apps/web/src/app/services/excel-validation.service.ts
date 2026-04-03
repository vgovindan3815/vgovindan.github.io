import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

export type ValidationResult = {
  error: string | null;
  timedOut: boolean;
};

@Injectable({ providedIn: 'root' })
export class ExcelValidationService {

  async validateBufferAsync(
    buffer: ArrayBuffer,
    pricingModel: string,
    timeoutMs = 15000,
  ): Promise<ValidationResult> {
    if (typeof Worker === 'undefined') {
      return { error: this.validateBuffer(buffer, pricingModel), timedOut: false };
    }

    try {
      return await new Promise<ValidationResult>((resolve) => {
        const worker = new Worker(new URL('./excel-validation.worker', import.meta.url), {
          type: 'module',
        });
        let done = false;

        const finish = (result: ValidationResult): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          worker.terminate();
          resolve(result);
        };

        const fallbackToMainThread = (): void => {
          finish({ error: this.validateBuffer(buffer, pricingModel), timedOut: false });
        };

        const timer = setTimeout(() => {
          finish({ error: null, timedOut: true });
        }, timeoutMs);

        worker.onmessage = (event: MessageEvent<{ error: string | null }>) => {
          finish({ error: event.data.error, timedOut: false });
        };

        worker.onerror = () => {
          fallbackToMainThread();
        };

        worker.postMessage({ buffer, pricingModel });
      });
    } catch {
      return { error: this.validateBuffer(buffer, pricingModel), timedOut: false };
    }
  }

  /**
   * Validate an Excel ArrayBuffer: reads cell 0_ReadMe!B4 and checks it
   * matches the selected pricing model. Returns null when valid or an
   * error string on mismatch / unreadable file.
   */
  validateBuffer(buffer: ArrayBuffer, pricingModel: string): string | null {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'array', sheetStubs: true });
    } catch {
      return 'Could not read the selected file. Please ensure it is a valid .xlsx file.';
    }

    const sheet = workbook.Sheets['0_ReadMe'];
    if (!sheet) {
      // Sheet absent — allow through, server will validate
      return null;
    }

    const b4Value = sheet['B4']?.v != null ? String(sheet['B4'].v).trim().toLowerCase() : null;
    const normalizedModel = pricingModel.trim().toLowerCase();
    if (!b4Value) {
      // No value in B4 — allow through
      return null;
    }

    if (b4Value !== normalizedModel) {
      return (
        `Template mismatch: 0_ReadMe!B4 is "${b4Value}" ` +
        `but selected model is "${pricingModel}". ` +
        `Please select the correct pricing model or upload the matching template.`
      );
    }

    return null; // ✅ Valid
  }
}
