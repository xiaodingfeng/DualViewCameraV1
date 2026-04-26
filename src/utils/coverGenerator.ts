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

export async function createCoverForPhoto(input: {
  sourcePath: string;
  settings: CoverTemplateSettings;
  title: string;
  infoText: string;
  createdAt: number;
}): Promise<string | null> {
  if (input.settings.templateId === 'none') return null;

  const dateText = input.settings.dateWatermarkEnabled ? formatCoverDate(input.createdAt) : '';
  const infoText = input.settings.infoWatermarkEnabled ? input.infoText : '';
  const sourcePath = toLocalPath(input.sourcePath);

  if (DualViewMedia?.createWatermarkedCover) {
    return DualViewMedia.createWatermarkedCover(
      sourcePath,
      slugify(input.title || 'cover'),
      input.title,
      dateText,
      infoText,
      input.settings.templateId,
    );
  }

  const target = `${RNFS.CachesDirectoryPath}/DualViewCamera_cover_${Date.now()}.jpg`;
  await RNFS.copyFile(sourcePath, target);
  return target;
}
