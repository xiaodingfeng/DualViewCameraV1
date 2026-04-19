import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  FlatList,
  GestureResponderEvent,
  Image,
  Linking,
  LogBox,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  PermissionsAndroid,
  requireNativeComponent,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import RNFS from 'react-native-fs';
import { callback } from 'react-native-nitro-modules';
import {
  CommonResolutions,
  NativePreviewView,
  type CameraDevice,
  type CameraPosition,
  type PreviewView,
  type Recorder,
  useCamera,
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  useMicrophonePermission,
  useOrientation,
  usePhotoOutput,
  usePreviewOutput,
  useVideoOutput,
} from 'react-native-vision-camera';

import FlashAutoIcon from './assets/icons/flash-auto.svg';
import FlashOffIcon from './assets/icons/flash-off.svg';
import FlashOnIcon from './assets/icons/flash-on.svg';
import SettingsIcon from './assets/icons/settings.svg';
import SwitchCameraIcon from './assets/icons/switch.svg';

type CaptureMode = 'photo' | 'video';
type ViewMode = 'single' | 'dual';
type FrameOrientation = 'portrait' | 'landscape';
type FlashMode = 'off' | 'on' | 'auto';
type LastMedia = { uri: string; type: 'photo' | 'video'; label: string } | null;
type GalleryMedia = {
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
type AspectRatioId = 'full' | '1:1' | '4:3' | '16:9';
type PhotoQuality = 'high' | 'standard' | 'low';
type PhotoFormat = 'jpeg' | 'heic';
type VideoQuality = '720' | '1080' | '4K' | '8K';
type VideoFps = 30 | 60;
type VideoCodecFormat = 'h265' | 'h264';
type PhotoVariant = 'full' | 'portrait' | 'landscape' | 'square' | 'photo4x3' | 'video16x9';
type VisibleFrameSpec = { aspect: number; variant: PhotoVariant };
type PersistedSettings = Partial<{
  selectedAspectId: AspectRatioId;
  photoQuality: PhotoQuality;
  photoFormat: PhotoFormat;
  videoFps: VideoFps;
  videoQuality: VideoQuality;
  videoCodec: VideoCodecFormat;
  viewMode: ViewMode;
  saveDualOutputs: boolean;
}>;

type NativeVideoViewProps = ViewProps & { sourceUri: string };
const NativeDualViewVideoView = Platform.OS === 'android'
  ? requireNativeComponent<NativeVideoViewProps>('DualViewVideoView')
  : null;

const COLORS = {
  bg: '#000000',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.72)',
  line: 'rgba(255,255,255,0.28)',
  panel: 'rgba(0,0,0,0.72)',
  accent: '#ffd166',
  red: '#ff3b30',
};

const TOP_BAR_OFFSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 50;
const PREVIEW_TOP_OFFSET = Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;
const LANDSCAPE_MAIN_BOTTOM_OFFSET = 148;
const ZOOM_BAR_WIDTH = 280;
const PX_PER_ZOOM = 120; 
const SETTINGS_PATH = `${RNFS.DocumentDirectoryPath}/dual-view-camera-settings.json`;

const ASPECT_RATIOS: Array<{ id: AspectRatioId; label: string; previewAspect?: number; photoVariant: PhotoVariant; photoResolution: { width: number; height: number } }> = [
  { id: 'full', label: '全屏', previewAspect: undefined, photoVariant: 'full', photoResolution: CommonResolutions.HIGHEST_4_3 },
  { id: '1:1', label: '1:1', previewAspect: 1, photoVariant: 'square', photoResolution: { width: 3024, height: 3024 } },
  { id: '4:3', label: '4:3', previewAspect: 3 / 4, photoVariant: 'photo4x3', photoResolution: CommonResolutions.UHD_4_3 },
  { id: '16:9', label: '16:9', previewAspect: 9 / 16, photoVariant: 'video16x9', photoResolution: CommonResolutions.UHD_16_9 },
];

const PHOTO_QUALITY_CONFIG: Record<PhotoQuality, { label: string; quality: number; nativeQuality: number; priority: 'speed' | 'balanced' | 'quality' }> = {
  high: { label: '高', quality: 1, nativeQuality: 99, priority: 'quality' },
  standard: { label: '标准', quality: 0.92, nativeQuality: 94, priority: 'balanced' },
  low: { label: '低', quality: 0.78, nativeQuality: 82, priority: 'speed' },
};

const PHOTO_FORMAT_CONFIG: Record<PhotoFormat, { label: string }> = {
  jpeg: { label: 'JPG' },
  heic: { label: 'HEIF' },
};

const VIDEO_QUALITY_CONFIG: Record<VideoQuality, { label: string; resolution: { width: number; height: number }; landscape: { width: number; height: number }; portrait: { width: number; height: number } }> = {
  '720': { label: '720', resolution: CommonResolutions.HD_16_9, landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } },
  '1080': { label: '1080', resolution: CommonResolutions.FHD_16_9, landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } },
  '4K': { label: '4K', resolution: CommonResolutions.UHD_16_9, landscape: { width: 3840, height: 2160 }, portrait: { width: 2160, height: 3840 } },
  '8K': { label: '8K', resolution: CommonResolutions['8k_16_9'], landscape: { width: 8064, height: 4536 }, portrait: { width: 4536, height: 8064 } },
};

const VIDEO_CODEC_CONFIG: Record<VideoCodecFormat, { label: string }> = {
  h265: { label: 'HEVC' },
  h264: { label: 'H.264' },
};

const { DualViewMedia } = NativeModules as {
  DualViewMedia?: {
    createPhotoVariant(sourcePath: string, variant: PhotoVariant, suffix: string): Promise<string>;
    createPhotoVariantWithAspect?(sourcePath: string, suffix: string, aspectWidth: number, aspectHeight: number): Promise<string>;
    createPhotoVariantWithAspectAndFormat?(sourcePath: string, suffix: string, aspectWidth: number, aspectHeight: number, format: PhotoFormat): Promise<string>;
    createPhotoVariantWithAspectFormatQuality?(sourcePath: string, suffix: string, aspectWidth: number, aspectHeight: number, format: PhotoFormat, quality: number): Promise<string>;
    getMediaStoragePath?(uri: string): Promise<string>;
    createDualPhotoVariantsWithAspects?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
    ): Promise<{ mainPath: string; subPath: string }>;
    createDualPhotoVariantsWithAspectsAndFormat?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
    ): Promise<{ mainPath: string; subPath: string }>;
    createDualPhotoVariantsWithAspectsFormatQuality?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
      quality: number,
    ): Promise<{ mainPath: string; subPath: string }>;
    createVideoVariant?(sourcePath: string, variant: PhotoVariant, suffix: string, width: number, height: number, codec: VideoCodecFormat): Promise<string>;
    shareMedia?(uri: string, mimeType: string, title: string): Promise<boolean>;
  };
};

LogBox.ignoreLogs([
  'JPromise was destroyed',
  'Low-light boost is not supported',
  'SafeAreaView has been deprecated',
]);

function App(): React.JSX.Element {
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  const devicesList = useCameraDevices();
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const device = useCameraDevice(cameraPosition);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    if (!cameraPermission.hasPermission) {
      cameraPermission.requestPermission();
    }
  }, [cameraPermission]);

  useEffect(() => {
    if (captureMode === 'video' && !microphonePermission.hasPermission) {
      microphonePermission.requestPermission();
    }
  }, [captureMode, microphonePermission]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const switchCamera = useCallback(() => {
    setCameraPosition(current => (current === 'back' ? 'front' : 'back'));
  }, []);

  if (!cameraPermission.hasPermission) {
    return <PermissionScreen onRequest={cameraPermission.requestPermission} />;
  }

  if (device == null) {
    if (isInitializing) {
      return <View style={styles.root} />;
    }
    return <EmptyCameraScreen position={cameraPosition} onSwitchCamera={switchCamera} />;
  }

  const dCount = Array.isArray(devicesList) ? devicesList.length : 0;

  return (
    <CameraShell
      cameraPosition={cameraPosition}
      captureMode={captureMode}
      device={device}
      devicesCount={dCount}
      microphoneReady={microphonePermission.hasPermission}
      onCaptureModeChange={setCaptureMode}
      onSwitchCamera={switchCamera}
    />
  );
}

function CameraShell({
  cameraPosition,
  captureMode,
  device,
  devicesCount,
  microphoneReady,
  onCaptureModeChange,
  onSwitchCamera,
}: {
  cameraPosition: CameraPosition;
  captureMode: CaptureMode;
  device: CameraDevice;
  devicesCount: number;
  microphoneReady: boolean;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onSwitchCamera: () => void;
}) {
  const physicalOrientation = useOrientation('device');
  const [selectedAspectId, setSelectedAspectId] = useState<AspectRatioId>('16:9');
  const [photoQuality, setPhotoQuality] = useState<PhotoQuality>('high');
  const [photoFormat, setPhotoFormat] = useState<PhotoFormat>('jpeg');
  const [videoFps, setVideoFps] = useState<VideoFps>(30);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('4K');
  const [videoCodec, setVideoCodec] = useState<VideoCodecFormat>('h265');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const selectedAspect = useMemo(
    () => ASPECT_RATIOS.find(item => item.id === selectedAspectId) ?? ASPECT_RATIOS[2],
    [selectedAspectId],
  );
  const photoQualityConfig = PHOTO_QUALITY_CONFIG[photoQuality];
  const videoQualityConfig = VIDEO_QUALITY_CONFIG[videoQuality];
  
  const mainPreviewOutput = usePreviewOutput();
  const pipPreviewOutput = usePreviewOutput();
  const photoOutput = usePhotoOutput({
    targetResolution: photoQuality === 'high' ? CommonResolutions.HIGHEST_4_3 : CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: photoQualityConfig.quality,
    qualityPrioritization: photoQualityConfig.priority === 'speed' && !device.supportsSpeedQualityPrioritization
      ? 'balanced'
      : photoQualityConfig.priority,
  });

  const videoOutput = useVideoOutput({
    targetResolution: videoQualityConfig.resolution,
    enableAudio: microphoneReady,
    enablePersistentRecorder: false,
  });

  const previewRef = useRef<PreviewView | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const cameraReopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialAppState = AppState.currentState;
  const startsActive = initialAppState !== 'background' && initialAppState !== 'inactive';
  const appStateRef = useRef(initialAppState);
  const hasEnteredBackgroundRef = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveDualOutputs, setSaveDualOutputs] = useState(true);
  
  const [zoom, setZoom] = useState(() => clamp(1, device.minZoom, device.maxZoom));
  const [isRulerMode, setIsRulerMode] = useState(false);
  
  const [isBusy, setIsBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);
  const [lastMedia, setLastMedia] = useState<LastMedia>(null);
  const [toast, setToast] = useState('');
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [pendingPhotoCapture, setPendingPhotoCapture] = useState(false);
  const [pendingVideoStart, setPendingVideoStart] = useState(false);
  const [previewIssue, setPreviewIssue] = useState('');
  const [isAppActive, setIsAppActive] = useState(startsActive);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [galleryItems, setGalleryItems] = useState<GalleryMedia[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPersistedSettings()
      .then(settings => {
        if (cancelled) return;
        if (isAspectRatioId(settings.selectedAspectId)) setSelectedAspectId(settings.selectedAspectId);
        if (isPhotoQuality(settings.photoQuality)) setPhotoQuality(settings.photoQuality);
        if (isPhotoFormat(settings.photoFormat)) setPhotoFormat(settings.photoFormat);
        if (isVideoFps(settings.videoFps)) setVideoFps(settings.videoFps);
        if (isVideoQuality(settings.videoQuality)) setVideoQuality(settings.videoQuality);
        if (isVideoCodecFormat(settings.videoCodec)) setVideoCodec(settings.videoCodec);
        if (isViewMode(settings.viewMode)) setViewMode(settings.viewMode);
        if (typeof settings.saveDualOutputs === 'boolean') setSaveDualOutputs(settings.saveDualOutputs);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    savePersistedSettings({
      selectedAspectId,
      photoQuality,
      photoFormat,
      videoFps,
      videoQuality,
      videoCodec,
      viewMode,
      saveDualOutputs,
    }).catch(() => {});
  }, [photoFormat, photoQuality, saveDualOutputs, selectedAspectId, settingsLoaded, videoCodec, videoFps, videoQuality, viewMode]);

  const isDeviceLandscape = physicalOrientation?.startsWith('landscape') ?? false;
  const defaultSubOrientation: FrameOrientation = isDeviceLandscape ? 'portrait' : 'landscape';
  const mainDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? defaultSubOrientation : 'portrait';
  const subDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? 'portrait' : defaultSubOrientation;
  const fullMainAspect = previewSize.width > 0 && previewSize.height > 0
    ? previewSize.width / Math.max(1, previewSize.height)
    : 9 / 16;
  const mainFrameSpec = useMemo(
    () => visibleFrameSpec(mainDisplayOrientation, selectedAspect, fullMainAspect),
    [fullMainAspect, mainDisplayOrientation, selectedAspect],
  );
  const subFrameSpec = useMemo(
    () => visibleFrameSpec(subDisplayOrientation, selectedAspect, 3 / 4),
    [selectedAspect, subDisplayOrientation],
  );
  const isFullPreview = selectedAspectId === 'full' && mainDisplayOrientation === 'portrait';
  const mainPreviewAspect = mainFrameSpec.aspect;
  const previewTopOffset = isFullPreview ? 0 : PREVIEW_TOP_OFFSET;
  const mainPreviewBottomOffset = !isFullPreview && mainDisplayOrientation === 'landscape' ? LANDSCAPE_MAIN_BOTTOM_OFFSET : 0;
  const mainPreviewFrame = useMemo(
    () => calculateContainedFrame(previewSize.width, Math.max(0, previewSize.height - previewTopOffset - mainPreviewBottomOffset), mainPreviewAspect),
    [mainPreviewAspect, mainPreviewBottomOffset, previewSize.height, previewSize.width, previewTopOffset],
  );
  const videoFpsOptions = useMemo<VideoFps[]>(() => {
    const supports60 = safeSupportsFPS(device, 60);
    return supports60 ? [30, 60] : [30];
  }, [device]);
  const videoFrameSize = useCallback((spec: VisibleFrameSpec) => videoTargetSizeForAspect(spec.aspect, videoQualityConfig), [videoQualityConfig]);

  const outputs = useMemo(() => {
    if (captureMode === 'photo') {
      if (viewMode === 'dual' && !pendingPhotoCapture) {
        return [mainPreviewOutput, pipPreviewOutput];
      }
      return [mainPreviewOutput, photoOutput];
    } else {
      if (viewMode === 'dual' && !isRecording && !pendingVideoStart) {
        return [mainPreviewOutput, pipPreviewOutput];
      }
      return [mainPreviewOutput, videoOutput];
    }
  }, [captureMode, isRecording, mainPreviewOutput, pendingPhotoCapture, pendingVideoStart, pipPreviewOutput, photoOutput, videoOutput, viewMode]);
  const cameraConstraints = useMemo(
    () => {
      if (captureMode !== 'video') {
        return [{ resolutionBias: photoOutput }];
      }
      return [{ fps: videoFps }, { resolutionBias: videoOutput }];
    },
    [captureMode, photoOutput, videoFps, videoOutput],
  );
  const initialZoomRef = useRef(zoom);

  const previewHybridRef = useMemo(
    () => callback((preview: PreviewView) => {
      previewRef.current = preview;
    }),
    [],
  );

  const scheduleCameraReopen = useCallback(() => {
    if (cameraReopenTimerRef.current != null) {
      clearTimeout(cameraReopenTimerRef.current);
    }
    setIsAppActive(false);
    cameraReopenTimerRef.current = setTimeout(() => {
      cameraReopenTimerRef.current = null;
      setSessionRevision(curr => curr + 1);
      setIsAppActive(true);
    }, 450);
  }, []);

  const scheduleResumePreviewRefresh = useCallback(() => {
    if (resumePreviewTimerRef.current != null) {
      clearTimeout(resumePreviewTimerRef.current);
    }
    resumePreviewTimerRef.current = setTimeout(() => {
      resumePreviewTimerRef.current = null;
      if (appStateRef.current !== 'active') {
        return;
      }
      setSessionRevision(curr => curr + 1);
    }, 260);
  }, []);

  useEffect(() => {
    initialZoomRef.current = zoom;
  }, [zoom]);

  const getInitialZoom = useCallback(() => initialZoomRef.current, []);

  const handleCameraStarted = useCallback(() => {
    setPreviewIssue('');
  }, []);

  const handleCameraError = useCallback((error: Error) => {
    if (isCameraResourceBusyError(error)) {
      setPreviewIssue('');
      scheduleCameraReopen();
      return;
    }
    const message = cameraErrorMessage(error, '相机错误');
    setPreviewIssue(message);
  }, [scheduleCameraReopen]);

  const handleCameraInterruptionEnded = useCallback(() => {
    setPreviewIssue('');
  }, []);

  const cameraController = useCamera({
    device: device,
    outputs,
    constraints: cameraConstraints,
    isActive: isAppActive && !galleryOpen,
    orientationSource: 'device',
    getInitialZoom,
    onStarted: handleCameraStarted,
    onError: handleCameraError,
    onInterruptionEnded: handleCameraInterruptionEnded,
  });

  useEffect(() => {
    if (!device) return;
    setZoom(clamp(1, device.minZoom, device.maxZoom));
    setFlashMode('off');
    setIsSwapped(false);
    setIsRulerMode(false);
    setPreviewIssue('');
    if (!safeSupportsFPS(device, videoFps)) {
      setVideoFps(30);
    }
  }, [device?.id]);

  useEffect(() => {
    if (captureMode === 'video') {
      setFlashMode('off');
    }
  }, [captureMode]);

  useEffect(() => {
    if (!isRecording || recordingStartedAt == null) {
      setRecordingSeconds(0);
      return;
    }
    const update = () => {
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isRecording, recordingStartedAt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const active = nextState === 'active';
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      if (active) {
        setPreviewIssue('');
        if (!wasActive) {
          setIsAppActive(true);
          if (hasEnteredBackgroundRef.current) {
            hasEnteredBackgroundRef.current = false;
            scheduleResumePreviewRefresh();
          }
        }
      } else {
        hasEnteredBackgroundRef.current = true;
        if (cameraReopenTimerRef.current != null) {
          clearTimeout(cameraReopenTimerRef.current);
          cameraReopenTimerRef.current = null;
        }
        if (resumePreviewTimerRef.current != null) {
          clearTimeout(resumePreviewTimerRef.current);
          resumePreviewTimerRef.current = null;
        }
        setIsAppActive(false);
      }
    });
    return () => subscription.remove();
  }, [scheduleResumePreviewRefresh]);

  useEffect(() => {
    return () => {
      if (cameraReopenTimerRef.current != null) {
        clearTimeout(cameraReopenTimerRef.current);
      }
      if (resumePreviewTimerRef.current != null) {
        clearTimeout(resumePreviewTimerRef.current);
      }
      if (zoomFocusTimerRef.current != null) {
        clearTimeout(zoomFocusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (cameraController == null || typeof (cameraController as any).setZoom !== 'function') return;
    (cameraController as any).setZoom(clamp(zoom, device.minZoom, device.maxZoom)).catch(() => {});
  }, [cameraController, zoom, device.minZoom, device.maxZoom]);

  useEffect(() => {
    if (cameraController == null || typeof (cameraController as any).setTorchMode !== 'function') return;
    const shouldEnableTorch = captureMode === 'video' && flashMode === 'on' && device.hasTorch;
    (cameraController as any).setTorchMode(shouldEnableTorch ? 'on' : 'off', shouldEnableTorch ? 1 : undefined).catch(() => {});
  }, [cameraController, captureMode, device.hasTorch, flashMode]);

  useEffect(() => {
    if (cameraController == null || previewRef.current == null || previewSize.width <= 0 || previewSize.height <= 0) {
      return;
    }
    if (zoomFocusTimerRef.current != null) {
      clearTimeout(zoomFocusTimerRef.current);
    }
    zoomFocusTimerRef.current = setTimeout(() => {
      zoomFocusTimerRef.current = null;
      if (previewRef.current == null) return;
      try {
        const point = previewRef.current.createMeteringPoint(previewSize.width / 2, previewSize.height / 2, 96);
        cameraController.focusTo(point, {
          responsiveness: 'steady',
          adaptiveness: 'continuous',
          autoResetAfter: 3,
        }).catch(() => {});
      } catch {
      }
    }, zoom >= 2 ? 180 : 320);
    return () => {
      if (zoomFocusTimerRef.current != null) {
        clearTimeout(zoomFocusTimerRef.current);
      }
    };
  }, [cameraController, previewSize.height, previewSize.width, zoom]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const refreshGallery = useCallback(async () => {
    const items = await loadDualViewGallery();
    setGalleryItems(items);
    setLastMedia(mediaToLastMedia(items[0] ?? null));
    setGalleryIndex(current => items.length === 0 ? 0 : Math.min(current, items.length - 1));
    return items;
  }, []);

  useEffect(() => {
    refreshGallery().catch(() => {});
  }, [refreshGallery]);

  useEffect(() => {
    if (!isAppActive) return;
    refreshGallery().catch(() => {});
  }, [isAppActive, refreshGallery]);

  useEffect(() => {
    if (!galleryOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setGalleryOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [galleryOpen]);

  const saveToGallery = useCallback(async (filePath: string, type: 'photo' | 'video', label: string) => {
    const sourcePath = type === 'video' ? await ensureVideoExtension(filePath, label) : filePath;
    const uri = toFileUri(sourcePath);
    const saved = await CameraRoll.saveAsset(uri, { type, album: 'DualViewCamera' });
    setLastMedia(mediaToLastMedia(cameraRollNodeToGalleryMedia(saved)));
    refreshGallery().catch(() => {});
    return saved.node.image.uri;
  }, [refreshGallery]);

  const saveCapturedPhotoInBackground = useCallback((filePath: string, options: { mainSpec: VisibleFrameSpec; subSpec: VisibleFrameSpec; dual: boolean; format: PhotoFormat; quality: number }) => {
    void (async () => {
      try {
        if (options.dual) {
          const { mainPath, subPath } = await createDualPhotoVariantsForAspects(filePath, options.mainSpec, options.subSpec, options.format, options.quality);
          await Promise.all([
            saveToGallery(mainPath, 'photo', '主画面'),
            saveToGallery(subPath, 'photo', '副画面'),
          ]);
        } else {
          const mainPath = await createPhotoVariantForAspect(filePath, options.mainSpec, 'main', options.format, options.quality);
          await saveToGallery(mainPath, 'photo', '主画面');
        }
      } catch (error) {
        setToast(cameraErrorMessage(error, '照片保存失败'));
      }
    })();
  }, [saveToGallery]);

  const prepareFlashForPhoto = useCallback(async () => {
    if (flashMode !== 'on' || cameraController == null || !device?.hasTorch) return false;
    try {
      await cameraController.setTorchMode('on', 1);
      await wait(160);
      return true;
    } catch { return false; }
  }, [cameraController, device?.hasTorch, flashMode]);

  const cleanupFlashAfterPhoto = useCallback(async (torchWasEnabled: boolean) => {
    if (!torchWasEnabled || cameraController == null) return;
    try { await cameraController.setTorchMode('off'); } catch {}
  }, [cameraController]);

  const takePhoto = useCallback(async () => {
    if (isBusy || captureMode !== 'photo') return;
    if (viewMode === 'dual' && !pendingPhotoCapture) {
      setPendingPhotoCapture(true);
      return;
    }
    setIsBusy(true);
    const torchWasEnabled = await prepareFlashForPhoto();
    try {
      const file = await photoOutput.capturePhotoToFile({
         flashMode: device?.hasFlash ? flashMode : 'off',
         enableShutterSound: true,
      }, {});
      saveCapturedPhotoInBackground(file.filePath, {
        mainSpec: mainFrameSpec,
        subSpec: subFrameSpec,
        dual: viewMode === 'dual' && saveDualOutputs,
        format: photoFormat,
        quality: photoQualityConfig.nativeQuality,
      });
    } catch (error) {
      setToast(cameraErrorMessage(error, '拍照失败'));
    } finally {
      await cleanupFlashAfterPhoto(torchWasEnabled);
      setIsBusy(false);
      setPendingPhotoCapture(false);
    }
  }, [captureMode, cleanupFlashAfterPhoto, device?.hasFlash, flashMode, isBusy, mainFrameSpec, pendingPhotoCapture, photoFormat, photoOutput, photoQualityConfig.nativeQuality, prepareFlashForPhoto, saveCapturedPhotoInBackground, saveDualOutputs, subFrameSpec, viewMode]);

  useEffect(() => {
    if (!pendingPhotoCapture) return;
    const timer = setTimeout(() => {
      takePhoto();
    }, 200);
    return () => clearTimeout(timer);
  }, [pendingPhotoCapture, takePhoto]);

  const finishRecording = useCallback(async (filePath: string) => {
    try {
      const mainVariant = mainFrameSpec.variant;
      const mainPath = await createVideoVariant(filePath, mainVariant, 'main', videoFrameSize(mainFrameSpec), videoCodec);
      await saveToGallery(mainPath, 'video', '主画面');
      if (viewMode === 'dual' && saveDualOutputs) {
        const subVariant = subFrameSpec.variant;
        const subPath = await createVideoVariant(filePath, subVariant, 'sub', videoFrameSize(subFrameSpec), videoCodec);
        await saveToGallery(subPath, 'video', '副画面');
      }
    } catch (error) {
      setToast('录像保存失败');
    }
  }, [mainFrameSpec, saveDualOutputs, saveToGallery, subFrameSpec, videoCodec, videoFrameSize, viewMode]);

  const toggleRecording = useCallback(async () => {
    if (isBusy || captureMode !== 'video') return;
    if (viewMode === 'dual' && !isRecording && !pendingVideoStart) {
      setPendingVideoStart(true);
      return;
    }
    setIsBusy(true);
    try {
      if (isRecording && recorderRef.current != null) {
        await recorderRef.current.stopRecording();
        return;
      }
      const recorder = await videoOutput.createRecorder({});
      recorderRef.current = recorder;
      await recorder.startRecording(
        filePath => {
          setIsRecording(false);
          setRecordingStartedAt(null);
          recorderRef.current = null;
          setToast('录像已停止，正在后台保存');
          finishRecording(filePath);
        },
        error => {
          setIsRecording(false);
          setRecordingStartedAt(null);
          recorderRef.current = null;
          setToast(error.message);
        },
      );
      setIsRecording(true);
      setRecordingStartedAt(Date.now());
    } catch (error) {
      setIsRecording(false);
      setRecordingStartedAt(null);
      setToast(cameraErrorMessage(error, '录像失败'));
    } finally {
      setIsBusy(false);
      setPendingVideoStart(false);
    }
  }, [captureMode, finishRecording, isBusy, isRecording, pendingVideoStart, videoOutput, viewMode]);

  useEffect(() => {
    if (!pendingVideoStart) return;
    const timer = setTimeout(() => {
      toggleRecording();
    }, 200);
    return () => clearTimeout(timer);
  }, [pendingVideoStart, toggleRecording]);

  const focusAtPoint = useCallback(async (event: GestureResponderEvent) => {
    setIsRulerMode(false);
    if (cameraController == null || previewRef.current == null) return;
    const { locationX, locationY } = event.nativeEvent;
    try {
      const point = previewRef.current.createMeteringPoint(locationX, locationY, 80);
      await cameraController.focusTo(point, { responsiveness: 'snappy', autoResetAfter: 4 });
      setFocusPoint({ x: locationX, y: locationY });
    } catch {}
  }, [cameraController]);

  const cycleFlash = useCallback(() => {
    if (!device?.hasFlash && !device?.hasTorch) {
      setToast('不支持闪光灯');
      return;
    }
    if (captureMode === 'video') {
      if (!device?.hasTorch) {
        setToast('不支持常亮闪光灯');
        return;
      }
      setFlashMode(current => (current === 'on' ? 'off' : 'on'));
      return;
    }
    setFlashMode(current => (current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off'));
  }, [captureMode, device?.hasFlash, device?.hasTorch]);

  const swapMainAndSub = useCallback(() => {
    setIsSwapped(current => !current);
  }, []);

  const openLastMedia = useCallback(() => {
    if (galleryItems.length === 0) {
      setToast('还没有拍摄内容');
      return;
    }
    setGalleryIndex(0);
    setGalleryOpen(true);
    refreshGallery().catch(() => {});
  }, [galleryItems.length, refreshGallery]);

  const closeGallery = useCallback(() => {
    setGalleryOpen(false);
  }, []);

  const handleGalleryDelete = useCallback(async (item: GalleryMedia) => {
    try {
      await CameraRoll.deletePhotos([item.uri]);
      const nextItems = galleryItems.filter(media => media.id !== item.id);
      setGalleryItems(nextItems);
      setLastMedia(mediaToLastMedia(nextItems[0] ?? null));
      if (nextItems.length === 0) {
        setGalleryOpen(false);
        setGalleryIndex(0);
      } else {
        setGalleryIndex(current => Math.min(current, nextItems.length - 1));
      }
      setToast('已删除');
      refreshGallery().catch(() => {});
    } catch (error) {
      setToast(cameraErrorMessage(error, '删除失败'));
    }
  }, [galleryItems, refreshGallery]);

  const lastPinchDist = useRef<number | null>(null);
  const onTouchMove = useCallback((event: GestureResponderEvent) => {
     if (event.nativeEvent.touches.length === 2) {
        const t1 = event.nativeEvent.touches[0];
        const t2 = event.nativeEvent.touches[1];
        const dist = Math.sqrt(Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2));
        if (lastPinchDist.current != null) {
          const delta = (dist - lastPinchDist.current) / 30; 
          setZoom(z => clamp(z + delta, device.minZoom, device.maxZoom));
        }
        lastPinchDist.current = dist;
     }
  }, [device.maxZoom, device.minZoom]);

  const primaryAction = captureMode === 'photo' ? takePhoto : toggleRecording;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" hidden={galleryOpen} translucent backgroundColor="transparent" />
      <View style={styles.root}>
        <View
          style={styles.previewArea}
          onLayout={event => {
            const { width, height } = event.nativeEvent.layout;
            setPreviewSize({ width, height });
          }}
          onTouchMove={onTouchMove}
          onTouchEnd={() => { lastPinchDist.current = null; }}
        >
          <MainPreview
            hybridRef={previewHybridRef}
            orientation={mainDisplayOrientation}
            aspectRatio={mainPreviewAspect}
            frame={mainPreviewFrame}
            bottomOffset={mainPreviewBottomOffset}
            topOffset={previewTopOffset}
            fillScreen={isFullPreview}
            previewOutput={mainPreviewOutput}
            sessionRevision={sessionRevision}
          />
          <Pressable style={styles.focusLayer} onPress={focusAtPoint} />
          {focusPoint && <FocusBox point={focusPoint} />}
          {previewIssue ? <PreviewStatusOverlay issue={previewIssue} mode="" /> : null}
          <TopBar
            aspectId={selectedAspectId}
            aspectOptions={ASPECT_RATIOS}
            captureMode={captureMode}
            flashMode={flashMode}
            isRecording={isRecording}
            onAspectChange={setSelectedAspectId}
            onCycleFlash={cycleFlash}
            onOpenSettings={() => setSettingsOpen(true)}
            onVideoFpsChange={setVideoFps}
            onVideoQualityChange={setVideoQuality}
            recordingSeconds={recordingSeconds}
            videoFps={videoFps}
            videoFpsOptions={videoFpsOptions}
            videoQuality={videoQuality}
          />
          {viewMode === 'dual' && (
            <PipPreview
              aspectRatio={subFrameSpec.aspect}
              isSwapped={isSwapped}
              orientation={subDisplayOrientation}
              onPress={swapMainAndSub}
              previewOutput={
                captureMode === 'photo'
                  ? (pendingPhotoCapture ? null : pipPreviewOutput)
                  : (isRecording || pendingVideoStart ? null : pipPreviewOutput)
              }
              sessionRevision={sessionRevision}
              placeholderMode={
                captureMode === 'photo' && pendingPhotoCapture
                  ? 'photo'
                  : captureMode === 'video' && (isRecording || pendingVideoStart)
                    ? 'video'
                    : null
              }
            />
          )}
          {toast ? <Toast message={toast} /> : null}
          <View style={styles.zoomBarContainer} pointerEvents="box-none">
             <ZoomSelector 
               currentZoom={zoom} 
               onChange={setZoom} 
               minZoom={device.minZoom}
               maxZoom={device.maxZoom}
               isRulerMode={isRulerMode}
               setIsRulerMode={setIsRulerMode}
             />
          </View>
        </View>
        <BottomControls
          captureMode={captureMode}
          isBusy={isBusy}
          isRecording={isRecording}
          lastMedia={lastMedia}
          onCaptureModeChange={onCaptureModeChange}
          onGalleryPress={openLastMedia}
          onPrimaryAction={primaryAction}
          onSwitchCamera={onSwitchCamera}
          onViewModeChange={setViewMode}
          viewMode={viewMode}
        />
      </View>
      <SettingsModal
        device={device}
        devicesCount={devicesCount}
        flashMode={flashMode}
        onClose={() => setSettingsOpen(false)}
        onFlashModeChange={setFlashMode}
        open={settingsOpen}
        photoFormat={photoFormat}
        onPhotoFormatChange={setPhotoFormat}
        photoQuality={photoQuality}
        onPhotoQualityChange={setPhotoQuality}
        saveDualOutputs={saveDualOutputs}
        setSaveDualOutputs={setSaveDualOutputs}
        videoFps={videoFps}
        videoFpsOptions={videoFpsOptions}
        onVideoFpsChange={setVideoFps}
        videoCodec={videoCodec}
        onVideoCodecChange={setVideoCodec}
        videoQuality={videoQuality}
        onVideoQualityChange={setVideoQuality}
        viewMode={viewMode}
      />
      <GalleryModal
        index={galleryIndex}
        items={galleryItems}
        onClose={closeGallery}
        onDelete={handleGalleryDelete}
        onIndexChange={setGalleryIndex}
        open={galleryOpen}
      />
    </SafeAreaView>
  );
}

function PermissionScreen({ onRequest }: { onRequest: () => Promise<boolean> }) {
  return (
    <SafeAreaView style={styles.centerScreen}>
      <Text style={styles.title}>需要相机权限</Text>
      <Text style={styles.description}>请授权相机权限，用于实时预览、拍照和录像。</Text>
      <Pressable style={styles.primaryButton} onPress={onRequest}>
        <Text style={styles.primaryButtonText}>授权相机</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function EmptyCameraScreen({ position, onSwitchCamera }: { position: CameraPosition; onSwitchCamera: () => void }) {
  return (
    <SafeAreaView style={styles.centerScreen}>
      <Text style={styles.title}>未找到{position === 'back' ? '后置' : '前置'}摄像头</Text>
      <Pressable style={styles.primaryButton} onPress={onSwitchCamera}>
        <Text style={styles.primaryButtonText}>切换摄像头</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function PreviewStatusOverlay({ issue }: { issue: string; mode: string }) {
  return (
    <View pointerEvents="none" style={styles.previewStatus}>
      <Text style={styles.previewStatusTitle}>{issue ? '预览异常' : '正在启动相机'}</Text>
      <Text style={styles.previewStatusText}>{issue || '正在绑定 CameraX 输出，请稍候。'}</Text>
    </View>
  );
}

function FocusBox({ point }: { point: { x: number; y: number } }) {
  return <View pointerEvents="none" style={[styles.focusBox, { left: point.x - 36, top: point.y - 36 }]} />;
}

function TopBar({
  aspectId,
  aspectOptions,
  captureMode,
  flashMode,
  isRecording,
  onAspectChange,
  onCycleFlash,
  onOpenSettings,
  onVideoFpsChange,
  onVideoQualityChange,
  recordingSeconds,
  videoFps,
  videoFpsOptions,
  videoQuality,
}: {
  aspectId: AspectRatioId;
  aspectOptions: typeof ASPECT_RATIOS;
  captureMode: CaptureMode;
  flashMode: FlashMode;
  isRecording: boolean;
  onAspectChange: (value: AspectRatioId) => void;
  onCycleFlash: () => void;
  onOpenSettings: () => void;
  onVideoFpsChange: (value: VideoFps) => void;
  onVideoQualityChange: (value: VideoQuality) => void;
  recordingSeconds: number;
  videoFps: VideoFps;
  videoFpsOptions: VideoFps[];
  videoQuality: VideoQuality;
}) {
  const FlashIcon = flashMode === 'off' ? FlashOffIcon : (flashMode === 'auto' ? FlashAutoIcon : FlashOnIcon);
  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <View style={styles.topSide} />
      <View style={styles.topCenter} pointerEvents="box-none">
        {isRecording ? (
          <Text style={styles.recordingTime}>{formatDuration(recordingSeconds)}</Text>
        ) : captureMode === 'video' ? (
          <View style={styles.topVideoControls}>
            <View style={styles.topVideoPills}>
              <Pressable style={styles.topPill} onPress={() => onVideoFpsChange(nextFps(videoFps, videoFpsOptions))}>
                <Text style={styles.topPillText}>{videoFps}HZ</Text>
              </Pressable>
              <Pressable style={styles.topPill} onPress={() => onVideoQualityChange(nextVideoQuality(videoQuality))}>
                <Text style={styles.topPillText}>{VIDEO_QUALITY_CONFIG[videoQuality].label}</Text>
              </Pressable>
            </View>
            <View style={styles.aspectRow}>
              {aspectOptions.map(option => (
                <Pressable key={option.id} style={[styles.aspectButton, aspectId === option.id && styles.aspectButtonActive]} onPress={() => onAspectChange(option.id)}>
                  <Text style={[styles.aspectText, aspectId === option.id && styles.aspectTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.aspectRow}>
            {aspectOptions.map(option => (
              <Pressable key={option.id} style={[styles.aspectButton, aspectId === option.id && styles.aspectButtonActive]} onPress={() => onAspectChange(option.id)}>
                <Text style={[styles.aspectText, aspectId === option.id && styles.aspectTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <View style={styles.topActions}>
        <RoundButton label="" active={flashMode !== 'off'} onPress={onCycleFlash} style={styles.noBorderButton}><FlashIcon width={28} height={28} /></RoundButton>
        <RoundButton label="" onPress={onOpenSettings} style={styles.noBorderButton}><SettingsIcon width={28} height={28} /></RoundButton>
      </View>
    </View>
  );
}

function BottomControls({ captureMode, isBusy, isRecording, lastMedia, onCaptureModeChange, onGalleryPress, onPrimaryAction, onSwitchCamera, onViewModeChange, viewMode }: { captureMode: CaptureMode; isBusy: boolean; isRecording: boolean; lastMedia: LastMedia; onCaptureModeChange: (mode: CaptureMode) => void; onGalleryPress: () => void; onPrimaryAction: () => void; onSwitchCamera: () => void; onViewModeChange: (mode: ViewMode) => void; viewMode: ViewMode }) {
  return (
    <View style={styles.bottomControls} pointerEvents="box-none">
      <View style={styles.modeRow}>
        <Text onPress={() => onCaptureModeChange('photo')} style={[styles.modeText, captureMode === 'photo' && styles.modeTextActive]}>拍照</Text>
        <Text onPress={() => onCaptureModeChange('video')} style={[styles.modeText, captureMode === 'video' && styles.modeTextActive]}>录像</Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.thumbnailButton} onPress={onGalleryPress}>{lastMedia?.type === 'photo' ? <Image source={{ uri: lastMedia.uri }} style={styles.thumbnailImage} /> : <Text style={styles.thumbnailText}>{lastMedia ? '视频' : ''}</Text>}</Pressable>
        <Pressable disabled={isBusy} style={[styles.shutter, isRecording && styles.shutterRecording]} onPress={onPrimaryAction}><View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} /></Pressable>
        <RoundButton label="" onPress={onSwitchCamera} style={styles.noBorderButton}><SwitchCameraIcon width={32} height={32} /></RoundButton>
      </View>
      <View style={styles.viewModeRow}>
        <Pressable style={styles.viewModeButton} onPress={() => onViewModeChange('single')}>
          <Text style={[styles.viewModeText, viewMode === 'single' && styles.viewModeTextActive]}>单画面</Text>
        </Pressable>
        <Pressable style={styles.viewModeButton} onPress={() => onViewModeChange('dual')}>
          <Text style={[styles.viewModeText, viewMode === 'dual' && styles.viewModeTextActive]}>双画面</Text>
        </Pressable>
      </View>
    </View>
  );
}

function GalleryModal({
  index,
  items,
  onClose,
  onDelete,
  onIndexChange,
  open,
}: {
  index: number;
  items: GalleryMedia[];
  onClose: () => void;
  onDelete: (item: GalleryMedia) => void;
  onIndexChange: (index: number) => void;
  open: boolean;
}) {
  const listRef = useRef<FlatList<GalleryMedia> | null>(null);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(() => new Set());
  const [zoomLocked, setZoomLocked] = useState(false);
  const current = items[index] ?? null;

  useEffect(() => {
    if (!open || viewerWidth <= 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false });
    });
  }, [index, open, viewerWidth]);

  useEffect(() => {
    if (!open) {
      setDetailsOpen(false);
      setFailedPreviewIds(new Set());
      setZoomLocked(false);
    }
  }, [open]);

  const shareCurrent = useCallback(async () => {
    if (current == null) return;
    try {
      if (DualViewMedia?.shareMedia) {
        await DualViewMedia.shareMedia(current.uri, mimeTypeForMedia(current), current.filename ?? 'DualViewCamera');
        return;
      }
      await Linking.openURL(current.uri);
    } catch {
    }
  }, [current]);

  const openCurrent = useCallback(() => {
    if (current == null) return;
    Linking.openURL(current.uri).catch(() => {});
  }, [current]);

  const confirmDelete = useCallback(() => {
    if (current == null) return;
    Alert.alert('删除这项？', current.filename ?? current.uri, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => onDelete(current) },
    ]);
  }, [current, onDelete]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent visible={open}>
      <View
        style={styles.galleryRoot}
        onLayout={event => setViewerWidth(event.nativeEvent.layout.width)}
      >
        <StatusBar hidden translucent backgroundColor="transparent" />
        <View style={styles.galleryTopBar}>
          <Text style={styles.galleryCount}>{items.length > 0 ? `${index + 1}/${items.length}` : '0/0'}</Text>
        </View>
        {viewerWidth > 0 && items.length > 0 ? (
          <FlatList
            ref={listRef}
            data={items}
            horizontal
            initialNumToRender={3}
            keyExtractor={item => item.id}
            maxToRenderPerBatch={3}
            pagingEnabled
            removeClippedSubviews
            scrollEnabled={!zoomLocked}
            renderItem={({ item, index: itemIndex }) => (
              <View style={[styles.galleryPage, { width: viewerWidth }]}>
                {Math.abs(itemIndex - index) > 2 ? (
                  <View style={styles.galleryLazyPage} />
                ) : item.type === 'photo' && !failedPreviewIds.has(item.id) ? (
                  <ZoomablePhoto
                    item={item}
                    onPreviewError={() => setFailedPreviewIds(previous => {
                      const next = new Set(previous);
                      next.add(item.id);
                      return next;
                    })}
                    onZoomActiveChange={itemIndex === index ? setZoomLocked : undefined}
                  />
                ) : item.type === 'video' ? (
                  <InlineVideoPlayer
                    item={item}
                    onZoomActiveChange={itemIndex === index ? setZoomLocked : undefined}
                  />
                ) : (
                  <MediaPreviewFallback item={item} />
                )}
              </View>
            )}
            showsHorizontalScrollIndicator={false}
            windowSize={5}
            getItemLayout={(_, itemIndex) => ({ length: viewerWidth, offset: viewerWidth * itemIndex, index: itemIndex })}
            onMomentumScrollEnd={event => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / viewerWidth);
              onIndexChange(clamp(nextIndex, 0, items.length - 1));
              setZoomLocked(false);
            }}
            onScrollToIndexFailed={info => {
              setTimeout(() => {
                listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              }, 50);
            }}
          />
        ) : (
          <View style={styles.galleryEmpty}><Text style={styles.galleryEmptyText}>还没有拍摄内容</Text></View>
        )}
        {detailsOpen && current ? <MediaDetails item={current} /> : null}
        {current ? (
          <View style={styles.galleryBottomBar}>
            <Pressable style={styles.galleryBottomButton} onPress={() => setDetailsOpen(value => !value)}>
              <Text style={styles.galleryBottomText}>详情</Text>
            </Pressable>
            <Pressable style={styles.galleryBottomButton} onPress={shareCurrent}>
              <Text style={styles.galleryBottomText}>分享</Text>
            </Pressable>
            <Pressable style={styles.galleryBottomButton} onPress={openCurrent}>
              <Text style={styles.galleryBottomText}>查看</Text>
            </Pressable>
            <Pressable style={[styles.galleryBottomButton, styles.galleryDeleteButton]} onPress={confirmDelete}>
              <Text style={[styles.galleryBottomText, styles.galleryDeleteText]}>删除</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ZoomablePhoto({
  item,
  onPreviewError,
  onZoomActiveChange,
}: {
  item: GalleryMedia;
  onPreviewError: () => void;
  onZoomActiveChange?: (active: boolean) => void;
}) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const imageFrame = useMemo(
    () => containedMediaFrame(containerSize.width, containerSize.height, item.width, item.height),
    [containerSize.height, containerSize.width, item.height, item.width],
  );
  const baseScaleRef = useRef(1);
  const baseTranslateRef = useRef({ x: 0, y: 0 });
  const startCenterRef = useRef<{ x: number; y: number } | null>(null);
  const startDistanceRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const touchCountRef = useRef(0);

  useEffect(() => {
    scaleRef.current = scale;
    onZoomActiveChange?.(scale > 1.02);
  }, [onZoomActiveChange, scale]);

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    baseScaleRef.current = 1;
    baseTranslateRef.current = { x: 0, y: 0 };
    startDistanceRef.current = null;
    startCenterRef.current = null;
    panStartRef.current = null;
    onZoomActiveChange?.(false);
  }, [item.id, onZoomActiveChange]);

  const updateScaleAndTranslate = useCallback((nextScale: number, nextTranslate: { x: number; y: number }) => {
    const boundedScale = clamp(nextScale, 1, 4);
    setScale(boundedScale);
    setTranslate(clampPhotoTranslate(nextTranslate, boundedScale, containerSize, imageFrame));
  }, [containerSize, imageFrame]);

  return (
    <View
      style={styles.zoomablePhoto}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setContainerSize({ width, height });
      }}
      onTouchStart={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        const distance = touchDistance(event.nativeEvent.touches);
        const center = touchCenter(event.nativeEvent.touches);
        if (distance != null) {
          startDistanceRef.current = distance;
          startCenterRef.current = center;
          baseScaleRef.current = scaleRef.current;
          baseTranslateRef.current = translateRef.current;
          onZoomActiveChange?.(true);
        } else if (scaleRef.current > 1.02 && event.nativeEvent.touches[0]) {
          panStartRef.current = {
            x: event.nativeEvent.touches[0].pageX,
            y: event.nativeEvent.touches[0].pageY,
          };
          baseTranslateRef.current = translateRef.current;
        }
      }}
      onTouchMove={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        const distance = touchDistance(event.nativeEvent.touches);
        const center = touchCenter(event.nativeEvent.touches);
        if (distance != null && center != null) {
          if (startDistanceRef.current == null) {
            startDistanceRef.current = distance;
            startCenterRef.current = center;
            baseScaleRef.current = scaleRef.current;
            baseTranslateRef.current = translateRef.current;
            onZoomActiveChange?.(true);
            return;
          }
          const nextScale = clamp(baseScaleRef.current * (distance / startDistanceRef.current), 1, 4);
          const startCenter = startCenterRef.current ?? center;
          const zoomCenter = clampPointToMediaRect(center, containerSize, imageFrame);
          const origin = {
            x: zoomCenter.x - containerSize.width / 2,
            y: zoomCenter.y - containerSize.height / 2,
          };
          const scaleRatio = nextScale / Math.max(0.001, baseScaleRef.current);
          const nextTranslate = {
            x: baseTranslateRef.current.x + (center.x - startCenter.x) + (origin.x - baseTranslateRef.current.x) * (1 - scaleRatio),
            y: baseTranslateRef.current.y + (center.y - startCenter.y) + (origin.y - baseTranslateRef.current.y) * (1 - scaleRatio),
          };
          updateScaleAndTranslate(nextScale, nextTranslate);
          return;
        }
        if (scaleRef.current <= 1.02 || !event.nativeEvent.touches[0]) return;
        if (panStartRef.current == null) {
          panStartRef.current = {
            x: event.nativeEvent.touches[0].pageX,
            y: event.nativeEvent.touches[0].pageY,
          };
          baseTranslateRef.current = translateRef.current;
          return;
        }
        const nextTranslate = {
          x: baseTranslateRef.current.x + event.nativeEvent.touches[0].pageX - panStartRef.current.x,
          y: baseTranslateRef.current.y + event.nativeEvent.touches[0].pageY - panStartRef.current.y,
        };
        updateScaleAndTranslate(scaleRef.current, nextTranslate);
      }}
      onTouchEnd={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        if (touchCountRef.current >= 2) {
          const distance = touchDistance(event.nativeEvent.touches);
          const center = touchCenter(event.nativeEvent.touches);
          startDistanceRef.current = distance;
          startCenterRef.current = center;
          baseScaleRef.current = scaleRef.current;
          baseTranslateRef.current = translateRef.current;
          return;
        }
        startDistanceRef.current = null;
        startCenterRef.current = null;
        panStartRef.current = null;
        baseTranslateRef.current = translateRef.current;
        if (scaleRef.current <= 1.02) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomActiveChange?.(false);
        }
      }}
      onTouchCancel={() => {
        touchCountRef.current = 0;
        startDistanceRef.current = null;
        startCenterRef.current = null;
        panStartRef.current = null;
        if (scaleRef.current <= 1.02) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomActiveChange?.(false);
        }
      }}
    >
      <View style={[styles.zoomableImageFrame, imageFrame, { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] }]}>
        <Image
          source={{ uri: item.uri }}
          style={styles.galleryImage}
          resizeMode="contain"
          onError={onPreviewError}
        />
      </View>
      {scale > 1.02 ? (
        <Pressable style={styles.zoomResetButton} onPress={() => {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
        }}>
          <Text style={styles.zoomResetText}>还原</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InlineVideoPlayer({
  item,
  onZoomActiveChange,
}: {
  item: GalleryMedia;
  onZoomActiveChange?: (active: boolean) => void;
}) {
  if (NativeDualViewVideoView == null) {
    return <MediaPreviewFallback item={item} />;
  }
  return (
    <View
      style={styles.inlineVideoPlayer}
      onTouchStart={event => {
        if (event.nativeEvent.touches.length >= 2) {
          onZoomActiveChange?.(true);
        }
      }}
      onTouchMove={event => {
        if (event.nativeEvent.touches.length >= 2) {
          onZoomActiveChange?.(true);
        }
      }}
      onTouchEnd={event => {
        if (event.nativeEvent.touches.length < 2) {
          onZoomActiveChange?.(false);
        }
      }}
      onTouchCancel={() => onZoomActiveChange?.(false)}
    >
      <NativeDualViewVideoView style={styles.inlineVideoPlayer} sourceUri={item.uri} />
    </View>
  );
}

function MediaPreviewFallback({ item }: { item: GalleryMedia }) {
  const isVideo = item.type === 'video';
  return (
    <View style={styles.mediaPreviewFallback}>
      <Text style={styles.videoPreviewIcon}>{isVideo ? '▶' : '!'}</Text>
      <Text style={styles.videoPreviewTitle}>{isVideo ? '视频' : '无法预览'}</Text>
      {isVideo ? <Text style={styles.videoPreviewText}>{formatDuration(Math.floor(item.duration || 0))}</Text> : null}
      <Text style={styles.videoPreviewHint}>{isVideo ? '可查看或分享原视频' : '可用系统查看或分享原文件'}</Text>
    </View>
  );
}

function MediaDetails({ item }: { item: GalleryMedia }) {
  return (
    <View style={styles.mediaDetails}>
      <Text style={styles.mediaDetailsTitle}>{item.type === 'photo' ? '照片详情' : '视频详情'}</Text>
      <Text style={styles.mediaDetailsText}>文件：{item.filename ?? '未知'}</Text>
      <Text style={styles.mediaDetailsText}>时间：{formatTimestamp(item.timestamp)}</Text>
      <Text style={styles.mediaDetailsText}>尺寸：{item.width || '-'} × {item.height || '-'}</Text>
      {item.type === 'video' ? <Text style={styles.mediaDetailsText}>时长：{formatDuration(Math.floor(item.duration || 0))}</Text> : null}
      <Text style={styles.mediaDetailsText}>大小：{formatBytes(item.fileSize)}</Text>
      <Text style={styles.mediaDetailsPath} numberOfLines={3}>{item.filepath ?? item.uri}</Text>
    </View>
  );
}

function PipPreview({ aspectRatio, isSwapped, orientation, onPress, previewOutput, sessionRevision, placeholderMode }: { aspectRatio: number; isSwapped: boolean; orientation: FrameOrientation; onPress: () => void; previewOutput: any | null; sessionRevision: number; placeholderMode: 'photo' | 'video' | null }) {
  const pipSize = useMemo(() => pipFrameSize(aspectRatio), [aspectRatio]);
  const placeholderTitle = placeholderMode === 'photo' ? '拍照中' : '录制中';
  return (
    <View style={[styles.pip, pipSize]}>
       {previewOutput ? (
         <NativePreviewView key={`pip-${sessionRevision}`} style={StyleSheet.absoluteFill} previewOutput={previewOutput} resizeMode="cover" implementationMode="compatible" />
       ) : (
         <View style={styles.pipPlaceholder}>
           {placeholderMode ? (
             <>
               <Text style={styles.pipPlaceholderTitle}>{placeholderTitle}</Text>
               <Text style={styles.pipPlaceholderText}>副画面按保存构图输出</Text>
             </>
           ) : (
             <Text style={styles.pipPlaceholderText}>副画面</Text>
           )}
         </View>
       )}
       <Text style={styles.pipLabel}>{placeholderMode ? placeholderTitle : (isSwapped ? '主画面' : `副 ${formatAspectLabel(aspectRatio)}`)}</Text>
       <Pressable style={styles.pipTouchLayer} onPress={onPress} />
    </View>
  );
}

function MainPreview({
  bottomOffset,
  fillScreen,
  frame,
  hybridRef,
  orientation,
  aspectRatio,
  previewOutput,
  sessionRevision,
  topOffset,
}: {
  fillScreen: boolean;
  bottomOffset: number;
  frame: { width: any; height: any };
  hybridRef: unknown;
  orientation: FrameOrientation;
  aspectRatio?: number;
  previewOutput: any;
  sessionRevision: number;
  topOffset: number;
}) {
  const centerStyle = useMemo(
    () => [styles.mainPreviewCenter, { top: topOffset, bottom: bottomOffset }],
    [bottomOffset, topOffset],
  );
  const slotStyle = useMemo(() => {
    if (fillScreen) {
      return styles.mainFullSlot;
    }
    return [styles.mainContainedSlot, frame];
  }, [fillScreen, frame]);

  return (
    <View pointerEvents="none" style={centerStyle}>
      <View style={slotStyle}>
        <NativePreviewView key={`main-${sessionRevision}`} style={StyleSheet.absoluteFill} previewOutput={previewOutput} resizeMode="cover" implementationMode="compatible" hybridRef={hybridRef as never} />
      </View>
    </View>
  );
}

function ZoomSelector({ currentZoom, onChange, minZoom, maxZoom, isRulerMode, setIsRulerMode }: { currentZoom: number; onChange: (z: number) => void; minZoom: number; maxZoom: number; isRulerMode: boolean; setIsRulerMode: (m: boolean) => void }) {
  const startZoomRef = useRef(currentZoom);
  const zoomRef = useRef(currentZoom);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const options = useMemo(() => [0.6, 1, 2, 2.5, 5].filter(v => v >= minZoom && v <= maxZoom), [minZoom, maxZoom]);

  useEffect(() => { zoomRef.current = currentZoom; }, [currentZoom]);
  
  const clearTimer = () => { if (restoreTimer.current) { clearTimeout(restoreTimer.current); restoreTimer.current = null; } };
  const startTimer = () => { clearTimer(); restoreTimer.current = setTimeout(() => setIsRulerMode(false), 500); };
  
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startZoomRef.current = zoomRef.current; clearTimer(); },
    onPanResponderMove: (_, gesture) => {
       if (!isRulerMode && Math.abs(gesture.dx) < 12) return;
       if (!isRulerMode) setIsRulerMode(true);
       clearTimer();
       const delta = -(gesture.dx / PX_PER_ZOOM);
       const next = clamp(startZoomRef.current + delta, minZoom, maxZoom);
       onChange(Math.round(next * 10) / 10);
    },
    onPanResponderRelease: () => { if (isRulerMode) startTimer(); },
    onPanResponderTerminate: () => setIsRulerMode(false)
  })).current;

  const tickStep = PX_PER_ZOOM * 0.1;
  const stripLeft = (ZOOM_BAR_WIDTH / 2) - ((currentZoom - minZoom) * PX_PER_ZOOM) - (tickStep / 2);
  const markers = useMemo(() => {
     const items = [];
     for(let i=0; i <= (maxZoom - minZoom) * 10; i++) items.push(minZoom + i * 0.1);
     return items;
  }, [minZoom, maxZoom]);

  return (
    <View style={styles.zoomBarShell} {...panResponder.panHandlers}>
      {isRulerMode ? (
        <View style={styles.rulerContainer}>
           <View style={[styles.rulerStrip, { left: stripLeft }]}>
              {markers.map((val) => (
                <View key={val.toFixed(1)} style={[styles.markerGroup, { width: tickStep }]}>
                   <View style={[styles.tick, Math.abs(val % 0.5) < 0.01 && styles.tickHalf, Math.abs(val % 1) < 0.01 && styles.tickMajor]} />
                   {Math.abs(val % 1) < 0.01 && <Text style={styles.tickLabel}>{val.toFixed(0)}</Text>}
                </View>
              ))}
           </View>
           <View style={styles.centerPointer} />
           <View style={styles.valueFloat}><Text style={styles.floatingValue}>{currentZoom.toFixed(1)}x</Text></View>
        </View>
      ) : (
        <View style={styles.optionsRow}>
          {options.map(val => (
            <Pressable key={val} onPress={() => onChange(val)} onLongPress={() => setIsRulerMode(true)} style={styles.optionItem}>
              <Text style={[styles.optionText, Math.abs(currentZoom - val) < 0.05 && styles.activeText]}>{val === currentZoom ? `${val}x` : val}</Text>
            </Pressable>
          ))}
          {!options.some(v => Math.abs(currentZoom - v) < 0.05) && <View style={styles.optionItem}><Text style={[styles.optionText, styles.activeText]}>{currentZoom.toFixed(1)}x</Text></View>}
        </View>
      )}
    </View>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

type SettingsTab = 'photo' | 'video' | 'about';
type LegalDocType = 'service' | 'privacy' | 'sharing' | null;

function SettingsModal({
  device,
  devicesCount,
  flashMode,
  onClose,
  onFlashModeChange,
  open,
  photoFormat,
  onPhotoFormatChange,
  photoQuality,
  onPhotoQualityChange,
  saveDualOutputs,
  setSaveDualOutputs,
  videoFps,
  videoFpsOptions,
  onVideoFpsChange,
  videoCodec,
  onVideoCodecChange,
  videoQuality,
  onVideoQualityChange,
  viewMode,
}: {
  device: CameraDevice | null;
  devicesCount: number;
  flashMode: FlashMode;
  onClose: () => void;
  onFlashModeChange: (mode: FlashMode) => void;
  open: boolean;
  photoFormat: PhotoFormat;
  onPhotoFormatChange: (value: PhotoFormat) => void;
  photoQuality: PhotoQuality;
  onPhotoQualityChange: (value: PhotoQuality) => void;
  saveDualOutputs: boolean;
  setSaveDualOutputs: (value: boolean) => void;
  videoFps: VideoFps;
  videoFpsOptions: VideoFps[];
  onVideoFpsChange: (value: VideoFps) => void;
  videoCodec: VideoCodecFormat;
  onVideoCodecChange: (value: VideoCodecFormat) => void;
  videoQuality: VideoQuality;
  onVideoQualityChange: (value: VideoQuality) => void;
  viewMode: ViewMode;
}) {
  const [tab, setTab] = useState<SettingsTab>('photo');
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // 在二级页面打开时，不触发下滑关闭弹窗
      if (legalDoc) return false;
      return gestureState.dy > 15 && Math.abs(gestureState.dx) < 15;
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 80 || gestureState.vy > 0.5) {
        onClose();
      }
    },
  }), [onClose, legalDoc]);

  const renderLegalContent = () => {
    switch (legalDoc) {
      case 'service':
        return {
          title: '服务使用协议',
          content: '欢迎使用 Agile Studio（以下简称“本软件”）。\n\n1. 软件用途：本软件是一款多功能相机工具，支持单/双画面拍摄与录制。\n2. 行为规范：用户应对使用本软件拍摄的所有内容承担法律责任，不得用于偷拍、监听等侵害他人隐私的行为。\n3. 数据存储：本软件产生的照片和视频默认存储在您的设备本地（DCIM/DualViewCamera），我们不提供云端备份服务，请自行保管重要数据。\n4. 免责声明：因硬件兼容性或系统原因导致的拍摄失败、数据丢失，本软件不承担赔偿责任。',
        };
      case 'privacy':
        return {
          title: '隐私保护政策',
          content: '我们高度重视您的隐私。\n\n1. 权限说明：\n   - 相机权限：用于实时取景、拍照及录制视频。\n   - 麦克风权限：用于录制视频时采集音频。\n   - 存储权限：用于将拍摄结果保存至系统相册，以及读取历史作品。\n2. 数据收集：本软件为纯本地工具类应用。除非您主动分享，我们不会收集、上传或向任何服务器传输您的照片、视频或个人地理位置信息。\n3. 权限管理：您可以随时在系统设置中撤回已授权的权限，但这将导致对应功能无法使用。',
        };
      case 'sharing':
        return {
          title: '第三方信息共享清单',
          content: '为保障应用稳定运行及功能实现，本软件接入了以下第三方 SDK/库：\n\n1. React Native Vision Camera：用于提供高性能相机渲染及底层采集能力。\n2. CameraRoll：用于实现与系统相册的安全交互（保存及读取）。\n3. React Native FS：用于管理本地临时文件及裁剪文件的生成。\n4. SVG Transformer：用于界面图标的渲染。\n\n上述组件均仅在本地运行，不涉及向第三方服务器共享您的个人身份信息。',
        };
      default:
        return null;
    }
  };

  const currentLegal = renderLegalContent();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View 
          style={styles.settingsPanel} 
          {...panResponder.panHandlers}
        >
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Pressable onPress={onClose}><Text style={styles.closeText}>完成</Text></Pressable>
          </View>
          <View style={styles.settingsTabs}>
            <Pressable style={[styles.settingsTab, tab === 'photo' && styles.settingsTabActive]} onPress={() => setTab('photo')}>
              <Text style={[styles.settingsTabText, tab === 'photo' && styles.settingsTabTextActive]}>拍照</Text>
            </Pressable>
            <Pressable style={[styles.settingsTab, tab === 'video' && styles.settingsTabActive]} onPress={() => setTab('video')}>
              <Text style={[styles.settingsTabText, tab === 'video' && styles.settingsTabTextActive]}>录像</Text>
            </Pressable>
            <Pressable style={[styles.settingsTab, tab === 'about' && styles.settingsTabActive]} onPress={() => setTab('about')}>
              <Text style={[styles.settingsTabText, tab === 'about' && styles.settingsTabTextActive]}>关于</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {tab === 'photo' ? (
              <>
                <SettingsSection title="照片质量">
                  {(['high', 'standard', 'low'] as PhotoQuality[]).map(value => (
                    <Chip key={value} active={photoQuality === value} label={PHOTO_QUALITY_CONFIG[value].label} onPress={() => onPhotoQualityChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="照片格式">
                  {(['jpeg', 'heic'] as PhotoFormat[]).map(value => (
                    <Chip key={value} active={photoFormat === value} label={PHOTO_FORMAT_CONFIG[value].label} onPress={() => onPhotoFormatChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="闪光灯">
                  <Chip active={flashMode === 'off'} label="关闭" onPress={() => onFlashModeChange('off')} />
                  <Chip active={flashMode === 'auto'} disabled={!device?.hasFlash} label="自动" onPress={() => onFlashModeChange('auto')} />
                  <Chip active={flashMode === 'on'} disabled={!device?.hasFlash && !device?.hasTorch} label="开启" onPress={() => onFlashModeChange('on')} />
                </SettingsSection>
              </>
            ) : tab === 'video' ? (
              <>
                <SettingsSection title="默认帧率">
                  {([30, 60] as VideoFps[]).map(value => (
                    <Chip key={value} active={videoFps === value} disabled={!videoFpsOptions.includes(value)} label={`${value}HZ`} onPress={() => onVideoFpsChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="默认画质">
                  {(['720', '1080', '4K', '8K'] as VideoQuality[]).map(value => (
                    <Chip key={value} active={videoQuality === value} label={VIDEO_QUALITY_CONFIG[value].label} onPress={() => onVideoQualityChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="编码格式">
                  {(['h265', 'h264'] as VideoCodecFormat[]).map(value => (
                    <Chip key={value} active={videoCodec === value} label={VIDEO_CODEC_CONFIG[value].label} onPress={() => onVideoCodecChange(value)} />
                  ))}
                </SettingsSection>
              </>
            ) : (
              <>
                <SettingsSection title="软件信息">
                  <Text style={styles.aboutAppTitle}>Agile Studio</Text>
                  <Text style={styles.aboutVersion}>版本：1.0.0 (Build 20260419)</Text>
                  <Text style={[styles.settingLine, { marginTop: 8 }]}>Agile Studio 是一款专为高效构图设计的双画面相机，支持主副画面同时采集。所有媒体文件均保存在本地 DCIM 目录，保护隐私，拒绝云端上传。</Text>
                </SettingsSection>
                <SettingsSection title="合规指引">
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('service')}>
                    <Text style={styles.legalLinkText}>服务使用协议</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('privacy')}>
                    <Text style={styles.legalLinkText}>隐私保护政策</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('sharing')}>
                    <Text style={styles.legalLinkText}>第三方信息共享清单</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                </SettingsSection>
              </>
            )}
            
            {(tab === 'photo' || tab === 'video') && (
              <SettingsSection title="双画面">
                <Chip active={viewMode === 'dual'} label="双画面预览已开启" />
                <Chip active={saveDualOutputs} label="双画面同时保存" onPress={() => setSaveDualOutputs(!saveDualOutputs)} />
              </SettingsSection>
            )}
            
            {tab === 'about' && (
              <>
                <SettingsSection title="开发者">
                  <Text style={styles.settingLine}>© 2026 Agile Studio Dev Team.</Text>
                  <Text style={styles.settingLine}>基于 Vision Camera 5.0 引擎构建</Text>
                </SettingsSection>
                <SettingsSection title="设备能力">
                  <Text style={styles.settingLine}>镜头数量：{devicesCount}</Text>
                  <Text style={styles.settingLine}>缩放范围：{device?.minZoom?.toFixed(1)}x ~ {device?.maxZoom?.toFixed(1)}x</Text>
                </SettingsSection>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>

          {/* 二级页面覆盖层 */}
          {legalDoc && currentLegal && (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#151515', borderRadius: 24, zIndex: 100 }]}>
              <View style={styles.settingsHeader}>
                <Pressable onPress={() => setLegalDoc(null)} style={{ paddingVertical: 4 }}>
                   <Text style={styles.closeText}>‹ 返回</Text>
                </Pressable>
                <Text style={styles.settingsTitle}>{currentLegal.title}</Text>
                <View style={{ width: 40 }} />
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.legalContentText}>{currentLegal.content}</Text>
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.settingsSection}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.chipWrap}>{children}</View></View>;
}

function Chip({ active = false, disabled = false, label, onPress }: { active?: boolean; disabled?: boolean; label: string; onPress?: () => void }) {
  return <Pressable disabled={disabled || onPress == null} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]} onPress={onPress}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

function RoundButton({ active = false, label, onPress, style, children }: { active?: boolean; label: string; onPress: () => void; style?: any; children?: React.ReactNode }) {
  return <Pressable style={[styles.roundButton, active && styles.roundButtonActive, style]} onPress={onPress}>{children ? children : <Text style={styles.roundButtonText}>{label}</Text>}</Pressable>;
}

async function requestGalleryReadPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const version = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
  try {
    if (version >= 33) {
      const permissions = [
        (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_IMAGES,
        (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_VIDEO,
      ].filter(Boolean) as string[];
      if (permissions.length === 0) return true;
      const result = await PermissionsAndroid.requestMultiple(permissions as any) as Record<string, string>;
      return permissions.every(permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
    }
    const permission = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    const granted = await PermissionsAndroid.request(permission);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function loadDualViewGallery(): Promise<GalleryMedia[]> {
  const hasPermission = await requestGalleryReadPermission();
  if (!hasPermission) return [];
  try {
    const result = await CameraRoll.getPhotos({
      first: 80,
      assetType: 'All',
      groupTypes: 'Album',
      groupName: 'DualViewCamera',
      include: ['filename', 'fileSize', 'imageSize', 'playableDuration'],
    });
    const items = result.edges.map(cameraRollNodeToGalleryMedia).filter(Boolean) as GalleryMedia[];
    if (!DualViewMedia?.getMediaStoragePath) return items;
    return Promise.all(items.map(async item => {
      try {
        const filepath = await DualViewMedia.getMediaStoragePath?.(item.uri);
        return filepath ? { ...item, filepath } : item;
      } catch {
        return item;
      }
    }));
  } catch {
    return [];
  }
}

function cameraRollNodeToGalleryMedia(asset: any): GalleryMedia | null {
  const node = asset?.node;
  const image = node?.image;
  if (!node || !image?.uri) return null;
  const rawType = String(node.type ?? '');
  const type: 'photo' | 'video' = rawType.toLowerCase().includes('video') || image.playableDuration > 0 ? 'video' : 'photo';
  return {
    id: String(node.id ?? image.uri),
    uri: image.uri,
    filepath: image.filepath ?? null,
    type,
    filename: image.filename ?? null,
    fileSize: typeof image.fileSize === 'number' ? image.fileSize : null,
    width: Number(image.width ?? 0),
    height: Number(image.height ?? 0),
    duration: Number(image.playableDuration ?? 0),
    timestamp: Number(node.timestamp ?? node.modificationTimestamp ?? 0),
  };
}

function mediaToLastMedia(item: GalleryMedia | null): LastMedia {
  if (item == null) return null;
  return {
    uri: item.uri,
    type: item.type,
    label: item.filename ?? (item.type === 'photo' ? '照片' : '视频'),
  };
}
function mimeTypeForMedia(item: GalleryMedia): string {
  const filename = item.filename?.toLowerCase() ?? item.uri.toLowerCase();
  if (item.type === 'video') return 'video/mp4';
  if (filename.endsWith('.heic') || filename.endsWith('.heif')) return 'image/heif';
  if (filename.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function toFileUri(path: string): string { return path.startsWith('file://') ? path : `file://${path}`; }
function toLocalPath(path: string): string { return path.replace(/^file:\/\//, ''); }
async function ensureVideoExtension(filePath: string, label: string): Promise<string> {
  const source = toLocalPath(filePath);
  if (/\.(mp4|m4v|mov|3gp)$/i.test(source)) return source;
  const target = `${RNFS.CachesDirectoryPath}/DualViewCamera_${slugify(label)}_${Date.now()}.mp4`;
  await RNFS.copyFile(source, target);
  return target;
}
async function createPhotoVariant(filePath: string, variant: PhotoVariant, suffix: string): Promise<string> {
  if (variant === 'full' || !DualViewMedia?.createPhotoVariant) return toLocalPath(filePath);
  return DualViewMedia.createPhotoVariant(toLocalPath(filePath), variant, slugify(suffix));
}
async function createPhotoVariantForAspect(filePath: string, spec: VisibleFrameSpec, suffix: string, format: PhotoFormat = 'jpeg', quality = 94): Promise<string> {
  if (DualViewMedia?.createPhotoVariantWithAspectFormatQuality) {
    return DualViewMedia.createPhotoVariantWithAspectFormatQuality(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
      format,
      quality,
    );
  }
  if (DualViewMedia?.createPhotoVariantWithAspectAndFormat) {
    return DualViewMedia.createPhotoVariantWithAspectAndFormat(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
      format,
    );
  }
  if (DualViewMedia?.createPhotoVariantWithAspect) {
    return DualViewMedia.createPhotoVariantWithAspect(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
    );
  }
  return createPhotoVariant(filePath, spec.variant, suffix);
}
async function createDualPhotoVariantsForAspects(filePath: string, mainSpec: VisibleFrameSpec, subSpec: VisibleFrameSpec, format: PhotoFormat = 'jpeg', quality = 94): Promise<{ mainPath: string; subPath: string }> {
  if (DualViewMedia?.createDualPhotoVariantsWithAspectsFormatQuality) {
    return DualViewMedia.createDualPhotoVariantsWithAspectsFormatQuality(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
      format,
      quality,
    );
  }
  if (DualViewMedia?.createDualPhotoVariantsWithAspectsAndFormat) {
    return DualViewMedia.createDualPhotoVariantsWithAspectsAndFormat(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
      format,
    );
  }
  if (DualViewMedia?.createDualPhotoVariantsWithAspects) {
    return DualViewMedia.createDualPhotoVariantsWithAspects(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
    );
  }
  const [mainPath, subPath] = await Promise.all([
    createPhotoVariantForAspect(filePath, mainSpec, 'main'),
    createPhotoVariantForAspect(filePath, subSpec, 'sub'),
  ]);
  return { mainPath, subPath };
}
async function createVideoVariant(filePath: string, variant: PhotoVariant, suffix: string, targetSize: { width: number; height: number }, codec: VideoCodecFormat = 'h265'): Promise<string> {
  if (!DualViewMedia?.createVideoVariant) return toLocalPath(filePath);
  return DualViewMedia.createVideoVariant(toLocalPath(filePath), variant, slugify(suffix), targetSize.width, targetSize.height, codec);
}
function slugify(v: string): string { return v.replace(/[^\w-]+/g, '_') || 'media'; }
function wait(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function visibleFrameSpec(orientation: FrameOrientation, selectedAspect: typeof ASPECT_RATIOS[number], fullPortraitAspect: number): VisibleFrameSpec {
  if (orientation === 'landscape') return { aspect: 16 / 9, variant: 'landscape' };
  if (selectedAspect.id === 'full') return { aspect: fullPortraitAspect, variant: 'full' };
  if (selectedAspect.id === '16:9') return { aspect: 9 / 16, variant: 'video16x9' };
  return { aspect: selectedAspect.previewAspect ?? 3 / 4, variant: selectedAspect.photoVariant };
}
function videoTargetSizeForAspect(aspectRatio: number, quality: (typeof VIDEO_QUALITY_CONFIG)[VideoQuality]): { width: number; height: number } {
  const targetLongEdge = aspectRatio >= 1 ? quality.landscape.width : quality.portrait.height;
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
function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
function pipFrameSize(aspectRatio: number): { width: number; height: number } {
  if (Math.abs(aspectRatio - 1) < 0.01) {
    return { width: 154, height: 154 };
  }
  if (aspectRatio >= 1) {
    return { width: 192, height: Math.round(192 / aspectRatio) };
  }
  return { width: Math.round(168 * aspectRatio), height: 168 };
}
function formatAspectLabel(aspectRatio: number): string {
  if (Math.abs(aspectRatio - 1) < 0.01) return '1:1';
  if (Math.abs(aspectRatio - 16 / 9) < 0.02 || Math.abs(aspectRatio - 9 / 16) < 0.02) return '16:9';
  if (Math.abs(aspectRatio - 3 / 4) < 0.02) return '3:4';
  return '全屏';
}
function safeSupportsFPS(device: CameraDevice, fps: VideoFps): boolean {
  try {
    return device.supportsFPS(fps);
  } catch {
    return fps === 30;
  }
}
function nextFps(current: VideoFps, options: VideoFps[]): VideoFps {
  const currentIndex = options.indexOf(current);
  return options[(currentIndex + 1) % options.length] ?? 30;
}
function nextVideoQuality(current: VideoQuality): VideoQuality {
  const options: VideoQuality[] = ['720', '1080', '4K', '8K'];
  return options[(options.indexOf(current) + 1) % options.length] ?? '4K';
}
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '未知';
  const millis = timestamp > 100000000000 ? timestamp : timestamp * 1000;
  return new Date(millis).toLocaleString('zh-CN', { hour12: false });
}
function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
function touchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number | null {
  if (touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}
function touchCenter(touches: ReadonlyArray<{ locationX: number; locationY: number }>): { x: number; y: number } | null {
  if (touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.locationX + second.locationX) / 2,
    y: (first.locationY + second.locationY) / 2,
  };
}
function containedMediaFrame(containerWidth: number, containerHeight: number, mediaWidth: number, mediaHeight: number): { width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { width: containerWidth, height: containerHeight };
  }
  const containerRatio = containerWidth / containerHeight;
  const mediaRatio = mediaWidth / mediaHeight;
  if (mediaRatio > containerRatio) {
    return { width: containerWidth, height: containerWidth / mediaRatio };
  }
  return { width: containerHeight * mediaRatio, height: containerHeight };
}
function clampPointToMediaRect(point: { x: number; y: number }, container: { width: number; height: number }, frame: { width: number; height: number }): { x: number; y: number } {
  const left = (container.width - frame.width) / 2;
  const top = (container.height - frame.height) / 2;
  return {
    x: clamp(point.x, left, left + frame.width),
    y: clamp(point.y, top, top + frame.height),
  };
}
function clampPhotoTranslate(translate: { x: number; y: number }, scale: number, size: { width: number; height: number }, frame: { width: number; height: number }): { x: number; y: number } {
  if (scale <= 1.02 || size.width <= 0 || size.height <= 0) return { x: 0, y: 0 };
  const maxX = Math.max(0, (frame.width * scale - size.width) / 2);
  const maxY = Math.max(0, (frame.height * scale - size.height) / 2);
  return {
    x: clamp(translate.x, -maxX, maxX),
    y: clamp(translate.y, -maxY, maxY),
  };
}
function calculateContainedFrame(containerWidth: number, containerHeight: number, aspectRatio?: number): { width: any; height: any } {
  if (containerWidth <= 0 || containerHeight <= 0 || aspectRatio == null) {
    return { width: '100%', height: '100%' };
  }
  const containerRatio = containerWidth / containerHeight;
  if (containerRatio > aspectRatio) {
    return { width: containerHeight * aspectRatio, height: containerHeight };
  }
  return { width: containerWidth, height: containerWidth / aspectRatio };
}
async function loadPersistedSettings(): Promise<PersistedSettings> {
  try {
    const exists = await RNFS.exists(SETTINGS_PATH);
    if (!exists) return {};
    return JSON.parse(await RNFS.readFile(SETTINGS_PATH, 'utf8')) as PersistedSettings;
  } catch {
    return {};
  }
}
async function savePersistedSettings(settings: PersistedSettings): Promise<void> {
  await RNFS.writeFile(SETTINGS_PATH, JSON.stringify(settings), 'utf8');
}
function isAspectRatioId(value: unknown): value is AspectRatioId {
  return value === 'full' || value === '1:1' || value === '4:3' || value === '16:9';
}
function isPhotoQuality(value: unknown): value is PhotoQuality {
  return value === 'high' || value === 'standard' || value === 'low';
}
function isPhotoFormat(value: unknown): value is PhotoFormat {
  return value === 'jpeg' || value === 'heic';
}
function isVideoQuality(value: unknown): value is VideoQuality {
  return value === '720' || value === '1080' || value === '4K' || value === '8K';
}
function isVideoFps(value: unknown): value is VideoFps {
  return value === 30 || value === 60;
}
function isVideoCodecFormat(value: unknown): value is VideoCodecFormat {
  return value === 'h265' || value === 'h264';
}
function isViewMode(value: unknown): value is ViewMode {
  return value === 'single' || value === 'dual';
}
function isCameraResourceBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /maximum number of open cameras|too many open cameras|camera.*in use/i.test(message);
}
function cameraErrorMessage(error: any, fallback: string): string {
  const m = error?.message || '';
  if (m.includes('flash')) return '不支持闪光灯';
  return m.split('\n')[0] || fallback;
}
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(v, max)); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  root: { flex: 1, backgroundColor: COLORS.bg },
  previewArea: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#05070a' },
  focusLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 8 },
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.bg },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  description: { color: COLORS.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  primaryButton: { borderRadius: 999, backgroundColor: COLORS.text, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#000', fontWeight: '800' },
  previewStatus: { position: 'absolute', left: 22, right: 22, top: '40%', zIndex: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: COLORS.line },
  previewStatusTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  previewStatusText: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  mainPreviewCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  mainContainedSlot: { backgroundColor: '#000', overflow: 'hidden' },
  mainPortraitSlot: { height: '100%', aspectRatio: 3 / 4, backgroundColor: '#000', overflow: 'hidden' },
  mainFullSlot: { width: '100%', height: '100%' },
  mainLandscapeSlot: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  mainTallLandscapeSlot: { height: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  topBar: { position: 'absolute', left: 0, right: 0, top: TOP_BAR_OFFSET, zIndex: 20, paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topSide: { width: 88, height: 42 },
  topCenter: { position: 'absolute', left: 88, right: 88, alignItems: 'center', justifyContent: 'center' },
  topActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  aspectRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.42)' },
  aspectButton: { minWidth: 34, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  aspectButtonActive: { backgroundColor: 'rgba(255,209,102,0.22)' },
  aspectText: { color: COLORS.muted, fontSize: 11, fontWeight: '900' },
  aspectTextActive: { color: COLORS.text },
  topVideoControls: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  topVideoPills: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  topPill: { minWidth: 58, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.46)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  topPillText: { color: COLORS.text, fontSize: 12, fontWeight: '900' },
  recordingTime: { minWidth: 68, textAlign: 'center', color: COLORS.text, fontSize: 15, fontWeight: '900', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17, backgroundColor: 'rgba(255,59,48,0.78)' },
  roundButton: { minWidth: 42, height: 42, borderRadius: 21, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 0, opacity: 0.65 },
  roundButtonActive: { backgroundColor: 'rgba(255,209,102,0.18)', opacity: 0.88 },
  roundButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  noBorderButton: { backgroundColor: 'transparent', borderWidth: 0, minWidth: 42 },
  pip: { position: 'absolute', left: 18, bottom: 228, zIndex: 18, overflow: 'hidden', borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: '#000' },
  pipLabel: { position: 'absolute', left: 6, bottom: 5, color: COLORS.text, fontSize: 10, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 3 },
  pipTouchLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  pipPlaceholder: { flex: 1, backgroundColor: 'rgba(10,10,10,0.92)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pipPlaceholderTitle: { color: COLORS.text, fontSize: 13, fontWeight: '900', marginBottom: 5, textAlign: 'center' },
  pipPlaceholderText: { color: COLORS.muted, fontSize: 11, fontWeight: '800', lineHeight: 15, textAlign: 'center' },
  zoomBarContainer: { position: 'absolute', left: 0, right: 0, bottom: 180, alignItems: 'center', zIndex: 25 },
  zoomBarShell: { width: ZOOM_BAR_WIDTH, height: 38, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  optionItem: { height: '100%', paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  optionText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '900' },
  activeText: { color: COLORS.accent },
  rulerContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  rulerStrip: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', height: '100%', paddingBottom: 7 },
  markerGroup: { alignItems: 'center' },
  tick: { width: 1.5, height: 7, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1 },
  tickHalf: { height: 10, backgroundColor: 'rgba(255,255,255,0.5)' },
  tickMajor: { height: 15, backgroundColor: '#fff', width: 2 },
  tickLabel: { position: 'absolute', top: -13, color: 'rgba(255,255,255,0.6)', fontSize: 8, fontWeight: '800' },
  centerPointer: { position: 'absolute', width: 2.5, height: 22, backgroundColor: COLORS.accent, borderRadius: 2, zIndex: 3 },
  valueFloat: { position: 'absolute', right: 12, backgroundColor: 'rgba(0,0,0,0.28)', paddingHorizontal: 6, borderRadius: 10 },
  floatingValue: { color: COLORS.accent, fontSize: 13, fontWeight: '900' },
  toast: { position: 'absolute', left: 24, right: 24, bottom: 150, zIndex: 30, alignItems: 'center' },
  toastText: { overflow: 'hidden', color: COLORS.text, fontSize: 13, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.65)' },
  bottomControls: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 26, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 22, backgroundColor: 'transparent' },
  modeRow: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 34 },
  modeText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  modeTextActive: { color: COLORS.accent },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 82 },
  thumbnailButton: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: COLORS.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbnailImage: { width: '100%', height: '100%' },
  thumbnailText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterRecording: { borderColor: COLORS.red },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  shutterInnerRecording: { width: 28, height: 28, borderRadius: 7, backgroundColor: COLORS.red },
  viewModeRow: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  viewModeButton: { minWidth: 116, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  viewModeText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  viewModeTextActive: { color: COLORS.text },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.44)' },
  settingsPanel: { maxHeight: '82%', padding: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#151515' },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  settingsTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  closeText: { color: COLORS.accent, fontSize: 15, fontWeight: '800' },
  settingsTabs: { flexDirection: 'row', gap: 8, marginBottom: 14, padding: 4, borderRadius: 12, backgroundColor: '#0f0f0f' },
  settingsTab: { flex: 1, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  settingsTabActive: { backgroundColor: '#2d2d2d' },
  settingsTabText: { color: COLORS.muted, fontSize: 13, fontWeight: '800' },
  settingsTabTextActive: { color: COLORS.text },
  aboutAppTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 2 },
  aboutVersion: { color: COLORS.muted, fontSize: 11, marginBottom: 4 },
  legalLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  legalLinkText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  legalArrow: { color: COLORS.muted, fontSize: 18, fontWeight: '300' },
  legalContentText: { color: COLORS.muted, fontSize: 13, lineHeight: 22, padding: 4 },
  settingsSection: { marginBottom: 16, padding: 14, borderRadius: 18, backgroundColor: '#222' },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#111', borderWidth: 1, borderColor: COLORS.line },
  chipActive: { borderColor: COLORS.accent, backgroundColor: 'rgba(255,209,102,0.18)' },
  chipDisabled: { opacity: 0.42 },
  chipText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: COLORS.text },
  settingLine: { color: COLORS.muted, fontSize: 12, lineHeight: 22 },
  focusBox: { position: 'absolute', width: 72, height: 72, borderWidth: 2, borderColor: COLORS.accent, borderRadius: 4 },
  galleryRoot: { flex: 1, backgroundColor: '#000' },
  galleryTopBar: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, paddingTop: TOP_BAR_OFFSET, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  galleryTopButton: { minWidth: 58, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  galleryTopText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  galleryCount: { color: COLORS.text, fontSize: 14, fontWeight: '900' },
  galleryPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  galleryLazyPage: { flex: 1, backgroundColor: '#000' },
  galleryImage: { width: '100%', height: '100%' },
  zoomablePhoto: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  zoomableImageFrame: { alignItems: 'center', justifyContent: 'center' },
  zoomResetButton: { position: 'absolute', right: 18, top: TOP_BAR_OFFSET + 42, minWidth: 52, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  zoomResetText: { color: COLORS.text, fontSize: 12, fontWeight: '900' },
  inlineVideoPlayer: { width: '100%', height: '100%', backgroundColor: '#000' },
  galleryEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  galleryEmptyText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  mediaPreviewFallback: { minWidth: 210, minHeight: 180, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: 'rgba(255,255,255,0.08)' },
  videoPreview: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  videoPreviewIcon: { color: COLORS.text, fontSize: 54, fontWeight: '900', marginBottom: 12 },
  videoPreviewTitle: { color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 },
  videoPreviewText: { color: COLORS.muted, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  videoPreviewHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  galleryBottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 26, flexDirection: 'row', gap: 10, justifyContent: 'space-between', backgroundColor: 'transparent' },
  galleryBottomButton: { flex: 1, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  galleryDeleteButton: { backgroundColor: 'rgba(255,59,48,0.18)' },
  galleryBottomText: { color: COLORS.text, fontSize: 13, fontWeight: '900' },
  galleryDeleteText: { color: '#ff8a82' },
  mediaDetails: { position: 'absolute', left: 16, right: 16, bottom: 92, zIndex: 6, padding: 14, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.78)', borderWidth: 1, borderColor: COLORS.line },
  mediaDetailsTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginBottom: 8 },
  mediaDetailsText: { color: COLORS.muted, fontSize: 12, lineHeight: 20 },
  mediaDetailsPath: { color: 'rgba(255,255,255,0.48)', fontSize: 11, lineHeight: 16, marginTop: 6 },
});

export default App;
