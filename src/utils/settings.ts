import RNFS from 'react-native-fs';

import { SETTINGS_PATH } from '../config/camera';
import type { CoverTemplateId, CoverTemplateSettings } from '../types/coverTemplate';
import type {
  AspectRatioId,
  CaptureSourceMode,
  PersistedSettings,
  PipAnchor,
  PipLayoutConfig,
  PipScale,
  PreviewLayoutTemplateId,
  PhotoFormat,
  PhotoQuality,
  SafetyOverlayMode,
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

export function isSafetyOverlayMode(value: unknown): value is SafetyOverlayMode {
  return value === 'off' || value === 'subtle' || value === 'strong';
}

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'single' || value === 'dual';
}

export function isCaptureSourceMode(value: unknown): value is CaptureSourceMode {
  return value === 'same-camera-crop' || value === 'concurrent-cameras';
}

export function isPipAnchor(value: unknown): value is PipAnchor {
  return value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'bottom-right';
}

export function isPipScale(value: unknown): value is PipScale {
  return value === 'small' || value === 'medium' || value === 'large';
}

export function isPreviewLayoutTemplateId(value: unknown): value is PreviewLayoutTemplateId {
  return value === 'pip' || value === 'split-horizontal' || value === 'split-vertical' || value === 'stack';
}

export function isCoverTemplateId(value: unknown): value is CoverTemplateId {
  return value === 'none' || value === 'clean-date' || value === 'dual-card' || value === 'vlog-title';
}

export function isCoverTemplateSettings(value: unknown): value is CoverTemplateSettings {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCoverTemplateId(candidate.templateId) &&
    typeof candidate.dateWatermarkEnabled === 'boolean' &&
    typeof candidate.infoWatermarkEnabled === 'boolean' &&
    typeof candidate.title === 'string' &&
    candidate.title.length <= 28
  );
}

export function isPipLayoutConfig(value: unknown): value is PipLayoutConfig {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isPipAnchor(candidate.anchor) &&
    isPipScale(candidate.scale) &&
    typeof candidate.marginX === 'number' &&
    Number.isFinite(candidate.marginX) &&
    candidate.marginX >= 0 &&
    candidate.marginX <= 120 &&
    typeof candidate.marginY === 'number' &&
    Number.isFinite(candidate.marginY) &&
    candidate.marginY >= 0 &&
    candidate.marginY <= 320
  );
}
