jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  CachesDirectoryPath: '/cache',
  exists: jest.fn(() => Promise.resolve(false)),
  readFile: jest.fn(),
  writeFile: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
  mkdir: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
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
import {
  buildCameraCapabilities,
  firstSupportedVideoQuality,
} from '../utils/cameraCapabilities';
import { ensureVideoExtension } from '../utils/gallery';
import { buildReadyAsset, enrichGalleryMediaWithIndex } from '../utils/mediaIndex';
import {
  createMediaJob,
  markStaleRunningJobs,
  updateMediaJobInList,
} from '../utils/mediaJobQueue';
import {
  isAspectRatioId,
  isPhotoFormat,
  isSafetyOverlayMode,
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
    expect(isSafetyOverlayMode('subtle')).toBe(true);
    expect(isSafetyOverlayMode('visible')).toBe(false);
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

describe('camera capabilities', () => {
  it('derives flash, fps and quality support from the active device', () => {
    const device = {
      id: 'back-0',
      hasFlash: true,
      hasTorch: false,
      supportsFPS: jest.fn((fps: number) => fps <= 30),
      getSupportedResolutions: jest.fn(() => [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
      ]),
    };

    const capabilities = buildCameraCapabilities(device as any);

    expect(capabilities.deviceId).toBe('back-0');
    expect(capabilities.flash).toEqual({ auto: true, on: true, torch: false });
    expect(capabilities.videoFps[30]).toBe(true);
    expect(capabilities.videoFps[60]).toBe(false);
    expect(capabilities.videoQualities['1080']).toBe(true);
    expect(capabilities.videoQualities['4K']).toBe(false);
    expect(firstSupportedVideoQuality(capabilities)).toBe('1080');
  });
});

describe('media index helpers', () => {
  it('enriches gallery media with capture group metadata', () => {
    const asset = buildReadyAsset({
      captureId: 'cap_1',
      createdAt: 1000,
      type: 'photo',
      role: 'sub',
      aspect: '16:9',
      uri: 'content://media/1',
      localPath: '/storage/DCIM/DualViewCamera/sub.jpg',
    });

    const [item] = enrichGalleryMediaWithIndex(
      [
        {
          id: '1',
          uri: 'content://media/1',
          filepath: '/storage/DCIM/DualViewCamera/sub.jpg',
          type: 'photo',
          filename: 'sub.jpg',
          fileSize: 12,
          width: 1920,
          height: 1080,
          duration: 0,
          timestamp: 1000,
        },
      ],
      [
        {
          captureId: 'cap_1',
          createdAt: 1000,
          mode: 'dual',
          outputPackId: 'dual-main-sub',
          assets: [asset],
        },
      ],
    );

    expect(item.captureId).toBe('cap_1');
    expect(item.captureRole).toBe('sub');
    expect(item.captureGroupSize).toBe(1);
  });
});

describe('media job queue helpers', () => {
  it('creates and updates background media jobs with bounded progress', () => {
    const job = createMediaJob({
      captureId: 'cap_2',
      type: 'video-variant',
      input: { role: 'sub' },
      now: 1000,
    });

    const [updated] = updateMediaJobInList(
      [job],
      job.id,
      { status: 'running', progress: 2 },
      1200,
    );

    expect(updated.captureId).toBe('cap_2');
    expect(updated.status).toBe('running');
    expect(updated.progress).toBe(1);
    expect(updated.updatedAt).toBe(1200);
  });

  it('marks interrupted queued and running jobs as failed after reload', () => {
    const queued = createMediaJob({
      captureId: 'cap_3',
      type: 'video-variant',
      input: {},
      now: 1000,
    });
    const running = { ...queued, id: 'running-job', status: 'running' as const };
    const succeeded = { ...queued, id: 'done-job', status: 'succeeded' as const };

    const recovered = markStaleRunningJobs([queued, running, succeeded], 2000);

    expect(recovered[0].status).toBe('failed');
    expect(recovered[1].status).toBe('failed');
    expect(recovered[2].status).toBe('succeeded');
    expect(recovered[0].errorMessage).toContain('后台任务未完成');
  });
});
