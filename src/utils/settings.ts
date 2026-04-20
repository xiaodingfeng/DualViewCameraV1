import RNFS from 'react-native-fs';

import { SETTINGS_PATH } from '../config/camera';
import type {
  AspectRatioId,
  PersistedSettings,
  PhotoFormat,
  PhotoQuality,
  VideoCodecFormat,
  VideoFps,
  VideoQuality,
  ViewMode,
} from '../types/camera';

export async function loadPersistedSettings(): Promise<PersistedSettings> {
  try {
    const exists = await RNFS.exists(SETTINGS_PATH);
    if (!exists) return {};
    return JSON.parse(await RNFS.readFile(SETTINGS_PATH, 'utf8')) as PersistedSettings;
  } catch {
    return {};
  }
}

export async function savePersistedSettings(settings: PersistedSettings): Promise<void> {
  await RNFS.writeFile(SETTINGS_PATH, JSON.stringify(settings), 'utf8');
}

export function isAspectRatioId(value: unknown): value is AspectRatioId {
  return value === 'full' || value === '1:1' || value === '4:3' || value === '16:9';
}

export function isPhotoQuality(value: unknown): value is PhotoQuality {
  return value === 'high' || value === 'standard' || value === 'low';
}

export function isPhotoFormat(value: unknown): value is PhotoFormat {
  return value === 'jpeg' || value === 'heic';
}

export function isVideoQuality(value: unknown): value is VideoQuality {
  return value === '720' || value === '1080' || value === '4K' || value === '8K';
}

export function isVideoFps(value: unknown): value is VideoFps {
  return value === 30 || value === 60;
}

export function isVideoCodecFormat(value: unknown): value is VideoCodecFormat {
  return value === 'h265' || value === 'h264';
}

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'single' || value === 'dual';
}
