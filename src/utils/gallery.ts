import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';

import { DualViewMedia } from '../native/dualViewMedia';
import type {
  GalleryMedia,
  LastMedia,
  PhotoFormat,
  PhotoVariant,
  VideoCodecFormat,
  VisibleFrameSpec,
} from '../types/camera';
import { slugify } from './camera';

export async function requestGalleryReadPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const version = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
  try {
    if (version >= 33) {
      const permissions = [
        (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_IMAGES,
        (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_VIDEO,
      ].filter(Boolean) as string[];
      if (permissions.length === 0) return true;
      const result = (await PermissionsAndroid.requestMultiple(permissions as any)) as Record<string, string>;
      return permissions.every(permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
    }
    const permission = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    const granted = await PermissionsAndroid.request(permission);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function loadDualViewGallery(): Promise<GalleryMedia[]> {
  const hasPermission = await requestGalleryReadPermission();
  if (!hasPermission) return [];
  try {
    const result = await CameraRoll.getPhotos({
      first: 80,
      assetType: 'All',
      groupTypes: 'Album',
      groupName: 'DualViewCamera',
      include: ['filename', 'fileSize', 'imageSize', 'playableDuration'],
    });
    const items = result.edges.map(cameraRollNodeToGalleryMedia).filter(Boolean) as GalleryMedia[];
    if (!DualViewMedia?.getMediaStoragePath) return items;

    const getMediaStoragePath = DualViewMedia?.getMediaStoragePath;
    return Promise.all(
      items.map(async item => {
        if (!getMediaStoragePath) return item;
        try {
          const filepath = await getMediaStoragePath(item.uri);
          return filepath ? { ...item, filepath } : item;
        } catch {
          return item;
        }
      }),
    );
  } catch {
    return [];
  }
}

export function cameraRollNodeToGalleryMedia(asset: any): GalleryMedia | null {
  const node = asset?.node;
  const image = node?.image;
  if (!node || !image?.uri) return null;
  const rawType = String(node.type ?? '');
  const type: 'photo' | 'video' =
    rawType.toLowerCase().includes('video') || image.playableDuration > 0 ? 'video' : 'photo';

  return {
    id: String(node.id ?? image.uri),
    uri: image.uri,
    filepath: image.filepath ?? null,
    type,
    filename: image.filename ?? null,
    fileSize: typeof image.fileSize === 'number' ? image.fileSize : null,
    width: Number(image.width ?? 0),
    height: Number(image.height ?? 0),
    duration: Number(image.playableDuration ?? 0),
    timestamp: Number(node.timestamp ?? node.modificationTimestamp ?? 0),
  };
}

export function mediaToLastMedia(item: GalleryMedia | null): LastMedia {
  if (item == null) return null;
  return {
    uri: item.uri,
    type: item.type,
    label: item.filename ?? (item.type === 'photo' ? '照片' : '视频'),
  };
}

export function mimeTypeForMedia(item: GalleryMedia): string {
  const filename = item.filename?.toLowerCase() ?? item.uri.toLowerCase();
  if (item.type === 'video') return 'video/mp4';
  if (filename.endsWith('.heic') || filename.endsWith('.heif')) return 'image/heif';
  if (filename.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export function toLocalPath(path: string): string {
  return path.replace(/^file:\/\//, '');
}

export async function ensureVideoExtension(filePath: string, label: string): Promise<string> {
  const source = toLocalPath(filePath);
  if (/\.(mp4|m4v|mov|3gp)$/i.test(source)) return source;
  const target = `${RNFS.CachesDirectoryPath}/DualViewCamera_${slugify(label)}_${Date.now()}.mp4`;
  await RNFS.copyFile(source, target);
  return target;
}

export async function createPhotoVariant(filePath: string, variant: PhotoVariant, suffix: string): Promise<string> {
  if (variant === 'full' || !DualViewMedia?.createPhotoVariant) return toLocalPath(filePath);
  return DualViewMedia.createPhotoVariant(toLocalPath(filePath), variant, slugify(suffix));
}

export async function createPhotoVariantForAspect(
  filePath: string,
  spec: VisibleFrameSpec,
  suffix: string,
  format: PhotoFormat = 'jpeg',
  quality = 94,
): Promise<string> {
  if (DualViewMedia?.createPhotoVariantWithAspectFormatQuality) {
    return DualViewMedia.createPhotoVariantWithAspectFormatQuality(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
      format,
      quality,
    );
  }
  if (DualViewMedia?.createPhotoVariantWithAspectAndFormat) {
    return DualViewMedia.createPhotoVariantWithAspectAndFormat(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
      format,
    );
  }
  if (DualViewMedia?.createPhotoVariantWithAspect) {
    return DualViewMedia.createPhotoVariantWithAspect(
      toLocalPath(filePath),
      slugify(`${suffix}_${spec.variant}`),
      Math.round(spec.aspect * 10000),
      10000,
    );
  }
  return createPhotoVariant(filePath, spec.variant, suffix);
}

export async function createDualPhotoVariantsForAspects(
  filePath: string,
  mainSpec: VisibleFrameSpec,
  subSpec: VisibleFrameSpec,
  format: PhotoFormat = 'jpeg',
  quality = 94,
): Promise<{ mainPath: string; subPath: string }> {
  if (DualViewMedia?.createDualPhotoVariantsWithAspectsFormatQuality) {
    return DualViewMedia.createDualPhotoVariantsWithAspectsFormatQuality(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
      format,
      quality,
    );
  }
  if (DualViewMedia?.createDualPhotoVariantsWithAspectsAndFormat) {
    return DualViewMedia.createDualPhotoVariantsWithAspectsAndFormat(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
      format,
    );
  }
  if (DualViewMedia?.createDualPhotoVariantsWithAspects) {
    return DualViewMedia.createDualPhotoVariantsWithAspects(
      toLocalPath(filePath),
      slugify(`main_${mainSpec.variant}`),
      Math.round(mainSpec.aspect * 10000),
      10000,
      slugify(`sub_${subSpec.variant}`),
      Math.round(subSpec.aspect * 10000),
      10000,
    );
  }
  const [mainPath, subPath] = await Promise.all([
    createPhotoVariantForAspect(filePath, mainSpec, 'main'),
    createPhotoVariantForAspect(filePath, subSpec, 'sub'),
  ]);
  return { mainPath, subPath };
}

export async function createVideoVariant(
  filePath: string,
  variant: PhotoVariant,
  suffix: string,
  targetSize: { width: number; height: number },
  codec: VideoCodecFormat = 'h265',
): Promise<string> {
  if (!DualViewMedia?.createVideoVariant) return toLocalPath(filePath);
  return DualViewMedia.createVideoVariant(
    toLocalPath(filePath),
    variant,
    slugify(suffix),
    targetSize.width,
    targetSize.height,
    codec,
  );
}
