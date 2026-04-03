/// <reference lib="webworker" />
import * as XLSX from 'xlsx';

type ValidationRequest = {
  buffer: ArrayBuffer;
  pricingModel: string;
};

type ValidationResponse = {
  error: string | null;
};

function validateBuffer(buffer: ArrayBuffer, pricingModel: string): string | null {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', sheetStubs: true });
  } catch {
    return 'Could not read the selected file. Please ensure it is a valid .xlsx file.';
  }

  const sheet = workbook.Sheets['0_ReadMe'];
  if (!sheet) return null;

  const b4Value = sheet['B4']?.v != null ? String(sheet['B4'].v).trim().toLowerCase() : null;
  const normalizedModel = pricingModel.trim().toLowerCase();
  if (!b4Value) return null;

  if (b4Value !== normalizedModel) {
    return (
      `Template mismatch: 0_ReadMe!B4 is "${b4Value}" ` +
      `but selected model is "${pricingModel}". ` +
      `Please select the correct pricing model or upload the matching template.`
    );
  }

  return null;
}

addEventListener('message', (event: MessageEvent<ValidationRequest>) => {
  const { buffer, pricingModel } = event.data;
  const error = validateBuffer(buffer, pricingModel);
  const response: ValidationResponse = { error };
  postMessage(response);
});
