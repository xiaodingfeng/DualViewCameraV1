import type {
  AspectRatioId,
  FrameOrientation,
  PhotoVariant,
  ViewMode,
  VisibleFrameSpec,
} from './camera';

export type CompositionAspectId = AspectRatioId | '3:4' | '9:16';
export type CompositionRole = 'main' | 'sub' | 'cover' | 'source';
export type CompositionLayoutId =
  | 'single'
  | 'pip'
  | 'split-horizontal'
  | 'split-vertical'
  | 'stack';
export type CompositionOutputKind = 'photo' | 'video' | 'cover';
export type CompositionFrameOrientation = FrameOrientation;

export interface CropSpec extends VisibleFrameSpec {
  aspectId: AspectRatioId;
  orientation: CompositionFrameOrientation;
  variant: PhotoVariant;
}

export interface CompositionOutputSpec {
  id: string;
  role: CompositionRole;
  kind: CompositionOutputKind;
  crop: CropSpec;
  enabled: boolean;
}

export interface CompositionScene {
  id: string;
  layoutId: CompositionLayoutId;
  source: 'same-camera';
  isSwapped: boolean;
  display: {
    main: CropSpec;
    sub?: CropSpec;
  };
  save: {
    main: CropSpec;
    sub: CropSpec;
  };
  outputs: CompositionOutputSpec[];
}

export interface CompositionAspectOption {
  id: AspectRatioId;
  previewAspect?: number;
  photoVariant: PhotoVariant;
}

export interface BuildCompositionSceneInput {
  viewMode: ViewMode;
  selectedAspect: CompositionAspectOption;
  isSwapped: boolean;
  isDeviceLandscape: boolean;
  fullMainAspect: number;
  saveDualOutputs: boolean;
}
