export type ConcurrentCameraFacing = 'front' | 'back' | 'external' | 'unknown';
export type ConcurrentCameraUseCase = 'preview' | 'photo' | 'video';

export type ConcurrentCameraPair = {
  id: string;
  primaryCameraId: string;
  secondaryCameraId: string;
  primaryFacing: ConcurrentCameraFacing;
  secondaryFacing: ConcurrentCameraFacing;
  supportedUseCases: ConcurrentCameraUseCase[];
  maxPreviewSize?: { width: number; height: number };
  maxVideoSize?: { width: number; height: number };
  supportsCompositionSettings: boolean;
};

export type ConcurrentCameraCapabilityReason =
  | 'api-too-low'
  | 'feature-missing'
  | 'no-camera-pairs'
  | 'camerax-unavailable'
  | 'unknown-error';

export type ConcurrentCameraCapability = {
  supported: boolean;
  reason?: ConcurrentCameraCapabilityReason;
  pairs: ConcurrentCameraPair[];
};
