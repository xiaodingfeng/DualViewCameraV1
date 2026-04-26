export type CoverTemplateId = 'none' | 'clean-date' | 'dual-card' | 'vlog-title';

export interface CoverTemplateSettings {
  templateId: CoverTemplateId;
  dateWatermarkEnabled: boolean;
  infoWatermarkEnabled: boolean;
  title: string;
}
