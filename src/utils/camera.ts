import type { CameraDevice } from 'react-native-vision-camera';

import { ASPECT_RATIOS, VIDEO_QUALITY_CONFIG } from '../config/camera';
import type {
  FrameOrientation,
  VideoFps,
  VideoQuality,
  VisibleFrameSpec,
} from '../types/camera';

export function slugify(v: string): string {
  return v.replace(/[^\w-]+/g, '_') || 'media';
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function visibleFrameSpec(
  orientation: FrameOrientation,
  selectedAspect: (typeof ASPECT_RATIOS)[number],
  fullPortraitAspect: number,
): VisibleFrameSpec {
  const isLandscape = orientation === 'landscape';

  if (selectedAspect.id === 'full') {
    return {
      aspect: isLandscape ? 1 / fullPortraitAspect : fullPortraitAspect,
      variant: 'full',
    };
  }

  if (selectedAspect.id === '1:1') {
    return { aspect: 1, variant: 'square' };
  }

  if (selectedAspect.id === '16:9') {
    return {
      aspect: isLandscape ? 16 / 9 : 9 / 16,
      variant: isLandscape ? 'landscape' : 'video16x9',
    };
  }

  if (selectedAspect.id === '4:3') {
    return {
      aspect: isLandscape ? 4 / 3 : 3 / 4,
      variant: isLandscape ? 'landscape' : 'photo4x3',
    };
  }

  const baseAspect = selectedAspect.previewAspect ?? 3 / 4;

  return {
    aspect: isLandscape ? 1 / baseAspect : baseAspect,
    variant: isLandscape ? 'landscape' : selectedAspect.photoVariant,
  };
}

export function videoTargetSizeForAspect(
  aspectRatio: number,
  quality: (typeof VIDEO_QUALITY_CONFIG)[VideoQuality],
): { width: number; height: number } {
  const targetLongEdge =
    aspectRatio >= 1 ? quality.landscape.width : quality.portrait.height;

  if (Math.abs(aspectRatio - 1) < 0.01) {
    const size = evenDimension(targetLongEdge);
    return { width: size, height: size };
  }

  if (aspectRatio >= 1) {
    return {
      width: evenDimension(targetLongEdge),
      height: evenDimension(targetLongEdge / aspectRatio),
    };
  }

  return {
    width: evenDimension(targetLongEdge * aspectRatio),
    height: evenDimension(targetLongEdge),
  };
}

export function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function pipFrameSize(aspectRatio: number): {
  width: number;
  height: number;
} {
  if (Math.abs(aspectRatio - 1) < 0.01) {
    return { width: 154, height: 154 };
  }
  if (aspectRatio >= 1) {
    return { width: 192, height: Math.round(192 / aspectRatio) };
  }
  return { width: Math.round(168 * aspectRatio), height: 168 };
}

export function formatAspectLabel(aspectRatio: number): string {
  if (Math.abs(aspectRatio - 1) < 0.01) return '1:1';
  if (
    Math.abs(aspectRatio - 16 / 9) < 0.02 ||
    Math.abs(aspectRatio - 9 / 16) < 0.02
  )
    return '16:9';
  if (
    Math.abs(aspectRatio - 4 / 3) < 0.02 ||
    Math.abs(aspectRatio - 3 / 4) < 0.02
  ) {
    return '4:3';
  }
  return '全屏';
}

export function safeSupportsFPS(device: CameraDevice, fps: VideoFps): boolean {
  try {
    return device.supportsFPS(fps);
  } catch {
    return fps === 30;
  }
}

export function nextFps(current: VideoFps, options: VideoFps[]): VideoFps {
  const currentIndex = options.indexOf(current);
  return options[(currentIndex + 1) % options.length] ?? 30;
}

export function nextVideoQuality(current: VideoQuality): VideoQuality {
  const options: VideoQuality[] = ['720', '1080', '4K', '8K'];
  return options[(options.indexOf(current) + 1) % options.length] ?? '4K';
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '未知';
  const millis = timestamp > 100000000000 ? timestamp : timestamp * 1000;
  return new Date(millis).toLocaleString('zh-CN', { hour12: false });
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function touchDistance(
  touches: ReadonlyArray<{ pageX: number; pageY: number }>,
): number | null {
  if (touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

export function touchCenter(
  touches: ReadonlyArray<{ locationX: number; locationY: number }>,
): { x: number; y: number } | null {
  if (touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.locationX + second.locationX) / 2,
    y: (first.locationY + second.locationY) / 2,
  };
}

export function containedMediaFrame(
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): { width: number; height: number } {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    mediaWidth <= 0 ||
    mediaHeight <= 0
  ) {
    return { width: containerWidth, height: containerHeight };
  }

  const containerRatio = containerWidth / containerHeight;
  const mediaRatio = mediaWidth / mediaHeight;

  if (mediaRatio > containerRatio) {
    return { width: containerWidth, height: containerWidth / mediaRatio };
  }

  return { width: containerHeight * mediaRatio, height: containerHeight };
}

export function clampPointToMediaRect(
  point: { x: number; y: number },
  container: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } {
  const left = (container.width - frame.width) / 2;
  const top = (container.height - frame.height) / 2;

  return {
    x: clamp(point.x, left, left + frame.width),
    y: clamp(point.y, top, top + frame.height),
  };
}

export function clampPhotoTranslate(
  translate: { x: number; y: number },
  scale: number,
  size: { width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } {
  if (scale <= 1.02 || size.width <= 0 || size.height <= 0)
    return { x: 0, y: 0 };

  const maxX = Math.max(0, (frame.width * scale - size.width) / 2);
  const maxY = Math.max(0, (frame.height * scale - size.height) / 2);

  return {
    x: clamp(translate.x, -maxX, maxX),
    y: clamp(translate.y, -maxY, maxY),
  };
}

export function calculateContainedFrame(
  containerWidth: number,
  containerHeight: number,
  aspectRatio?: number,
): { width: any; height: any } {
  if (containerWidth <= 0 || containerHeight <= 0 || aspectRatio == null) {
    return { width: '100%', height: '100%' };
  }

  const containerRatio = containerWidth / containerHeight;

  if (containerRatio > aspectRatio) {
    return { width: containerHeight * aspectRatio, height: containerHeight };
  }

  return { width: containerWidth, height: containerWidth / aspectRatio };
}

export function isCameraResourceBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /maximum number of open cameras|too many open cameras|camera.*in use/i.test(
    message,
  );
}

export function cameraErrorMessage(error: any, fallback: string): string {
  const message = error?.message || '';
  if (message.includes('flash')) return '不支持闪光灯';
  return message.split('\n')[0] || fallback;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max));
}
