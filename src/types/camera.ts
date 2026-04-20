import type { ViewProps } from 'react-native';

export type CaptureMode = 'photo' | 'video';
export type ViewMode = 'single' | 'dual';
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
};

export type AspectRatioId = 'full' | '1:1' | '4:3' | '16:9';
export type PhotoQuality = 'high' | 'standard' | 'low';
export type PhotoFormat = 'jpeg' | 'heic';
export type VideoQuality = '720' | '1080' | '4K' | '8K';
export type VideoFps = 30 | 60;
export type VideoCodecFormat = 'h265' | 'h264';
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
  saveDualOutputs: boolean;
}>;

export type NativeVideoViewProps = ViewProps & { sourceUri: string };
