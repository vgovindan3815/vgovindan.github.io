import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface JobStatus {
  requestId: string;
  status: 'Queued' | 'Processing' | 'Completed' | 'Failed';
  progress: number;
  message?: string;
  outputPath?: string;
  outputBase64?: string;
  error?: { code: string; details: string };
}

export interface SubmitRequest {
  pricingModel: 'Zone-based' | 'Mileage-based' | 'Auto';
  input: { driveId: string; itemId: string; name: string; localFileBase64?: string };
  output: { localPath: string; fileName: string };
}

export interface SubmitResponse {
  requestId: string;
  status: string;
  statusUrl: string;
}

export interface BatchSubmitRequest {
  inputDir: string;
  outputDir: string;
  pricingModel: 'Zone-based' | 'Mileage-based' | 'Auto';
}

export interface BatchSubmitResponse {
  batchId: string;
  status: string;
  totalFiles: number;
  statusUrl: string;
  requestIds: string[];
}

export interface BatchItemStatus extends JobStatus {
  sourceFile?: string;
}

export interface BatchStatusResponse {
  batchId: string;
  status: 'Queued' | 'Processing' | 'Completed' | 'CompletedWithErrors' | 'Failed';
  inputDir: string;
  outputDir: string;
  pricingModel: 'Zone-based' | 'Mileage-based' | 'Auto';
  submittedAt: string;
  submittedBy: string;
  requestIds: string[];
  total: number;
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  items: BatchItemStatus[];
  retryOfBatchId?: string;
}

export interface BatchFolderBrowseResponse {
  roots: string[];
  currentPath: string | null;
  parentPath: string | null;
  directories: string[];
}

export interface FolderPickRequest {
  title?: string;
  startPath?: string;
}

export interface FolderPickResponse {
  path: string | null;
  canceled: boolean;
}

@Injectable({ providedIn: 'root' })
export class RequestsApiService {
  readonly baseUrl = environment.apiBaseUrl;

  constructor(private readonly http: HttpClient) {}

  private effectiveToken(token: string): string {
    const explicit = token?.trim();
    if (explicit) {
      return explicit;
    }

    if (typeof localStorage === 'undefined') {
      return '';
    }

    return localStorage.getItem('freight.auth.token') ?? '';
  }

  private buildHeaders(token: string): HttpHeaders {
    let headers = new HttpHeaders();
    const effective = this.effectiveToken(token);
    if (effective) {
      headers = headers.set('Authorization', `Bearer ${effective}`);
    }
    return headers;
  }

  submit(req: SubmitRequest, token: string): Observable<SubmitResponse> {
    return this.http.post<SubmitResponse>(`${this.baseUrl}/api/requests`, req, {
      headers: this.buildHeaders(token),
    });
  }

  getStatus(requestId: string, token: string): Observable<JobStatus> {
    return this.http.get<JobStatus>(`${this.baseUrl}/api/requests/${requestId}`, {
      headers: this.buildHeaders(token),
    });
  }

  submitBatch(req: BatchSubmitRequest, token: string): Observable<BatchSubmitResponse> {
    return this.http.post<BatchSubmitResponse>(`${this.baseUrl}/api/batch/requests`, req, {
      headers: this.buildHeaders(token),
    });
  }

  getBatchStatus(batchId: string, token: string): Observable<BatchStatusResponse> {
    return this.http.get<BatchStatusResponse>(`${this.baseUrl}/api/batch/requests/${batchId}`, {
      headers: this.buildHeaders(token),
    });
  }

  browseBatchFolders(pathValue: string | null, token: string): Observable<BatchFolderBrowseResponse> {
    const encoded = pathValue ? `?path=${encodeURIComponent(pathValue)}` : '';
    return this.http.get<BatchFolderBrowseResponse>(`${this.baseUrl}/api/batch/folders${encoded}`, {
      headers: this.buildHeaders(token),
    });
  }

    listFolders(path: string, token: string): Observable<BatchFolderBrowseResponse> {
      const encoded = path ? `?path=${encodeURIComponent(path)}` : '';
      return this.http.get<BatchFolderBrowseResponse>(`${this.baseUrl}/api/batch/folders${encoded}`, {
        headers: this.buildHeaders(token),
      });
    }

  pickFolder(req: FolderPickRequest, token: string): Observable<FolderPickResponse> {
    return this.http.post<FolderPickResponse>(`${this.baseUrl}/api/system/pick-folder`, req, {
      headers: this.buildHeaders(token),
    });
  }

  retryFailedBatch(batchId: string, token: string): Observable<BatchSubmitResponse> {
    return this.http.post<BatchSubmitResponse>(`${this.baseUrl}/api/batch/requests/${batchId}/retry-failed`, {}, {
      headers: this.buildHeaders(token),
    });
  }
}
