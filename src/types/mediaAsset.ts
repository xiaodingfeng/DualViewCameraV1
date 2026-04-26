import type { AspectRatioId, ViewMode } from './camera';

export type DualMediaType = 'photo' | 'video' | 'cover';
export type DualMediaRole =
  | 'main'
  | 'sub'
  | 'vertical'
  | 'horizontal'
  | 'square'
  | 'source'
  | 'cover';
export type DualMediaStatus = 'processing' | 'ready' | 'failed';
export type OutputPackId = 'current-only' | 'dual-main-sub' | 'social-basic';

export interface DualMediaAsset {
  id: string;
  captureId: string;
  createdAt: number;
  type: DualMediaType;
  role: DualMediaRole;
  aspect: AspectRatioId | '3:4' | '9:16';
  uri: string;
  localPath?: string;
  sourceUri?: string;
  templateId?: string;
  title?: string;
  status: DualMediaStatus;
  errorMessage?: string;
}

export interface DualCaptureGroup {
  captureId: string;
  createdAt: number;
  mode: ViewMode;
  outputPackId: OutputPackId;
  assets: DualMediaAsset[];
}
