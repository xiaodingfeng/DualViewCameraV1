import type { CoverTemplateId } from '../types/coverTemplate';

export const COVER_TEMPLATE_LABELS: Record<CoverTemplateId, string> = {
  none: '关闭',
  'clean-date': '日期封面',
  'dual-card': '双画面卡片',
  'vlog-title': 'Vlog 标题',
};

export const COVER_TEMPLATE_IDS: CoverTemplateId[] = ['none', 'clean-date', 'dual-card', 'vlog-title'];
