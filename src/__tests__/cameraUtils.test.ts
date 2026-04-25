jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  copyFile: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: jest.fn(),
    saveAsset: jest.fn(),
    deletePhotos: jest.fn(),
  },
}));

jest.mock('react-native-vision-camera', () => ({
  CommonResolutions: {
    HIGHEST_4_3: { width: 4032, height: 3024 },
    UHD_4_3: { width: 3840, height: 2880 },
    UHD_16_9: { width: 3840, height: 2160 },
    HD_16_9: { width: 1280, height: 720 },
    FHD_16_9: { width: 1920, height: 1080 },
    '8k_16_9': { width: 8064, height: 4536 },
  },
}));

import { ASPECT_RATIOS, VIDEO_QUALITY_CONFIG } from '../config/camera';
import {
  calculateContainedFrame,
  videoFpsOptionsForQuality,
  videoTargetSizeForAspect,
  visibleFrameSpec,
} from '../utils/camera';
import { buildCompositionScene } from '../utils/composition';
import { ensureVideoExtension } from '../utils/gallery';
import {
  isAspectRatioId,
  isPhotoFormat,
  isVideoCodecFormat,
  isVideoFps,
  isVideoQuality,
  isViewMode,
} from '../utils/settings';

describe('camera geometry helpers', () => {
  const aspect16x9 = ASPECT_RATIOS.find(item => item.id === '16:9')!;
  const aspect4x3 = ASPECT_RATIOS.find(item => item.id === '4:3')!;
  const aspectFull = ASPECT_RATIOS.find(item => item.id === 'full')!;

  it('builds visible frame specs for portrait and landscape crops', () => {
    expect(visibleFrameSpec('portrait', aspect16x9, 9 / 16)).toEqual({
      aspect: 9 / 16,
      variant: 'video16x9',
    });
    expect(visibleFrameSpec('landscape', aspect16x9, 9 / 16)).toEqual({
      aspect: 16 / 9,
      variant: 'landscape',
    });
    expect(visibleFrameSpec('landscape', aspect4x3, 3 / 4)).toEqual({
      aspect: 4 / 3,
      variant: 'landscape',
    });
  });

  it('keeps full aspect tied to current preview orientation', () => {
    expect(visibleFrameSpec('portrait', aspectFull, 9 / 16)).toEqual({
      aspect: 9 / 16,
      variant: 'full',
    });
    expect(visibleFrameSpec('landscape', aspectFull, 9 / 16)).toEqual({
      aspect: 16 / 9,
      variant: 'full',
    });
  });

  it('calculates contained frames without exceeding the container', () => {
    expect(calculateContainedFrame(400, 800, 9 / 16)).toEqual({
      width: 400,
      height: 400 / (9 / 16),
    });
    expect(calculateContainedFrame(800, 400, 9 / 16)).toEqual({
      width: 400 * (9 / 16),
      height: 400,
    });
    expect(calculateContainedFrame(0, 400, 9 / 16)).toEqual({
      width: '100%',
      height: '100%',
    });
  });
});

describe('video helpers', () => {
  it('filters fps options by camera capability and quality', () => {
    const supports60 = { supportsFPS: jest.fn(() => true) };
    const no60 = { supportsFPS: jest.fn(() => false) };

    expect(videoFpsOptionsForQuality(supports60 as any, '4K')).toEqual([30, 60]);
    expect(videoFpsOptionsForQuality(no60 as any, '4K')).toEqual([30]);
    expect(videoFpsOptionsForQuality(supports60 as any, '8K')).toEqual([30]);
  });

  it('uses even dimensions for target video sizes', () => {
    expect(videoTargetSizeForAspect(16 / 9, VIDEO_QUALITY_CONFIG['1080'])).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(videoTargetSizeForAspect(9 / 16, VIDEO_QUALITY_CONFIG['1080'])).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(videoTargetSizeForAspect(1, VIDEO_QUALITY_CONFIG['720'])).toEqual({
      width: 1280,
      height: 1280,
    });
  });
});

describe('gallery helpers', () => {
  it('keeps existing video extensions', async () => {
    await expect(ensureVideoExtension('/tmp/source.mp4', '主画面')).resolves.toBe(
      '/tmp/source.mp4',
    );
  });

  it('copies extensionless videos to an mp4 cache file', async () => {
    await expect(ensureVideoExtension('file:///tmp/source', '副 画面')).resolves.toMatch(
      /^\/cache\/DualViewCamera___\d+\.mp4$/,
    );
  });
});

describe('settings guards', () => {
  it('accept valid persisted setting values only', () => {
    expect(isAspectRatioId('16:9')).toBe(true);
    expect(isAspectRatioId('9:16')).toBe(false);
    expect(isPhotoFormat('jpeg')).toBe(true);
    expect(isPhotoFormat('jpg')).toBe(false);
    expect(isVideoCodecFormat('h265')).toBe(true);
    expect(isVideoCodecFormat('av1')).toBe(false);
    expect(isVideoFps(60)).toBe(true);
    expect(isVideoFps(24)).toBe(false);
    expect(isVideoQuality('4K')).toBe(true);
    expect(isVideoQuality('2K')).toBe(false);
    expect(isViewMode('dual')).toBe(true);
    expect(isViewMode('pip')).toBe(false);
  });
});

describe('buildCompositionScene', () => {
  const aspect16x9 = ASPECT_RATIOS.find(item => item.id === '16:9')!;

  it('matches the current dual-view display and save orientation rules', () => {
    const scene = buildCompositionScene({
      viewMode: 'dual',
      selectedAspect: aspect16x9,
      isSwapped: false,
      isDeviceLandscape: false,
      fullMainAspect: 9 / 16,
      saveDualOutputs: true,
    });

    expect(scene.layoutId).toBe('pip');
    expect(scene.display.main.orientation).toBe('portrait');
    expect(scene.display.sub?.orientation).toBe('landscape');
    expect(scene.save.main.orientation).toBe('portrait');
    expect(scene.save.sub.orientation).toBe('landscape');
    expect(scene.save.main.variant).toBe('video16x9');
    expect(scene.save.sub.variant).toBe('landscape');
    expect(scene.outputs.find(output => output.id === 'sub-photo')?.enabled).toBe(
      true,
    );
  });

  it('reverses main and sub roles after PiP swap', () => {
    const scene = buildCompositionScene({
      viewMode: 'dual',
      selectedAspect: aspect16x9,
      isSwapped: true,
      isDeviceLandscape: true,
      fullMainAspect: 9 / 16,
      saveDualOutputs: false,
    });

    expect(scene.display.main.orientation).toBe('landscape');
    expect(scene.display.sub?.orientation).toBe('portrait');
    expect(scene.save.main.orientation).toBe('portrait');
    expect(scene.save.sub.orientation).toBe('landscape');
    expect(scene.outputs.find(output => output.id === 'sub-video')?.enabled).toBe(
      false,
    );
  });
});
