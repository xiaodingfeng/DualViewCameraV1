import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { ConcurrentCameraCapabilityPanel } from './ConcurrentCameraCapabilityPanel';
import type { ConcurrentCameraCapability, ConcurrentCameraPair } from '../../types/concurrentCamera';

type ConcurrentCameraDebugScreenProps = {
  capability: ConcurrentCameraCapability | null;
  open: boolean;
  onClose: () => void;
};

export function ConcurrentCameraDebugScreen({
  capability,
  open,
  onClose,
}: ConcurrentCameraDebugScreenProps) {
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  const selectedPair = useMemo(
      () => capability?.pairs.find(pair => pair.id === selectedPairId) ?? capability?.pairs[0] ?? null,
      [capability?.pairs, selectedPairId],
  );

  useEffect(() => {
    if (!open) return;
    setEvents(current => appendEvent(current, 'open debug screen'));
  }, [open]);

  useEffect(() => {
    if (!open || selectedPairId != null || !capability?.pairs.length) return;
    setSelectedPairId(capability.pairs[0].id);
  }, [capability?.pairs, open, selectedPairId]);

  const handleSelectPair = (pair: ConcurrentCameraPair) => {
    setSelectedPairId(pair.id);
    setEvents(current => appendEvent(current, `select pair ${pair.primaryCameraId}+${pair.secondaryCameraId}`));
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={open}>
      <View style={debugStyles.root}>
        <View style={debugStyles.header}>
          <View>
            <Text style={debugStyles.title}>双摄并发实验</Text>
            <Text style={debugStyles.subtitle}>Debug only</Text>
          </View>
          <Pressable onPress={onClose} style={debugStyles.closeButton}>
            <Text style={debugStyles.closeText}>关闭</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={debugStyles.content}>
          <ConcurrentCameraCapabilityPanel
            capability={capability}
            selectedPairId={selectedPair?.id ?? null}
            onSelectPair={handleSelectPair}
          />

          <View style={debugStyles.previewArea}>
            <View style={debugStyles.mainPreview}>
              <Text style={debugStyles.previewTitle}>VisionCamera Multi-Camera</Text>
              <Text style={debugStyles.previewText}>
                产品模式已改用 VisionCamera 官方 Multi-Camera Session，不再加载原生 CameraX 并发预览宿主。
              </Text>
            </View>
          </View>

          <View style={debugStyles.section}>
            <Text style={debugStyles.sectionTitle}>实验说明</Text>
            <Text style={debugStyles.noteText}>
              当前页面仅保留系统并发组合探测结果。双摄并发预览与拍照由主拍摄页的 VisionCamera Multi-Camera Session 承接。
            </Text>
          </View>

          <View style={debugStyles.section}>
            <Text style={debugStyles.sectionTitle}>生命周期日志</Text>
            {events.length === 0 ? (
              <Text style={debugStyles.noteText}>暂无日志</Text>
            ) : (
              events.map((event, index) => (
                <Text key={`${event}-${index}`} style={debugStyles.logText}>
                  {event}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function appendEvent(events: string[], message: string): string[] {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return [`${time} ${message}`, ...events].slice(0, 24);
}

const debugStyles = {
  root: {
    flex: 1,
    backgroundColor: '#05070a',
  },
  header: {
    minHeight: 76,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900' as const,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 3,
  },
  closeButton: {
    minWidth: 58,
    height: 38,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  closeText: {
    color: '#ffd166',
    fontSize: 13,
    fontWeight: '900' as const,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  previewArea: {
    minHeight: 180,
    borderRadius: 10,
    overflow: 'hidden' as const,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  mainPreview: {
    flex: 1,
    minHeight: 180,
    padding: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#0b0f15',
  },
  previewTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900' as const,
  },
  previewText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center' as const,
  },
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
  noteText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 18,
  },
  logText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 19,
  },
};
