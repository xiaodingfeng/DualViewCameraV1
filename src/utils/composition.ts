import type { FrameOrientation } from '../types/camera';
import type {
  BuildCompositionSceneInput,
  CompositionOutputKind,
  CompositionOutputSpec,
  CompositionRole,
  CropSpec,
} from '../types/composition';
import { visibleFrameSpec } from './camera';

function buildCropSpec(
  orientation: FrameOrientation,
  selectedAspect: BuildCompositionSceneInput['selectedAspect'],
  fullPortraitAspect: number,
): CropSpec {
  return {
    aspectId: selectedAspect.id,
    orientation,
    ...visibleFrameSpec(orientation, selectedAspect, fullPortraitAspect),
  };
}

function buildOutput(
  role: CompositionRole,
  kind: CompositionOutputKind,
  crop: CropSpec,
  enabled: boolean,
): CompositionOutputSpec {
  return {
    id: `${role}-${kind}`,
    role,
    kind,
    crop,
    enabled,
  };
}

export function buildCompositionScene(input: BuildCompositionSceneInput) {
  const displayPrimaryOrientation: FrameOrientation = 'portrait';
  const displaySecondaryOrientation: FrameOrientation = 'landscape';
  const savePrimaryOrientation: FrameOrientation = input.isDeviceLandscape
    ? 'landscape'
    : 'portrait';
  const saveSecondaryOrientation: FrameOrientation = input.isDeviceLandscape
    ? 'portrait'
    : 'landscape';

  const mainDisplayOrientation: FrameOrientation =
    input.viewMode === 'dual'
      ? input.isSwapped
        ? displaySecondaryOrientation
        : displayPrimaryOrientation
      : displayPrimaryOrientation;

  const subDisplayOrientation: FrameOrientation =
    input.viewMode === 'dual'
      ? input.isSwapped
        ? displayPrimaryOrientation
        : displaySecondaryOrientation
      : displaySecondaryOrientation;

  const saveMainOrientation: FrameOrientation =
    input.viewMode === 'dual'
      ? input.isSwapped
        ? saveSecondaryOrientation
        : savePrimaryOrientation
      : savePrimaryOrientation;

  const saveSubOrientation: FrameOrientation =
    input.viewMode === 'dual'
      ? input.isSwapped
        ? savePrimaryOrientation
        : saveSecondaryOrientation
      : saveSecondaryOrientation;

  const mainDisplay = buildCropSpec(
    mainDisplayOrientation,
    input.selectedAspect,
    input.fullMainAspect,
  );
  const subDisplay = buildCropSpec(
    subDisplayOrientation,
    input.selectedAspect,
    3 / 4,
  );
  const mainSave = buildCropSpec(
    saveMainOrientation,
    input.selectedAspect,
    input.fullMainAspect,
  );
  const subSave = buildCropSpec(saveSubOrientation, input.selectedAspect, 3 / 4);

  return {
    id: `${input.viewMode}-${input.isSwapped ? 'swapped' : 'normal'}`,
    layoutId: input.viewMode === 'dual' ? 'pip' : 'single',
    source: 'same-camera',
    isSwapped: input.isSwapped,
    display: {
      main: mainDisplay,
      sub: input.viewMode === 'dual' ? subDisplay : undefined,
    },
    save: {
      main: mainSave,
      sub: subSave,
    },
    outputs: [
      buildOutput('main', 'photo', mainSave, true),
      buildOutput(
        'sub',
        'photo',
        subSave,
        input.viewMode === 'dual' && input.saveDualOutputs,
      ),
      buildOutput('main', 'video', mainSave, true),
      buildOutput(
        'sub',
        'video',
        subSave,
        input.viewMode === 'dual' && input.saveDualOutputs,
      ),
    ],
  } as const;
}
