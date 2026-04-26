import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  CommonResolutions,
  NativePreviewView,
  usePhotoOutput,
  usePreviewOutput,
  VisionCamera,
} from 'react-native-vision-camera';
import type { CameraDevice, CameraSession } from 'react-native-vision-camera';

import { COLORS } from '../../config/camera';

export type VisionCameraMultiCamHandle = {
  capturePhoto: () => Promise<void>;
};

export type VisionCameraMultiCamPhotoResult = {
  backPath: string;
  frontPath: string;
};

type VisionCameraMultiCamPreviewProps = {
  active: boolean;
  backDevice: CameraDevice | null;
  frontDevice: CameraDevice | null;
  onError: (message: string) => void;
  onPhotoCaptured: (result: VisionCameraMultiCamPhotoResult) => void;
  onReadyChange?: (ready: boolean) => void;
};

export const VisionCameraMultiCamPreview = forwardRef<
  VisionCameraMultiCamHandle,
  VisionCameraMultiCamPreviewProps
>(function VisionCameraMultiCamPreview({
  active,
  backDevice,
  frontDevice,
  onError,
  onPhotoCaptured,
  onReadyChange,
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
  const sessionRef = useRef<CameraSession | null>(null);
  const isReadyRef = useRef(false);
  const [status, setStatus] = useState('双摄并发待机');

  useImperativeHandle(
    ref,
    () => ({
      capturePhoto: async () => {
        if (!isReadyRef.current) {
          throw new Error('双摄并发会话尚未就绪');
        }
        const [backPhoto, frontPhoto] = await Promise.all([
          backPhotoOutput.capturePhotoToFile(
            { flashMode: 'off', enableShutterSound: false },
            {},
          ),
          frontPhotoOutput.capturePhotoToFile(
            { flashMode: 'off', enableShutterSound: false },
            {},
          ),
        ]);
        onPhotoCaptured({
          backPath: backPhoto.filePath,
          frontPath: frontPhoto.filePath,
        });
      },
    }),
    [backPhotoOutput, frontPhotoOutput, onPhotoCaptured],
  );

  useEffect(() => {
    let cancelled = false;
    isReadyRef.current = false;
    onReadyChange?.(false);

    async function startSession() {
      if (!active) {
        setStatus('双摄并发未启用');
        return;
      }
      if (!VisionCamera.supportsMultiCamSessions) {
        setStatus('当前 VisionCamera 不支持 Multi-Camera Session');
        onError('当前 VisionCamera 不支持 Multi-Camera Session');
        return;
      }
      if (backDevice == null || frontDevice == null) {
        setStatus('未找到前后摄像头设备');
        onError('未找到前后摄像头设备');
        return;
      }

      try {
        setStatus('正在启动 VisionCamera Multi-Camera');
        const session = await VisionCamera.createCameraSession(true);
        if (cancelled) {
          await session.stop().catch(() => {});
          return;
        }

        sessionRef.current = session;
        await session.configure([
          {
            input: backDevice,
            outputs: [
              { output: backPreviewOutput, mirrorMode: 'off' },
              { output: backPhotoOutput, mirrorMode: 'off' },
            ],
            constraints: [],
          },
          {
            input: frontDevice,
            outputs: [
              { output: frontPreviewOutput, mirrorMode: 'on' },
              { output: frontPhotoOutput, mirrorMode: 'off' },
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
        setStatus('VisionCamera Multi-Camera 已启动');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`VisionCamera Multi-Camera 启动失败：${message}`);
        onError(`VisionCamera Multi-Camera 启动失败：${message}`);
      }
    }

    startSession();

    return () => {
      cancelled = true;
      isReadyRef.current = false;
      onReadyChange?.(false);
      const session = sessionRef.current;
      sessionRef.current = null;
      session?.stop().catch(() => {});
    };
  }, [
    active,
    backDevice,
    backPhotoOutput,
    backPreviewOutput,
    frontDevice,
    frontPhotoOutput,
    frontPreviewOutput,
    onError,
    onReadyChange,
  ]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <NativePreviewView
        implementationMode="compatible"
        previewOutput={backPreviewOutput}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
      <View style={multiCamStyles.pip}>
        <NativePreviewView
          implementationMode="compatible"
          previewOutput={frontPreviewOutput}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
        <Text style={multiCamStyles.pipLabel}>前摄</Text>
      </View>
      <View style={multiCamStyles.statusPill} pointerEvents="none">
        <Text style={multiCamStyles.statusText}>{status}</Text>
      </View>
    </View>
  );
});

const multiCamStyles = StyleSheet.create({
  pip: {
    position: 'absolute',
    right: 18,
    bottom: 218,
    width: 142,
    height: 190,
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
  statusPill: {
    position: 'absolute',
    left: 18,
    top: 112,
    maxWidth: '86%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  statusText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '800',
  },
});
