export type CoverTemplateId = 'none' | 'watermark';

export interface CoverTemplateSettings {
  templateId: CoverTemplateId;
  titleWatermarkEnabled: boolean;
  dateWatermarkEnabled: boolean;
  infoWatermarkEnabled: boolean;
  title: string;
}
