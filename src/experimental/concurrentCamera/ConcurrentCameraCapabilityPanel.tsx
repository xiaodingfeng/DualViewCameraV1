import React from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ConcurrentCameraCapability, ConcurrentCameraPair } from '../../types/concurrentCamera';

type ConcurrentCameraCapabilityPanelProps = {
  capability: ConcurrentCameraCapability | null;
  selectedPairId: string | null;
  onSelectPair: (pair: ConcurrentCameraPair) => void;
};

export function ConcurrentCameraCapabilityPanel({
  capability,
  selectedPairId,
  onSelectPair,
}: ConcurrentCameraCapabilityPanelProps) {
  if (capability == null) {
    return (
      <View style={panelStyles.section}>
        <Text style={panelStyles.sectionTitle}>能力探测</Text>
        <Text style={panelStyles.mutedText}>正在读取系统并发相机能力</Text>
      </View>
    );
  }

  const diagnostics = (
    <>
      <Text style={panelStyles.mutedText}>Android API: {capability.androidApiLevel ?? 'unknown'}</Text>
      <Text style={panelStyles.mutedText}>
        FEATURE_CAMERA_CONCURRENT: {capability.hasConcurrentFeature ? 'true' : 'false'}
      </Text>
      <Text style={panelStyles.mutedText}>
        Camera IDs: {capability.cameras?.map(camera => `${camera.facing}:${camera.id}`).join(', ') || 'none'}
      </Text>
    </>
  );

  if (!capability.supported) {
    return (
      <View style={panelStyles.section}>
        <Text style={panelStyles.sectionTitle}>能力探测</Text>
        {diagnostics}
        <Text style={panelStyles.mutedText}>{reasonText(capability.reason)}</Text>
      </View>
    );
  }

  return (
    <View style={panelStyles.section}>
      <Text style={panelStyles.sectionTitle}>可用组合</Text>
      {diagnostics}
      {capability.pairs.map(pair => {
        const selected = selectedPairId === pair.id;
        return (
          <Pressable
            key={pair.id}
            onPress={() => onSelectPair(pair)}
            style={[panelStyles.pairCard, selected && panelStyles.pairCardSelected]}>
            <Text style={panelStyles.pairTitle}>
              {pair.primaryFacing}:{pair.primaryCameraId} + {pair.secondaryFacing}:{pair.secondaryCameraId}
            </Text>
            <Text style={panelStyles.mutedText}>
              UseCase: {pair.supportedUseCases.join(', ')}
            </Text>
            <Text style={panelStyles.mutedText}>
              CompositionSettings: {pair.supportsCompositionSettings ? 'supported' : 'not detected'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function reasonText(reason: ConcurrentCameraCapability['reason']): string {
  switch (reason) {
    case 'api-too-low':
      return '当前 Android 版本不支持并发相机能力。';
    case 'feature-missing':
      return '当前设备未声明并发相机系统能力。';
    case 'no-camera-pairs':
      return '系统未返回可用并发相机组合。';
    case 'camerax-unavailable':
      return 'CameraX 并发能力暂不可用。';
    default:
      return '并发相机能力探测失败。';
  }
}

const panelStyles = {
  section: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#1e1e1e',
    gap: 8,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900' as const,
  },
  mutedText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 18,
  },
  pairCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111111',
    gap: 4,
  },
  pairCardSelected: {
    borderColor: '#ffd166',
    backgroundColor: 'rgba(255,209,102,0.12)',
  },
  pairTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900' as const,
  },
};
