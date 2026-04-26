import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import {
  CommonResolutions,
  NativePreviewView,
  usePhotoOutput,
  usePreviewOutput,
  useVideoOutput,
  VisionCamera,
} from 'react-native-vision-camera';
import type {
  CameraDevice,
  CameraSession,
  Location,
  Recorder,
} from 'react-native-vision-camera';

import { COLORS } from '../../config/camera';
import type { CaptureMode, ConcurrentMainCamera, ConcurrentPipLayoutConfig } from '../../types/camera';
import { clamp } from '../../utils/camera';

export type VisionCameraMultiCamHandle = {
  capturePhoto: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
};

export type VisionCameraMultiCamPhotoResult = {
  backPath: string;
  frontPath: string;
};

export type VisionCameraMultiCamVideoResult = {
  backPath: string;
  frontPath: string;
};

type RecordingState = {
  backPath?: string;
  frontPath?: string;
  backDone: boolean;
  frontDone: boolean;
  errored: boolean;
};

type VisionCameraMultiCamPreviewProps = {
  active: boolean;
  backDevice: CameraDevice | null;
  captureMode: CaptureMode;
  enableAudio: boolean;
  frontDevice: CameraDevice | null;
  location?: Location | null;
  mainCamera: ConcurrentMainCamera;
  onError: (message: string) => void;
  onPhotoCaptured: (result: VisionCameraMultiCamPhotoResult) => void;
  onPipLayoutChange?: (layout: ConcurrentPipLayoutConfig) => void;
  onReadyChange?: (ready: boolean) => void;
  onVideoCaptured: (result: VisionCameraMultiCamVideoResult) => void;
  pipLayout: ConcurrentPipLayoutConfig;
};

const PIP_WIDTH = 142;
const PIP_HEIGHT = 190;
const PIP_MIN_MARGIN = 12;
const PIP_BOTTOM_SAFE = 158;

export const VisionCameraMultiCamPreview = forwardRef<
  VisionCameraMultiCamHandle,
  VisionCameraMultiCamPreviewProps
>(function VisionCameraMultiCamPreview({
  active,
  backDevice,
  captureMode,
  enableAudio,
  frontDevice,
  location,
  mainCamera,
  onError,
  onPhotoCaptured,
  onPipLayoutChange,
  onReadyChange,
  onVideoCaptured,
  pipLayout,
}, ref) {
  const backPreviewOutput = usePreviewOutput();
  const frontPreviewOutput = usePreviewOutput();
  const backPhotoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: 0.94,
    qualityPrioritization: 'balanced',
  });
  const frontPhotoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    containerFormat: 'jpeg',
    quality: 0.94,
    qualityPrioritization: 'balanced',
  });
  const backVideoOutput = useVideoOutput({
    targetResolution: CommonResolutions.HD_16_9,
    enableAudio: enableAudio && mainCamera === 'back',
    enablePersistentRecorder: false,
  });
  const frontVideoOutput = useVideoOutput({
    targetResolution: CommonResolutions.HD_16_9,
    enableAudio: enableAudio && mainCamera === 'front',
    enablePersistentRecorder: false,
  });
  const sessionRef = useRef<CameraSession | null>(null);
  const isReadyRef = useRef(false);
  const backRecorderRef = useRef<Recorder | null>(null);
  const frontRecorderRef = useRef<Recorder | null>(null);
  const recordingStateRef = useRef<RecordingState | null>(null);
  const startOffsetRef = useRef({ left: 0, top: 0 });
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const maxPipLeft = Math.max(PIP_MIN_MARGIN, previewSize.width - PIP_WIDTH - PIP_MIN_MARGIN);
  const maxPipTop = Math.max(PIP_MIN_MARGIN, previewSize.height - PIP_HEIGHT - PIP_BOTTOM_SAFE);
  const pipPosition = useMemo(
    () => ({
      left: clamp(
        pipLayout.leftRatio * Math.max(1, maxPipLeft - PIP_MIN_MARGIN) + PIP_MIN_MARGIN,
        PIP_MIN_MARGIN,
        maxPipLeft,
      ),
      top: clamp(
        pipLayout.topRatio * Math.max(1, maxPipTop - PIP_MIN_MARGIN) + PIP_MIN_MARGIN,
        PIP_MIN_MARGIN,
        maxPipTop,
      ),
    }),
    [maxPipLeft, maxPipTop, pipLayout.leftRatio, pipLayout.topRatio],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startOffsetRef.current = pipPosition;
        },
        onPanResponderMove: (_, gesture) => {
          const left = clamp(startOffsetRef.current.left + gesture.dx, PIP_MIN_MARGIN, maxPipLeft);
          const top = clamp(startOffsetRef.current.top + gesture.dy, PIP_MIN_MARGIN, maxPipTop);
          onPipLayoutChange?.({
            leftRatio: (left - PIP_MIN_MARGIN) / Math.max(1, maxPipLeft - PIP_MIN_MARGIN),
            topRatio: (top - PIP_MIN_MARGIN) / Math.max(1, maxPipTop - PIP_MIN_MARGIN),
          });
        },
      }),
    [maxPipLeft, maxPipTop, onPipLayoutChange, pipPosition],
  );

  const finishRecordingIfReady = useMemo(
    () => () => {
      const state = recordingStateRef.current;
      if (state == null || state.errored || !state.backDone || !state.frontDone) return;
      recordingStateRef.current = null;
      backRecorderRef.current = null;
      frontRecorderRef.current = null;
      if (state.backPath == null || state.frontPath == null) {
        onError('双摄并发录像文件生成失败');
        return;
      }
      onVideoCaptured({
        backPath: state.backPath,
        frontPath: state.frontPath,
      });
    },
    [onError, onVideoCaptured],
  );

  useImperativeHandle(
    ref,
    () => ({
      capturePhoto: async () => {
        if (!isReadyRef.current || captureMode !== 'photo') {
          throw new Error('双摄并发拍照会话尚未就绪');
        }
        const photoOptions = {
          flashMode: 'off' as const,
          enableShutterSound: false,
          ...(location ? { location } : {}),
        };
        const [backPhoto, frontPhoto] = await Promise.all([
          backPhotoOutput.capturePhotoToFile(photoOptions, {}),
          frontPhotoOutput.capturePhotoToFile(photoOptions, {}),
        ]);
        onPhotoCaptured({
          backPath: backPhoto.filePath,
          frontPath: frontPhoto.filePath,
        });
      },
      startRecording: async () => {
        if (!isReadyRef.current || captureMode !== 'video') {
          throw new Error('双摄并发录像会话尚未就绪');
        }
        if (recordingStateRef.current != null) {
          throw new Error('双摄并发录像已经在进行中');
        }
        const recorderSettings = location ? { location } : {};
        const [backRecorder, frontRecorder] = await Promise.all([
          backVideoOutput.createRecorder(mainCamera === 'back' ? recorderSettings : {}),
          frontVideoOutput.createRecorder(mainCamera === 'front' ? recorderSettings : {}),
        ]);
        backRecorderRef.current = backRecorder;
        frontRecorderRef.current = frontRecorder;
        recordingStateRef.current = {
          backDone: false,
          frontDone: false,
          errored: false,
        };
        const handleError = (error: Error) => {
          const state = recordingStateRef.current;
          if (state != null) state.errored = true;
          recordingStateRef.current = null;
          backRecorderRef.current = null;
          frontRecorderRef.current = null;
          onError(error.message);
        };
        await Promise.all([
          backRecorder.startRecording(
            filePath => {
              const state = recordingStateRef.current;
              if (state == null) return;
              state.backPath = filePath;
              state.backDone = true;
              finishRecordingIfReady();
            },
            handleError,
          ),
          frontRecorder.startRecording(
            filePath => {
              const state = recordingStateRef.current;
              if (state == null) return;
              state.frontPath = filePath;
              state.frontDone = true;
              finishRecordingIfReady();
            },
            handleError,
          ),
        ]);
      },
      stopRecording: async () => {
        const recorders = [backRecorderRef.current, frontRecorderRef.current].filter(
          (recorder): recorder is Recorder => recorder != null,
        );
        if (recorders.length === 0) return;
        await Promise.all(recorders.map(recorder => recorder.stopRecording()));
      },
    }),
    [
      backPhotoOutput,
      backVideoOutput,
      captureMode,
      finishRecordingIfReady,
      frontPhotoOutput,
      frontVideoOutput,
      location,
      mainCamera,
      onError,
      onPhotoCaptured,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    isReadyRef.current = false;
    onReadyChange?.(false);
    recordingStateRef.current = null;
    backRecorderRef.current = null;
    frontRecorderRef.current = null;

    async function startSession() {
      if (!active) return;
      if (!VisionCamera.supportsMultiCamSessions) {
        onError('当前 VisionCamera 不支持 Multi-Camera Session');
        return;
      }
      if (backDevice == null || frontDevice == null) {
        onError('未找到前后摄像头设备');
        return;
      }

      try {
        const session = await VisionCamera.createCameraSession(true);
        if (cancelled) {
          await session.stop().catch(() => {});
          return;
        }

        sessionRef.current = session;
        await session.configure([
          {
            input: backDevice,
            outputs:
              captureMode === 'photo'
                ? [
                    { output: backPreviewOutput, mirrorMode: 'off' },
                    { output: backPhotoOutput, mirrorMode: 'off' },
                  ]
                : [
                    { output: backPreviewOutput, mirrorMode: 'off' },
                    { output: backVideoOutput, mirrorMode: 'off' },
                  ],
            constraints: [],
          },
          {
            input: frontDevice,
            outputs:
              captureMode === 'photo'
                ? [
                    { output: frontPreviewOutput, mirrorMode: 'on' },
                    { output: frontPhotoOutput, mirrorMode: 'off' },
                  ]
                : [
                    { output: frontPreviewOutput, mirrorMode: 'on' },
                    { output: frontVideoOutput, mirrorMode: 'off' },
                  ],
            constraints: [],
          },
        ]);
        await session.start();
        if (cancelled) {
          await session.stop().catch(() => {});
          return;
        }

        isReadyRef.current = true;
        onReadyChange?.(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError(`VisionCamera Multi-Camera 启动失败：${message}`);
      }
    }

    startSession();

    return () => {
      cancelled = true;
      isReadyRef.current = false;
      onReadyChange?.(false);
      const backRecorder = backRecorderRef.current;
      const frontRecorder = frontRecorderRef.current;
      backRecorderRef.current = null;
      frontRecorderRef.current = null;
      recordingStateRef.current = null;
      backRecorder?.cancelRecording().catch(() => {});
      frontRecorder?.cancelRecording().catch(() => {});
      const session = sessionRef.current;
      sessionRef.current = null;
      session?.stop().catch(() => {});
    };
  }, [
    active,
    backDevice,
    backPhotoOutput,
    backPreviewOutput,
    backVideoOutput,
    captureMode,
    frontDevice,
    frontPhotoOutput,
    frontPreviewOutput,
    frontVideoOutput,
    onError,
    onReadyChange,
  ]);

  const mainPreviewOutput = mainCamera === 'back' ? backPreviewOutput : frontPreviewOutput;
  const subPreviewOutput = mainCamera === 'back' ? frontPreviewOutput : backPreviewOutput;
  const subLabel = mainCamera === 'back' ? '前摄' : '后摄';

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setPreviewSize({ width, height });
      }}
    >
      <NativePreviewView
        implementationMode="compatible"
        previewOutput={mainPreviewOutput}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          multiCamStyles.pip,
          {
            left: pipPosition.left,
            top: pipPosition.top,
          },
        ]}
        {...panResponder.panHandlers}
      >
        <NativePreviewView
          implementationMode="compatible"
          previewOutput={subPreviewOutput}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
        <Text style={multiCamStyles.pipLabel}>{subLabel}</Text>
      </View>
    </View>
  );
});

const multiCamStyles = StyleSheet.create({
  pip: {
    position: 'absolute',
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.84)',
    backgroundColor: '#000',
  },
  pipLabel: {
    position: 'absolute',
    left: 8,
    bottom: 7,
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
});
