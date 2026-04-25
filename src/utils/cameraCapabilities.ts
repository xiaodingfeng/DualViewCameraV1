import { Platform } from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';

import { PHOTO_FORMAT_CONFIG, VIDEO_CODEC_CONFIG, VIDEO_QUALITY_CONFIG } from '../config/camera';
import type { FlashMode, PhotoFormat, VideoCodecFormat, VideoFps, VideoQuality } from '../types/camera';
import type { CameraCapabilities } from '../types/cameraCapabilities';
import { safeSupportsFPS } from './camera';

export interface CameraCapabilitySettingState {
  flashMode: FlashMode;
  photoFormat: PhotoFormat;
  videoFps: VideoFps;
  videoQuality: VideoQuality;
  videoCodec: VideoCodecFormat;
}

export interface CameraCapabilitySettingResolution {
  patch: Partial<CameraCapabilitySettingState>;
  messages: string[];
}

export function buildCameraCapabilities(
  device: CameraDevice | null,
): CameraCapabilities {
  return {
    deviceId: device?.id ?? null,
    flash: {
      auto: Boolean(device?.hasFlash),
      on: Boolean(device?.hasFlash || device?.hasTorch),
      torch: Boolean(device?.hasTorch),
    },
    photoFormats: {
      jpeg: true,
      heic: supportsHeifOutput(),
    },
    videoFps: {
      30: true,
      60: device == null ? false : safeSupportsFPS(device, 60),
    },
    videoQualities: buildVideoQualityCapabilities(device),
    videoCodecs: {
      h265: true,
      h264: true,
    },
  };
}

export function firstSupportedVideoQuality(
  capabilities: CameraCapabilities,
): VideoQuality {
  const preferred: VideoQuality[] = ['4K', '1080', '720', '8K'];
  return (
    preferred.find(quality => capabilities.videoQualities[quality]) ?? '720'
  );
}

export function resolveSettingsForCapabilities(
  capabilities: CameraCapabilities,
  state: CameraCapabilitySettingState,
): CameraCapabilitySettingResolution {
  const patch: Partial<CameraCapabilitySettingState> = {};
  const messages: string[] = [];

  if (state.flashMode === 'auto' && !capabilities.flash.auto) {
    patch.flashMode = 'off';
    messages.push('当前设备不支持自动闪光灯，已关闭');
  } else if (state.flashMode === 'on' && !capabilities.flash.on) {
    patch.flashMode = 'off';
    messages.push('当前设备不支持闪光灯，已关闭');
  }

  if (!capabilities.photoFormats[state.photoFormat]) {
    patch.photoFormat = 'jpeg';
    messages.push(`当前设备不支持 ${PHOTO_FORMAT_CONFIG[state.photoFormat].label}，已切换 JPG`);
  }

  if (!capabilities.videoFps[state.videoFps]) {
    patch.videoFps = 30;
    messages.push(`当前设备不支持 ${state.videoFps}HZ，已切换 30HZ`);
  }

  if (!capabilities.videoQualities[state.videoQuality]) {
    const fallbackQuality = firstSupportedVideoQuality(capabilities);
    patch.videoQuality = fallbackQuality;
    messages.push(
      `当前设备不支持 ${VIDEO_QUALITY_CONFIG[state.videoQuality].label}，已切换 ${VIDEO_QUALITY_CONFIG[fallbackQuality].label}`,
    );
  }

  if (!capabilities.videoCodecs[state.videoCodec]) {
    patch.videoCodec = 'h264';
    messages.push(`当前设备不支持 ${VIDEO_CODEC_CONFIG[state.videoCodec].label}，已切换 H.264`);
  }

  return { patch, messages };
}

function supportsHeifOutput(): boolean {
  if (Platform.OS !== 'android') return false;
  const version =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : Number(Platform.Version);
  return Number.isFinite(version) && version >= 28;
}

function buildVideoQualityCapabilities(
  device: CameraDevice | null,
): CameraCapabilities['videoQualities'] {
  if (device == null) {
    return {
      '720': false,
      '1080': false,
      '4K': false,
      '8K': false,
    };
  }

  const resolutions = safeGetVideoResolutions(device);
  if (resolutions.length === 0) {
    return {
      '720': true,
      '1080': true,
      '4K': true,
      '8K': true,
    };
  }

  return {
    '720': hasResolutionAtLeast(resolutions, VIDEO_QUALITY_CONFIG['720'].landscape),
    '1080': hasResolutionAtLeast(resolutions, VIDEO_QUALITY_CONFIG['1080'].landscape),
    '4K': hasResolutionAtLeast(resolutions, VIDEO_QUALITY_CONFIG['4K'].landscape),
    '8K': hasResolutionAtLeast(resolutions, VIDEO_QUALITY_CONFIG['8K'].landscape),
  };
}

function safeGetVideoResolutions(
  device: CameraDevice,
): Array<{ width: number; height: number }> {
  try {
    return device.getSupportedResolutions('video' as never);
  } catch {
    return [];
  }
}

function hasResolutionAtLeast(
  resolutions: Array<{ width: number; height: number }>,
  target: { width: number; height: number },
): boolean {
  const targetLong = Math.max(target.width, target.height);
  const targetShort = Math.min(target.width, target.height);

  return resolutions.some(resolution => {
    const long = Math.max(resolution.width, resolution.height);
    const short = Math.min(resolution.width, resolution.height);
    return long >= targetLong && short >= targetShort;
  });
}
