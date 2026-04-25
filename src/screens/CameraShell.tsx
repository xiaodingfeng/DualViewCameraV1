import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  GestureResponderEvent,
  PanResponder,
  Pressable,
  StatusBar,
  View,
} from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { callback } from 'react-native-nitro-modules';
import {
  CommonResolutions,
  type CameraDevice,
  type CameraPosition,
  type Orientation,
  type PreviewView,
  type Recorder,
  useCamera,
  useOrientation,
  usePhotoOutput,
  usePreviewOutput,
  useVideoOutput,
} from 'react-native-vision-camera';

import {
  ASPECT_RATIOS,
  PHOTO_QUALITY_CONFIG,
  VIDEO_QUALITY_CONFIG,
} from '../config/camera';
import {
  BottomControls,
  FocusBox,
  MainPreview,
  PipPreview,
  PreviewStatusOverlay,
  Toast,
  TopBar,
  ZoomSelector,
} from '../components/CameraPrimitives';
import { GalleryView } from '../components/GalleryModal';
import { MediaJobIndicator } from '../components/MediaJobIndicator';
import { SettingsModal } from '../components/SettingsModal';
import { DualViewMedia } from '../native/dualViewMedia';

const SCREEN_WIDTH = Dimensions.get('window').width;
import { styles } from '../styles/cameraStyles';
import type {
  AspectRatioId,
  CaptureMode,
  FlashMode,
  GalleryMedia,
  LastMedia,
  PhotoFormat,
  PhotoQuality,
  SafetyOverlayMode,
  VideoCodecFormat,
  VideoFps,
  VideoQuality,
  ViewMode,
  VisibleFrameSpec,
} from '../types/camera';
import {
  calculateContainedFrame,
  cameraErrorMessage,
  clamp,
  isCameraResourceBusyError,
  videoFpsOptionsForQuality,
  videoTargetSizeForAspect,
  wait,
} from '../utils/camera';
import {
  buildCameraCapabilities,
  firstSupportedVideoQuality,
} from '../utils/cameraCapabilities';
import { createCaptureId } from '../utils/captureId';
import { buildCompositionScene } from '../utils/composition';
import {
  cameraRollNodeToGalleryMedia,
  createDualPhotoVariantsForAspects,
  createPhotoVariantForAspect,
  createVideoVariant,
  ensureVideoExtension,
  loadDualViewGallery,
  mediaToLastMedia,
  toFileUri,
} from '../utils/gallery';
import {
  buildReadyAsset,
  upsertCaptureGroup,
} from '../utils/mediaIndex';
import type { MediaJob } from '../types/mediaJob';
import {
  createMediaJob,
  loadMediaJobs,
  markStaleRunningJobs,
  saveMediaJobs,
  updateMediaJob,
  updateMediaJobInList,
  upsertMediaJob,
  upsertMediaJobInList,
} from '../utils/mediaJobQueue';
import type { DualMediaAsset } from '../types/mediaAsset';
import {
  isAspectRatioId,
  isPhotoFormat,
  isPhotoQuality,
  isSafetyOverlayMode,
  isVideoCodecFormat,
  isVideoFps,
  isVideoQuality,
  isViewMode,
  loadPersistedSettings,
  savePersistedSettings,
} from '../utils/settings';

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
  const [appliedVideoFps, setAppliedVideoFps] = useState<VideoFps>(30);
  const [appliedVideoQuality, setAppliedVideoQuality] = useState<VideoQuality>('4K');
  const [videoCodec, setVideoCodec] = useState<VideoCodecFormat>('h265');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const selectedAspect = useMemo(
      () => ASPECT_RATIOS.find(item => item.id === selectedAspectId) ?? ASPECT_RATIOS[2],
      [selectedAspectId],
  );
  const capabilities = useMemo(() => buildCameraCapabilities(device), [device]);
  const photoQualityConfig = PHOTO_QUALITY_CONFIG[photoQuality];
  const appliedVideoQualityConfig = VIDEO_QUALITY_CONFIG[appliedVideoQuality];

  const mainPreviewOutput = usePreviewOutput();
  const pipPreviewOutput = usePreviewOutput();

  const photoOutput = usePhotoOutput({
    targetResolution:
        photoQuality === 'high' ? CommonResolutions.HIGHEST_4_3 : CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: photoQualityConfig.quality,
    qualityPrioritization:
        photoQualityConfig.priority === 'speed' && !device.supportsSpeedQualityPrioritization
            ? 'balanced'
            : photoQualityConfig.priority,
  });

  const videoOutput = useVideoOutput({
    targetResolution: appliedVideoQualityConfig.resolution,
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
  const [shutterSoundEnabled, setShutterSoundEnabled] = useState(false);
  const [safetyOverlayMode, setSafetyOverlayMode] = useState<SafetyOverlayMode>('subtle');

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
  const [mediaJobs, setMediaJobs] = useState<MediaJob[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isVideoSessionTarget, setIsVideoSessionTarget] = useState(false);

  const isVideoSessionRequired = isRecording || pendingVideoStart;
  useEffect(() => {
    if (isVideoSessionRequired) {
      setIsVideoSessionTarget(true);
    } else {
      // Priority: Keep Main Preview stable. Delay the Sub-preview (PIP) 
      // recovery even longer (1000ms) to ensure the hardware finishes 
      // its primary session reconfiguration first.
      const timer = setTimeout(() => setIsVideoSessionTarget(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [isVideoSessionRequired]);

  const panX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const isGalleryOpenRef = useRef(false);
  const isBusyRef = useRef(isBusy);
  const isRecordingRef = useRef(isRecording);
  const isZoomGestureActiveRef = useRef(false);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    let cancelled = false;
    loadMediaJobs()
      .then(jobs => {
        const recoveredJobs = markStaleRunningJobs(jobs);
        if (!cancelled) {
          setMediaJobs(recoveredJobs);
        }
        if (recoveredJobs.some((job, index) => job !== jobs[index])) {
          saveMediaJobs(recoveredJobs).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshGallery = useCallback(async () => {
    const items = await loadDualViewGallery();
    setGalleryItems(items);
    setLastMedia(mediaToLastMedia(items[0] ?? null));
    setGalleryIndex(current => (items.length === 0 ? 0 : Math.min(current, items.length - 1)));
    return items;
  }, []);

  const openGallery = useCallback(() => {
    isGalleryOpenRef.current = true;
    setGalleryIndex(0); // Always show the latest media when opening
    Animated.spring(panX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 12,
    }).start();
    setGalleryOpen(true);
    refreshGallery().catch(() => {});
  }, [panX, refreshGallery]);

  const closeGallery = useCallback(() => {
    isGalleryOpenRef.current = false;
    Animated.spring(panX, {
      toValue: SCREEN_WIDTH,
      useNativeDriver: true,
      bounciness: 0,
      speed: 12,
    }).start();
    setGalleryOpen(false);
  }, [panX]);

  const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (isZoomGestureActiveRef.current) return false;
          // If gallery is open and we are at the first item, capture right swipes to allow closing
          if (isGalleryOpenRef.current && galleryIndexRef.current === 0 && gestureState.dx > 40 && Math.abs(gestureState.dy) < 30) {
            return true;
          }
          return false;
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          const { dx, dy } = gestureState;
          if (isBusyRef.current || isRecordingRef.current || isZoomGestureActiveRef.current) return false;

          if (isGalleryOpenRef.current) {
            return dx > 30 && Math.abs(dy) < 40 && galleryIndexRef.current === 0;
          }

          return dx < -30 && Math.abs(dy) < 40;
        },
        onPanResponderMove: (_, gestureState) => {
          if (isGalleryOpenRef.current) {
            if (gestureState.dx > 0) {
              panX.setValue(gestureState.dx);
            }
          } else {
            if (gestureState.dx < 0) {
              const newX = SCREEN_WIDTH + gestureState.dx;
              panX.setValue(Math.max(0, newX));
            }
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isGalleryOpenRef.current) {
            if (gestureState.dx > SCREEN_WIDTH / 4 || gestureState.vx > 0.5) {
              closeGallery();
            } else {
              openGallery();
            }
          } else {
            if (gestureState.dx < -SCREEN_WIDTH / 4 || gestureState.vx < -0.5) {
              openGallery();
            } else {
              closeGallery();
            }
          }
        },
      })
  ).current;

  const galleryIndexRef = useRef(0);
  useEffect(() => {
    galleryIndexRef.current = galleryIndex;
  }, [galleryIndex]);

  const lastViewMode = useRef(viewMode);
  const lastCaptureMode = useRef(captureMode);

  useEffect(() => {
    const isViewModeChange = viewMode !== lastViewMode.current;
    const isCaptureModeChange = captureMode !== lastCaptureMode.current;
    lastViewMode.current = viewMode;
    lastCaptureMode.current = captureMode;

    // Only perform a "Hard Reset" (bumping sessionRevision) when switching 
    // between Single and Dual view modes, as the UI layout changes significantly.
    // For mode switching within the same viewMode, let vision-camera 
    // handle the session update smoothly without unmounting the view.
    const needsHardReset = isViewModeChange;
    
    if (needsHardReset || viewMode === 'dual') {
      setIsSwitching(true);
    }
    if (needsHardReset) {
      setIsCameraReady(false);
      setSessionRevision(curr => curr + 1);
    }

    if (captureMode === 'video') {
      if (appliedVideoFps !== videoFps) setAppliedVideoFps(videoFps);
      if (appliedVideoQuality !== videoQuality) setAppliedVideoQuality(videoQuality);
    }

    const delay = (viewMode === 'dual') ? 600 : (needsHardReset ? 300 : 0);
    const timer = setTimeout(() => setIsSwitching(false), delay);
    return () => clearTimeout(timer);
  }, [captureMode, viewMode, videoFps, videoQuality, appliedVideoFps, appliedVideoQuality]);

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
          if (typeof settings.shutterSoundEnabled === 'boolean') setShutterSoundEnabled(settings.shutterSoundEnabled);
          if (isSafetyOverlayMode(settings.safetyOverlayMode)) setSafetyOverlayMode(settings.safetyOverlayMode);
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

    if (flashMode === 'auto' && !capabilities.flash.auto) {
      setFlashMode('off');
    } else if (flashMode === 'on' && !capabilities.flash.on) {
      setFlashMode('off');
    }

    if (!capabilities.photoFormats[photoFormat]) {
      setPhotoFormat('jpeg');
    }

    if (!capabilities.videoFps[videoFps]) {
      setVideoFps(30);
    }

    if (!capabilities.videoQualities[videoQuality]) {
      setVideoQuality(firstSupportedVideoQuality(capabilities));
    }

    if (!capabilities.videoCodecs[videoCodec]) {
      setVideoCodec('h264');
    }
  }, [
    capabilities,
    flashMode,
    photoFormat,
    settingsLoaded,
    videoCodec,
    videoFps,
    videoQuality,
  ]);

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
      safetyOverlayMode,
      shutterSoundEnabled,
    }).catch(() => {});
  }, [
    photoFormat,
    photoQuality,
    saveDualOutputs,
    safetyOverlayMode,
    selectedAspectId,
    settingsLoaded,
    shutterSoundEnabled,
    videoCodec,
    videoFps,
    videoQuality,
    viewMode,
  ]);

  const isDeviceLandscape = physicalOrientation === 'left' || physicalOrientation === 'right';
  const shouldMirrorSavedPhoto = cameraPosition === 'front';
  const captureOutputOrientation: Orientation | null = physicalOrientation ?? null;
  const fullMainAspect =
      previewSize.width > 0 && previewSize.height > 0
          ? previewSize.width / Math.max(1, previewSize.height)
          : 9 / 16;

  const compositionScene = useMemo(
      () =>
          buildCompositionScene({
            viewMode,
            selectedAspect,
            isSwapped,
            isDeviceLandscape,
            fullMainAspect,
            saveDualOutputs,
          }),
      [
        fullMainAspect,
        isDeviceLandscape,
        isSwapped,
        saveDualOutputs,
        selectedAspect,
        viewMode,
      ],
  );

  const mainDisplayOrientation = compositionScene.display.main.orientation;
  const subDisplayOrientation =
      compositionScene.display.sub?.orientation ?? 'landscape';
  const mainFrameSpec = compositionScene.display.main;
  const subFrameSpec = compositionScene.display.sub ?? compositionScene.save.sub;
  const saveMainOrientation = compositionScene.save.main.orientation;
  const saveSubOrientation = compositionScene.save.sub.orientation;
  const saveMainFrameSpec = compositionScene.save.main;
  const saveSubFrameSpec = compositionScene.save.sub;
  const shouldRotateMainLandscapeFallback = isDeviceLandscape && saveMainOrientation === 'landscape';
  const shouldRotateSubLandscapeFallback = isDeviceLandscape && saveSubOrientation === 'landscape';

  useEffect(() => {
    if (captureOutputOrientation == null) return;

    photoOutput.outputOrientation = captureOutputOrientation;
    videoOutput.outputOrientation = captureOutputOrientation;
  }, [
    captureOutputOrientation,
    photoOutput,
    videoOutput,
  ]);

  const isFullPreview =
      selectedAspectId === 'full' &&
      (viewMode === 'single' || (viewMode === 'dual' && mainDisplayOrientation === 'portrait'));

  const mainPreviewAspect = mainFrameSpec.aspect;
  const previewTopOffset = 0;
  const mainPreviewBottomOffset = 0;

  const mainPreviewFrame = useMemo(
      () =>
          calculateContainedFrame(
              previewSize.width,
              Math.max(0, previewSize.height),
              mainPreviewAspect,
          ),
      [mainPreviewAspect, previewSize.height, previewSize.width],
  );

  const videoFpsOptions = useMemo<VideoFps[]>(() => {
    return videoFpsOptionsForQuality(device, videoQuality);
  }, [device, videoQuality]);

  const videoFrameSize = useCallback(
      (spec: VisibleFrameSpec) => videoTargetSizeForAspect(spec.aspect, appliedVideoQualityConfig),
      [appliedVideoQualityConfig],
  );

  const photoOutputs = useMemo(() => [mainPreviewOutput, photoOutput], [mainPreviewOutput, photoOutput]);
  const videoOutputs = useMemo(() => [mainPreviewOutput, videoOutput], [mainPreviewOutput, videoOutput]);

  const outputs = useMemo(() => {
    if (viewMode === 'dual') {
      // 1. If actively recording or in the buffer period after stop, 
      // use the most stable single-preview + video pipe.
      if (isVideoSessionTarget) {
        return [mainPreviewOutput, videoOutput];
      }
      
      // 2. Dual-View Standby (Both Photo and Video modes).
      // Strategy: Use [Preview+Preview+Photo] which is confirmed stable.
      return [mainPreviewOutput, pipPreviewOutput, photoOutput];
    }

    // Single mode: All-in-one pipeline is standard and stable.
    return [mainPreviewOutput, photoOutput, videoOutput];
  }, [viewMode, isVideoSessionTarget, mainPreviewOutput, pipPreviewOutput, photoOutput, videoOutput]);

  const cameraConstraints = useMemo(() => {
    // For Dual-View Standby, use standard 30fps without resolution bias 
    // to ensure the hardware can reliably handle multiple streams.
    if (viewMode === 'dual' && !isVideoSessionTarget) {
       return [{ fps: 30 }]; 
    }

    if (viewMode === 'single') {
      return [{ fps: appliedVideoFps }];
    }

    return [{ fps: appliedVideoFps }, { resolutionBias: videoOutput }];
  }, [viewMode, isVideoSessionTarget, appliedVideoFps, videoOutput]);

  const initialZoomRef = useRef(zoom);

  const previewHybridRef = useMemo(
      () =>
          callback((preview: PreviewView) => {
            previewRef.current = preview;
          }),
      [],
  );

  const scheduleCameraReopen = useCallback(() => {
    if (cameraReopenTimerRef.current != null) {
      clearTimeout(cameraReopenTimerRef.current);
    }

    setIsAppActive(false);
    setIsCameraReady(false);
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
      if (appStateRef.current !== 'active') return;
      setSessionRevision(curr => curr + 1);
    }, 260);
  }, []);

  useEffect(() => {
    initialZoomRef.current = zoom;
  }, [zoom]);

  const getInitialZoom = useCallback(() => initialZoomRef.current, []);

  const handleCameraStarted = useCallback(() => {
    setPreviewIssue('');
    setIsCameraReady(true);
  }, []);

  const handleCameraError = useCallback(
      (error: Error) => {
        if (isCameraResourceBusyError(error)) {
          setPreviewIssue('');
          scheduleCameraReopen();
          return;
        }

        const message = cameraErrorMessage(error, '相机错误');
        setPreviewIssue(message);
      },
      [scheduleCameraReopen],
  );

  const handleCameraInterruptionEnded = useCallback(() => {
    setPreviewIssue('');
  }, []);

  const cameraController = useCamera({
    device,
    outputs,
    constraints: cameraConstraints,
    isActive: isAppActive && !galleryOpen,
    orientationSource: 'device',
    mirrorMode: cameraPosition === 'front' ? 'on' : 'off',
    getInitialZoom,
    onStarted: handleCameraStarted,
    onError: handleCameraError,
    onInterruptionEnded: handleCameraInterruptionEnded,
  });

  useEffect(() => {
    if (!device) return;

    setIsCameraReady(false);
    setZoom(clamp(1, device.minZoom, device.maxZoom));
    setFlashMode('off');
    setIsSwapped(false);
    setIsRulerMode(false);
    setPreviewIssue('');
  }, [device?.id, device]);

  useEffect(() => {
    if (!device) return;

    const options = videoFpsOptionsForQuality(device, videoQuality);
    if (!options.includes(videoFps)) {
      setVideoFps(30);
    }
  }, [device, videoFps, videoQuality]);

  useEffect(() => {
    if (!device) return;

    const options = videoFpsOptionsForQuality(device, appliedVideoQuality);
    if (!options.includes(appliedVideoFps)) {
      setAppliedVideoFps(30);
    }
  }, [appliedVideoFps, appliedVideoQuality, device]);

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
        setIsCameraReady(false);
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

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const shouldEnableTorch =
        captureMode === 'video' &&
        flashMode === 'on' &&
        device.hasTorch &&
        isAppActive &&
        !galleryOpen;

    const applyTorchMode = async (attempt = 0) => {
      try {
        await (cameraController as any).setTorchMode(shouldEnableTorch ? 'on' : 'off');
      } catch (error) {
        if (cancelled || !shouldEnableTorch) return;
        if (attempt < 2) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            applyTorchMode(attempt + 1);
          }, 180);
          return;
        }
        setFlashMode('off');
        setToast(cameraErrorMessage(error, '无法开启常亮闪光灯'));
      }
    };

    applyTorchMode();

    return () => {
      cancelled = true;
      if (retryTimer != null) clearTimeout(retryTimer);
    };
  }, [
    cameraController,
    captureMode,
    device.hasTorch,
    flashMode,
    galleryOpen,
    isAppActive,
    isCameraReady,
    isRecording,
    isVideoSessionTarget,
    pendingVideoStart,
  ]);

  useEffect(() => {
    if (
        cameraController == null ||
        previewRef.current == null ||
        previewSize.width <= 0 ||
        previewSize.height <= 0
    ) {
      return;
    }

    if (zoomFocusTimerRef.current != null) {
      clearTimeout(zoomFocusTimerRef.current);
    }

    zoomFocusTimerRef.current = setTimeout(() => {
      zoomFocusTimerRef.current = null;
      if (previewRef.current == null) return;

      try {
        const point = previewRef.current.createMeteringPoint(
            previewSize.width / 2,
            previewSize.height / 2,
            96,
        );

        cameraController
            .focusTo(point, {
              responsiveness: 'steady',
              adaptiveness: 'continuous',
              autoResetAfter: 3,
            })
            .catch(() => {});
      } catch {}
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
      closeGallery();
      return true;
    });
    return () => subscription.remove();
  }, [galleryOpen, closeGallery]);

  const saveToGallery = useCallback(
      async (filePath: string, type: 'photo' | 'video', label: string) => {
        const sourcePath = type === 'video' ? await ensureVideoExtension(filePath, label) : filePath;
        const uri = toFileUri(sourcePath);
        const saved = await CameraRoll.saveAsset(uri, { type, album: 'DualViewCamera' });
        setLastMedia(mediaToLastMedia(cameraRollNodeToGalleryMedia(saved)));
        refreshGallery().catch(() => {});
        return {
          uri: saved.node.image.uri,
          localPath: sourcePath,
        };
      },
      [refreshGallery],
  );

  const saveCaptureGroupToIndex = useCallback(
      async (input: {
        captureId: string;
        createdAt: number;
        assets: DualMediaAsset[];
      }) => {
        if (input.assets.length === 0) return;
        await upsertCaptureGroup({
          captureId: input.captureId,
          createdAt: input.createdAt,
          mode: viewMode,
          outputPackId:
              viewMode === 'dual' && saveDualOutputs ? 'dual-main-sub' : 'current-only',
          assets: input.assets,
        });
      },
      [saveDualOutputs, viewMode],
  );

  const saveCapturedPhotoInBackground = useCallback(
      (
          filePath: string,
          options: {
            mainSpec: VisibleFrameSpec;
            subSpec: VisibleFrameSpec;
            dual: boolean;
            format: PhotoFormat;
            quality: number;
            mirror: boolean;
            rotateLandscapeFallback: { main: boolean; sub: boolean };
          },
      ) => {
        const captureId = createCaptureId();
        const createdAt = Date.now();
        void (async () => {
          try {
            if (options.dual) {
              const { mainPath, subPath } = await createDualPhotoVariantsForAspects(
                  filePath,
                  options.mainSpec,
                  options.subSpec,
                  options.format,
                  options.quality,
                  options.mirror,
                  options.rotateLandscapeFallback,
              );

              const [mainSaved, subSaved] = await Promise.all([
                saveToGallery(mainPath, 'photo', '主画面'),
                saveToGallery(subPath, 'photo', '副画面'),
              ]);
              await saveCaptureGroupToIndex({
                captureId,
                createdAt,
                assets: [
                  buildReadyAsset({
                    captureId,
                    createdAt,
                    type: 'photo',
                    role: 'main',
                    aspect: selectedAspectId,
                    uri: mainSaved.uri,
                    localPath: mainSaved.localPath,
                    sourceUri: filePath,
                  }),
                  buildReadyAsset({
                    captureId,
                    createdAt,
                    type: 'photo',
                    role: 'sub',
                    aspect: selectedAspectId,
                    uri: subSaved.uri,
                    localPath: subSaved.localPath,
                    sourceUri: filePath,
                  }),
                ],
              });
            } else {
              const mainPath = await createPhotoVariantForAspect(
                  filePath,
                  options.mainSpec,
                  'main',
                  options.format,
                  options.quality,
                  options.mirror,
                  options.rotateLandscapeFallback.main,
              );
              const mainSaved = await saveToGallery(mainPath, 'photo', '主画面');
              await saveCaptureGroupToIndex({
                captureId,
                createdAt,
                assets: [
                  buildReadyAsset({
                    captureId,
                    createdAt,
                    type: 'photo',
                    role: 'main',
                    aspect: selectedAspectId,
                    uri: mainSaved.uri,
                    localPath: mainSaved.localPath,
                    sourceUri: filePath,
                  }),
                ],
              });
            }
          } catch (error) {
            setToast(cameraErrorMessage(error, '照片保存失败'));
          }
        })();
      },
      [saveCaptureGroupToIndex, saveToGallery, selectedAspectId],
  );

  const prepareFlashForPhoto = useCallback(async () => {
    if (flashMode !== 'on' || cameraController == null || !device?.hasTorch) return false;

    try {
      await cameraController.setTorchMode('on');
      await wait(160);
      return true;
    } catch {
      return false;
    }
  }, [cameraController, device?.hasTorch, flashMode]);

  const cleanupFlashAfterPhoto = useCallback(
      async (torchWasEnabled: boolean) => {
        if (!torchWasEnabled || cameraController == null) return;
        try {
          await cameraController.setTorchMode('off');
        } catch {}
      },
      [cameraController],
  );

  const takePhoto = useCallback(async () => {
    if (isBusy || captureMode !== 'photo') return;

    if (viewMode === 'dual' && !pendingPhotoCapture) {
      setPendingPhotoCapture(true);
      return;
    }

    setIsBusy(true);
    const torchWasEnabled = await prepareFlashForPhoto();

    try {
      if (captureOutputOrientation != null) {
        photoOutput.outputOrientation = captureOutputOrientation;
      }

      const file = await photoOutput.capturePhotoToFile(
          {
            flashMode: device?.hasFlash ? flashMode : 'off',
            enableShutterSound: shutterSoundEnabled,
          },
          {},
      );

      saveCapturedPhotoInBackground(file.filePath, {
        mainSpec: saveMainFrameSpec,
        subSpec: saveSubFrameSpec,
        dual: viewMode === 'dual' && saveDualOutputs,
        format: photoFormat,
        quality: photoQualityConfig.nativeQuality,
        mirror: shouldMirrorSavedPhoto,
        rotateLandscapeFallback: {
          main: shouldRotateMainLandscapeFallback,
          sub: shouldRotateSubLandscapeFallback,
        },
      });
    } catch (error) {
      setToast(cameraErrorMessage(error, '拍照失败'));
    } finally {
      await cleanupFlashAfterPhoto(torchWasEnabled);
      setIsBusy(false);
      setPendingPhotoCapture(false);
    }
  }, [
    captureMode,
    cleanupFlashAfterPhoto,
    captureOutputOrientation,
    device?.hasFlash,
    flashMode,
    isBusy,
    pendingPhotoCapture,
    photoFormat,
    photoOutput,
    photoQualityConfig.nativeQuality,
    prepareFlashForPhoto,
    saveCapturedPhotoInBackground,
    saveDualOutputs,
    saveMainFrameSpec,
    saveSubFrameSpec,
    shouldMirrorSavedPhoto,
    shouldRotateMainLandscapeFallback,
    shouldRotateSubLandscapeFallback,
    shutterSoundEnabled,
    viewMode,
  ]);

  useEffect(() => {
    if (!pendingPhotoCapture) return;
    const timer = setTimeout(() => {
      takePhoto();
    }, 32);
    return () => clearTimeout(timer);
  }, [pendingPhotoCapture, takePhoto]);

  const finishRecording = useCallback(
      async (filePath: string) => {
        const captureId = createCaptureId();
        const createdAt = Date.now();
        let originalSaved = false;
        try {
          const mainSaved = await saveToGallery(filePath, 'video', '主画面');
          originalSaved = true;
          await saveCaptureGroupToIndex({
            captureId,
            createdAt,
            assets: [
              buildReadyAsset({
                captureId,
                createdAt,
                type: 'video',
                role: 'main',
                aspect: selectedAspectId,
                uri: mainSaved.uri,
                localPath: mainSaved.localPath,
                sourceUri: filePath,
              }),
            ],
          });
          setToast(viewMode === 'dual' && saveDualOutputs ? '主画面视频已保存，副画面稍后后台处理' : '视频已保存');

          if (viewMode === 'dual' && saveDualOutputs) {
            void (async () => {
              const job = createMediaJob({
                captureId,
                type: 'video-variant',
                input: {
                  sourceUri: filePath,
                  role: 'sub',
                  codec: videoCodec,
                  aspect: selectedAspectId,
                },
              });
              const applyJobPatch = async (
                  patch: Partial<Omit<MediaJob, 'id' | 'captureId' | 'type' | 'createdAt'>>,
              ) => {
                setMediaJobs(previous => updateMediaJobInList(previous, job.id, patch));
                const jobs = await updateMediaJob(job.id, patch);
                setMediaJobs(jobs);
              };

              try {
                setMediaJobs(previous => upsertMediaJobInList(previous, job));
                await upsertMediaJob(job);
                await applyJobPatch({ status: 'running', progress: 0.08 });
                const subVariant = saveSubFrameSpec.variant;
                await applyJobPatch({ status: 'running', progress: 0.35 });
                const subPath = await createVideoVariant(
                    filePath,
                    subVariant,
                    'sub',
                    videoFrameSize(saveSubFrameSpec),
                    videoCodec,
                    false,
                    shouldRotateSubLandscapeFallback,
                );
                await applyJobPatch({ status: 'running', progress: 0.72 });
                const subSaved = await saveToGallery(subPath, 'video', '副画面');
                await saveCaptureGroupToIndex({
                  captureId,
                  createdAt,
                  assets: [
                    buildReadyAsset({
                      captureId,
                      createdAt,
                      type: 'video',
                      role: 'sub',
                      aspect: selectedAspectId,
                      uri: subSaved.uri,
                      localPath: subSaved.localPath,
                      sourceUri: filePath,
                    }),
                  ],
                });
                setToast('副画面视频已保存');
                await applyJobPatch({
                  status: 'succeeded',
                  progress: 1,
                  output: {
                    uri: subSaved.uri,
                    localPath: subSaved.localPath,
                  },
                });
              } catch (error) {
                await applyJobPatch({
                  status: 'failed',
                  errorMessage: cameraErrorMessage(error, '副画面视频后台处理失败'),
                }).catch(() => {});
                setToast('副画面视频后台处理失败，已保留主画面视频');
              }
            })();
          }
        } catch {
          setToast(originalSaved ? '副画面视频后台处理失败，已保留主画面视频' : '录像保存失败');
        }
      },
      [
        saveCaptureGroupToIndex,
        saveDualOutputs,
        saveToGallery,
        saveSubFrameSpec,
        selectedAspectId,
        shouldRotateSubLandscapeFallback,
        setMediaJobs,
        videoCodec,
        videoFrameSize,
        viewMode,
      ],
  );

  const toggleRecording = useCallback(async () => {
    if (isBusy || captureMode !== 'video') return;

    // In dual-view, we MUST warmup because standby pipeline is [Main+Pip+Photo],
    // while recording pipeline is [Main+Video].
    const needsVideoPipelineWarmup =
        !isRecording &&
        !pendingVideoStart &&
        (viewMode === 'dual' || appliedVideoFps !== videoFps || appliedVideoQuality !== videoQuality);

    if (needsVideoPipelineWarmup) {
      if (appliedVideoFps !== videoFps) {
        setAppliedVideoFps(videoFps);
      }
      if (appliedVideoQuality !== videoQuality) {
        setAppliedVideoQuality(videoQuality);
      }
      setIsCameraReady(false);
      setPendingVideoStart(true);
      return;
    }

    setIsBusy(true);

    try {
      if (isRecording && recorderRef.current != null) {
        await recorderRef.current.stopRecording();
        return;
      }

      if (captureOutputOrientation != null) {
        videoOutput.outputOrientation = captureOutputOrientation;
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
  }, [
    appliedVideoFps,
    appliedVideoQuality,
    captureMode,
    captureOutputOrientation,
    finishRecording,
    isBusy,
    isRecording,
    pendingVideoStart,
    videoFps,
    videoOutput,
    videoQuality,
    viewMode,
  ]);

  useEffect(() => {
    if (!pendingVideoStart) return;
    const timer = setTimeout(() => {
      toggleRecording();
    }, 32);
    return () => clearTimeout(timer);
  }, [pendingVideoStart, toggleRecording]);

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusAtPoint = useCallback(
      async (event: GestureResponderEvent) => {
        setIsRulerMode(false);
        if (cameraController == null || previewRef.current == null) return;

        const { locationX, locationY } = event.nativeEvent;

        try {
          const point = previewRef.current.createMeteringPoint(locationX, locationY, 80);
          await cameraController.focusTo(point, {
            responsiveness: 'snappy',
            autoResetAfter: 4,
          });
          setFocusPoint({ x: locationX, y: locationY });

          // Auto-hide the focus box after 2.5 seconds
          if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
          focusTimerRef.current = setTimeout(() => {
            setFocusPoint(null);
            focusTimerRef.current = null;
          }, 2500);
        } catch {}
      },
      [cameraController],
  );

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
    if (isRecordingRef.current) return;
    setIsSwapped(current => !current);
  }, []);

  const openLastMedia = useCallback(() => {
    if (galleryItems.length === 0) {
      setToast('还没有拍摄内容');
      return;
    }
    setGalleryIndex(0);
    openGallery();
  }, [galleryItems.length, openGallery]);

  const handleGalleryDelete = useCallback(
      async (item: GalleryMedia) => {
        try {
          if (DualViewMedia?.deleteMedia) {
            const deleted = await DualViewMedia.deleteMedia(item.uri);
            if (!deleted) {
              throw new Error('Media item was not deleted');
            }
          } else {
            await CameraRoll.deletePhotos([item.uri]);
          }
          const nextItems = galleryItems.filter(media => media.id !== item.id);
          setGalleryItems(nextItems);
          setLastMedia(mediaToLastMedia(nextItems[0] ?? null));

          if (nextItems.length === 0) {
            closeGallery();
            setGalleryIndex(0);
          } else {
            setGalleryIndex(current => Math.min(current, nextItems.length - 1));
          }

          setToast('已删除');
          refreshGallery().catch(() => {});
        } catch (error) {
          setToast(cameraErrorMessage(error, '删除失败'));
        }
      },
      [galleryItems, refreshGallery, closeGallery],
  );

  const lastPinchDist = useRef<number | null>(null);

  const onTouchMove = useCallback(
      (event: GestureResponderEvent) => {
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
      },
      [device.maxZoom, device.minZoom],
  );

  const primaryAction = captureMode === 'photo' ? takePhoto : toggleRecording;

  return (
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <StatusBar barStyle="light-content" hidden={galleryOpen} translucent backgroundColor="transparent" />

        <View style={styles.root} {...panResponder.panHandlers}>
          <View
              style={styles.previewArea}
              onLayout={event => {
                const { width, height } = event.nativeEvent.layout;
                setPreviewSize({ width, height });
              }}
              onTouchMove={onTouchMove}
              onTouchEnd={() => {
                lastPinchDist.current = null;
              }}
          >
            <MainPreview
                hybridRef={previewHybridRef}
                cropSpec={mainFrameSpec}
                orientation={mainDisplayOrientation}
                aspectRatio={mainPreviewAspect}
                frame={mainPreviewFrame}
                isRecording={isRecording}
                overlayMode={safetyOverlayMode}
                bottomOffset={mainPreviewBottomOffset}
                topOffset={previewTopOffset}
                fillScreen={isFullPreview}
                previewOutput={mainPreviewOutput}
                sessionRevision={sessionRevision}
                isTransitioning={
                    !isCameraReady ||
                    isSwitching
                }
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
                    cropSpec={subFrameSpec}
                    isSwapped={isSwapped}
                    isRecording={isRecording}
                    orientation={subDisplayOrientation}
                    onPress={swapMainAndSub}
                    overlayMode={safetyOverlayMode}
                    previewOutput={
                      captureMode === 'photo'
                          ? pendingPhotoCapture
                              ? null
                              : pipPreviewOutput
                          : isVideoSessionTarget
                              ? null
                              : pipPreviewOutput
                    }
                    sessionRevision={sessionRevision}
                    placeholderMode={
                      captureMode === 'photo' && pendingPhotoCapture
                          ? 'photo'
                          : captureMode === 'video' && isVideoSessionTarget
                              ? 'video'
                              : null
                    }
                />
            )}

            {toast ? <Toast message={toast} /> : null}
            <MediaJobIndicator jobs={mediaJobs} />

            <View style={styles.zoomBarContainer} pointerEvents="box-none">
              <ZoomSelector
                  currentZoom={zoom}
                  onChange={setZoom}
                  minZoom={device.minZoom}
                  maxZoom={device.maxZoom}
                  isRulerMode={isRulerMode}
                  setIsRulerMode={setIsRulerMode}
                  onGestureActiveChange={active => {
                    isZoomGestureActiveRef.current = active;
                  }}
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

          <GalleryView
              index={galleryIndex}
              items={galleryItems}
              onClose={closeGallery}
              onDelete={handleGalleryDelete}
              onIndexChange={setGalleryIndex}
              translateX={panX}
          />
        </View>

        <SettingsModal
            device={device}
            devicesCount={devicesCount}
            capabilities={capabilities}
            flashMode={flashMode}
            onClose={() => setSettingsOpen(false)}
            onFlashModeChange={setFlashMode}
            open={settingsOpen}
            photoFormat={photoFormat}
            onPhotoFormatChange={setPhotoFormat}
            photoQuality={photoQuality}
            onPhotoQualityChange={setPhotoQuality}
            saveDualOutputs={saveDualOutputs}
            safetyOverlayMode={safetyOverlayMode}
            onSafetyOverlayModeChange={setSafetyOverlayMode}
            setSaveDualOutputs={setSaveDualOutputs}
            shutterSoundEnabled={shutterSoundEnabled}
            onShutterSoundEnabledChange={setShutterSoundEnabled}
            videoFps={videoFps}
            videoFpsOptions={videoFpsOptions}
            onVideoFpsChange={setVideoFps}
            videoCodec={videoCodec}
            onVideoCodecChange={setVideoCodec}
            videoQuality={videoQuality}
            onVideoQualityChange={setVideoQuality}
            viewMode={viewMode}
        />
      </SafeAreaView>
  );
}

export default CameraShell;
