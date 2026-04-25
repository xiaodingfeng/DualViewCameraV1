import RNFS from 'react-native-fs';

import type { GalleryMedia } from '../types/camera';
import type {
  DualCaptureGroup,
  DualMediaAsset,
  DualMediaRole,
} from '../types/mediaAsset';
import { slugify } from './camera';

const MEDIA_INDEX_DIR = `${RNFS.DocumentDirectoryPath}/DualViewCamera`;
const MEDIA_INDEX_PATH = `${MEDIA_INDEX_DIR}/media-index.json`;
const MAX_CAPTURE_GROUPS = 500;

type MediaIndexFile = {
  version: 1;
  groups: DualCaptureGroup[];
};

export async function loadMediaIndex(): Promise<DualCaptureGroup[]> {
  try {
    const exists = await RNFS.exists(MEDIA_INDEX_PATH);
    if (!exists) return [];
    const raw = await RNFS.readFile(MEDIA_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MediaIndexFile>;
    if (!Array.isArray(parsed.groups)) return [];
    return normalizeGroups(parsed.groups);
  } catch {
    await backupBrokenIndex().catch(() => {});
    return [];
  }
}

export async function upsertCaptureGroup(group: DualCaptureGroup): Promise<void> {
  const groups = await loadMediaIndex();
  const nextGroups = mergeGroup(groups, group)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_CAPTURE_GROUPS);

  await writeMediaIndex(nextGroups);
}

export function enrichGalleryMediaWithIndex(
  items: GalleryMedia[],
  groups: DualCaptureGroup[],
): GalleryMedia[] {
  if (groups.length === 0) return items;

  const byKey = new Map<string, { group: DualCaptureGroup; asset: DualMediaAsset }>();
  const matchedAssetIds = new Set<string>();
  groups.forEach(group => {
    group.assets.forEach(asset => {
      assetKeys(asset).forEach(key => byKey.set(key, { group, asset }));
    });
  });

  return items
    .map(item => {
      const match = itemKeys(item)
        .map(key => byKey.get(key))
        .find(Boolean);
      if (!match) return item;
      matchedAssetIds.add(match.asset.id);

      return {
        ...item,
        captureId: match.group.captureId,
        captureRole: match.asset.role,
        captureGroupSize: match.group.assets.length,
        captureGroupCreatedAt: match.group.createdAt,
        captureStatus: match.asset.status,
        errorMessage: match.asset.errorMessage,
      };
    })
    .concat(failedAssetsAsGalleryMedia(groups, matchedAssetIds))
    .sort((a, b) => {
      const aGroupTime = a.captureGroupCreatedAt ?? a.timestamp;
      const bGroupTime = b.captureGroupCreatedAt ?? b.timestamp;
      if (bGroupTime !== aGroupTime) return bGroupTime - aGroupTime;
      return roleSort(a.captureRole) - roleSort(b.captureRole);
    });
}

export function buildReadyAsset(input: {
  captureId: string;
  createdAt: number;
  type: 'photo' | 'video';
  role: DualMediaRole;
  aspect: DualMediaAsset['aspect'];
  uri: string;
  localPath?: string;
  sourceUri?: string;
}): DualMediaAsset {
  return {
    id: `${input.captureId}_${input.role}_${slugify(input.uri)}`,
    captureId: input.captureId,
    createdAt: input.createdAt,
    type: input.type,
    role: input.role,
    aspect: input.aspect,
    uri: input.uri,
    localPath: input.localPath,
    sourceUri: input.sourceUri,
    status: 'ready',
  };
}

export function buildFailedAsset(input: {
  captureId: string;
  createdAt: number;
  type: 'photo' | 'video';
  role: DualMediaRole;
  aspect: DualMediaAsset['aspect'];
  sourceUri?: string;
  errorMessage: string;
}): DualMediaAsset {
  return {
    id: `${input.captureId}_${input.role}_failed`,
    captureId: input.captureId,
    createdAt: input.createdAt,
    type: input.type,
    role: input.role,
    aspect: input.aspect,
    uri: `failed://${input.captureId}/${input.role}`,
    sourceUri: input.sourceUri,
    status: 'failed',
    errorMessage: input.errorMessage,
  };
}

async function writeMediaIndex(groups: DualCaptureGroup[]): Promise<void> {
  await ensureIndexDir();
  await RNFS.writeFile(
    MEDIA_INDEX_PATH,
    JSON.stringify({ version: 1, groups }, null, 2),
    'utf8',
  );
}

async function ensureIndexDir(): Promise<void> {
  const exists = await RNFS.exists(MEDIA_INDEX_DIR);
  if (!exists) {
    await RNFS.mkdir(MEDIA_INDEX_DIR);
  }
}

async function backupBrokenIndex(): Promise<void> {
  const exists = await RNFS.exists(MEDIA_INDEX_PATH);
  if (!exists) return;
  await ensureIndexDir();
  const target = `${MEDIA_INDEX_DIR}/media-index.broken.${Date.now()}.json`;
  await RNFS.moveFile(MEDIA_INDEX_PATH, target);
}

function mergeGroup(
  groups: DualCaptureGroup[],
  incoming: DualCaptureGroup,
): DualCaptureGroup[] {
  const existing = groups.find(group => group.captureId === incoming.captureId);
  if (!existing) return [incoming, ...groups];

  const assets = new Map<string, DualMediaAsset>();
  [...existing.assets, ...incoming.assets].forEach(asset => {
    assets.set(asset.id, asset);
  });

  return groups.map(group =>
    group.captureId === incoming.captureId
      ? {
          ...existing,
          ...incoming,
          assets: Array.from(assets.values()).sort(
            (a, b) => roleSort(a.role) - roleSort(b.role),
          ),
        }
      : group,
  );
}

function normalizeGroups(groups: DualCaptureGroup[]): DualCaptureGroup[] {
  return groups
    .filter(group => group?.captureId && Array.isArray(group.assets))
    .map(group => ({
      ...group,
      assets: group.assets.filter(asset => asset?.id && asset?.uri),
    }))
    .filter(group => group.assets.length > 0);
}

function assetKeys(asset: DualMediaAsset): string[] {
  return uniqueKeys([
    asset.uri,
    asset.localPath,
    normalizeFileUri(asset.localPath),
    filenameFromPath(asset.uri),
    filenameFromPath(asset.localPath),
  ]);
}

function failedAssetsAsGalleryMedia(
  groups: DualCaptureGroup[],
  matchedAssetIds: Set<string>,
): GalleryMedia[] {
  return groups.flatMap(group =>
    group.assets
      .filter(asset => {
        const hasReadyAssetForRole = group.assets.some(
          candidate => candidate.role === asset.role && candidate.status === 'ready',
        );
        return asset.status === 'failed' && !matchedAssetIds.has(asset.id) && !hasReadyAssetForRole;
      })
      .map(asset => ({
        id: asset.id,
        uri: asset.uri,
        filepath: null,
        type: asset.type === 'video' ? 'video' : 'photo',
        filename: null,
        fileSize: null,
        width: 0,
        height: 0,
        duration: 0,
        timestamp: asset.createdAt,
        captureId: group.captureId,
        captureRole: asset.role,
        captureGroupSize: group.assets.length,
        captureGroupCreatedAt: group.createdAt,
        captureStatus: 'failed',
        errorMessage: asset.errorMessage,
      })),
  );
}

function itemKeys(item: GalleryMedia): string[] {
  return uniqueKeys([
    item.uri,
    item.filepath ?? undefined,
    normalizeFileUri(item.filepath ?? undefined),
    item.filename ?? undefined,
    filenameFromPath(item.uri),
    filenameFromPath(item.filepath ?? undefined),
  ]);
}

function uniqueKeys(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function normalizeFileUri(path?: string): string | undefined {
  if (!path) return undefined;
  return path.startsWith('file://') ? path : `file://${path}`;
}

function filenameFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop();
}

function roleSort(role?: DualMediaRole): number {
  const order: DualMediaRole[] = [
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
