import React from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles/cameraStyles';
import type { SafetyOverlayMode } from '../types/camera';
import type { CropSpec } from '../types/composition';

export function CompositionOverlay({
  crop,
  isRecording,
  mode,
  role,
}: {
  crop: CropSpec;
  isRecording: boolean;
  mode: SafetyOverlayMode;
  role: 'main' | 'sub';
}) {
  if (mode === 'off') return null;

  const label = `${role === 'main' ? '主画面' : '副画面'} ${formatCropLabel(crop)}`;
  const strong = mode === 'strong';

  return (
    <View
      pointerEvents="none"
      style={[
        styles.compositionOverlay,
        strong && styles.compositionOverlayStrong,
        isRecording && styles.compositionOverlayRecording,
      ]}
    >
      <View style={styles.compositionCornerTopLeft} />
      <View style={styles.compositionCornerTopRight} />
      <View style={styles.compositionCornerBottomLeft} />
      <View style={styles.compositionCornerBottomRight} />
      {!isRecording && (
        <Text style={[styles.compositionLabel, strong && styles.compositionLabelStrong]}>
          {label}
        </Text>
      )}
    </View>
  );
}

function formatCropLabel(crop: CropSpec): string {
  if (crop.aspectId === 'full') return '全屏';
  if (crop.orientation === 'landscape' && crop.aspectId === '4:3') return '4:3';
  if (crop.orientation === 'landscape' && crop.aspectId === '16:9') return '16:9';
  return crop.aspectId;
}
