/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native-vision-camera', () => ({
  useCameraDevice: jest.fn(() => null),
  useCameraDevices: jest.fn(() => []),
  useCameraPermission: jest.fn(() => ({
    hasPermission: true,
    requestPermission: jest.fn(() => Promise.resolve(true)),
  })),
  useMicrophonePermission: jest.fn(() => ({
    hasPermission: true,
    requestPermission: jest.fn(() => Promise.resolve(true)),
  })),
  Camera: () => null,
  CommonResolutions: {
    HIGHEST_4_3: { width: 4032, height: 3024 },
    UHD_4_3: { width: 3840, height: 2880 },
    UHD_16_9: { width: 3840, height: 2160 },
    HD_16_9: { width: 1280, height: 720 },
    FHD_16_9: { width: 1920, height: 1080 },
    '8k_16_9': { width: 8064, height: 4536 },
  },
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  CachesDirectoryPath: '/cache',
  exists: jest.fn(() => Promise.resolve(false)),
  readFile: jest.fn(),
  writeFile: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: jest.fn(() => Promise.resolve({ edges: [] })),
    saveAsset: jest.fn(),
    deletePhotos: jest.fn(),
  },
}));

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
