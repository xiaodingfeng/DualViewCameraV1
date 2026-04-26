import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { NativePreviewView } from 'react-native-vision-camera';

import FlashAutoIcon from '../../assets/icons/flash-auto.svg';
import FlashOffIcon from '../../assets/icons/flash-off.svg';
import FlashOnIcon from '../../assets/icons/flash-on.svg';
import SettingsIcon from '../../assets/icons/settings.svg';
import SwitchCameraIcon from '../../assets/icons/switch.svg';

import { CompositionOverlay } from './CompositionOverlay';
import { ASPECT_RATIOS, PX_PER_ZOOM, TOP_BAR_OFFSET, VIDEO_QUALITY_CONFIG, ZOOM_BAR_WIDTH } from '../config/camera';
import { styles } from '../styles/cameraStyles';
import type {
  AspectRatioId,
  CaptureMode,
  FlashMode,
  FrameOrientation,
  LastMedia,
  PipAnchor,
  PipLayoutConfig,
  PreviewLayoutTemplateId,
  SafetyOverlayMode,
  VideoFps,
  VideoQuality,
} from '../types/camera';
import type { CropSpec } from '../types/composition';
import {
  calculateContainedFrame,
  clamp,
  formatAspectLabel,
  formatDuration,
  nextFps,
  nextVideoQuality,
  pipFrameSize,
} from '../utils/camera';

export function PermissionScreen({ onRequest }: { onRequest: () => Promise<void> }) {
  return (
    <SafeAreaView style={styles.centerScreen}>
      <Text style={styles.title}>需要相机权限</Text>
      <Text style={styles.description}>请点击下方按钮授权相机权限。若点击无反应，请在系统设置中手动开启。</Text>
      <Pressable style={styles.primaryButton} onPress={onRequest}>
        <Text style={styles.primaryButtonText}>去授权</Text>
      </Pressable>
    </SafeAreaView>
  );
}

export function EmptyCameraScreen({
  position,
  onSwitchCamera,
}: {
  position: 'back' | 'front';
  onSwitchCamera: () => void;
}) {
  return (
    <SafeAreaView style={styles.centerScreen}>
      <Text style={styles.title}>未找到{position === 'back' ? '后置' : '前置'}摄像头</Text>
      <Pressable style={styles.primaryButton} onPress={onSwitchCamera}>
        <Text style={styles.primaryButtonText}>切换摄像头</Text>
      </Pressable>
    </SafeAreaView>
  );
}

export function PreviewStatusOverlay({ issue }: { issue: string; mode: string }) {
  return (
    <View pointerEvents="none" style={styles.previewStatus}>
      <Text style={styles.previewStatusTitle}>{issue ? '预览异常' : '正在启动相机'}</Text>
      <Text style={styles.previewStatusText}>{issue || '正在绑定 CameraX 输出，请稍候。'}</Text>
    </View>
  );
}

export function FocusBox({ point }: { point: { x: number; y: number } }) {
  return <View pointerEvents="none" style={[styles.focusBox, { left: point.x - 36, top: point.y - 36 }]} />;
}

export function TopBar({
  aspectId,
  aspectOptions,
  captureMode,
  flashMode,
  isRecording,
  onAspectChange,
  onCycleFlash,
  onOpenSettings,
  onVideoFpsChange,
  onVideoQualityChange,
  recordingSeconds,
  videoFps,
  videoFpsOptions,
  videoQuality,
}: {
  aspectId: AspectRatioId;
  aspectOptions: typeof ASPECT_RATIOS;
  captureMode: CaptureMode;
  flashMode: FlashMode;
  isRecording: boolean;
  onAspectChange: (value: AspectRatioId) => void;
  onCycleFlash: () => void;
  onOpenSettings: () => void;
  onVideoFpsChange: (value: VideoFps) => void;
  onVideoQualityChange: (value: VideoQuality) => void;
  recordingSeconds: number;
  videoFps: VideoFps;
  videoFpsOptions: VideoFps[];
  videoQuality: VideoQuality;
}) {
  const FlashIcon = flashMode === 'off' ? FlashOffIcon : flashMode === 'auto' ? FlashAutoIcon : FlashOnIcon;

  return (
    <View style={styles.topBar} pointerEvents="box-none">
      <View style={styles.topSide} />
      <View style={styles.topCenter} pointerEvents="box-none">
        {isRecording ? (
          <Text style={styles.recordingTime}>{formatDuration(recordingSeconds)}</Text>
        ) : captureMode === 'video' ? (
          <View style={styles.topVideoControls}>
            <View style={styles.topVideoPills}>
              <Pressable style={styles.topPill} onPress={() => onVideoFpsChange(nextFps(videoFps, videoFpsOptions))}>
                <Text style={styles.topPillText}>{videoFps}HZ</Text>
              </Pressable>
              <Pressable style={styles.topPill} onPress={() => onVideoQualityChange(nextVideoQuality(videoQuality))}>
                <Text style={styles.topPillText}>{VIDEO_QUALITY_CONFIG[videoQuality].label}</Text>
              </Pressable>
            </View>
            <View style={styles.aspectRow}>
              {aspectOptions.map(option => (
                <Pressable
                  key={option.id}
                  style={[styles.aspectButton, aspectId === option.id && styles.aspectButtonActive]}
                  onPress={() => onAspectChange(option.id)}
                >
                  <Text style={[styles.aspectText, aspectId === option.id && styles.aspectTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.aspectRow}>
            {aspectOptions.map(option => (
              <Pressable
                key={option.id}
                style={[styles.aspectButton, aspectId === option.id && styles.aspectButtonActive]}
                onPress={() => onAspectChange(option.id)}
              >
                <Text style={[styles.aspectText, aspectId === option.id && styles.aspectTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <View style={styles.topActions}>
        <RoundButton label="" active={flashMode !== 'off'} onPress={onCycleFlash} style={styles.noBorderButton}>
          <FlashIcon width={28} height={28} />
        </RoundButton>
        <RoundButton label="" onPress={onOpenSettings} style={styles.noBorderButton}>
          <SettingsIcon width={28} height={28} />
        </RoundButton>
      </View>
    </View>
  );
}

export function BottomControls({
  captureMode,
  isBusy,
  isRecording,
  lastMedia,
  onCaptureModeChange,
  onGalleryPress,
  onPrimaryAction,
  onSwitchCamera,
  onViewModeChange,
  viewMode,
}: {
  captureMode: CaptureMode;
  isBusy: boolean;
  isRecording: boolean;
  lastMedia: LastMedia;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onGalleryPress: () => void;
  onPrimaryAction: () => void;
  onSwitchCamera: () => void;
  onViewModeChange: (mode: 'single' | 'dual') => void;
  viewMode: 'single' | 'dual';
}) {
  return (
    <View style={styles.bottomControls} pointerEvents="box-none">
      <View style={styles.modeRow}>
        <Text onPress={() => !isRecording && onCaptureModeChange('photo')} style={[styles.modeText, captureMode === 'photo' && styles.modeTextActive, isRecording && styles.modeTextDisabled]}>拍照</Text>
        <Text onPress={() => !isRecording && onCaptureModeChange('video')} style={[styles.modeText, captureMode === 'video' && styles.modeTextActive, isRecording && styles.modeTextDisabled]}>录像</Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.thumbnailButton} onPress={onGalleryPress} disabled={isRecording}>
          {lastMedia?.type === 'photo' ? (
            <Image source={{ uri: lastMedia.uri }} style={styles.thumbnailImage} />
          ) : (
            <Text style={styles.thumbnailText}>{lastMedia ? '视频' : ''}</Text>
          )}
        </Pressable>
        <Pressable
          disabled={isBusy}
          style={[styles.shutter, isRecording && styles.shutterRecording]}
          onPress={onPrimaryAction}
        >
          <View style={[styles.shutterInner, isRecording && styles.shutterInnerRecording]} />
        </Pressable>
        <RoundButton label="" onPress={onSwitchCamera} style={styles.noBorderButton} active={false} disabled={isRecording}>
          <SwitchCameraIcon width={32} height={32} />
        </RoundButton>
      </View>
      <View style={styles.viewModeRow}>
        <Pressable style={styles.viewModeButton} onPress={() => !isRecording && onViewModeChange('single')} disabled={isRecording}>
          <Text style={[styles.viewModeText, viewMode === 'single' && styles.viewModeTextActive, isRecording && styles.viewModeTextDisabled]}>单画面</Text>
        </Pressable>
        <Pressable style={styles.viewModeButton} onPress={() => !isRecording && onViewModeChange('dual')} disabled={isRecording}>
          <Text style={[styles.viewModeText, viewMode === 'dual' && styles.viewModeTextActive, isRecording && styles.viewModeTextDisabled]}>双画面</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TemplatePreviewPane({
  cropSpec,
  hybridRef,
  isRecording,
  overlayMode,
  previewOutput,
  role,
  sessionRevision,
  style,
}: {
  cropSpec: CropSpec;
  hybridRef?: unknown;
  isRecording: boolean;
  overlayMode: SafetyOverlayMode;
  previewOutput: any | null;
  role: 'main' | 'sub';
  sessionRevision: number;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.templatePane, style]}>
      {previewOutput ? (
        <NativePreviewView
          key={`${role}-template-${sessionRevision}`}
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="cover"
          implementationMode="compatible"
          hybridRef={hybridRef as never}
        />
      ) : (
        <View style={styles.pipPlaceholder}>
          <Text style={styles.pipPlaceholderText}>{role === 'main' ? '主画面' : '副画面'}</Text>
        </View>
      )}
      <CompositionOverlay crop={cropSpec} isRecording={isRecording} mode={overlayMode} role={role} />
    </View>
  );
}

export function TemplateDualPreview({
  layoutId,
  mainCropSpec,
  mainHybridRef,
  mainPreviewOutput,
  overlayMode,
  subCropSpec,
  subPreviewOutput,
  isRecording,
  sessionRevision,
}: {
  layoutId: Exclude<PreviewLayoutTemplateId, 'pip'>;
  mainCropSpec: CropSpec;
  mainHybridRef: unknown;
  mainPreviewOutput: any | null;
  overlayMode: SafetyOverlayMode;
  subCropSpec: CropSpec;
  subPreviewOutput: any | null;
  isRecording: boolean;
  sessionRevision: number;
}) {
  const isHorizontal = layoutId === 'split-horizontal';
  const isVertical = layoutId === 'split-vertical';

  if (layoutId === 'stack') {
    return (
      <View pointerEvents="none" style={styles.templateLayer}>
        <TemplatePreviewPane
          cropSpec={mainCropSpec}
          hybridRef={mainHybridRef}
          isRecording={isRecording}
          overlayMode={overlayMode}
          previewOutput={mainPreviewOutput}
          role="main"
          sessionRevision={sessionRevision}
          style={styles.stackMainPane}
        />
        <TemplatePreviewPane
          cropSpec={subCropSpec}
          isRecording={isRecording}
          overlayMode={overlayMode}
          previewOutput={subPreviewOutput}
          role="sub"
          sessionRevision={sessionRevision}
          style={styles.stackSubPane}
        />
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.templateLayer,
        isHorizontal && styles.templateSplitHorizontal,
        isVertical && styles.templateSplitVertical,
      ]}
    >
      <TemplatePreviewPane
        cropSpec={mainCropSpec}
        hybridRef={mainHybridRef}
        isRecording={isRecording}
        overlayMode={overlayMode}
        previewOutput={mainPreviewOutput}
        role="main"
        sessionRevision={sessionRevision}
        style={styles.templateSplitPane}
      />
      <TemplatePreviewPane
        cropSpec={subCropSpec}
        isRecording={isRecording}
        overlayMode={overlayMode}
        previewOutput={subPreviewOutput}
        role="sub"
        sessionRevision={sessionRevision}
        style={styles.templateSplitPane}
      />
    </View>
  );
}

const PIP_DRAG_THRESHOLD = 8;
const PIP_MARGIN_X = 18;
const PIP_TOP_MARGIN = TOP_BAR_OFFSET + 58;
const PIP_BOTTOM_MARGIN = 228;
const PIP_SCALE_FACTORS = {
  small: 0.86,
  medium: 1,
  large: 1.15,
} as const;

function scaledPipFrameSize(aspectRatio: number, scale: PipLayoutConfig['scale']) {
  const base = pipFrameSize(aspectRatio);
  const factor = PIP_SCALE_FACTORS[scale];
  return {
    width: Math.round(base.width * factor),
    height: Math.round(base.height * factor),
  };
}

function pipAnchorPosition(
  layout: PipLayoutConfig,
  previewSize: { width: number; height: number },
  pipSize: { width: number; height: number },
) {
  const maxLeft = Math.max(0, previewSize.width - pipSize.width);
  const maxTop = Math.max(0, previewSize.height - pipSize.height);
  const left = layout.anchor.endsWith('right') ? maxLeft - layout.marginX : layout.marginX;
  const top = layout.anchor.startsWith('bottom') ? maxTop - layout.marginY : layout.marginY;

  return {
    left: clamp(left, 0, maxLeft),
    top: clamp(top, 0, maxTop),
  };
}

function nearestPipAnchor(
  left: number,
  top: number,
  previewSize: { width: number; height: number },
  pipSize: { width: number; height: number },
): PipAnchor {
  const centerX = left + pipSize.width / 2;
  const centerY = top + pipSize.height / 2;
  const vertical = centerY < previewSize.height / 2 ? 'top' : 'bottom';
  const horizontal = centerX < previewSize.width / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as PipAnchor;
}

export function PipPreview({
  aspectRatio,
  cropSpec,
  isSwapped,
  isRecording,
  orientation,
  onPress,
  overlayMode,
  layout,
  onGestureActiveChange,
  onLayoutChange,
  previewOutput,
  previewSize,
  sessionRevision,
  placeholderMode,
}: {
  aspectRatio: number;
  cropSpec: CropSpec;
  isSwapped: boolean;
  isRecording: boolean;
  orientation: FrameOrientation;
  onPress: () => void;
  overlayMode: SafetyOverlayMode;
  layout: PipLayoutConfig;
  onGestureActiveChange?: (active: boolean) => void;
  onLayoutChange: (layout: PipLayoutConfig) => void;
  previewOutput: any | null;
  previewSize: { width: number; height: number };
  sessionRevision: number;
  placeholderMode: 'photo' | 'video' | null;
}) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const pipSize = useMemo(() => scaledPipFrameSize(aspectRatio, layout.scale), [aspectRatio, layout.scale]);
  const anchorPosition = useMemo(
    () => pipAnchorPosition(layout, previewSize, pipSize),
    [layout, pipSize, previewSize.height, previewSize.width],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > PIP_DRAG_THRESHOLD || Math.abs(gesture.dy) > PIP_DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          draggedRef.current = false;
          onGestureActiveChange?.(true);
          setDragOffset({ x: 0, y: 0 });
        },
        onPanResponderMove: (_event, gesture) => {
          if (Math.abs(gesture.dx) > PIP_DRAG_THRESHOLD || Math.abs(gesture.dy) > PIP_DRAG_THRESHOLD) {
            draggedRef.current = true;
          }
          setDragOffset({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          const wasDragged = draggedRef.current;
          draggedRef.current = false;
          onGestureActiveChange?.(false);
          setDragOffset({ x: 0, y: 0 });

          if (!wasDragged) {
            onPress();
            return;
          }

          const maxLeft = Math.max(0, previewSize.width - pipSize.width);
          const maxTop = Math.max(0, previewSize.height - pipSize.height);
          const nextLeft = clamp(anchorPosition.left + gesture.dx, 0, maxLeft);
          const nextTop = clamp(anchorPosition.top + gesture.dy, 0, maxTop);
          const nextAnchor = nearestPipAnchor(nextLeft, nextTop, previewSize, pipSize);

          onLayoutChange({
            ...layout,
            anchor: nextAnchor,
            marginX: PIP_MARGIN_X,
            marginY: nextAnchor.startsWith('top') ? PIP_TOP_MARGIN : PIP_BOTTOM_MARGIN,
          });
        },
        onPanResponderTerminate: () => {
          draggedRef.current = false;
          onGestureActiveChange?.(false);
          setDragOffset({ x: 0, y: 0 });
        },
      }),
    [anchorPosition.left, anchorPosition.top, layout, onGestureActiveChange, onLayoutChange, onPress, pipSize, previewSize],
  );
  const placeholderTitle = placeholderMode === 'photo' ? '拍照中' : '录制中';

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.pip,
        pipSize,
        {
          left: anchorPosition.left,
          top: anchorPosition.top,
          transform: [{ translateX: dragOffset.x }, { translateY: dragOffset.y }],
        },
      ]}
    >
      {previewOutput ? (
        <NativePreviewView
          key={`pip-${sessionRevision}`}
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="cover"
          implementationMode="compatible"
        />
      ) : (
        <View style={styles.pipPlaceholder}>
          {placeholderMode ? (
            <>
              <Text style={styles.pipPlaceholderTitle}>{placeholderTitle}</Text>
              <Text style={styles.pipPlaceholderText}>副画面按保存构图输出</Text>
            </>
          ) : (
            <Text style={styles.pipPlaceholderText}>副画面</Text>
          )}
        </View>
      )}
      <CompositionOverlay crop={cropSpec} isRecording={isRecording} mode={overlayMode} role="sub" />
      <Text style={styles.pipLabel}>
        {placeholderMode ? placeholderTitle : isSwapped ? '主画面' : `副 ${formatAspectLabel(aspectRatio)}`}
      </Text>
      <View pointerEvents="none" style={styles.pipTouchLayer} />
    </View>
  );
}

export function MainPreview({
  bottomOffset,
  cropSpec,
  fillScreen,
  frame,
  hybridRef,
  isRecording,
  orientation,
  overlayMode,
  aspectRatio,
  previewOutput,
  sessionRevision,
  topOffset,
  isTransitioning,
}: {
  fillScreen: boolean;
  bottomOffset: number;
  cropSpec: CropSpec;
  frame: { width: any; height: any };
  hybridRef: unknown;
  isRecording: boolean;
  orientation: FrameOrientation;
  overlayMode: SafetyOverlayMode;
  aspectRatio?: number;
  previewOutput: any;
  sessionRevision: number;
  topOffset: number;
  isTransitioning: boolean;
}) {
  const centerStyle = useMemo(
    () => [styles.mainPreviewCenter, { top: topOffset, bottom: bottomOffset }],
    [bottomOffset, topOffset],
  );

  const slotStyle = useMemo(() => {
    if (fillScreen) {
      return styles.mainFullSlot;
    }
    return [styles.mainContainedSlot, frame];
  }, [fillScreen, frame]);

  return (
    <View pointerEvents="none" style={centerStyle}>
      <View style={slotStyle}>
        <NativePreviewView
          key={`main-${sessionRevision}`}
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="cover"
          implementationMode="compatible"
          hybridRef={hybridRef as never}
        />
        {isTransitioning && (
          <View style={[StyleSheet.absoluteFill, styles.transitionOverlay]}>
            <View style={styles.transitionLogo}>
              <Text style={styles.transitionLogoText}>Agile</Text>
            </View>
          </View>
        )}
        <CompositionOverlay crop={cropSpec} isRecording={isRecording} mode={overlayMode} role="main" />
      </View>
    </View>
  );
}

export function ZoomSelector({
  currentZoom,
  onChange,
  minZoom,
  maxZoom,
  isRulerMode,
  setIsRulerMode,
  onGestureActiveChange,
}: {
  currentZoom: number;
  onChange: (z: number) => void;
  minZoom: number;
  maxZoom: number;
  isRulerMode: boolean;
  setIsRulerMode: (m: boolean) => void;
  onGestureActiveChange?: (active: boolean) => void;
}) {
  const startZoomRef = useRef(currentZoom);
  const zoomRef = useRef(currentZoom);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const options = useMemo(() => [0.6, 1, 2, 2.5, 5].filter(v => v >= minZoom && v <= maxZoom), [minZoom, maxZoom]);

  useEffect(() => {
    zoomRef.current = currentZoom;
  }, [currentZoom]);

  const clearTimer = () => {
    if (restoreTimer.current) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
  };

  const startTimer = () => {
    clearTimer();
    restoreTimer.current = setTimeout(() => setIsRulerMode(false), 500);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startZoomRef.current = zoomRef.current;
        onGestureActiveChange?.(true);
        clearTimer();
      },
      onPanResponderMove: (_, gesture) => {
        if (!isRulerMode && Math.abs(gesture.dx) < 12) return;
        if (!isRulerMode) setIsRulerMode(true);
        clearTimer();
        const delta = -(gesture.dx / PX_PER_ZOOM);
        const next = clamp(startZoomRef.current + delta, minZoom, maxZoom);
        onChange(Math.round(next * 10) / 10);
      },
      onPanResponderRelease: () => {
        if (isRulerMode) startTimer();
        onGestureActiveChange?.(false);
      },
      onPanResponderTerminate: () => {
        setIsRulerMode(false);
        onGestureActiveChange?.(false);
      },
    }),
  ).current;

  const tickStep = PX_PER_ZOOM * 0.1;
  const stripLeft = ZOOM_BAR_WIDTH / 2 - (currentZoom - minZoom) * PX_PER_ZOOM - tickStep / 2;
  const markers = useMemo(() => {
    const items = [];
    for (let i = 0; i <= (maxZoom - minZoom) * 10; i += 1) items.push(minZoom + i * 0.1);
    return items;
  }, [minZoom, maxZoom]);

  return (
    <View style={styles.zoomBarShell} {...panResponder.panHandlers}>
      {isRulerMode ? (
        <View style={styles.rulerContainer}>
          <View style={[styles.rulerStrip, { left: stripLeft }]}>
            {markers.map(val => (
              <View key={val.toFixed(1)} style={[styles.markerGroup, { width: tickStep }]}>
                <View
                  style={[
                    styles.tick,
                    Math.abs(val % 0.5) < 0.01 && styles.tickHalf,
                    Math.abs(val % 1) < 0.01 && styles.tickMajor,
                  ]}
                />
                {Math.abs(val % 1) < 0.01 && <Text style={styles.tickLabel}>{val.toFixed(0)}</Text>}
              </View>
            ))}
          </View>
          <View style={styles.centerPointer} />
          <View style={styles.valueFloat}>
            <Text style={styles.floatingValue}>{currentZoom.toFixed(1)}x</Text>
          </View>
        </View>
      ) : (
        <View style={styles.optionsRow}>
          {options.map(val => (
            <Pressable
              key={val}
              onPress={() => onChange(val)}
              onLongPress={() => setIsRulerMode(true)}
              style={styles.optionItem}
            >
              <Text style={[styles.optionText, Math.abs(currentZoom - val) < 0.05 && styles.activeText]}>
                {val === currentZoom ? `${val}x` : val}
              </Text>
            </Pressable>
          ))}
          {!options.some(v => Math.abs(currentZoom - v) < 0.05) && (
            <View style={styles.optionItem}>
              <Text style={[styles.optionText, styles.activeText]}>{currentZoom.toFixed(1)}x</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

export function RoundButton({
  active,
  label,
  onPress,
  style,
  children,
  disabled,
}: {
  active?: boolean;
  label: string;
  onPress: () => void;
  style?: any;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.roundButton, active && styles.roundButtonActive, style, disabled && { opacity: 0.3 }]}
      onPress={onPress}
      disabled={disabled}
    >
      {children ? children : <Text style={styles.roundButtonText}>{label}</Text>}
    </Pressable>
  );
}

