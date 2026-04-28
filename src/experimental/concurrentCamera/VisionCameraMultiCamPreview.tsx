import React, {
  forwardRef,
  useCallback,
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
import type {
  CaptureMode,
  ConcurrentMainCamera,
  ConcurrentPipLayoutConfig,
  PreviewLayoutTemplateId,
} from '../../types/camera';
import { clamp, wait } from '../../utils/camera';

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
  layoutId: PreviewLayoutTemplateId;
  location?: Location | null;
  mainCamera: ConcurrentMainCamera;
  onError: (message: string) => void;
  onPhotoCaptured: (result: VisionCameraMultiCamPhotoResult) => void;
  onPipLayoutChange?: (layout: ConcurrentPipLayoutConfig) => void;
  onReadyChange?: (ready: boolean) => void;
  onVideoCaptured: (result: VisionCameraMultiCamVideoResult) => void;
  pipLayout: ConcurrentPipLayoutConfig;
};

type VisionCameraFactoryWithMultiCam = typeof VisionCamera & {
  supportsMultiCamSessions?: boolean;
  createCameraSession?: (enableMultiCam: boolean) => Promise<CameraSession>;
};

const PIP_WIDTH = 142;
const PIP_HEIGHT = 190;
const PIP_MIN_MARGIN = 12;
const PIP_BOTTOM_SAFE = 158;

async function createMultiCamSession(): Promise<CameraSession> {
  const factory = VisionCamera as VisionCameraFactoryWithMultiCam;

  if (factory.supportsMultiCamSessions !== true) {
    throw new Error('当前 VisionCamera Runtime 不支持 Multi-Camera Session');
  }

  if (typeof factory.createCameraSession !== 'function') {
    throw new Error('当前 VisionCamera 版本没有暴露 createCameraSession(true)');
  }

  return factory.createCameraSession(true);
}

export const VisionCameraMultiCamPreview = forwardRef<
  VisionCameraMultiCamHandle,
  VisionCameraMultiCamPreviewProps
>(function VisionCameraMultiCamPreview(
  {
    active,
    backDevice,
    captureMode,
    enableAudio,
    frontDevice,
    layoutId,
    location,
    mainCamera,
    onError,
    onPhotoCaptured,
    onPipLayoutChange,
    onReadyChange,
    onVideoCaptured,
    pipLayout,
  },
  ref,
) {
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
    enablePersistentRecorder: true,
  });

  const frontVideoOutput = useVideoOutput({
    targetResolution: CommonResolutions.HD_16_9,
    enableAudio: enableAudio && mainCamera === 'front',
    enablePersistentRecorder: true,
  });

  const sessionRef = useRef<CameraSession | null>(null);
  const isReadyRef = useRef(false);
  const backRecorderRef = useRef<Recorder | null>(null);
  const frontRecorderRef = useRef<Recorder | null>(null);
  const recordingStateRef = useRef<RecordingState | null>(null);

  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [localPipLayout, setLocalPipLayout] = useState(pipLayout);

  useEffect(() => {
    setLocalPipLayout(pipLayout);
  }, [pipLayout]);

  const maxPipLeft = Math.max(
    PIP_MIN_MARGIN,
    previewSize.width - PIP_WIDTH - PIP_MIN_MARGIN,
  );
  const maxPipTop = Math.max(
    PIP_MIN_MARGIN,
    previewSize.height - PIP_HEIGHT - PIP_BOTTOM_SAFE,
  );

  const pipPosition = useMemo(
    () => ({
      left: clamp(
        localPipLayout.leftRatio * Math.max(1, maxPipLeft - PIP_MIN_MARGIN) +
          PIP_MIN_MARGIN,
        PIP_MIN_MARGIN,
        maxPipLeft,
      ),
      top: clamp(
        localPipLayout.topRatio * Math.max(1, maxPipTop - PIP_MIN_MARGIN) +
          PIP_MIN_MARGIN,
        PIP_MIN_MARGIN,
        maxPipTop,
      ),
    }),
    [maxPipLeft, maxPipTop, localPipLayout.leftRatio, localPipLayout.topRatio],
  );

  const startOffsetRef = useRef({ left: 0, top: 0 });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          layoutId === 'pip' && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
        onStartShouldSetPanResponder: () => layoutId === 'pip',
        onPanResponderGrant: () => {
          startOffsetRef.current = pipPosition;
        },
        onPanResponderMove: (_, gesture) => {
          const left = clamp(
            startOffsetRef.current.left + gesture.dx,
            PIP_MIN_MARGIN,
            maxPipLeft,
          );
          const top = clamp(
            startOffsetRef.current.top + gesture.dy,
            PIP_MIN_MARGIN,
            maxPipTop,
          );

          const leftRatio = (left - PIP_MIN_MARGIN) / Math.max(1, maxPipLeft - PIP_MIN_MARGIN);
          const topRatio = (top - PIP_MIN_MARGIN) / Math.max(1, maxPipTop - PIP_MIN_MARGIN);

          setLocalPipLayout({ leftRatio, topRatio });
        },
        onPanResponderRelease: () => {
          onPipLayoutChange?.(localPipLayout);
        },
      }),
    [layoutId, maxPipLeft, maxPipTop, onPipLayoutChange, pipPosition, localPipLayout],
  );

  const resetRecordingRefs = useCallback(() => {
    backRecorderRef.current = null;
    frontRecorderRef.current = null;
    recordingStateRef.current = null;
  }, []);

  const cancelActiveRecorders = useCallback(async () => {
    const recorders = [backRecorderRef.current, frontRecorderRef.current].filter(
      (recorder): recorder is Recorder => recorder != null,
    );

    await Promise.allSettled(
      recorders.map(async recorder => {
        try {
          await recorder.cancelRecording();
        } catch {
          // Cleanup should never throw into React unmount/session restart.
        }
      }),
    );

    resetRecordingRefs();
  }, [resetRecordingRefs]);

  const finishRecordingIfReady = useCallback(() => {
    const state = recordingStateRef.current;

    if (state == null || state.errored || !state.backDone || !state.frontDone) {
      return;
    }

    resetRecordingRefs();

    if (state.backPath == null || state.frontPath == null) {
      onError('双摄并发录像文件生成失败');
      return;
    }

    onVideoCaptured({
      backPath: state.backPath,
      frontPath: state.frontPath,
    });
  }, [onError, onVideoCaptured, resetRecordingRefs]);

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

        if (
          recordingStateRef.current != null ||
          backRecorderRef.current != null ||
          frontRecorderRef.current != null
        ) {
          throw new Error('双摄并发录像已经在进行中');
        }

        const recorderSettings = location ? { location } : {};

        try {
          const backRecorder = await backVideoOutput.createRecorder(
              mainCamera === 'back' ? recorderSettings : {},
          );
          await wait(150);
          const frontRecorder = await frontVideoOutput.createRecorder(
              mainCamera === 'front' ? recorderSettings : {},
          );

          backRecorderRef.current = backRecorder;
          frontRecorderRef.current = frontRecorder;
          recordingStateRef.current = {
            backDone: false,
            frontDone: false,
            errored: false,
          };

          const handleError = (error: Error) => {
            console.log('Concurrent recording error:', error);
            const state = recordingStateRef.current;
            if (state != null) {
              state.errored = true;
            }

            void cancelActiveRecorders();
            onError(error.message || '双摄并发录像失败');
          };

          await backRecorder.startRecording(
            filePath => {
              const state = recordingStateRef.current;
              if (state == null || state.errored) return;

              state.backPath = filePath;
              state.backDone = true;
              finishRecordingIfReady();
            },
            handleError,
          );

          await wait(350); // Increased delay between recorder starts for emulator stability

          await frontRecorder.startRecording(
            filePath => {
              const state = recordingStateRef.current;
              if (state == null || state.errored) return;

              state.frontPath = filePath;
              state.frontDone = true;
              finishRecordingIfReady();
            },
            handleError,
          );
        } catch (error) {
          await cancelActiveRecorders();
          throw error;
        }
      },

      stopRecording: async () => {
        const recorders = [
          backRecorderRef.current,
          frontRecorderRef.current,
        ].filter((recorder): recorder is Recorder => recorder != null);

        if (recorders.length === 0) {
          return;
        }

        const results = await Promise.allSettled(
          recorders.map(recorder => recorder.stopRecording()),
        );
        const rejected = results.find(result => result.status === 'rejected');

        if (rejected?.status === 'rejected') {
          await cancelActiveRecorders();
          throw rejected.reason;
        }
      },
    }),
    [
      backPhotoOutput,
      backVideoOutput,
      cancelActiveRecorders,
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
    resetRecordingRefs();

    async function startSession() {
      if (!active) {
        return;
      }

      if (backDevice == null || frontDevice == null) {
        onError('未找到前后摄像头设备');
        return;
      }

      let session: CameraSession | null = null;

      try {
        session = await createMultiCamSession();

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
        if (session != null && sessionRef.current === session) {
          sessionRef.current = null;
        }
        await session?.stop().catch(() => {});

        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          onError(`VisionCamera Multi-Camera 启动失败：${message}`);
        }
      }
    }

    startSession();

    return () => {
      cancelled = true;
      isReadyRef.current = false;
      onReadyChange?.(false);

      void cancelActiveRecorders();

      const session = sessionRef.current;
      sessionRef.current = null;
      if (session != null) {
        void (async () => {
          try {
            await session.stop();
            if (typeof (session as any).close === 'function') {
              await (session as any).close();
            }
          } catch (e) {
             console.log('Multi-camera session cleanup error:', e);
          }
        })();
      }
    };
  }, [
    active,
    backDevice,
    backPhotoOutput,
    backPreviewOutput,
    backVideoOutput,
    cancelActiveRecorders,
    captureMode,
    frontDevice,
    frontPhotoOutput,
    frontPreviewOutput,
    frontVideoOutput,
    mainCamera,
    onError,
    onReadyChange,
    resetRecordingRefs,
  ]);

  const mainPreviewOutput =
    mainCamera === 'back' ? backPreviewOutput : frontPreviewOutput;
  const subPreviewOutput =
    mainCamera === 'back' ? frontPreviewOutput : backPreviewOutput;
  const subLabel = mainCamera === 'back' ? '前摄' : '后摄';

  const renderLayout = () => {
    if (layoutId === 'split-horizontal') {
      return (
        <View style={StyleSheet.absoluteFill}>
          <View style={multiCamStyles.splitHorizontalHalf}>
             <NativePreviewView
               implementationMode="compatible"
               previewOutput={mainPreviewOutput}
               resizeMode="cover"
               style={StyleSheet.absoluteFill}
             />
          </View>
          <View style={multiCamStyles.splitHorizontalHalf}>
             <NativePreviewView
               implementationMode="compatible"
               previewOutput={subPreviewOutput}
               resizeMode="cover"
               style={StyleSheet.absoluteFill}
             />
          </View>
        </View>
      );
    }

    if (layoutId === 'split-vertical') {
      return (
        <View style={StyleSheet.absoluteFill}>
          <View style={multiCamStyles.splitVerticalHalf}>
             <NativePreviewView
               implementationMode="compatible"
               previewOutput={mainPreviewOutput}
               resizeMode="cover"
               style={StyleSheet.absoluteFill}
             />
          </View>
          <View style={multiCamStyles.splitVerticalHalf}>
             <NativePreviewView
               implementationMode="compatible"
               previewOutput={subPreviewOutput}
               resizeMode="cover"
               style={StyleSheet.absoluteFill}
             />
          </View>
        </View>
      );
    }

    if (layoutId === 'stack') {
       return (
         <View style={StyleSheet.absoluteFill}>
           <View style={multiCamStyles.stackMain}>
              <NativePreviewView
                implementationMode="compatible"
                previewOutput={mainPreviewOutput}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
              />
           </View>
           <View style={multiCamStyles.stackSub}>
              <NativePreviewView
                implementationMode="compatible"
                previewOutput={subPreviewOutput}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
              />
           </View>
         </View>
       );
    }

    return (
      <View style={StyleSheet.absoluteFill}>
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
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setPreviewSize({ width, height });
      }}
    >
      {renderLayout()}
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
  splitHorizontalHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  splitVerticalHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  stackMain: {
    flex: 3,
    overflow: 'hidden',
  },
  stackSub: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});
