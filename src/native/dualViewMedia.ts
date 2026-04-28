import { NativeModules, Platform, requireNativeComponent } from 'react-native';

import type {
  ConcurrentCompositeLayout,
  NativeVideoViewProps,
  PhotoFormat,
  PhotoVariant,
  VideoCodecFormat,
} from '../types/camera';
import type { CoverTemplateId } from '../types/coverTemplate';

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
    createPhotoVariantWithAspectFormatQualityAndMirror?(
      sourcePath: string,
      suffix: string,
      aspectWidth: number,
      aspectHeight: number,
      format: PhotoFormat,
      quality: number,
      mirror: boolean,
    ): Promise<string>;
    createPhotoVariantWithAspectFormatQualityMirrorAndRotate?(
      sourcePath: string,
      suffix: string,
      aspectWidth: number,
      aspectHeight: number,
      format: PhotoFormat,
      quality: number,
      mirror: boolean,
      rotateLandscapeFallback: boolean,
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
    createDualPhotoVariantsWithAspectsFormatQualityAndMirror?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
      quality: number,
      mirror: boolean,
    ): Promise<{ mainPath: string; subPath: string }>;
    createDualPhotoVariantsWithAspectsFormatQualityMirrorAndRotate?(
      sourcePath: string,
      mainSuffix: string,
      mainAspectWidth: number,
      mainAspectHeight: number,
      subSuffix: string,
      subAspectWidth: number,
      subAspectHeight: number,
      format: PhotoFormat,
      quality: number,
      mirror: boolean,
      mainRotateLandscapeFallback: boolean,
      subRotateLandscapeFallback: boolean,
    ): Promise<{ mainPath: string; subPath: string }>;
    createVideoVariant?(
      sourcePath: string,
      variant: PhotoVariant,
      suffix: string,
      width: number,
      height: number,
      codec: VideoCodecFormat,
    ): Promise<string>;
    createVideoVariantWithMirror?(
      sourcePath: string,
      variant: PhotoVariant,
      suffix: string,
      width: number,
      height: number,
      codec: VideoCodecFormat,
      mirror: boolean,
    ): Promise<string>;
    createVideoVariantWithMirrorAndRotate?(
      sourcePath: string,
      variant: PhotoVariant,
      suffix: string,
      width: number,
      height: number,
      codec: VideoCodecFormat,
      mirror: boolean,
      rotateLandscapeFallback: boolean,
    ): Promise<string>;
    createConcurrentCompositePhoto?(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: ConcurrentCompositeLayout,
      format: PhotoFormat,
      quality: number,
    ): Promise<string>;
    createConcurrentCompositePhotoWithPip?(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: ConcurrentCompositeLayout,
      pipLeftRatio: number,
      pipTopRatio: number,
      pipScale: 'small' | 'medium' | 'large',
      isPortrait: boolean,
      format: PhotoFormat,
      quality: number,
    ): Promise<string>;
    createConcurrentCompositeVideo?(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: ConcurrentCompositeLayout,
      codec: VideoCodecFormat,
    ): Promise<string>;
    createConcurrentCompositeVideoWithPip?(
      mainPath: String,
      subPath: String,
      suffix: String,
      layout: ConcurrentCompositeLayout,
      pipLeftRatio: number,
      pipTopRatio: number,
      pipScale: 'small' | 'medium' | 'large',
      isPortrait: boolean,
      codec: VideoCodecFormat,
    ): Promise<string>;
    createWatermarkedCover?(
      sourcePath: string,
      suffix: string,
      title: string,
      dateText: string,
      infoText: string,
      templateId: CoverTemplateId,
    ): Promise<string>;
    deleteMedia?(uri: string): Promise<boolean>;
    shareMedia?(uri: string, mimeType: string, title: string): Promise<boolean>;
  };
};
