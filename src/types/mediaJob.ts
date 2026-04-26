export type MediaJobType =
  | 'photo-variant'
  | 'photo-pack'
  | 'video-variant'
  | 'cover-generate'
  | 'gallery-save';

export type MediaJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface MediaJob {
  id: string;
  captureId: string;
  type: MediaJobType;
  status: MediaJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
  retryCount: number;
}
