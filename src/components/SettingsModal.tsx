import React, { useMemo, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';

import {
  COLORS,
  PHOTO_FORMAT_CONFIG,
  PHOTO_QUALITY_CONFIG,
  VIDEO_CODEC_CONFIG,
  VIDEO_QUALITY_CONFIG,
} from '../config/camera';
import { styles } from '../styles/cameraStyles';
import type {
  FlashMode,
  PhotoFormat,
  PhotoQuality,
  SafetyOverlayMode,
  VideoCodecFormat,
  VideoFps,
  VideoQuality,
  ViewMode,
} from '../types/camera';
import type { CameraCapabilities } from '../types/cameraCapabilities';

type SettingsTab = 'photo' | 'video' | 'about';
type LegalDocType = 'service' | 'privacy' | 'sharing' | null;

function SettingsModal({
  device,
  devicesCount,
  capabilities,
  flashMode,
  onClose,
  onFlashModeChange,
  open,
  photoFormat,
  onPhotoFormatChange,
  photoQuality,
  onPhotoQualityChange,
  saveDualOutputs,
  safetyOverlayMode,
  onSafetyOverlayModeChange,
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
  flashMode: FlashMode;
  onClose: () => void;
  onFlashModeChange: (mode: FlashMode) => void;
  open: boolean;
  photoFormat: PhotoFormat;
  onPhotoFormatChange: (value: PhotoFormat) => void;
  photoQuality: PhotoQuality;
  onPhotoQualityChange: (value: PhotoQuality) => void;
  saveDualOutputs: boolean;
  safetyOverlayMode: SafetyOverlayMode;
  onSafetyOverlayModeChange: (value: SafetyOverlayMode) => void;
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

  // Reset tab to photo whenever modal is opened
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
      if (gestureState.dy > 80 || gestureState.vy > 0.5) {
        onClose();
      }
    },
  }), [onClose, legalDoc]);

  const renderLegalContent = () => {
    switch (legalDoc) {
      case 'service':
        return {
          title: '服务使用协议',
          content: '欢迎使用 Agile（以下简称“本软件”）。\n\n1. 软件用途：本软件是一款多功能相机工具，支持单/双画面拍摄与录制。\n2. 行为规范：用户应对使用本软件拍摄的所有内容承担法律责任，不得用于偷拍、监听等侵害他人隐私的行为。\n3. 数据存储：本软件产生的照片和视频默认存储在您的设备本地（DCIM/DualViewCamera），我们不提供云端备份服务，请自行保管重要数据。\n4. 免责声明：因硬件兼容性或系统原因导致的拍摄失败、数据丢失，本软件不承担赔偿责任。',
        };
      case 'privacy':
        return {
          title: '隐私保护政策',
          content: '我们高度重视您的隐私。\n\n1. 权限说明：\n   - 相机权限：用于实时取景、拍照及录制视频。\n   - 麦克风权限：用于录制视频时采集音频。\n   - 存储权限：用于将拍摄结果保存至系统相册，以及读取历史作品。\n2. 数据收集：本软件为纯本地工具类应用。除非您主动分享，我们不会收集、上传或向任何服务器传输您的照片、视频或个人地理位置信息。\n3. 权限管理：您可以随时在系统设置中撤回已授权的权限，但这将导致对应功能无法使用。',
        };
      case 'sharing':
        return {
          title: '第三方信息共享清单',
          content: '为保障应用稳定运行及功能实现，本软件接入了以下第三方 SDK/库：\n\n1. React Native Vision Camera：用于提供高性能相机渲染及底层采集能力。\n2. CameraRoll：用于实现与系统相册的安全交互（保存及读取）。\n3. React Native FS：用于管理本地临时文件及裁剪文件的生成。\n4. SVG Transformer：用于界面图标的渲染。\n\n上述组件均仅在本地运行，不涉及向第三方服务器共享您的个人身份信息。',
        };
      default:
        return null;
    }
  };

  const currentLegal = renderLegalContent();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View 
          style={[styles.settingsPanel, { height: 600, maxHeight: 600 }]} 
          {...panResponder.panHandlers}
        >
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Pressable onPress={onClose} style={{ padding: 4 }}><Text style={styles.closeText}>完成</Text></Pressable>
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
                <SettingsSection title="构图安全框">
                  {(['off', 'subtle', 'strong'] as SafetyOverlayMode[]).map(value => (
                    <Chip key={value} active={safetyOverlayMode === value} label={SAFETY_OVERLAY_LABELS[value]} onPress={() => onSafetyOverlayModeChange(value)} />
                  ))}
                </SettingsSection>
              </>
            ) : tab === 'video' ? (
              <>
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
                <SettingsSection title="构图安全框">
                  {(['off', 'subtle', 'strong'] as SafetyOverlayMode[]).map(value => (
                    <Chip key={value} active={safetyOverlayMode === value} label={SAFETY_OVERLAY_LABELS[value]} onPress={() => onSafetyOverlayModeChange(value)} />
                  ))}
                </SettingsSection>
              </>
            ) : (
              <>
                <SettingsSection title="软件信息">
                  <Text style={styles.aboutAppTitle}>Agile</Text>
                  <Text style={styles.aboutVersion}>版本：1.0.0 (Build 20260419)</Text>
                  <Text style={[styles.settingLine, { marginTop: 8 }]}>Agile 是一款专为高效构图设计的双画面相机，支持同一摄像头的主副构图同时输出。所有媒体文件均保存在本地 DCIM 目录，保护隐私，拒绝云端上传。</Text>
                </SettingsSection>
                <SettingsSection title="合规指引">
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('service')}>
                    <Text style={styles.legalLinkText}>服务使用协议</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('privacy')}>
                    <Text style={styles.legalLinkText}>隐私保护政策</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                  <Pressable style={styles.legalLink} onPress={() => setLegalDoc('sharing')}>
                    <Text style={styles.legalLinkText}>第三方信息共享清单</Text>
                    <Text style={styles.legalArrow}>›</Text>
                  </Pressable>
                </SettingsSection>
              </>
            )}
            
            {(tab === 'photo' || tab === 'video') && (
              <SettingsSection title="双画面">
                <Chip active={viewMode === 'dual'} label="双画面预览已开启" />
                <Chip active={saveDualOutputs} label="双画面同时保存" onPress={() => setSaveDualOutputs(!saveDualOutputs)} />
              </SettingsSection>
            )}
            
            {tab === 'about' && (
              <>
                <SettingsSection title="开发者">
                  <Text style={styles.settingLine}>© 2026 Agile Dev Team.</Text>
                  <Text style={styles.settingLine}>基于 Vision Camera 5.0 引擎构建</Text>
                </SettingsSection>
                <SettingsSection title="设备能力">
                  <Text style={styles.settingLine}>镜头数量：{devicesCount}</Text>
                  <Text style={styles.settingLine}>缩放范围：{device?.minZoom?.toFixed(1)}x ~ {device?.maxZoom?.toFixed(1)}x</Text>
                </SettingsSection>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>

          {/* 二级页面覆盖层：重新设计 */}
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

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.settingsSection}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.chipWrap}>{children}</View></View>;
}

function Chip({ active = false, disabled = false, label, onPress }: { active?: boolean; disabled?: boolean; label: string; onPress?: () => void }) {
  return <Pressable disabled={disabled || onPress == null} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]} onPress={onPress}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const SAFETY_OVERLAY_LABELS: Record<SafetyOverlayMode, string> = {
  off: '关闭',
  subtle: '轻量',
  strong: '明显',
};

function RoundButton({ active = false, label, onPress, style, children }: { active?: boolean; label: string; onPress: () => void; style?: any; children?: React.ReactNode }) {
  return <Pressable style={[styles.roundButton, active && styles.roundButtonActive, style]} onPress={onPress}>{children ? children : <Text style={styles.roundButtonText}>{label}</Text>}</Pressable>;
}
export { SettingsModal };
