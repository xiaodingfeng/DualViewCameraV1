import { NativeModules, Platform, requireNativeComponent } from 'react-native';

import type { NativeVideoViewProps, PhotoFormat, PhotoVariant, VideoCodecFormat } from '../types/camera';

export const NativeDualViewVideoView =
  Platform.OS === 'android'
    ? requireNativeComponent<NativeVideoViewProps>('DualViewVideoView')
    : null;

export const { DualViewMedia } = NativeModules as {
  DualViewMedia?: {
    createPhotoVariant(sourcePath: string, variant: PhotoVariant, suffix: string): Promise<string>;
    createPhotoVariantWithAspect?(sourcePath: string, suffix: string, aspectWidth: number, aspectHeight: number): Promise<string>;
    createPhotoVariantWithAspectAndFormat?(
      sourcePath: string,
      suffix: string,
      aspectWidth: number,
      aspectHeight: number,
      format: PhotoFormat,
    ): Promise<string>;
    createPhotoVariantWithAspectFormatQuality?(
      sourcePath: string,
      suffix: string,
      aspectWidth: number,
      aspectHeight: number,
      format: PhotoFormat,
      quality: number,
    ): Promise<string>;
    getMediaStoragePath?(uri: string): Promise<string>;
    createDualPhotoVariantsWithAspects?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
    ): Promise<{ mainPath: string; subPath: string }>;
    createDualPhotoVariantsWithAspectsAndFormat?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
    ): Promise<{ mainPath: string; subPath: string }>;
    createDualPhotoVariantsWithAspectsFormatQuality?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
      quality: number,
    ): Promise<{ mainPath: string; subPath: string }>;
    createVideoVariant?(
      sourcePath: string,
      variant: PhotoVariant,
      suffix: string,
      width: number,
      height: number,
      codec: VideoCodecFormat,
    ): Promise<string>;
    shareMedia?(uri: string, mimeType: string, title: string): Promise<boolean>;
  };
};
