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
type PhotoVariant = 'full' | 'portrait' | 'landscape';

const COLORS = {
  bg: '#000000',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.72)',
  line: 'rgba(255,255,255,0.28)',
  panel: 'rgba(0,0,0,0.72)',
  accent: '#ffd166',
  red: '#ff3b30',
};

const TOP_BAR_OFFSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 40 : 64;

const { DualViewMedia } = NativeModules as {
  DualViewMedia?: {
    createPhotoVariant(sourcePath: string, variant: PhotoVariant, suffix: string): Promise<string>;
    createVideoVariant?(sourcePath: string, variant: PhotoVariant, suffix: string): Promise<string>;
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
  const devices = useCameraDevices();
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const device = useCameraDevice(cameraPosition);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    cameraPermission.requestPermission();
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

  return (
    <CameraShell
      captureMode={captureMode}
      cameraPosition={cameraPosition}
      device={device}
      devicesCount={devices.length}
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
  
  const photoPreview = usePreviewOutput();
  const photoPipPreview = usePreviewOutput();
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    quality: 0.94,
    qualityPrioritization: device.supportsSpeedQualityPrioritization ? 'balanced' : 'quality',
  });

  const videoPreview = usePreviewOutput();
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.HD_16_9,
    enableAudio: microphoneReady,
    enablePersistentRecorder: false,
  });

  const previewRef = useRef<PreviewView | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveDualOutputs, setSaveDualOutputs] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isBusy, setIsBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);
  const [lastMedia, setLastMedia] = useState<LastMedia>(null);
  const [toast, setToast] = useState('');
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingPhotoCapture, setPendingPhotoCapture] = useState(false);
  const [pendingVideoStart, setPendingVideoStart] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewIssue, setPreviewIssue] = useState('');
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  const [sessionRevision, setSessionRevision] = useState(0);

  const isDeviceLandscape = physicalOrientation?.startsWith('landscape') ?? false;
  const defaultSubOrientation: FrameOrientation = isDeviceLandscape ? 'portrait' : 'landscape';
  const mainDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? defaultSubOrientation : 'portrait';
  const subDisplayOrientation: FrameOrientation = viewMode === 'dual' && isSwapped ? 'portrait' : defaultSubOrientation;

  const outputs = useMemo(() => {
    if (captureMode === 'photo') {
      if (viewMode === 'dual' && !pendingPhotoCapture) {
        return [photoPreview, photoPipPreview, photoOutput];
      } else {
        return [photoPreview, photoOutput];
      }
    } else {
      if (viewMode === 'dual' && !isRecording && !pendingVideoStart) {
        return [videoPreview, photoPipPreview];
      } else {
        return [videoPreview, videoOutput];
      }
    }
  }, [captureMode, isRecording, pendingPhotoCapture, pendingVideoStart, viewMode, photoPreview, photoPipPreview, photoOutput, videoPreview, videoOutput]);

  const previewHybridRef = useMemo(
    () => callback((preview: PreviewView) => {
      previewRef.current = preview;
    }),
    [],
  );

  const cameraController = useCamera({
    device: device,
    outputs,
    isActive: isAppActive,
    orientationSource: 'device',
    enableDistortionCorrection: undefined,
    enableLowLightBoost: undefined,
    enableSmoothAutoFocus: undefined,
    getInitialZoom: () => zoom,
    onStarted: () => {
      setPreviewReady(true);
      setPreviewIssue('');
    },
    onError: error => {
      const message = cameraErrorMessage(error, '相机错误');
      setPreviewIssue(message);
    },
  });

  useEffect(() => {
    if (!device) return;
    setZoom(1);
    setFlashMode('off');
    setIsSwapped(false);
  }, [device?.id]);

  useEffect(() => {
    if (viewMode === 'single') {
      setIsSwapped(false);
    }
  }, [viewMode]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const active = nextState === 'active';
      setIsAppActive(active);
      if (active) {
        setSessionRevision(current => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (cameraController == null) return;
    const timer = setTimeout(() => {
      cameraController.setZoom(clamp(zoom, cameraController.minZoom, cameraController.maxZoom)).catch(error => {
        if (isIgnorableZoomError(error)) return;
        setToast(cameraErrorMessage(error, '缩放失败'));
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [cameraController, zoom]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const cycleFlash = useCallback(() => {
    if (!device?.hasFlash && !device?.hasTorch) {
      setToast('当前摄像头不支持闪光灯');
      return;
    }
    setFlashMode(current => (current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off'));
  }, [device?.hasFlash, device?.hasTorch]);

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
    } catch {
      return false;
    }
  }, [cameraController, device?.hasTorch, flashMode]);

  const cleanupFlashAfterPhoto = useCallback(async (torchWasEnabled: boolean) => {
    if (!torchWasEnabled || cameraController == null) return;
    try {
      await cameraController.setTorchMode('off');
    } catch {
    }
  }, [cameraController]);

  const captureBasePhoto = useCallback(async () => {
    const torchWasEnabled = await prepareFlashForPhoto();
    try {
      return await photoOutput.capturePhotoToFile(
        {
          flashMode: device?.hasFlash ? flashMode : 'off',
          enableShutterSound: true,
          enableDistortionCorrection: device?.supportsDistortionCorrection,
        },
        {},
      );
    } finally {
      await cleanupFlashAfterPhoto(torchWasEnabled);
    }
  }, [cleanupFlashAfterPhoto, device?.hasFlash, device?.supportsDistortionCorrection, flashMode, photoOutput, prepareFlashForPhoto]);

  const takeOnePhoto = useCallback(async (label: string, variant: PhotoVariant) => {
    const file = await captureBasePhoto();
    const outputPath = await createPhotoVariant(file.filePath, variant, label);
    const uri = await saveToGallery(outputPath, 'photo', label);
    return uri;
  }, [captureBasePhoto, saveToGallery]);

  const takeDualPhoto = useCallback(async () => {
    const file = await captureBasePhoto();
    const mainVariant: PhotoVariant = mainDisplayOrientation;
    const subVariant: PhotoVariant = subDisplayOrientation;
    const mainPath = await createPhotoVariant(file.filePath, mainVariant, 'main');
    const subPath = await createPhotoVariant(file.filePath, subVariant, 'sub');
    return [
      await saveToGallery(mainPath, 'photo', '主画面'),
      await saveToGallery(subPath, 'photo', '副画面'),
    ];
  }, [captureBasePhoto, mainDisplayOrientation, saveToGallery, subDisplayOrientation]);

  const takePhoto = useCallback(async () => {
    if (isBusy || captureMode !== 'photo') return;
    if (viewMode === 'dual' && !pendingPhotoCapture) {
      setPendingPhotoCapture(true);
      return;
    }
    setIsBusy(true);
    try {
      const files = viewMode === 'dual' && saveDualOutputs
        ? await takeDualPhoto()
        : [await takeOnePhoto('主画面', 'portrait')];
      setToast(`拍照成功，已保存 ${files.length} 个文件`);
    } catch (error) {
      setToast(cameraErrorMessage(error, '拍照失败'));
    } finally {
      setIsBusy(false);
      setPendingPhotoCapture(false);
    }
  }, [captureMode, isBusy, pendingPhotoCapture, saveDualOutputs, takeDualPhoto, takeOnePhoto, viewMode]);

  useEffect(() => {
    if (!pendingPhotoCapture) return;
    const timer = setTimeout(() => {
      takePhoto();
    }, 200);
    return () => clearTimeout(timer);
  }, [pendingPhotoCapture, takePhoto]);

  const finishRecording = useCallback(async (filePath: string) => {
    try {
      const savedFiles: string[] = [];
      const mainPath = viewMode === 'dual'
        ? await createVideoVariant(filePath, mainDisplayOrientation, 'main')
        : await createVideoVariant(filePath, 'portrait', 'main');
      savedFiles.push(await saveToGallery(mainPath, 'video', '主画面'));
      
      if (viewMode === 'dual' && saveDualOutputs) {
        const subPath = await createVideoVariant(filePath, subDisplayOrientation, 'sub');
        savedFiles.push(await saveToGallery(subPath, 'video', '副画面'));
      }
      setToast(`录像成功，已保存 ${savedFiles.length} 个文件`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '录像保存失败');
    }
  }, [mainDisplayOrientation, saveDualOutputs, saveToGallery, subDisplayOrientation, viewMode]);

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
          recorderRef.current = null;
          finishRecording(filePath);
        },
        error => {
          setIsRecording(false);
          recorderRef.current = null;
          setToast(error.message);
        },
      );
      setIsRecording(true);
    } catch (error) {
      setIsRecording(false);
      recorderRef.current = null;
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
    if (cameraController == null || previewRef.current == null) return;
    const { locationX, locationY } = event.nativeEvent;
    try {
      const point = previewRef.current.createMeteringPoint(locationX, locationY, 80);
      await cameraController.focusTo(point, { responsiveness: 'snappy', autoResetAfter: 4 });
      setFocusPoint({ x: locationX, y: locationY });
    } catch (error) {
      setToast(cameraErrorMessage(error, '对焦失败'));
    }
  }, [cameraController]);

  const changeZoom = useCallback((direction: 1 | -1) => {
    const minZoom = cameraController?.minZoom ?? device?.minZoom ?? 1;
    const maxZoom = Math.min(cameraController?.maxZoom ?? device?.maxZoom ?? 8, 8);
    setZoom(current => clamp(Number((current + direction * 0.5).toFixed(1)), minZoom, maxZoom));
  }, [cameraController, device?.maxZoom, device?.minZoom]);

  const swapMainAndSub = useCallback(() => {
    if (viewMode !== 'dual') return;
    setIsSwapped(current => !current);
  }, [viewMode]);

  const openLastMedia = useCallback(() => {
    if (lastMedia == null) {
      setToast('还没有拍摄内容');
      return;
    }
    Alert.alert('最近保存', `${lastMedia.label}\n${lastMedia.uri}`);
  }, [lastMedia]);

  const primaryAction = captureMode === 'photo' ? takePhoto : toggleRecording;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.root}>
        <View style={styles.previewArea}>
          <MainPreview
            hybridRef={previewHybridRef}
            orientation={mainDisplayOrientation}
            captureMode={captureMode}
            previewOutput={captureMode === 'photo' ? photoPreview : videoPreview}
            sessionRevision={sessionRevision}
          />
          <Pressable style={styles.focusLayer} onPress={focusAtPoint} />
          {focusPoint ? <FocusBox point={focusPoint} /> : null}
          {previewIssue ? (
            <PreviewStatusOverlay issue={previewIssue} mode="" />
          ) : null}
          <TopBar
            flashMode={flashMode}
            onCycleFlash={cycleFlash}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          {viewMode === 'dual' ? (
            <PipPreview
              isSwapped={isSwapped}
              orientation={subDisplayOrientation}
              onPress={swapMainAndSub}
              captureMode={captureMode}
              previewOutput={
                captureMode === 'photo'
                  ? (pendingPhotoCapture ? null : photoPipPreview)
                  : (isRecording || pendingVideoStart ? null : photoPipPreview)
              }
              sessionRevision={sessionRevision}
              isRecording={isRecording && captureMode === 'video'}
            />
          ) : null}
          <ZoomControls zoom={zoom} onZoomIn={() => changeZoom(1)} onZoomOut={() => changeZoom(-1)} />
          {toast ? <Toast message={toast} /> : null}
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
        saveDualOutputs={saveDualOutputs}
        setSaveDualOutputs={setSaveDualOutputs}
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

function PreviewStatusOverlay({ issue, mode }: { issue: string; mode: string }) {
  return (
    <View pointerEvents="none" style={styles.previewStatus}>
      <Text style={styles.previewStatusTitle}>{issue ? '预览异常' : '正在启动相机'}</Text>
      <Text style={styles.previewStatusText}>{issue || '正在绑定 CameraX 输出，请稍候。'}</Text>
      {mode ? <Text style={styles.previewStatusMeta}>{mode}</Text> : null}
    </View>
  );
}

function FocusBox({ point }: { point: { x: number; y: number } }) {
  return <View pointerEvents="none" style={[styles.focusBox, { left: point.x - 36, top: point.y - 36 }]} />;
}

function TopBar({
  flashMode,
  onCycleFlash,
  onOpenSettings,
}: {
  flashMode: FlashMode;
  onCycleFlash: () => void;
  onOpenSettings: () => void;
}) {
  const FlashIcon = flashMode === 'off' ? FlashOffIcon : (flashMode === 'auto' ? FlashAutoIcon : FlashOnIcon);
  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <View />
      <View style={styles.topActions}>
        <RoundButton label="" active={flashMode !== 'off'} onPress={onCycleFlash} style={styles.noBorderButton}>
          <FlashIcon width={32} height={32} />
        </RoundButton>
        <RoundButton label="" onPress={onOpenSettings} style={styles.noBorderButton}>
          <SettingsIcon width={32} height={32} />
        </RoundButton>
      </View>
    </View>
  );
}

function BottomControls({
  captureMode,
  isBusy,
  isRecording,
  lastMedia,
  onCaptureModeChange,
  onGalleryPress,
  onPrimaryAction,
  onSwitchCamera,
  onViewModeChange,
  viewMode,
}: {
  captureMode: CaptureMode;
  isBusy: boolean;
  isRecording: boolean;
  lastMedia: LastMedia;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onGalleryPress: () => void;
  onPrimaryAction: () => void;
  onSwitchCamera: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  viewMode: ViewMode;
}) {
  return (
    <View style={styles.bottomControls}>
      <View style={styles.modeRow}>
        <Text onPress={() => onCaptureModeChange('photo')} style={[styles.modeText, captureMode === 'photo' && styles.modeTextActive]}>拍照</Text>
        <Text onPress={() => onCaptureModeChange('video')} style={[styles.modeText, captureMode === 'video' && styles.modeTextActive]}>录像</Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.thumbnailButton} onPress={onGalleryPress}>
          {lastMedia?.type === 'photo' ? <Image source={{ uri: lastMedia.uri }} style={styles.thumbnailImage} /> : <Text style={styles.thumbnailText}>{lastMedia ? '视频' : ''}</Text>}
        </Pressable>
        <Pressable disabled={isBusy} style={[styles.shutter, isRecording && styles.shutterRecording]} onPress={onPrimaryAction}>
          <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
        </Pressable>
        <RoundButton label="" onPress={onSwitchCamera} style={styles.noBorderButton}>
          <SwitchCameraIcon width={32} height={32} />
        </RoundButton>
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

function PipPreview({
  isSwapped,
  orientation,
  onPress,
  previewOutput,
  sessionRevision,
  isRecording,
  captureMode,
}: {
  isSwapped: boolean;
  orientation: FrameOrientation;
  onPress: () => void;
  previewOutput: ReturnType<typeof usePreviewOutput> | null;
  sessionRevision: number;
  isRecording: boolean;
  captureMode: CaptureMode;
}) {
  const isLandscape = orientation === 'landscape';
  return (
    <View style={[styles.pip, isLandscape ? styles.pipLandscape : styles.pipPortrait]}>
      {previewOutput ? (
        <NativePreviewView
          key={`pip-${sessionRevision}-${orientation}-${captureMode}`}
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="cover"
          implementationMode="compatible"
        />
      ) : (
        <View style={styles.pipPlaceholder}>
           <Text style={styles.pipPlaceholderText}>{isRecording ? '🔴 录制中' : '副画面'}</Text>
        </View>
      )}
      <Text style={styles.pipLabel}>{isRecording ? '🔴 录制中' : (isSwapped ? '主画面' : (isLandscape ? '副画面 横' : '副画面 竖'))}</Text>
      <Pressable style={styles.pipTouchLayer} onPress={onPress} />
    </View>
  );
}

function MainPreview({
  hybridRef,
  orientation,
  previewOutput,
  sessionRevision,
  captureMode,
}: {
  hybridRef: unknown;
  orientation: FrameOrientation;
  previewOutput: ReturnType<typeof usePreviewOutput>;
  sessionRevision: number;
  captureMode: CaptureMode;
}) {
  return (
    <View pointerEvents="none" style={styles.mainPreviewCenter}>
      <View style={orientation === 'landscape' ? styles.mainLandscapeSlot : styles.mainPortraitSlot}>
        <NativePreviewView
          key={`main-${sessionRevision}-${orientation}-${captureMode}`}
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="cover"
          implementationMode="compatible"
          hybridRef={hybridRef as never}
        />
      </View>
    </View>
  );
}

function ZoomControls({ zoom, onZoomIn, onZoomOut }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void }) {
  return (
    <View style={styles.zoomControls}>
      <Pressable style={styles.zoomButton} onPress={onZoomIn}><Text style={styles.zoomButtonText}>+</Text></Pressable>
      <Text style={styles.zoomText}>{zoom.toFixed(1)}x</Text>
      <Pressable style={styles.zoomButton} onPress={onZoomOut}><Text style={styles.zoomButtonText}>−</Text></Pressable>
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
  saveDualOutputs,
  setSaveDualOutputs,
  viewMode,
}: {
  device: CameraDevice | null;
  devicesCount: number;
  flashMode: FlashMode;
  onClose: () => void;
  onFlashModeChange: (mode: FlashMode) => void;
  open: boolean;
  saveDualOutputs: boolean;
  setSaveDualOutputs: (value: boolean) => void;
  viewMode: ViewMode;
}) {
  const photoResolutions = safeCount(() => device?.getSupportedResolutions('photo') ?? []);
  const videoResolutions = safeCount(() => device?.getSupportedResolutions('video') ?? []);
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.modalShade}>
        <View style={styles.settingsPanel}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Pressable onPress={onClose}><Text style={styles.closeText}>完成</Text></Pressable>
          </View>
          <ScrollView>
            <SettingsSection title="闪光灯">
              <Chip active={flashMode === 'off'} label="关闭" onPress={() => onFlashModeChange('off')} />
              <Chip active={flashMode === 'auto'} disabled={!device?.hasFlash} label="自动" onPress={() => onFlashModeChange('auto')} />
              <Chip active={flashMode === 'on'} disabled={!device?.hasFlash && !device?.hasTorch} label="开启" onPress={() => onFlashModeChange('on')} />
            </SettingsSection>
            <SettingsSection title="双画面">
              <Chip active={viewMode === 'dual'} label="双画面预览已开启" />
              <Chip active={saveDualOutputs} label="双画面同时保存" onPress={() => setSaveDualOutputs(!saveDualOutputs)} />
              <Chip active label="点击副画面切换主副" />
            </SettingsSection>
            <SettingsSection title="设备能力">
              <Text style={styles.settingLine}>设备：{device?.localizedName ?? '未知'}</Text>
              <Text style={styles.settingLine}>镜头数量：{devicesCount}</Text>
              <Text style={styles.settingLine}>拍照分辨率档位：{photoResolutions}</Text>
              <Text style={styles.settingLine}>视频分辨率档位：{videoResolutions}</Text>
              <Text style={styles.settingLine}>HDR：{device?.supportsPhotoHDR ? '支持' : '不支持'}</Text>
              <Text style={styles.settingLine}>防抖：{device?.supportsVideoStabilizationMode('standard') ? '支持' : '未报告'}</Text>
            </SettingsSection>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({ active = false, disabled = false, label, onPress }: { active?: boolean; disabled?: boolean; label: string; onPress?: () => void }) {
  return (
    <Pressable disabled={disabled || onPress == null} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RoundButton({ active = false, label, onPress, style, children }: { active?: boolean; label: string; onPress: () => void; style?: any; children?: React.ReactNode }) {
  return (
    <Pressable style={[styles.roundButton, active && styles.roundButtonActive, style]} onPress={onPress}>
      {children ? children : <Text style={styles.roundButtonText}>{label}</Text>}
    </Pressable>
  );
}

function safeCount<T>(reader: () => T[]): number {
  try {
    return reader().length;
  } catch {
    return 0;
  }
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function toLocalPath(path: string): string {
  return path.replace(/^file:\/\//, '');
}

async function copyMediaFile(filePath: string, suffix: string, preferredExtension?: string): Promise<string> {
  const source = toLocalPath(filePath);
  const extension = preferredExtension ?? (source.includes('.') ? source.slice(source.lastIndexOf('.')) : '.mp4');
  const target = `${RNFS.CachesDirectoryPath}/DualViewCamera_${suffix}_${Date.now()}${extension}`;
  await RNFS.copyFile(source, target);
  return target;
}

async function ensureVideoExtension(filePath: string, label: string): Promise<string> {
  const source = toLocalPath(filePath);
  if (/\.(mp4|m4v|mov|3gp)$/i.test(source)) {
    return source;
  }
  return copyMediaFile(source, slugify(label), '.mp4');
}

async function createPhotoVariant(filePath: string, variant: PhotoVariant, suffix: string): Promise<string> {
  if (variant === 'full') {
    return toLocalPath(filePath);
  }
  if (DualViewMedia?.createPhotoVariant != null) {
    return DualViewMedia.createPhotoVariant(toLocalPath(filePath), variant, slugify(suffix));
  }
  return toLocalPath(filePath);
}

async function createVideoVariant(filePath: string, variant: PhotoVariant, suffix: string): Promise<string> {
  if (DualViewMedia?.createVideoVariant != null) {
    return DualViewMedia.createVideoVariant(toLocalPath(filePath), variant, slugify(suffix));
  }
  return copyMediaFile(filePath, slugify(suffix), '.mp4');
}

function slugify(value: string): string {
  return value.replace(/[^\w-]+/g, '_') || 'media';
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isIgnorableZoomError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancelled due to another zoom value being set/i.test(message);
}

function cameraErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('No flash unit')) {
    return '当前摄像头不支持闪光灯';
  }
  if (message.includes('focus')) {
    return '当前设备不支持此位置对焦';
  }
  return message.split('\n')[0] || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  root: { flex: 1, backgroundColor: COLORS.bg },
  previewArea: { flex: 1, overflow: 'hidden', backgroundColor: '#05070a' },
  focusLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 8 },
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.bg },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  description: { color: COLORS.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  primaryButton: { borderRadius: 999, backgroundColor: COLORS.text, paddingHorizontal: 22, paddingVertical: 12 },
  primaryButtonText: { color: '#000', fontWeight: '800' },
  previewStatus: { position: 'absolute', left: 22, right: 22, top: '40%', zIndex: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: COLORS.line },
  previewStatusTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
  previewStatusText: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  previewStatusMeta: { color: COLORS.accent, fontSize: 11, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  mainPreviewCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  mainPortraitSlot: { width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000', overflow: 'hidden' },
  mainLandscapeSlot: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  topBar: { position: 'absolute', left: 0, right: 0, top: TOP_BAR_OFFSET, zIndex: 20, paddingHorizontal: 24, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: 24, alignItems: 'center' },
  cameraLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  roundButton: { minWidth: 64, height: 64, borderRadius: 32, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 0 },
  roundButtonActive: { backgroundColor: 'rgba(255,209,102,0.22)' },
  roundButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  iconText: { fontSize: 32, fontWeight: '400' },
  noBorderButton: { backgroundColor: 'transparent', borderWidth: 0, minWidth: 64 },
  pip: { position: 'absolute', left: 18, bottom: 28, zIndex: 18, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: '#000' },
  pipLandscape: { width: 190, height: 110, borderRadius: 16 },
  pipPortrait: { width: 126, height: 168, borderRadius: 16 },
  pipMirrorHint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.36)' },
  pipMirrorText: { color: 'rgba(255,255,255,0.84)', fontSize: 22, fontWeight: '900' },
  pipLabel: { position: 'absolute', left: 6, bottom: 5, color: COLORS.text, fontSize: 10, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 3 },
  pipTouchLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  pipPlaceholder: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  pipPlaceholderText: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  zoomControls: { position: 'absolute', right: 16, top: '38%', zIndex: 19, alignItems: 'center', gap: 8, padding: 6, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.38)' },
  zoomButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  zoomButtonText: { color: COLORS.text, fontSize: 22, fontWeight: '500' },
  zoomText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  toast: { position: 'absolute', left: 24, right: 24, bottom: 150, zIndex: 30, alignItems: 'center' },
  toastText: { overflow: 'hidden', color: COLORS.text, fontSize: 13, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.65)' },
  bottomControls: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 22, backgroundColor: '#000' },
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
