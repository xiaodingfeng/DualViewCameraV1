import React, { useCallback, useEffect, useState } from 'react';
import { AppState, LogBox, PermissionsAndroid, Platform, View } from 'react-native';
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

  // Simple handler to trigger system permission dialogs
  const handleRequestPermission = useCallback(async () => {
    // Request Camera
    await cameraPermission.requestPermission();
    
    // Request Storage/Media (This will pop up the system dialog if not permanently denied)
    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);
      } else {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
      }
    }
  }, [cameraPermission]);

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

  const switchCamera = useCallback(() => {
    setCameraPosition(current => (current === 'back' ? 'front' : 'back'));
  }, []);

  // Only block the app on Camera permission to allow entry.
  // Storage permission can be handled inside the app or via the same button.
  if (!cameraPermission.hasPermission) {
    return <PermissionScreen onRequest={handleRequestPermission} />;
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
      microphoneReady={microphonePermission.hasPermission}
      onCaptureModeChange={setCaptureMode}
      onSwitchCamera={switchCamera}
    />
  );
}
