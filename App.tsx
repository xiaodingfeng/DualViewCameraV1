import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  GestureResponderEvent,
  Image,
  LogBox,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
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
type AspectRatioId = 'full' | '1:1' | '4:3' | '16:9';
type PhotoQuality = 'high' | 'standard' | 'low';
type VideoQuality = '720' | '1080' | '4K' | '8K';
type VideoFps = 30 | 60;
type SettingsTab = 'photo' | 'video';
type PhotoVariant = 'full' | 'portrait' | 'landscape' | 'square' | 'photo4x3' | 'video16x9';
type PersistedSettings = Partial<{
  selectedAspectId: AspectRatioId;
  photoQuality: PhotoQuality;
  videoFps: VideoFps;
  videoQuality: VideoQuality;
  viewMode: ViewMode;
  saveDualOutputs: boolean;
}>;

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
const ZOOM_BAR_WIDTH = 280;
const PX_PER_ZOOM = 120; 
const SETTINGS_PATH = `${RNFS.DocumentDirectoryPath}/dual-view-camera-settings.json`;

const ASPECT_RATIOS: Array<{ id: AspectRatioId; label: string; previewAspect?: number; photoVariant: PhotoVariant; photoResolution: { width: number; height: number } }> = [
  { id: 'full', label: '全屏', previewAspect: undefined, photoVariant: 'full', photoResolution: CommonResolutions.HIGHEST_4_3 },
  { id: '1:1', label: '1:1', previewAspect: 1, photoVariant: 'square', photoResolution: { width: 3024, height: 3024 } },
  { id: '4:3', label: '4:3', previewAspect: 3 / 4, photoVariant: 'photo4x3', photoResolution: CommonResolutions.UHD_4_3 },
  { id: '16:9', label: '16:9', previewAspect: 9 / 16, photoVariant: 'video16x9', photoResolution: CommonResolutions.UHD_16_9 },
];

const PHOTO_QUALITY_CONFIG: Record<PhotoQuality, { label: string; quality: number; priority: 'speed' | 'balanced' | 'quality' }> = {
  high: { label: '高', quality: 0.96, priority: 'quality' },
  standard: { label: '标准', quality: 0.88, priority: 'balanced' },
  low: { label: '低', quality: 0.72, priority: 'speed' },
};

const VIDEO_QUALITY_CONFIG: Record<VideoQuality, { label: string; resolution: { width: number; height: number }; landscape: { width: number; height: number }; portrait: { width: number; height: number } }> = {
  '720': { label: '720', resolution: CommonResolutions.HD_16_9, landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 960 } },
  '1080': { label: '1080', resolution: CommonResolutions.FHD_16_9, landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1440 } },
  '4K': { label: '4K', resolution: CommonResolutions.UHD_16_9, landscape: { width: 3840, height: 2160 }, portrait: { width: 2160, height: 2880 } },
  '8K': { label: '8K', resolution: CommonResolutions['8k_16_9'], landscape: { width: 8064, height: 4536 }, portrait: { width: 6048, height: 8064 } },
};

const { DualViewMedia } = NativeModules as {
  DualViewMedia?: {
    createPhotoVariant(sourcePath: string, variant: PhotoVariant, suffix: string): Promise<string>;
    createVideoVariant?(sourcePath: string, variant: PhotoVariant, suffix: string, width: number, height: number): Promise<string>;
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
  const [videoFps, setVideoFps] = useState<VideoFps>(30);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('4K');
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
    targetResolution: CommonResolutions.UHD_4_3,
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
  
  const [zoom, setZoom] = useState(device.minZoom);
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

  useEffect(() => {
    let cancelled = false;
    loadPersistedSettings()
      .then(settings => {
        if (cancelled) return;
        if (isAspectRatioId(settings.selectedAspectId)) setSelectedAspectId(settings.selectedAspectId);
        if (isPhotoQuality(settings.photoQuality)) setPhotoQuality(settings.photoQuality);
        if (isVideoFps(settings.videoFps)) setVideoFps(settings.videoFps);
        if (isVideoQuality(settings.videoQuality)) setVideoQuality(settings.videoQuality);
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
      videoFps,
      videoQuality,
      viewMode,
      saveDualOutputs,
    }).catch(() => {});
  }, [photoQuality, saveDualOutputs, selectedAspectId, settingsLoaded, videoFps, videoQuality, viewMode]);

  const isDeviceLandscape = physicalOrientation?.startsWith('landscape') ?? false;
  const defaultSubOrientation: FrameOrientation = isDeviceLandscape ? 'portrait' : 'landscape';
  const mainDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? defaultSubOrientation : 'portrait';
  const subDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? 'portrait' : defaultSubOrientation;
  const isFullPreview = captureMode === 'photo' && selectedAspectId === 'full';
  const mainPreviewAspect = captureMode === 'video'
    ? 9 / 16
    : (mainDisplayOrientation === 'landscape' ? 16 / 9 : selectedAspect.previewAspect);
  const previewTopOffset = isFullPreview ? 0 : PREVIEW_TOP_OFFSET;
  const mainPreviewFrame = useMemo(
    () => calculateContainedFrame(previewSize.width, Math.max(0, previewSize.height - previewTopOffset), mainPreviewAspect),
    [mainPreviewAspect, previewSize.height, previewSize.width, previewTopOffset],
  );
  const videoFpsOptions = useMemo<VideoFps[]>(() => {
    const supports60 = safeSupportsFPS(device, 60);
    return supports60 ? [30, 60] : [30];
  }, [device]);
  const mainPhotoVariant = viewMode === 'dual'
    ? frameVariant(mainDisplayOrientation, selectedAspect.photoVariant)
    : selectedAspect.photoVariant;
  const subPhotoVariant = frameVariant(subDisplayOrientation, selectedAspect.photoVariant);
  const videoVariantSize = useCallback((variant: PhotoVariant) => {
    return variant === 'landscape' || variant === 'video16x9'
      ? videoQualityConfig.landscape
      : videoQualityConfig.portrait;
  }, [videoQualityConfig.landscape, videoQualityConfig.portrait]);

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
    isActive: isAppActive,
    orientationSource: 'device',
    getInitialZoom,
    onStarted: handleCameraStarted,
    onError: handleCameraError,
    onInterruptionEnded: handleCameraInterruptionEnded,
  });

  useEffect(() => {
    if (!device) return;
    setZoom(device.minZoom);
    setFlashMode('off');
    setIsSwapped(false);
    setIsRulerMode(false);
    setPreviewIssue('');
    if (!safeSupportsFPS(device, videoFps)) {
      setVideoFps(30);
    }
  }, [device?.id]);

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

  const saveToGallery = useCallback(async (filePath: string, type: 'photo' | 'video', label: string) => {
    const sourcePath = type === 'video' ? await ensureVideoExtension(filePath, label) : filePath;
    const uri = toFileUri(sourcePath);
    await CameraRoll.saveAsset(uri, { type, album: 'DualViewCamera' });
    setLastMedia({ uri, type, label });
    return uri;
  }, []);

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
      if (viewMode === 'dual' && saveDualOutputs) {
        const mainPath = await createPhotoVariant(file.filePath, mainPhotoVariant, 'main');
        const subPath = await createPhotoVariant(file.filePath, subPhotoVariant, 'sub');
        await saveToGallery(mainPath, 'photo', '主画面');
        await saveToGallery(subPath, 'photo', '副画面');
        setToast('拍照成功，已保存 2 个文件');
      } else {
        const mainPath = await createPhotoVariant(file.filePath, mainPhotoVariant, 'main');
        await saveToGallery(mainPath, 'photo', '主画面');
        setToast('拍照成功');
      }
    } catch (error) {
      setToast(cameraErrorMessage(error, '拍照失败'));
    } finally {
      await cleanupFlashAfterPhoto(torchWasEnabled);
      setIsBusy(false);
      setPendingPhotoCapture(false);
    }
  }, [captureMode, cleanupFlashAfterPhoto, device?.hasFlash, flashMode, isBusy, mainPhotoVariant, pendingPhotoCapture, photoOutput, prepareFlashForPhoto, saveDualOutputs, saveToGallery, subPhotoVariant, viewMode]);

  useEffect(() => {
    if (!pendingPhotoCapture) return;
    const timer = setTimeout(() => {
      takePhoto();
    }, 200);
    return () => clearTimeout(timer);
  }, [pendingPhotoCapture, takePhoto]);

  const finishRecording = useCallback(async (filePath: string) => {
    try {
      const mainVariant = viewMode === 'dual'
        ? frameVariant(mainDisplayOrientation, selectedAspect.photoVariant)
        : selectedAspect.photoVariant;
      const mainPath = await createVideoVariant(filePath, mainVariant, 'main', videoVariantSize(mainVariant));
      await saveToGallery(mainPath, 'video', '主画面');
      if (viewMode === 'dual' && saveDualOutputs) {
        const subVariant = frameVariant(subDisplayOrientation, selectedAspect.photoVariant);
        const subPath = await createVideoVariant(filePath, subVariant, 'sub', videoVariantSize(subVariant));
        await saveToGallery(subPath, 'video', '副画面');
      }
      setToast('录像已保存');
    } catch (error) {
      setToast('录像保存失败');
    }
  }, [mainDisplayOrientation, saveDualOutputs, saveToGallery, selectedAspect.photoVariant, subDisplayOrientation, videoVariantSize, viewMode]);

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
    setFlashMode(current => (current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off'));
  }, [device?.hasFlash, device?.hasTorch]);

  const swapMainAndSub = useCallback(() => {
    setIsSwapped(current => !current);
  }, []);

  const openLastMedia = useCallback(() => {
    if (lastMedia == null) {
      setToast('还没有拍摄内容');
      return;
    }
    Alert.alert('最近保存', `${lastMedia.label}\n${lastMedia.uri}`);
  }, [lastMedia]);

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
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
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
              isSwapped={isSwapped}
              orientation={subDisplayOrientation}
              onPress={swapMainAndSub}
              previewOutput={
                captureMode === 'photo'
                  ? (pendingPhotoCapture ? null : pipPreviewOutput)
                  : (isRecording || pendingVideoStart ? null : pipPreviewOutput)
              }
              sessionRevision={sessionRevision}
              isRecording={isRecording && captureMode === 'video'}
            />
          )}
          {toast ? <Toast message={toast} /> : null}
          <View style={styles.zoomBarContainer}>
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
        photoQuality={photoQuality}
        onPhotoQualityChange={setPhotoQuality}
        saveDualOutputs={saveDualOutputs}
        setSaveDualOutputs={setSaveDualOutputs}
        videoFps={videoFps}
        videoFpsOptions={videoFpsOptions}
        onVideoFpsChange={setVideoFps}
        videoQuality={videoQuality}
        onVideoQualityChange={setVideoQuality}
        viewMode={viewMode}
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
            <Pressable style={styles.topPill} onPress={() => onVideoFpsChange(nextFps(videoFps, videoFpsOptions))}>
              <Text style={styles.topPillText}>{videoFps}HZ</Text>
            </Pressable>
            <Pressable style={styles.topPill} onPress={() => onVideoQualityChange(nextVideoQuality(videoQuality))}>
              <Text style={styles.topPillText}>{VIDEO_QUALITY_CONFIG[videoQuality].label}</Text>
            </Pressable>
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
    <View style={styles.bottomControls}>
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

function PipPreview({ isSwapped, orientation, onPress, previewOutput, sessionRevision, isRecording }: { isSwapped: boolean; orientation: FrameOrientation; onPress: () => void; previewOutput: any | null; sessionRevision: number; isRecording: boolean }) {
  const isLandscape = orientation === 'landscape';
  return (
    <View style={[styles.pip, isLandscape ? styles.pipLandscape : styles.pipPortrait]}>
       {previewOutput ? (
         <NativePreviewView key={`pip-${sessionRevision}`} style={StyleSheet.absoluteFill} previewOutput={previewOutput} resizeMode="cover" implementationMode="compatible" />
       ) : (
         <View style={styles.pipPlaceholder}>
           <Text style={styles.pipPlaceholderText}>{isRecording ? '录制中' : '副画面'}</Text>
         </View>
       )}
       <Text style={styles.pipLabel}>{isRecording ? '录制中' : (isSwapped ? '主画面' : (isLandscape ? '副 16:9' : '副 3:4'))}</Text>
       <Pressable style={styles.pipTouchLayer} onPress={onPress} />
    </View>
  );
}

function MainPreview({
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
  frame: { width: any; height: any };
  hybridRef: unknown;
  orientation: FrameOrientation;
  aspectRatio?: number;
  previewOutput: any;
  sessionRevision: number;
  topOffset: number;
}) {
  const centerStyle = useMemo(
    () => [styles.mainPreviewCenter, { top: topOffset }],
    [topOffset],
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

  const stripLeft = (ZOOM_BAR_WIDTH / 2) - (currentZoom - minZoom) * PX_PER_ZOOM;
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
                <View key={val.toFixed(1)} style={[styles.markerGroup, { width: PX_PER_ZOOM * 0.1 }]}>
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

function SettingsModal({
  device,
  devicesCount,
  flashMode,
  onClose,
  onFlashModeChange,
  open,
  photoQuality,
  onPhotoQualityChange,
  saveDualOutputs,
  setSaveDualOutputs,
  videoFps,
  videoFpsOptions,
  onVideoFpsChange,
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
  photoQuality: PhotoQuality;
  onPhotoQualityChange: (value: PhotoQuality) => void;
  saveDualOutputs: boolean;
  setSaveDualOutputs: (value: boolean) => void;
  videoFps: VideoFps;
  videoFpsOptions: VideoFps[];
  onVideoFpsChange: (value: VideoFps) => void;
  videoQuality: VideoQuality;
  onVideoQualityChange: (value: VideoQuality) => void;
  viewMode: ViewMode;
}) {
  const [tab, setTab] = useState<SettingsTab>('photo');
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.modalShade}>
        <View style={styles.settingsPanel}>
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
          </View>
          <ScrollView>
            {tab === 'photo' ? (
              <>
                <SettingsSection title="照片质量">
                  {(['high', 'standard', 'low'] as PhotoQuality[]).map(value => (
                    <Chip key={value} active={photoQuality === value} label={PHOTO_QUALITY_CONFIG[value].label} onPress={() => onPhotoQualityChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="闪光灯">
                  <Chip active={flashMode === 'off'} label="关闭" onPress={() => onFlashModeChange('off')} />
                  <Chip active={flashMode === 'auto'} disabled={!device?.hasFlash} label="自动" onPress={() => onFlashModeChange('auto')} />
                  <Chip active={flashMode === 'on'} disabled={!device?.hasFlash && !device?.hasTorch} label="开启" onPress={() => onFlashModeChange('on')} />
                </SettingsSection>
              </>
            ) : (
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
              </>
            )}
            <SettingsSection title="双画面">
              <Chip active={viewMode === 'dual'} label="双画面预览已开启" />
              <Chip active={saveDualOutputs} label="双画面同时保存" onPress={() => setSaveDualOutputs(!saveDualOutputs)} />
            </SettingsSection>
            <SettingsSection title="设备能力">
              <Text style={styles.settingLine}>镜头数量：{devicesCount}</Text>
              <Text style={styles.settingLine}>缩放：{device?.minZoom}x ~ {device?.maxZoom}x</Text>
            </SettingsSection>
          </ScrollView>
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
async function createVideoVariant(filePath: string, variant: PhotoVariant, suffix: string, targetSize: { width: number; height: number }): Promise<string> {
  if (!DualViewMedia?.createVideoVariant) return toLocalPath(filePath);
  return DualViewMedia.createVideoVariant(toLocalPath(filePath), variant, slugify(suffix), targetSize.width, targetSize.height);
}
function slugify(v: string): string { return v.replace(/[^\w-]+/g, '_') || 'media'; }
function wait(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function frameVariant(orientation: FrameOrientation, selectedVariant: PhotoVariant): PhotoVariant {
  if (orientation === 'landscape') return 'landscape';
  if (selectedVariant === 'landscape' || selectedVariant === 'video16x9') return 'portrait';
  return selectedVariant === 'full' ? 'portrait' : selectedVariant;
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
function isVideoQuality(value: unknown): value is VideoQuality {
  return value === '720' || value === '1080' || value === '4K' || value === '8K';
}
function isVideoFps(value: unknown): value is VideoFps {
  return value === 30 || value === 60;
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
  mainPreviewCenter: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
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
  topVideoControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  topPill: { minWidth: 58, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.46)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  topPillText: { color: COLORS.text, fontSize: 12, fontWeight: '900' },
  recordingTime: { minWidth: 68, textAlign: 'center', color: COLORS.text, fontSize: 15, fontWeight: '900', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17, backgroundColor: 'rgba(255,59,48,0.78)' },
  roundButton: { minWidth: 42, height: 42, borderRadius: 21, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 0, opacity: 0.65 },
  roundButtonActive: { backgroundColor: 'rgba(255,209,102,0.18)', opacity: 0.88 },
  roundButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  noBorderButton: { backgroundColor: 'transparent', borderWidth: 0, minWidth: 42 },
  pip: { position: 'absolute', left: 18, bottom: 164, zIndex: 18, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: '#000' },
  pipLandscape: { width: 190, height: 110, borderRadius: 16 },
  pipPortrait: { width: 126, height: 168, borderRadius: 16 },
  pipLabel: { position: 'absolute', left: 6, bottom: 5, color: COLORS.text, fontSize: 10, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 3 },
  pipTouchLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  pipPlaceholder: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  pipPlaceholderText: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  zoomBarContainer: { position: 'absolute', left: 0, right: 0, bottom: 176, alignItems: 'center', zIndex: 25 },
  zoomBarShell: { width: ZOOM_BAR_WIDTH, height: 50, backgroundColor: 'rgba(0,0,0,0.26)', borderRadius: 25, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  optionItem: { height: '100%', paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  optionText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '900' },
  activeText: { color: COLORS.accent },
  rulerContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  rulerStrip: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', height: '100%', paddingBottom: 10 },
  markerGroup: { alignItems: 'center' },
  tick: { width: 1.5, height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1 },
  tickHalf: { height: 12, backgroundColor: 'rgba(255,255,255,0.5)' },
  tickMajor: { height: 18, backgroundColor: '#fff', width: 2 },
  tickLabel: { position: 'absolute', top: -16, color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '800' },
  centerPointer: { position: 'absolute', width: 2.5, height: 26, backgroundColor: COLORS.accent, borderRadius: 2, zIndex: 3 },
  valueFloat: { position: 'absolute', right: 14, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 6, borderRadius: 10 },
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
});

export default App;
