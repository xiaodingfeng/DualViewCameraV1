import React, { useCallback, useEffect, useState } from 'react';
import { LogBox, View } from 'react-native';
import {
  type CameraPosition,
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera';

import { PermissionScreen } from './src/components/CameraPrimitives';
import CameraShell from './src/screens/CameraShell';
import { styles } from './src/styles/cameraStyles';
import type { CaptureMode } from './src/types/camera';

LogBox.ignoreLogs([
  'JPromise was destroyed',
  'Low-light boost is not supported',
  'SafeAreaView has been deprecated',
]);

export default function App(): React.JSX.Element {
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
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const switchCamera = useCallback(() => {
    setCameraPosition(current => (current === 'back' ? 'front' : 'back'));
  }, []);

  if (!cameraPermission.hasPermission) {
    return <PermissionScreen onRequest={cameraPermission.requestPermission} />;
  }

  if (device == null) {
    return <View style={styles.root} />;
  }

  const dCount = Array.isArray(devicesList) ? devicesList.length : 0;

  return (
    <CameraShell
      cameraPosition={cameraPosition}
      captureMode={captureMode}
      device={device}
      devicesCount={dCount}
      isInitializing={isInitializing}
      microphoneReady={microphonePermission.hasPermission}
      onCaptureModeChange={setCaptureMode}
      onSwitchCamera={switchCamera}
    />
  );
}
