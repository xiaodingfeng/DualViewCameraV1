import type { CoverTemplateId } from '../types/coverTemplate';

export const COVER_TEMPLATE_LABELS: Record<CoverTemplateId, string> = {
  none: '关闭',
  watermark: '照片水印',
};

export const COVER_TEMPLATE_IDS: CoverTemplateId[] = ['none', 'watermark'];
