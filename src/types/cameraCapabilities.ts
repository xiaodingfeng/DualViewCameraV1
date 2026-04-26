import type {
  PhotoFormat,
  VideoCodecFormat,
  VideoFps,
  VideoQuality,
} from './camera';

export type CameraCapabilityFlag<T extends string | number> = Record<T, boolean>;

export interface CameraCapabilities {
  deviceId: string | null;
  flash: {
    auto: boolean;
    on: boolean;
    torch: boolean;
  };
  photoFormats: CameraCapabilityFlag<PhotoFormat>;
  videoFps: CameraCapabilityFlag<VideoFps>;
  videoQualities: CameraCapabilityFlag<VideoQuality>;
  videoCodecs: CameraCapabilityFlag<VideoCodecFormat>;
}
