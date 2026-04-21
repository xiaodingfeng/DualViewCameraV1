import { Platform, StatusBar } from 'react-native';
import RNFS from 'react-native-fs';
import { CommonResolutions } from 'react-native-vision-camera';

import type {
  AspectRatioId,
  PhotoQuality,
  PhotoFormat,
  VideoQuality,
  VideoCodecFormat,
  PhotoVariant,
} from '../types/camera';

export const COLORS = {
  bg: '#000000',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.72)',
  line: 'rgba(255,255,255,0.28)',
  panel: 'rgba(0,0,0,0.72)',
  accent: '#ffd166',
  red: '#ff3b30',
};

export const TOP_BAR_OFFSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 50;
export const PREVIEW_TOP_OFFSET = 0;
export const LANDSCAPE_MAIN_BOTTOM_OFFSET = 148;
export const ZOOM_BAR_WIDTH = 280;
export const PX_PER_ZOOM = 120;
export const SETTINGS_PATH = `${RNFS.DocumentDirectoryPath}/dual-view-camera-settings.json`;

export const ASPECT_RATIOS: Array<{
  id: AspectRatioId;
  label: string;
  previewAspect?: number;
  photoVariant: PhotoVariant;
  photoResolution: { width: number; height: number };
}> = [
  { id: 'full', label: '全屏', previewAspect: undefined, photoVariant: 'full', photoResolution: CommonResolutions.HIGHEST_4_3 },
  { id: '1:1', label: '1:1', previewAspect: 1, photoVariant: 'square', photoResolution: { width: 3024, height: 3024 } },
  { id: '4:3', label: '4:3', previewAspect: 3 / 4, photoVariant: 'photo4x3', photoResolution: CommonResolutions.UHD_4_3 },
  { id: '16:9', label: '16:9', previewAspect: 9 / 16, photoVariant: 'video16x9', photoResolution: CommonResolutions.UHD_16_9 },
];

export const PHOTO_QUALITY_CONFIG: Record<
  PhotoQuality,
  { label: string; quality: number; nativeQuality: number; priority: 'speed' | 'balanced' | 'quality' }
> = {
  high: { label: '高', quality: 1, nativeQuality: 99, priority: 'quality' },
  standard: { label: '标准', quality: 0.92, nativeQuality: 94, priority: 'balanced' },
  low: { label: '低', quality: 0.78, nativeQuality: 82, priority: 'speed' },
};

export const PHOTO_FORMAT_CONFIG: Record<PhotoFormat, { label: string }> = {
  jpeg: { label: 'JPG' },
  heic: { label: 'HEIF' },
};

export const VIDEO_QUALITY_CONFIG: Record<
  VideoQuality,
  {
    label: string;
    resolution: { width: number; height: number };
    landscape: { width: number; height: number };
    portrait: { width: number; height: number };
  }
> = {
  '720': { label: '720', resolution: CommonResolutions.HD_16_9, landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
  '1080': { label: '1080', resolution: CommonResolutions.FHD_16_9, landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } },
  '4K': { label: '4K', resolution: CommonResolutions.UHD_16_9, landscape: { width: 3840, height: 2160 }, portrait: { width: 2160, height: 3840 } },
  '8K': { label: '8K', resolution: CommonResolutions['8k_16_9'], landscape: { width: 8064, height: 4536 }, portrait: { width: 4536, height: 8064 } },
};

export const VIDEO_CODEC_CONFIG: Record<VideoCodecFormat, { label: string }> = {
  h265: { label: 'HEVC' },
  h264: { label: 'H.264' },
};
