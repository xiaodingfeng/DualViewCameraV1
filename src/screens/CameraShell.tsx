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
import { SettingsModal } from '../components/SettingsModal';

const SCREEN_WIDTH = Dimensions.get('window').width;
import { styles } from '../styles/cameraStyles';
import type {
  AspectRatioId,
  CaptureMode,
  FlashMode,
  FrameOrientation,
  GalleryMedia,
  LastMedia,
  PhotoFormat,
  PhotoQuality,
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
  safeSupportsFPS,
  videoTargetSizeForAspect,
  visibleFrameSpec,
  wait,
} from '../utils/camera';
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
  isAspectRatioId,
  isPhotoFormat,
  isPhotoQuality,
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
  const [isSwitching, setIsSwitching] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isVideoSessionTarget, setIsVideoSessionTarget] = useState(false);

  const isVideoSessionRequired = isRecording || pendingVideoStart;
  useEffect(() => {
    if (isVideoSessionRequired) {
      setIsVideoSessionTarget(true);
    } else {
      // Delay switching back from video-pipe to dual-preview pipe by 400ms
      // to move the hardware flicker away from the "Stop" button press.
      const timer = setTimeout(() => setIsVideoSessionTarget(false), 400);
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

    // Session only reconfigures when switching viewMode
    const needsDelay = viewMode === 'dual';
    setIsSwitching(true);

    // If we change viewMode or we are in the sensitive dual mode,
    // reset ready state to show loading instead of a frozen frame during reconfiguration.
    // Also force a hard reset (sessionRevision bump) if changing modes in dual-view to purge buffers.
    if (isViewModeChange || (isCaptureModeChange && viewMode === 'dual')) {
      setIsCameraReady(false);
      setSessionRevision(curr => curr + 1);
    }

    // If we are switching to video mode, pre-warm the video settings to avoid re-binding during record start
    if (captureMode === 'video') {
      if (appliedVideoFps !== videoFps) setAppliedVideoFps(videoFps);
      if (appliedVideoQuality !== videoQuality) setAppliedVideoQuality(videoQuality);
    }

    const timer = setTimeout(() => setIsSwitching(false), needsDelay ? 600 : 50);
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
  }, [
    photoFormat,
    photoQuality,
    saveDualOutputs,
    selectedAspectId,
    settingsLoaded,
    videoCodec,
    videoFps,
    videoQuality,
    viewMode,
  ]);

  const isDeviceLandscape = physicalOrientation === 'left' || physicalOrientation === 'right';
  const shouldMirrorSavedMedia = cameraPosition === 'front';
  const captureOutputOrientation: Orientation | null = physicalOrientation ?? null;
  const displayPrimaryOrientation: FrameOrientation = 'portrait';
  const displaySecondaryOrientation: FrameOrientation = 'landscape';
  const savePrimaryOrientation: FrameOrientation = isDeviceLandscape ? 'landscape' : 'portrait';
  const saveSecondaryOrientation: FrameOrientation = isDeviceLandscape ? 'portrait' : 'landscape';

  const mainDisplayOrientation: FrameOrientation =
      viewMode === 'dual'
          ? (isSwapped ? displaySecondaryOrientation : displayPrimaryOrientation)
          : displayPrimaryOrientation;

  const subDisplayOrientation: FrameOrientation =
      viewMode === 'dual'
          ? (isSwapped ? displayPrimaryOrientation : displaySecondaryOrientation)
          : displaySecondaryOrientation;

  const fullMainAspect =
      previewSize.width > 0 && previewSize.height > 0
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

  const saveMainOrientation: FrameOrientation =
      viewMode === 'dual'
          ? (isSwapped ? saveSecondaryOrientation : savePrimaryOrientation)
          : savePrimaryOrientation;

  const saveSubOrientation: FrameOrientation =
      viewMode === 'dual'
          ? (isSwapped ? savePrimaryOrientation : saveSecondaryOrientation)
          : saveSecondaryOrientation;

  const saveMainFrameSpec = useMemo(
      () => visibleFrameSpec(saveMainOrientation, selectedAspect, fullMainAspect),
      [fullMainAspect, saveMainOrientation, selectedAspect],
  );

  const saveSubFrameSpec = useMemo(
      () => visibleFrameSpec(saveSubOrientation, selectedAspect, 3 / 4),
      [saveSubOrientation, selectedAspect],
  );
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
    const supports60 = safeSupportsFPS(device, 60);
    return supports60 ? [30, 60] : [30];
  }, [device]);

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

    if (captureMode === 'video') {
      return [{ fps: appliedVideoFps }, { resolutionBias: videoOutput }];
    }
    return [{ resolutionBias: photoOutput }];
  }, [viewMode, captureMode, isVideoSessionTarget, appliedVideoFps, videoOutput, photoOutput]);

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

    if (!safeSupportsFPS(device, videoFps)) {
      setVideoFps(30);
    }
  }, [device, videoFps]);

  useEffect(() => {
    if (!device) return;

    if (!safeSupportsFPS(device, appliedVideoFps)) {
      setAppliedVideoFps(30);
    }
  }, [appliedVideoFps, device]);

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
    const shouldEnableTorch = captureMode === 'video' && flashMode === 'on' && device.hasTorch;
    (cameraController as any)
        .setTorchMode(shouldEnableTorch ? 'on' : 'off', shouldEnableTorch ? 1 : undefined)
        .catch(() => {});
  }, [cameraController, captureMode, device.hasTorch, flashMode]);

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
        return saved.node.image.uri;
      },
      [refreshGallery],
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

              await Promise.all([
                saveToGallery(mainPath, 'photo', '主画面'),
                saveToGallery(subPath, 'photo', '副画面'),
              ]);
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
              await saveToGallery(mainPath, 'photo', '主画面');
            }
          } catch (error) {
            setToast(cameraErrorMessage(error, '照片保存失败'));
          }
        })();
      },
      [saveToGallery],
  );

  const prepareFlashForPhoto = useCallback(async () => {
    if (flashMode !== 'on' || cameraController == null || !device?.hasTorch) return false;

    try {
      await cameraController.setTorchMode('on', 1);
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
            enableShutterSound: true,
          },
          {},
      );

      saveCapturedPhotoInBackground(file.filePath, {
        mainSpec: saveMainFrameSpec,
        subSpec: saveSubFrameSpec,
        dual: viewMode === 'dual' && saveDualOutputs,
        format: photoFormat,
        quality: photoQualityConfig.nativeQuality,
        mirror: shouldMirrorSavedMedia,
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
    shouldMirrorSavedMedia,
    shouldRotateMainLandscapeFallback,
    shouldRotateSubLandscapeFallback,
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
        try {
          const mainVariant = saveMainFrameSpec.variant;
          const mainPath = await createVideoVariant(
              filePath,
              mainVariant,
              'main',
              videoFrameSize(saveMainFrameSpec),
              videoCodec,
              shouldMirrorSavedMedia,
              shouldRotateMainLandscapeFallback,
          );
          await saveToGallery(mainPath, 'video', '主画面');

          if (viewMode === 'dual' && saveDualOutputs) {
            const subVariant = saveSubFrameSpec.variant;
            const subPath = await createVideoVariant(
                filePath,
                subVariant,
                'sub',
                videoFrameSize(saveSubFrameSpec),
                videoCodec,
                shouldMirrorSavedMedia,
                shouldRotateSubLandscapeFallback,
            );
            await saveToGallery(subPath, 'video', '副画面');
          }
        } catch {
          setToast('录像保存失败');
        }
      },
      [saveMainFrameSpec, saveDualOutputs, saveToGallery, saveSubFrameSpec, shouldMirrorSavedMedia, shouldRotateMainLandscapeFallback, shouldRotateSubLandscapeFallback, videoCodec, videoFrameSize, viewMode],
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
          await CameraRoll.deletePhotos([item.uri]);
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
                orientation={mainDisplayOrientation}
                aspectRatio={mainPreviewAspect}
                frame={mainPreviewFrame}
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
                    isSwapped={isSwapped}
                    orientation={subDisplayOrientation}
                    onPress={swapMainAndSub}
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
      </SafeAreaView>
  );
}

export default CameraShell;
