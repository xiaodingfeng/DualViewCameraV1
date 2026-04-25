import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { styles } from '../styles/cameraStyles';
import type { MediaJob } from '../types/mediaJob';
import { isVisibleMediaJob } from '../utils/mediaJobQueue';

export function MediaJobIndicator({ jobs }: { jobs: MediaJob[] }) {
  const [now, setNow] = useState(() => Date.now());
  const needsTicker = jobs.some(
    job => job.status === 'succeeded' || job.status === 'failed',
  );

  useEffect(() => {
    if (!needsTicker) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [needsTicker, jobs]);

  const job = useMemo(
    () => jobs.find(item => isVisibleMediaJob(item, now)),
    [jobs, now],
  );

  if (job == null) return null;

  const progress = Math.round(job.progress * 100);
  const title = jobTitle(job);
  const statusText =
    job.status === 'failed'
      ? job.errorMessage ?? '后台处理失败'
      : job.status === 'succeeded'
        ? '已完成'
        : `${progress}%`;

  return (
    <View style={styles.mediaJobIndicator} pointerEvents="none">
      <View style={styles.mediaJobHeader}>
        <Text style={styles.mediaJobTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.mediaJobStatus}>{statusText}</Text>
      </View>
      <View style={styles.mediaJobTrack}>
        <View
          style={[
            styles.mediaJobProgress,
            {
              width: `${Math.max(6, progress)}%`,
              opacity: job.status === 'failed' ? 0.45 : 1,
            },
          ]}
        />
      </View>
    </View>
  );
}

function jobTitle(job: MediaJob): string {
  switch (job.type) {
    case 'video-variant':
      return '正在生成副画面视频';
    case 'photo-pack':
      return '正在生成照片组';
    case 'photo-variant':
      return '正在生成照片';
    case 'cover-generate':
      return '正在生成封面';
    case 'gallery-save':
      return '正在保存到相册';
    default:
      return '后台处理中';
  }
}
