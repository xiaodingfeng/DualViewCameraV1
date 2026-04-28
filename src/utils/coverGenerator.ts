import RNFS from 'react-native-fs';

import { DualViewMedia } from '../native/dualViewMedia';
import type { CoverTemplateSettings } from '../types/coverTemplate';
import { slugify } from './camera';

function toLocalPath(path: string): string {
  return path.replace(/^file:\/\//, '');
}

function formatCoverDate(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}.${m}.${d}`;
}

export function hasPhotoWatermark(settings: CoverTemplateSettings): boolean {
  return (
    settings.templateId === 'watermark' &&
    (settings.titleWatermarkEnabled || settings.dateWatermarkEnabled || settings.infoWatermarkEnabled)
  );
}

export async function createWatermarkedPhoto(input: {
  sourcePath: string;
  settings: CoverTemplateSettings;
  title: string;
  infoText: string;
  createdAt: number;
}): Promise<string | null> {
  if (!hasPhotoWatermark(input.settings)) return null;

  const dateText = input.settings.dateWatermarkEnabled ? formatCoverDate(input.createdAt) : '';
  const titleText = input.settings.titleWatermarkEnabled ? input.title : '';
  const infoText = input.settings.infoWatermarkEnabled ? input.infoText : '';
  const sourcePath = toLocalPath(input.sourcePath);

  if (DualViewMedia?.createWatermarkedPhoto) {
    return DualViewMedia.createWatermarkedPhoto(
      sourcePath,
      slugify(input.title || 'watermark'),
      titleText,
      dateText,
      infoText,
      'watermark',
    );
  }

  const target = `${RNFS.CachesDirectoryPath}/DualViewCamera_watermark_${Date.now()}.jpg`;
  await RNFS.copyFile(sourcePath, target);
  return target;
}
