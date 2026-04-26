import React, { useMemo, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';

import {
  COLORS,
  PHOTO_FORMAT_CONFIG,
  PHOTO_QUALITY_CONFIG,
  VIDEO_CODEC_CONFIG,
  VIDEO_QUALITY_CONFIG,
} from '../config/camera';
import { COVER_TEMPLATE_IDS, COVER_TEMPLATE_LABELS } from '../config/coverTemplates';
import { styles } from '../styles/cameraStyles';
import type { CoverTemplateSettings } from '../types/coverTemplate';
import type { ConcurrentCameraCapability } from '../types/concurrentCamera';
import type {
  CaptureSourceMode,
  FlashMode,
  PhotoFormat,
  PhotoQuality,
  PreviewLayoutTemplateId,
  SafetyOverlayMode,
  VideoCodecFormat,
  VideoFps,
  VideoQuality,
  ViewMode,
} from '../types/camera';
import type { CameraCapabilities } from '../types/cameraCapabilities';

type SettingsTab = 'photo' | 'video' | 'about';
type LegalDocType = 'service' | 'privacy' | 'sharing' | null;
const CONCURRENT_CAMERA_PRODUCT_RENDERER_READY = true;

function SettingsModal({
  device,
  devicesCount,
  capabilities,
  captureSourceMode,
  coverTemplate,
  concurrentCameraCapability,
  flashMode,
  onCaptureSourceModeChange,
  onClose,
  onCoverTemplateChange,
  onFlashModeChange,
  onOpenConcurrentCameraDebug,
  open,
  photoFormat,
  onPhotoFormatChange,
  photoQuality,
  onPhotoQualityChange,
  saveDualOutputs,
  safetyOverlayMode,
  onSafetyOverlayModeChange,
  previewLayoutTemplate,
  onPreviewLayoutTemplateChange,
  setSaveDualOutputs,
  shutterSoundEnabled,
  onShutterSoundEnabledChange,
  videoFps,
  videoFpsOptions,
  onVideoFpsChange,
  videoCodec,
  onVideoCodecChange,
  videoQuality,
  onVideoQualityChange,
  viewMode,
}: {
  device: CameraDevice | null;
  devicesCount: number;
  capabilities: CameraCapabilities;
  captureSourceMode: CaptureSourceMode;
  coverTemplate: CoverTemplateSettings;
  concurrentCameraCapability: ConcurrentCameraCapability | null;
  flashMode: FlashMode;
  onCaptureSourceModeChange: (value: CaptureSourceMode) => void;
  onClose: () => void;
  onCoverTemplateChange: (value: CoverTemplateSettings) => void;
  onFlashModeChange: (mode: FlashMode) => void;
  onOpenConcurrentCameraDebug: () => void;
  open: boolean;
  photoFormat: PhotoFormat;
  onPhotoFormatChange: (value: PhotoFormat) => void;
  photoQuality: PhotoQuality;
  onPhotoQualityChange: (value: PhotoQuality) => void;
  saveDualOutputs: boolean;
  safetyOverlayMode: SafetyOverlayMode;
  onSafetyOverlayModeChange: (value: SafetyOverlayMode) => void;
  previewLayoutTemplate: PreviewLayoutTemplateId;
  onPreviewLayoutTemplateChange: (value: PreviewLayoutTemplateId) => void;
  setSaveDualOutputs: (value: boolean) => void;
  shutterSoundEnabled: boolean;
  onShutterSoundEnabledChange: (value: boolean) => void;
  videoFps: VideoFps;
  videoFpsOptions: VideoFps[];
  onVideoFpsChange: (value: VideoFps) => void;
  videoCodec: VideoCodecFormat;
  onVideoCodecChange: (value: VideoCodecFormat) => void;
  videoQuality: VideoQuality;
  onVideoQualityChange: (value: VideoQuality) => void;
  viewMode: ViewMode;
}) {
  const [tab, setTab] = useState<SettingsTab>('photo');
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);
  const concurrentSystemAvailable = concurrentCameraCapability?.supported === true && concurrentCameraCapability.pairs.length > 0;
  const concurrentAvailable = concurrentSystemAvailable && CONCURRENT_CAMERA_PRODUCT_RENDERER_READY;

  React.useEffect(() => {
    if (open) {
      setTab('photo');
      setLegalDoc(null);
    }
  }, [open]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      if (legalDoc) return false;
      return gestureState.dy > 15 && Math.abs(gestureState.dx) < 15;
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 80 || gestureState.vy > 0.5) onClose();
    },
  }), [legalDoc, onClose]);

  const currentLegal = renderLegalContent(legalDoc);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.settingsPanel, { height: 600, maxHeight: 600 }]} {...panResponder.panHandlers}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Text style={styles.closeText}>完成</Text>
            </Pressable>
          </View>
          <View style={styles.settingsTabs}>
            <Pressable style={[styles.settingsTab, tab === 'photo' && styles.settingsTabActive]} onPress={() => setTab('photo')}>
              <Text style={[styles.settingsTabText, tab === 'photo' && styles.settingsTabTextActive]}>拍照</Text>
            </Pressable>
            <Pressable style={[styles.settingsTab, tab === 'video' && styles.settingsTabActive]} onPress={() => setTab('video')}>
              <Text style={[styles.settingsTabText, tab === 'video' && styles.settingsTabTextActive]}>录像</Text>
            </Pressable>
            <Pressable style={[styles.settingsTab, tab === 'about' && styles.settingsTabActive]} onPress={() => setTab('about')}>
              <Text style={[styles.settingsTabText, tab === 'about' && styles.settingsTabTextActive]}>关于</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {tab === 'photo' ? (
              <>
                <CaptureSourceSection
                  captureSourceMode={captureSourceMode}
                  concurrentAvailable={concurrentAvailable}
                  concurrentCameraCapability={concurrentCameraCapability}
                  concurrentSystemAvailable={concurrentSystemAvailable}
                  onCaptureSourceModeChange={onCaptureSourceModeChange}
                />
                <SettingsSection title="照片质量">
                  {(['high', 'standard', 'low'] as PhotoQuality[]).map(value => (
                    <Chip key={value} active={photoQuality === value} label={PHOTO_QUALITY_CONFIG[value].label} onPress={() => onPhotoQualityChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="快门声音">
                  <Chip active={!shutterSoundEnabled} label="关闭" onPress={() => onShutterSoundEnabledChange(false)} />
                  <Chip active={shutterSoundEnabled} label="开启" onPress={() => onShutterSoundEnabledChange(true)} />
                </SettingsSection>
                <SettingsSection title="照片格式">
                  {(['jpeg', 'heic'] as PhotoFormat[]).map(value => (
                    <Chip key={value} active={photoFormat === value} disabled={!capabilities.photoFormats[value]} label={PHOTO_FORMAT_CONFIG[value].label} onPress={() => onPhotoFormatChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="闪光灯">
                  <Chip active={flashMode === 'off'} label="关闭" onPress={() => onFlashModeChange('off')} />
                  <Chip active={flashMode === 'auto'} disabled={!capabilities.flash.auto} label="自动" onPress={() => onFlashModeChange('auto')} />
                  <Chip active={flashMode === 'on'} disabled={!capabilities.flash.on} label="开启" onPress={() => onFlashModeChange('on')} />
                </SettingsSection>
                <SafetyOverlaySection safetyOverlayMode={safetyOverlayMode} onSafetyOverlayModeChange={onSafetyOverlayModeChange} />
                <SettingsSection title="封面水印">
                  <TextInput
                    maxLength={28}
                    onChangeText={text => onCoverTemplateChange({ ...coverTemplate, title: text })}
                    placeholder="封面标题"
                    placeholderTextColor={COLORS.muted}
                    style={styles.settingsTextInput}
                    value={coverTemplate.title}
                  />
                  {COVER_TEMPLATE_IDS.map(value => (
                    <Chip key={value} active={coverTemplate.templateId === value} label={COVER_TEMPLATE_LABELS[value]} onPress={() => onCoverTemplateChange({ ...coverTemplate, templateId: value })} />
                  ))}
                  <Chip active={coverTemplate.dateWatermarkEnabled} label="日期水印" onPress={() => onCoverTemplateChange({ ...coverTemplate, dateWatermarkEnabled: !coverTemplate.dateWatermarkEnabled })} />
                  <Chip active={coverTemplate.infoWatermarkEnabled} label="参数水印" onPress={() => onCoverTemplateChange({ ...coverTemplate, infoWatermarkEnabled: !coverTemplate.infoWatermarkEnabled })} />
                </SettingsSection>
              </>
            ) : tab === 'video' ? (
              <>
                <CaptureSourceSection
                  captureSourceMode={captureSourceMode}
                  concurrentAvailable={concurrentAvailable}
                  concurrentCameraCapability={concurrentCameraCapability}
                  concurrentSystemAvailable={concurrentSystemAvailable}
                  onCaptureSourceModeChange={onCaptureSourceModeChange}
                />
                <SettingsSection title="默认帧率">
                  {([30, 60] as VideoFps[]).map(value => (
                    <Chip key={value} active={videoFps === value} disabled={!videoFpsOptions.includes(value) || !capabilities.videoFps[value]} label={`${value}HZ`} onPress={() => onVideoFpsChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="默认画质">
                  {(['720', '1080', '4K', '8K'] as VideoQuality[]).map(value => (
                    <Chip key={value} active={videoQuality === value} disabled={!capabilities.videoQualities[value]} label={VIDEO_QUALITY_CONFIG[value].label} onPress={() => onVideoQualityChange(value)} />
                  ))}
                </SettingsSection>
                <SettingsSection title="编码格式">
                  {(['h265', 'h264'] as VideoCodecFormat[]).map(value => (
                    <Chip key={value} active={videoCodec === value} disabled={!capabilities.videoCodecs[value]} label={VIDEO_CODEC_CONFIG[value].label} onPress={() => onVideoCodecChange(value)} />
                  ))}
                </SettingsSection>
                <SafetyOverlaySection safetyOverlayMode={safetyOverlayMode} onSafetyOverlayModeChange={onSafetyOverlayModeChange} />
              </>
            ) : (
              <>
                <SettingsSection title="软件信息">
                  <Text style={styles.aboutAppTitle}>Agile</Text>
                  <Text style={styles.aboutVersion}>版本：1.0.0 (Build 20260419)</Text>
                  <Text style={[styles.settingLine, { marginTop: 8 }]}>Agile 是一款本地相机工具，支持同源双画面构图输出，并在设备支持时开放双摄并发高级模式。</Text>
                </SettingsSection>
                <SettingsSection title="合规指引">
                  <LegalLink label="服务使用协议" onPress={() => setLegalDoc('service')} />
                  <LegalLink label="隐私保护政策" onPress={() => setLegalDoc('privacy')} />
                  <LegalLink label="第三方信息共享清单" onPress={() => setLegalDoc('sharing')} />
                </SettingsSection>
              </>
            )}

            {(tab === 'photo' || tab === 'video') && (
              <SettingsSection title="双画面">
                <Chip active={viewMode === 'dual'} label="双画面预览已开启" />
                <Chip active={saveDualOutputs} label="双画面同时保存" onPress={() => setSaveDualOutputs(!saveDualOutputs)} />
                {PREVIEW_LAYOUT_TEMPLATES.map(item => (
                  <Chip
                    key={item.id}
                    active={previewLayoutTemplate === item.id}
                    label={item.label}
                    onPress={() => onPreviewLayoutTemplateChange(item.id)}
                  />
                ))}
              </SettingsSection>
            )}

            {tab === 'about' && (
              <>
                <SettingsSection title="开发者">
                  <Text style={styles.settingLine}>Copyright 2026 Agile Dev Team.</Text>
                  <Text style={styles.settingLine}>基于 Vision Camera 5.0 构建</Text>
                </SettingsSection>
                <SettingsSection title="设备能力">
                  <Text style={styles.settingLine}>镜头数量：{devicesCount}</Text>
                  <Text style={styles.settingLine}>缩放范围：{device?.minZoom?.toFixed(1)}x ~ {device?.maxZoom?.toFixed(1)}x</Text>
                </SettingsSection>
                <SettingsSection title="双摄并发">
                  <Text style={styles.settingLine}>{concurrentCameraStatusText(concurrentCameraCapability)}</Text>
                  {concurrentCameraCapability?.pairs.map(pair => (
                    <Text key={pair.id} style={styles.settingLine}>
                      {pair.primaryFacing}:{pair.primaryCameraId} + {pair.secondaryFacing}:{pair.secondaryCameraId}
                    </Text>
                  ))}
                  <Chip label="打开诊断页" onPress={onOpenConcurrentCameraDebug} />
                </SettingsSection>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>

          {legalDoc && currentLegal && (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#151515', borderRadius: 24, zIndex: 100, padding: 18 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 4 }}>
                <Pressable onPress={() => setLegalDoc(null)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: COLORS.accent, fontSize: 24, fontWeight: '300', marginTop: -4 }}>‹</Text>
                </Pressable>
                <Text style={[styles.settingsTitle, { marginLeft: 12, flex: 1 }]}>{currentLegal.title}</Text>
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
                <Text style={[styles.legalContentText, { fontSize: 14, color: '#aaa' }]}>{currentLegal.content}</Text>
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function CaptureSourceSection({
  captureSourceMode,
  concurrentAvailable,
  concurrentCameraCapability,
  concurrentSystemAvailable,
  onCaptureSourceModeChange,
}: {
  captureSourceMode: CaptureSourceMode;
  concurrentAvailable: boolean;
  concurrentCameraCapability: ConcurrentCameraCapability | null;
  concurrentSystemAvailable: boolean;
  onCaptureSourceModeChange: (value: CaptureSourceMode) => void;
}) {
  return (
    <SettingsSection title="拍摄源">
      <Chip
        active={captureSourceMode === 'same-camera-crop'}
        label="同源双画面"
        onPress={() => onCaptureSourceModeChange('same-camera-crop')}
      />
      <Chip
        active={captureSourceMode === 'concurrent-cameras'}
        disabled={!concurrentAvailable}
        label="双摄并发"
        onPress={() => onCaptureSourceModeChange('concurrent-cameras')}
      />
      <Text style={styles.settingLine}>
        {concurrentSystemAvailable && !concurrentAvailable
          ? '系统返回双摄组合，但 VisionCamera Multi-Camera 设备未就绪；主功能暂保持同源双画面。'
          : concurrentCameraStatusText(concurrentCameraCapability)}
      </Text>
    </SettingsSection>
  );
}

function SafetyOverlaySection({
  safetyOverlayMode,
  onSafetyOverlayModeChange,
}: {
  safetyOverlayMode: SafetyOverlayMode;
  onSafetyOverlayModeChange: (value: SafetyOverlayMode) => void;
}) {
  return (
    <SettingsSection title="构图安全框">
      {(['off', 'subtle', 'strong'] as SafetyOverlayMode[]).map(value => (
        <Chip key={value} active={safetyOverlayMode === value} label={SAFETY_OVERLAY_LABELS[value]} onPress={() => onSafetyOverlayModeChange(value)} />
      ))}
    </SettingsSection>
  );
}

function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.legalLink} onPress={onPress}>
      <Text style={styles.legalLinkText}>{label}</Text>
      <Text style={styles.legalArrow}>›</Text>
    </Pressable>
  );
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({ active = false, disabled = false, label, onPress }: { active?: boolean; disabled?: boolean; label: string; onPress?: () => void }) {
  return (
    <Pressable disabled={disabled || onPress == null} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const SAFETY_OVERLAY_LABELS: Record<SafetyOverlayMode, string> = {
  off: '关闭',
  subtle: '轻量',
  strong: '明显',
};

const PREVIEW_LAYOUT_TEMPLATES: Array<{ id: PreviewLayoutTemplateId; label: string }> = [
  { id: 'pip', label: '画中画' },
  { id: 'split-horizontal', label: '左右分屏' },
  { id: 'split-vertical', label: '上下分屏' },
  { id: 'stack', label: '主图+副条' },
];

function concurrentCameraStatusText(capability: ConcurrentCameraCapability | null): string {
  if (capability == null) return '正在探测设备双摄并发能力';
  if (capability.supported) return `当前设备发现 ${capability.pairs.length} 组并发相机组合，可作为高级拍摄源`;
  switch (capability.reason) {
    case 'api-too-low':
      return '当前 Android 版本低于 11，系统不开放双摄并发能力';
    case 'feature-missing':
      return '当前设备未声明 FEATURE_CAMERA_CONCURRENT，不能启用双摄并发';
    case 'no-camera-pairs':
      return '系统未返回可用的双摄并发组合';
    case 'camerax-unavailable':
      return '系统双摄并发能力暂不可用';
    default:
      return '双摄并发能力探测失败';
  }
}

function renderLegalContent(legalDoc: LegalDocType): { title: string; content: string } | null {
  switch (legalDoc) {
    case 'service':
      return {
        title: '服务使用协议',
        content:
          '欢迎使用 Agile。\n\n1. 本软件用于本地拍照、录像和双画面构图输出。\n2. 用户应对拍摄内容承担相应责任，不得用于侵犯他人隐私或违反法律法规的场景。\n3. 拍摄结果默认保存在设备本地 DCIM/DualViewCamera 目录。\n4. 因设备硬件、系统能力或权限状态导致的拍摄失败，请以应用内提示和系统设置为准。',
      };
    case 'privacy':
      return {
        title: '隐私保护政策',
        content:
          'Agile 优先作为本地工具运行。\n\n1. 相机权限用于实时取景、拍照和录像。\n2. 麦克风权限仅用于录像收音。\n3. 位置信息仅在用户授权后写入照片和视频的本地元数据。\n4. 应用不会主动上传照片、视频或位置数据到云端。',
      };
    case 'sharing':
      return {
        title: '第三方信息共享清单',
        content:
          '当前版本使用 React Native、Vision Camera、CameraRoll 和 React Native FS 等本地 SDK 实现相机、相册和文件处理能力。这些能力用于设备本地运行，不代表向第三方服务器共享用户媒体或身份信息。',
      };
    default:
      return null;
  }
}

export { SettingsModal };
