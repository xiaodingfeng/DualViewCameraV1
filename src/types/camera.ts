import type { ViewProps } from 'react-native';
import type { CoverTemplateSettings } from './coverTemplate';

export type CaptureMode = 'photo' | 'video';
export type ViewMode = 'single' | 'dual';
export type CaptureSourceMode = 'same-camera-crop' | 'concurrent-cameras';
export type FrameOrientation = 'portrait' | 'landscape';
export type FlashMode = 'off' | 'on' | 'auto';
export type LastMedia = { uri: string; type: 'photo' | 'video'; label: string } | null;
export type GalleryMedia = {
  id: string;
  uri: string;
  filepath: string | null;
  type: 'photo' | 'video';
  filename: string | null;
  fileSize: number | null;
  width: number;
  height: number;
  duration: number;
  timestamp: number;
  captureId?: string;
  captureRole?: 'main' | 'sub' | 'vertical' | 'horizontal' | 'square' | 'source' | 'cover';
  captureGroupSize?: number;
  captureGroupCreatedAt?: number;
  captureStatus?: 'processing' | 'ready' | 'failed';
  templateId?: string;
  title?: string;
  errorMessage?: string;
};

export type AspectRatioId = 'full' | '1:1' | '4:3' | '16:9';
export type PhotoQuality = 'high' | 'standard' | 'low';
export type PhotoFormat = 'jpeg' | 'heic';
export type VideoQuality = '720' | '1080' | '4K' | '8K';
export type VideoFps = 30 | 60;
export type VideoCodecFormat = 'h265' | 'h264';
export type SafetyOverlayMode = 'off' | 'subtle' | 'strong';
export type ConcurrentMainCamera = 'back' | 'front';
export type ConcurrentOutputMode = 'separate' | 'composed';
export type ConcurrentCompositeLayout = 'split-horizontal' | 'split-vertical' | 'stack';
export type ConcurrentPipLayoutConfig = {
  leftRatio: number;
  topRatio: number;
};
export type PipAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type PipScale = 'small' | 'medium' | 'large';
export type PreviewLayoutTemplateId = 'pip' | 'split-horizontal' | 'split-vertical' | 'stack';
export type PipLayoutConfig = {
  anchor: PipAnchor;
  scale: PipScale;
  marginX: number;
  marginY: number;
};
export type PhotoVariant = 'full' | 'portrait' | 'landscape' | 'square' | 'photo4x3' | 'video16x9';
export type VisibleFrameSpec = { aspect: number; variant: PhotoVariant };
export type PersistedSettings = Partial<{
  selectedAspectId: AspectRatioId;
  photoQuality: PhotoQuality;
  photoFormat: PhotoFormat;
  videoFps: VideoFps;
  videoQuality: VideoQuality;
  videoCodec: VideoCodecFormat;
  viewMode: ViewMode;
  captureSourceMode: CaptureSourceMode;
  saveDualOutputs: boolean;
  concurrentMainCamera: ConcurrentMainCamera;
  concurrentOutputMode: ConcurrentOutputMode;
  concurrentCompositeLayout: ConcurrentCompositeLayout;
  concurrentPipLayout: ConcurrentPipLayoutConfig;
  shutterSoundEnabled: boolean;
  safetyOverlayMode: SafetyOverlayMode;
  pipLayout: PipLayoutConfig;
  previewLayoutTemplate: PreviewLayoutTemplateId;
  coverTemplate: CoverTemplateSettings;
}>;

export type NativeVideoViewProps = ViewProps & { sourceUri: string };
