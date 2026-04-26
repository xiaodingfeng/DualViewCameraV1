import { NativeModules } from 'react-native';

import type { ConcurrentCameraCapability } from '../types/concurrentCamera';

type ConcurrentCameraModuleType = {
  getConcurrentCameraCapability(): Promise<ConcurrentCameraCapability>;
};

const NativeConcurrentCameraModule = NativeModules.ConcurrentCameraModule as
  | ConcurrentCameraModuleType
  | undefined;

export async function getConcurrentCameraCapability(): Promise<ConcurrentCameraCapability> {
  if (!NativeConcurrentCameraModule?.getConcurrentCameraCapability) {
    return {
      supported: false,
      reason: 'unknown-error',
      pairs: [],
    };
  }
  return NativeConcurrentCameraModule.getConcurrentCameraCapability();
}
