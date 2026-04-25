import RNFS from 'react-native-fs';

import type { MediaJob, MediaJobStatus, MediaJobType } from '../types/mediaJob';

const MEDIA_JOB_DIR = `${RNFS.DocumentDirectoryPath}/DualViewCamera`;
const MEDIA_JOB_PATH = `${MEDIA_JOB_DIR}/media-jobs.json`;
const MAX_MEDIA_JOBS = 300;

type MediaJobFile = {
  version: 1;
  jobs: MediaJob[];
};

let writeChain: Promise<void> = Promise.resolve();
let executionChain: Promise<void> = Promise.resolve();

export function createMediaJob(input: {
  id?: string;
  captureId: string;
  type: MediaJobType;
  input: Record<string, unknown>;
  now?: number;
}): MediaJob {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? `${input.captureId}_${input.type}_${now}`,
    captureId: input.captureId,
    type: input.type,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    input: input.input,
    retryCount: 0,
  };
}

export async function loadMediaJobs(): Promise<MediaJob[]> {
  try {
    const exists = await RNFS.exists(MEDIA_JOB_PATH);
    if (!exists) return [];
    const raw = await RNFS.readFile(MEDIA_JOB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MediaJobFile>;
    if (!Array.isArray(parsed.jobs)) return [];
    return normalizeJobs(parsed.jobs);
  } catch {
    await backupBrokenJobs().catch(() => {});
    return [];
  }
}

export async function saveMediaJobs(jobs: MediaJob[]): Promise<void> {
  const nextJobs = pruneJobs(normalizeJobs(jobs));
  writeChain = writeChain.then(async () => {
    await ensureJobDir();
    await RNFS.writeFile(
      MEDIA_JOB_PATH,
      JSON.stringify({ version: 1, jobs: nextJobs }, null, 2),
      'utf8',
    );
  });
  return writeChain;
}

export async function upsertMediaJob(job: MediaJob): Promise<MediaJob[]> {
  const jobs = await loadMediaJobs();
  const nextJobs = upsertMediaJobInList(jobs, job);
  await saveMediaJobs(nextJobs);
  return nextJobs;
}

export async function updateMediaJob(
  id: string,
  patch: Partial<Omit<MediaJob, 'id' | 'captureId' | 'type' | 'createdAt'>>,
  now = Date.now(),
): Promise<MediaJob[]> {
  const jobs = await loadMediaJobs();
  const nextJobs = updateMediaJobInList(jobs, id, patch, now);
  await saveMediaJobs(nextJobs);
  return nextJobs;
}

export function runQueuedMediaJob<T>(runner: () => Promise<T>): Promise<T> {
  const run = executionChain.then(runner, runner);
  executionChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export function upsertMediaJobInList(jobs: MediaJob[], job: MediaJob): MediaJob[] {
  const nextJobs = jobs.filter(item => item.id !== job.id);
  return pruneJobs([job, ...nextJobs]);
}

export function updateMediaJobInList(
  jobs: MediaJob[],
  id: string,
  patch: Partial<Omit<MediaJob, 'id' | 'captureId' | 'type' | 'createdAt'>>,
  now = Date.now(),
): MediaJob[] {
  return pruneJobs(
    jobs.map(job =>
      job.id === id
        ? {
            ...job,
            ...patch,
            updatedAt: now,
            progress: clampProgress(patch.progress ?? job.progress),
          }
        : job,
    ),
  );
}

export function markStaleRunningJobs(
  jobs: MediaJob[],
  now = Date.now(),
): MediaJob[] {
  return jobs.map(job =>
    job.status === 'queued' || job.status === 'running'
      ? {
          ...job,
          status: 'failed',
          progress: job.progress,
          updatedAt: now,
          errorMessage: job.errorMessage ?? '应用重启前后台任务未完成',
        }
      : job,
  );
}

export function isVisibleMediaJob(job: MediaJob, now = Date.now()): boolean {
  if (job.status === 'queued' || job.status === 'running') return true;
  if (job.status === 'failed') return now - job.updatedAt < 12000;
  if (job.status === 'succeeded') return now - job.updatedAt < 4000;
  return false;
}

function normalizeJobs(jobs: MediaJob[]): MediaJob[] {
  return jobs
    .filter(job => job?.id && job.captureId && job.type)
    .map(job => ({
      ...job,
      status: normalizeStatus(job.status),
      progress: clampProgress(job.progress),
      createdAt: Number.isFinite(job.createdAt) ? job.createdAt : Date.now(),
      updatedAt: Number.isFinite(job.updatedAt) ? job.updatedAt : Date.now(),
      input: job.input && typeof job.input === 'object' ? job.input : {},
      retryCount: Number.isFinite(job.retryCount) ? job.retryCount : 0,
    }));
}

function normalizeStatus(status: MediaJobStatus): MediaJobStatus {
  const statuses: MediaJobStatus[] = [
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ];
  return statuses.includes(status) ? status : 'failed';
}

function pruneJobs(jobs: MediaJob[]): MediaJob[] {
  return [...jobs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_MEDIA_JOBS);
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

async function ensureJobDir(): Promise<void> {
  const exists = await RNFS.exists(MEDIA_JOB_DIR);
  if (!exists) {
    await RNFS.mkdir(MEDIA_JOB_DIR);
  }
}

async function backupBrokenJobs(): Promise<void> {
  const exists = await RNFS.exists(MEDIA_JOB_PATH);
  if (!exists) return;
  await ensureJobDir();
  await RNFS.moveFile(
    MEDIA_JOB_PATH,
    `${MEDIA_JOB_DIR}/media-jobs.broken.${Date.now()}.json`,
  );
}
