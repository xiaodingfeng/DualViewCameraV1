import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';

import { NativeDualViewVideoView, DualViewMedia } from '../native/dualViewMedia';
import { styles } from '../styles/cameraStyles';
import type { GalleryMedia } from '../types/camera';
import type { MediaJob } from '../types/mediaJob';
import {
  clamp,
  clampPhotoTranslate,
  clampPointToMediaRect,
  containedMediaFrame,
  formatBytes,
  formatDuration,
  formatTimestamp,
  touchCenter,
  touchDistance,
} from '../utils/camera';
import { mimeTypeForMedia } from '../utils/gallery';

type GalleryMediaGroup = {
  id: string;
  createdAt: number;
  items: GalleryMedia[];
  jobs: MediaJob[];
};

export function GalleryView({
  index,
  items,
  onClose,
  onDelete,
  onIndexChange,
  onRetryMediaJob,
  mediaJobs = [],
  translateX,
}: {
  index: number;
  items: GalleryMedia[];
  onClose: () => void;
  onDelete: (item: GalleryMedia) => void;
  onIndexChange: (index: number) => void;
  onRetryMediaJob?: (job: MediaJob) => void;
  mediaJobs?: MediaJob[];
  translateX: Animated.AnimatedInterpolation<number>;
}) {
  const listRef = useRef<FlatList<GalleryMediaGroup> | null>(null);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(() => new Set());
  const [zoomLocked, setZoomLocked] = useState(false);
  const [assetIndexByGroup, setAssetIndexByGroup] = useState<Record<string, number>>({});
  const groups = useMemo(() => groupGalleryItems(items, mediaJobs), [items, mediaJobs]);
  const currentGroup = groups[index] ?? null;
  const currentAssetIndex = currentGroup
    ? Math.min(assetIndexByGroup[currentGroup.id] ?? 0, currentGroup.items.length - 1)
    : 0;
  const current = currentGroup?.items[currentAssetIndex] ?? null;

  useEffect(() => {
    if (viewerWidth <= 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false });
    });
  }, [index, viewerWidth]);

  useEffect(() => {
    setDetailsOpen(false);
    setFailedPreviewIds(new Set());
    setZoomLocked(false);
    // Force scroll to index 0 (latest) when items change or component mounts
    if (groups.length > 0 && viewerWidth > 0) {
      listRef.current?.scrollToIndex({ index: 0, animated: false });
    }
  }, [groups.length, viewerWidth]);

  useEffect(() => {
    if (index >= groups.length && groups.length > 0) {
      onIndexChange(groups.length - 1);
    }
  }, [groups.length, index, onIndexChange]);

  const shareCurrent = useCallback(async () => {
    if (current == null) return;
    try {
      if (DualViewMedia?.shareMedia) {
        await DualViewMedia.shareMedia(current.uri, mimeTypeForMedia(current), current.filename ?? 'DualViewCamera');
        return;
      }
      await Linking.openURL(current.uri);
    } catch {}
  }, [current]);

  const openCurrent = useCallback(() => {
    if (current == null) return;
    Linking.openURL(current.uri).catch(() => {});
  }, [current]);

  const confirmDelete = useCallback(() => {
    if (current == null) return;
    Alert.alert('删除这项？', current.filename ?? current.uri, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => onDelete(current) },
    ]);
  }, [current, onDelete]);

  return (
    <Animated.View 
      style={[styles.galleryRoot, { transform: [{ translateX }] }]} 
      onLayout={event => setViewerWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.galleryTopBar}>
        <Text style={styles.galleryCount}>
          {groups.length > 0
            ? `${index + 1}/${groups.length}${current?.captureRole ? ` · ${roleLabel(current.captureRole)}` : ''}`
            : '0/0'}
        </Text>
      </View>

      {viewerWidth > 0 && groups.length > 0 ? (
        <FlatList
          ref={listRef}
          data={groups}
          horizontal
          initialNumToRender={3}
          keyExtractor={group => group.id}
          maxToRenderPerBatch={3}
          pagingEnabled
          removeClippedSubviews
          scrollEnabled={!zoomLocked}
          renderItem={({ item: group, index: groupIndex }) => {
            const groupAssetIndex = Math.min(
              assetIndexByGroup[group.id] ?? 0,
              group.items.length - 1,
            );
            const item = group.items[groupAssetIndex] ?? null;
            const failedJobs = group.jobs.filter(job => job.status === 'failed');

            return (
            <View style={[styles.galleryPage, { width: viewerWidth }]}>
              {Math.abs(groupIndex - index) > 2 ? (
                <View style={styles.galleryLazyPage} />
              ) : item == null ? (
                <FailedMediaJobFallback jobs={failedJobs} onRetry={onRetryMediaJob} />
              ) : item.type === 'photo' && !failedPreviewIds.has(item.id) ? (
                <ZoomablePhoto
                  item={item}
                  onPreviewError={() =>
                    setFailedPreviewIds(previous => {
                      const next = new Set(previous);
                      next.add(item.id);
                      return next;
                    })
                  }
                  onZoomActiveChange={groupIndex === index ? setZoomLocked : undefined}
                />
              ) : item.type === 'video' ? (
                <InlineVideoPlayer item={item} onZoomActiveChange={groupIndex === index ? setZoomLocked : undefined} />
              ) : (
                <MediaPreviewFallback item={item} />
              )}
              {failedJobs.length > 0 && item != null ? (
                <FailedMediaJobBanner jobs={failedJobs} onRetry={onRetryMediaJob} />
              ) : null}
              {group.items.length > 1 ? (
                <View style={styles.galleryAssetStrip}>
                  {group.items.map((asset, assetIndex) => (
                    <Pressable
                      key={asset.id}
                      style={[
                        styles.galleryAssetChip,
                        assetIndex === groupAssetIndex && styles.galleryAssetChipActive,
                      ]}
                      onPress={() => {
                        setAssetIndexByGroup(previous => ({
                          ...previous,
                          [group.id]: assetIndex,
                        }));
                        setDetailsOpen(false);
                        setZoomLocked(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.galleryAssetChipText,
                          assetIndex === groupAssetIndex && styles.galleryAssetChipTextActive,
                        ]}
                      >
                        {roleLabel(asset.captureRole)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
          }}
          showsHorizontalScrollIndicator={false}
          windowSize={5}
          getItemLayout={(_, itemIndex) => ({
            length: viewerWidth,
            offset: viewerWidth * itemIndex,
            index: itemIndex,
          })}
          onMomentumScrollEnd={event => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.x / viewerWidth);
            onIndexChange(clamp(nextIndex, 0, groups.length - 1));
            setZoomLocked(false);
          }}
          onScrollToIndexFailed={info => {
            setTimeout(() => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            }, 50);
          }}
        />
      ) : (
        <View style={styles.galleryEmpty}>
          <Text style={styles.galleryEmptyText}>还没有拍摄内容</Text>
        </View>
      )}

      {detailsOpen && current ? <MediaDetails item={current} /> : null}

      {current ? (
        <View style={styles.galleryBottomBar}>
          <Pressable style={styles.galleryBottomButton} onPress={() => setDetailsOpen(value => !value)}>
            <Text style={styles.galleryBottomText}>详情</Text>
          </Pressable>
          <Pressable style={styles.galleryBottomButton} onPress={shareCurrent}>
            <Text style={styles.galleryBottomText}>分享</Text>
          </Pressable>
          <Pressable style={styles.galleryBottomButton} onPress={openCurrent}>
            <Text style={styles.galleryBottomText}>查看</Text>
          </Pressable>
          <Pressable style={[styles.galleryBottomButton, styles.galleryDeleteButton]} onPress={confirmDelete}>
            <Text style={[styles.galleryBottomText, styles.galleryDeleteText]}>删除</Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

function ZoomablePhoto({
  item,
  onPreviewError,
  onZoomActiveChange,
}: {
  item: GalleryMedia;
  onPreviewError: () => void;
  onZoomActiveChange?: (active: boolean) => void;
}) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const imageFrame = useMemo(
    () => containedMediaFrame(containerSize.width, containerSize.height, item.width, item.height),
    [containerSize.height, containerSize.width, item.height, item.width],
  );
  const baseScaleRef = useRef(1);
  const baseTranslateRef = useRef({ x: 0, y: 0 });
  const startCenterRef = useRef<{ x: number; y: number } | null>(null);
  const startDistanceRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const touchCountRef = useRef(0);

  useEffect(() => {
    scaleRef.current = scale;
    onZoomActiveChange?.(scale > 1.02);
  }, [onZoomActiveChange, scale]);

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    baseScaleRef.current = 1;
    baseTranslateRef.current = { x: 0, y: 0 };
    startDistanceRef.current = null;
    startCenterRef.current = null;
    panStartRef.current = null;
    onZoomActiveChange?.(false);
  }, [item.id, onZoomActiveChange]);

  const updateScaleAndTranslate = useCallback(
    (nextScale: number, nextTranslate: { x: number; y: number }) => {
      const boundedScale = clamp(nextScale, 1, 4);
      setScale(boundedScale);
      setTranslate(clampPhotoTranslate(nextTranslate, boundedScale, containerSize, imageFrame));
    },
    [containerSize, imageFrame],
  );

  return (
    <View
      style={styles.zoomablePhoto}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setContainerSize({ width, height });
      }}
      onTouchStart={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        const distance = touchDistance(event.nativeEvent.touches);
        const center = touchCenter(event.nativeEvent.touches);
        if (distance != null) {
          startDistanceRef.current = distance;
          startCenterRef.current = center;
          baseScaleRef.current = scaleRef.current;
          baseTranslateRef.current = translateRef.current;
          onZoomActiveChange?.(true);
        } else if (scaleRef.current > 1.02 && event.nativeEvent.touches[0]) {
          panStartRef.current = {
            x: event.nativeEvent.touches[0].pageX,
            y: event.nativeEvent.touches[0].pageY,
          };
          baseTranslateRef.current = translateRef.current;
        }
      }}
      onTouchMove={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        const distance = touchDistance(event.nativeEvent.touches);
        const center = touchCenter(event.nativeEvent.touches);
        if (distance != null && center != null) {
          if (startDistanceRef.current == null) {
            startDistanceRef.current = distance;
            startCenterRef.current = center;
            baseScaleRef.current = scaleRef.current;
            baseTranslateRef.current = translateRef.current;
            onZoomActiveChange?.(true);
            return;
          }
          const nextScale = clamp(baseScaleRef.current * (distance / startDistanceRef.current), 1, 4);
          const startCenter = startCenterRef.current ?? center;
          const zoomCenter = clampPointToMediaRect(center, containerSize, imageFrame);
          const origin = {
            x: zoomCenter.x - containerSize.width / 2,
            y: zoomCenter.y - containerSize.height / 2,
          };
          const scaleRatio = nextScale / Math.max(0.001, baseScaleRef.current);
          const nextTranslate = {
            x:
              baseTranslateRef.current.x +
              (center.x - startCenter.x) +
              (origin.x - baseTranslateRef.current.x) * (1 - scaleRatio),
            y:
              baseTranslateRef.current.y +
              (center.y - startCenter.y) +
              (origin.y - baseTranslateRef.current.y) * (1 - scaleRatio),
          };
          updateScaleAndTranslate(nextScale, nextTranslate);
          return;
        }
        if (scaleRef.current <= 1.02 || !event.nativeEvent.touches[0]) return;
        if (panStartRef.current == null) {
          panStartRef.current = {
            x: event.nativeEvent.touches[0].pageX,
            y: event.nativeEvent.touches[0].pageY,
          };
          baseTranslateRef.current = translateRef.current;
          return;
        }
        const nextTranslate = {
          x: baseTranslateRef.current.x + event.nativeEvent.touches[0].pageX - panStartRef.current.x,
          y: baseTranslateRef.current.y + event.nativeEvent.touches[0].pageY - panStartRef.current.y,
        };
        updateScaleAndTranslate(scaleRef.current, nextTranslate);
      }}
      onTouchEnd={event => {
        touchCountRef.current = event.nativeEvent.touches.length;
        if (touchCountRef.current >= 2) {
          const distance = touchDistance(event.nativeEvent.touches);
          const center = touchCenter(event.nativeEvent.touches);
          startDistanceRef.current = distance;
          startCenterRef.current = center;
          baseScaleRef.current = scaleRef.current;
          baseTranslateRef.current = translateRef.current;
          return;
        }
        startDistanceRef.current = null;
        startCenterRef.current = null;
        panStartRef.current = null;
        baseTranslateRef.current = translateRef.current;
        if (scaleRef.current <= 1.02) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomActiveChange?.(false);
        }
      }}
      onTouchCancel={() => {
        touchCountRef.current = 0;
        startDistanceRef.current = null;
        startCenterRef.current = null;
        panStartRef.current = null;
        if (scaleRef.current <= 1.02) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomActiveChange?.(false);
        }
      }}
    >
      <View
        style={[
          styles.zoomableImageFrame,
          imageFrame,
          { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
        ]}
      >
        <Image source={{ uri: item.uri }} style={styles.galleryImage} resizeMode="contain" onError={onPreviewError} />
      </View>
      {scale > 1.02 ? (
        <Pressable
          style={styles.zoomResetButton}
          onPress={() => {
            setScale(1);
            setTranslate({ x: 0, y: 0 });
          }}
        >
          <Text style={styles.zoomResetText}>还原</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InlineVideoPlayer({
  item,
  onZoomActiveChange,
}: {
  item: GalleryMedia;
  onZoomActiveChange?: (active: boolean) => void;
}) {
  if (NativeDualViewVideoView == null) {
    return <MediaPreviewFallback item={item} />;
  }
  return (
    <View
      style={styles.inlineVideoPlayer}
      onTouchStart={event => {
        if (event.nativeEvent.touches.length >= 2) {
          onZoomActiveChange?.(true);
        }
      }}
      onTouchMove={event => {
        if (event.nativeEvent.touches.length >= 2) {
          onZoomActiveChange?.(true);
        }
      }}
      onTouchEnd={event => {
        if (event.nativeEvent.touches.length < 2) {
          onZoomActiveChange?.(false);
        }
      }}
      onTouchCancel={() => onZoomActiveChange?.(false)}
    >
      <NativeDualViewVideoView style={styles.inlineVideoPlayer} sourceUri={item.uri} />
    </View>
  );
}

function MediaPreviewFallback({ item }: { item: GalleryMedia }) {
  const isVideo = item.type === 'video';
  return (
    <View style={styles.mediaPreviewFallback}>
      <Text style={styles.videoPreviewIcon}>{isVideo ? '▶' : '!'}</Text>
      <Text style={styles.videoPreviewTitle}>{isVideo ? '视频' : '无法预览'}</Text>
      {isVideo ? <Text style={styles.videoPreviewText}>{formatDuration(Math.floor(item.duration || 0))}</Text> : null}
      <Text style={styles.videoPreviewHint}>{isVideo ? '可查看或分享原视频' : '可用系统查看或分享原文件'}</Text>
    </View>
  );
}

function MediaDetails({ item }: { item: GalleryMedia }) {
  return (
    <View style={styles.mediaDetails}>
      <Text style={styles.mediaDetailsTitle}>{item.type === 'photo' ? '照片详情' : '视频详情'}</Text>
      <Text style={styles.mediaDetailsText}>文件：{item.filename ?? '未知'}</Text>
      {item.captureId ? (
        <>
          <Text style={styles.mediaDetailsText}>拍摄组：{item.captureId}</Text>
          <Text style={styles.mediaDetailsText}>
            角色：{roleLabel(item.captureRole)}（共 {item.captureGroupSize ?? 1} 项）
          </Text>
        </>
      ) : null}
      <Text style={styles.mediaDetailsText}>时间：{formatTimestamp(item.timestamp)}</Text>
      <Text style={styles.mediaDetailsText}>尺寸：{item.width || '-'} × {item.height || '-'}</Text>
      {item.type === 'video' ? (
        <Text style={styles.mediaDetailsText}>时长：{formatDuration(Math.floor(item.duration || 0))}</Text>
      ) : null}
      <Text style={styles.mediaDetailsText}>大小：{formatBytes(item.fileSize)}</Text>
      <Text style={styles.mediaDetailsPath} numberOfLines={3}>
        {item.filepath ?? item.uri}
      </Text>
    </View>
  );
}

function FailedMediaJobBanner({
  jobs,
  onRetry,
}: {
  jobs: MediaJob[];
  onRetry?: (job: MediaJob) => void;
}) {
  const [job] = jobs;
  if (job == null) return null;
  return (
    <View style={styles.galleryJobBanner}>
      <Text style={styles.galleryJobBannerTitle}>{mediaJobLabel(job)}失败</Text>
      <Text style={styles.galleryJobBannerText} numberOfLines={2}>
        {job.errorMessage ?? '后台处理失败'}
      </Text>
      {onRetry ? (
        <Pressable style={styles.galleryJobRetryButton} onPress={() => onRetry(job)}>
          <Text style={styles.galleryJobRetryText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FailedMediaJobFallback({
  jobs,
  onRetry,
}: {
  jobs: MediaJob[];
  onRetry?: (job: MediaJob) => void;
}) {
  const [job] = jobs;
  return (
    <View style={styles.mediaPreviewFallback}>
      <Text style={styles.videoPreviewIcon}>!</Text>
      <Text style={styles.videoPreviewTitle}>{job ? `${mediaJobLabel(job)}失败` : '后台处理失败'}</Text>
      <Text style={styles.videoPreviewHint}>
        {job?.errorMessage ?? '该组没有可预览的成功资产'}
      </Text>
      {job && onRetry ? (
        <Pressable style={styles.galleryJobRetryButton} onPress={() => onRetry(job)}>
          <Text style={styles.galleryJobRetryText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function groupGalleryItems(items: GalleryMedia[], jobs: MediaJob[] = []): GalleryMediaGroup[] {
  const groups = new Map<string, GalleryMediaGroup>();

  items.forEach(item => {
    const id = item.captureId ?? item.id;
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
      existing.createdAt = Math.max(existing.createdAt, item.captureGroupCreatedAt ?? item.timestamp);
      return;
    }

    groups.set(id, {
      id,
      createdAt: item.captureGroupCreatedAt ?? item.timestamp,
      items: [item],
      jobs: [],
    });
  });

  jobs
    .filter(job => job.status === 'failed')
    .forEach(job => {
      const existing = groups.get(job.captureId);
      if (existing) {
        existing.jobs.push(job);
        existing.createdAt = Math.max(existing.createdAt, job.createdAt);
        return;
      }
      groups.set(job.captureId, {
        id: job.captureId,
        createdAt: job.createdAt,
        items: [],
        jobs: [job],
      });
    });

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      items: group.items.sort((a, b) => roleOrder(a.captureRole) - roleOrder(b.captureRole)),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function mediaJobLabel(job: MediaJob): string {
  switch (job.type) {
    case 'video-variant':
      return '副画面视频';
    case 'photo-pack':
      return '照片组';
    case 'photo-variant':
      return '照片';
    case 'cover-generate':
      return '封面';
    case 'gallery-save':
      return '相册保存';
    default:
      return '后台任务';
  }
}

function roleOrder(role?: GalleryMedia['captureRole']): number {
  const order: Array<NonNullable<GalleryMedia['captureRole']>> = [
    'main',
    'sub',
    'vertical',
    'horizontal',
    'square',
    'cover',
    'source',
  ];
  return role == null ? order.length : order.indexOf(role);
}

function roleLabel(role?: GalleryMedia['captureRole']): string {
  switch (role) {
    case 'main':
      return '主画面';
    case 'sub':
      return '副画面';
    case 'vertical':
      return '竖图';
    case 'horizontal':
      return '横图';
    case 'square':
      return '方图';
    case 'cover':
      return '封面';
    case 'source':
      return '源文件';
    default:
      return '媒体';
  }
}
