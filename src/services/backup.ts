import { migrate, SCHEMA_VERSION, UNTRACKED_TABLES } from '@/db/migrations';
import type { BindValue, Db } from '@/db/types';
import { sha256Hex } from '@/lib/hash';
import { newId, nowISO } from '@/lib/id';

/**
 * Backup and restore of the whole SQLite database (Phase 4).
 *
 * This is snapshot backup, not sync: a backup is a full copy of the database at one moment, and a
 * restore replaces everything on this device with such a copy. Nothing is merged.
 *
 * Native work (snapshot files, opening copies, swapping the live database, Drive HTTP) sits behind
 * the `BackupEngine` and `DriveStore` ports so every rule here runs against node:sqlite in tests.
 */

// ---------------------------------------------------------------------------
// Errors

export type BackupErrorCode =
  | 'not-a-database'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'corrupt'
  | 'not-money-tracker'
  | 'newer-schema'
  | 'upload-unverified'
  | 'no-recovery'
  | 'recovery-mismatch'
  | 'restore-unverified';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

// ---------------------------------------------------------------------------
// Ports

/** A database opened from bytes, private to the backup code (never the app's connection). */
export interface DatabaseCopy {
  readonly db: Db;
  close(): Promise<void>;
}

export interface BackupEngine {
  /** The app's database. */
  readonly live: Db;
  /** A path for `VACUUM INTO` that does not exist yet. */
  snapshotPath(): string;
  /** Reads the file `VACUUM INTO` wrote, then deletes it. */
  readSnapshot(path: string): Promise<Uint8Array>;
  /** Opens `bytes` as a separate in-memory database. */
  open(bytes: Uint8Array): Promise<DatabaseCopy>;
  /**
   * Replaces the whole content of the live database with `copy` in one SQLite transaction (online
   * backup API). Called with the live write queue held.
   */
  replaceLive(copy: DatabaseCopy): Promise<void>;
  /** Stores `bytes` as the recovery copy (replacing the previous one) and returns what was stored. */
  saveRecovery(bytes: Uint8Array): Promise<Uint8Array>;
  /** The stored recovery copy, or null when there is none. */
  loadRecovery(): Promise<Uint8Array | null>;
}

export type DriveFile = {
  id: string;
  name: string;
  size?: string | number | null;
  createdTime?: string | null;
  description?: string | null;
  appProperties?: Record<string, string> | null;
};

export type DriveUpload = { name: string; bytes: Uint8Array; appProperties: Record<string, string>; description: string };

/** Google Drive `appDataFolder`, as used by backups. */
export interface DriveStore {
  list(): Promise<DriveFile[]>;
  upload(file: DriveUpload): Promise<DriveFile>;
  download(fileId: string): Promise<Uint8Array>;
  remove(fileId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Device metadata (sync_meta)

export type SyncMeta = {
  deviceId: string;
  changeSeq: number;
  lastChangeAt: string | null;
  /** change_seq when the data last matched a known backup (one made here, or the one restored). */
  baselineSeq: number | null;
  baselineBackupId: string | null;
  baselineCreatedAt: string | null;
  baselineDeviceId: string | null;
  baselineSha256: string | null;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  lastRestoreSource: string | null;
  recoveryAt: string | null;
  recoveryLabel: string | null;
  recoverySha256: string | null;
  recoverySize: number | null;
  keepBackups: number;
  accountEmail: string | null;
};

type SyncMetaRow = {
  device_id: string;
  change_seq: number;
  last_change_at: string | null;
  baseline_seq: number | null;
  baseline_backup_id: string | null;
  baseline_created_at: string | null;
  baseline_device_id: string | null;
  baseline_sha256: string | null;
  last_backup_at: string | null;
  last_restore_at: string | null;
  last_restore_source: string | null;
  recovery_at: string | null;
  recovery_label: string | null;
  recovery_sha256: string | null;
  recovery_size: number | null;
  keep_backups: number;
  account_email: string | null;
};

export async function getSyncMeta(db: Db): Promise<SyncMeta> {
  const r = await db.first<SyncMetaRow>('SELECT * FROM sync_meta WHERE id = 1');
  if (!r) throw new Error('sync_meta is missing (database not migrated to v4)');
  return {
    deviceId: r.device_id,
    changeSeq: r.change_seq,
    lastChangeAt: r.last_change_at,
    baselineSeq: r.baseline_seq,
    baselineBackupId: r.baseline_backup_id,
    baselineCreatedAt: r.baseline_created_at,
    baselineDeviceId: r.baseline_device_id,
    baselineSha256: r.baseline_sha256,
    lastBackupAt: r.last_backup_at,
    lastRestoreAt: r.last_restore_at,
    lastRestoreSource: r.last_restore_source,
    recoveryAt: r.recovery_at,
    recoveryLabel: r.recovery_label,
    recoverySha256: r.recovery_sha256,
    recoverySize: r.recovery_size,
    keepBackups: r.keep_backups,
    accountEmail: r.account_email,
  };
}

export const KEEP_BACKUP_CHOICES = [3, 5, 10, 20];

export async function setKeepBackups(db: Db, keep: number): Promise<void> {
  if (!Number.isInteger(keep) || keep < 1 || keep > 100) throw new Error('Keep between 1 and 100 backups');
  await db.run('UPDATE sync_meta SET keep_backups = ?, updated_at = ? WHERE id = 1', [keep, nowISO()]);
}

/** Tables whose rows mean "the user has entered something" (categories are seeded, so they do not count). */
const USER_DATA_TABLES = ['accounts', 'transactions', 'companies', 'savings_goals', 'budgets', 'tags', 'merchants', 'fx_rates'];

export async function hasUserData(db: Db): Promise<boolean> {
  for (const t of USER_DATA_TABLES) {
    if (await db.first(`SELECT 1 AS x FROM ${t} LIMIT 1`)) return true;
  }
  return false;
}

export type LocalBackup = {
  id: string;
  createdAt: string;
  driveFileId: string | null;
  accountEmail: string | null;
  schemaVersion: number;
  sha256: string;
  size: number;
  deviceName: string | null;
  status: 'verified' | 'deleted';
};

export type BackupStatus = {
  meta: SyncMeta;
  hasData: boolean;
  /** The data has changes that are in no known backup (or was never backed up). */
  unbackedChanges: boolean;
  lastBackup: LocalBackup | null;
};

export function hasUnbackedChanges(meta: Pick<SyncMeta, 'baselineSeq' | 'changeSeq'>, hasData: boolean): boolean {
  return meta.baselineSeq === null ? hasData : meta.changeSeq > meta.baselineSeq;
}

export async function backupStatus(db: Db): Promise<BackupStatus> {
  const meta = await getSyncMeta(db);
  const hasData = await hasUserData(db);
  const last = await db.first<{
    id: string;
    created_at: string;
    drive_file_id: string | null;
    account_email: string | null;
    schema_version: number;
    sha256: string;
    size: number;
    device_name: string | null;
    status: 'verified' | 'deleted';
  }>(`SELECT * FROM backups WHERE status = 'verified' ORDER BY created_at DESC LIMIT 1`);
  return {
    meta,
    hasData,
    unbackedChanges: hasUnbackedChanges(meta, hasData),
    lastBackup: last
      ? {
          id: last.id,
          createdAt: last.created_at,
          driveFileId: last.drive_file_id,
          accountEmail: last.account_email,
          schemaVersion: last.schema_version,
          sha256: last.sha256,
          size: last.size,
          deviceName: last.device_name,
          status: last.status,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Snapshot, manifest and inspection

const SQLITE_MAGIC = 'SQLite format 3\0';

export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

/**
 * Header bytes 18–19 say "WAL mode" (2) in a file copied from a WAL database. An in-memory copy
 * cannot use WAL, so such files are opened as rollback-journal files (1). The data is unchanged.
 */
export function withRollbackHeader(bytes: Uint8Array): Uint8Array {
  if (bytes[18] === 1 && bytes[19] === 1) return bytes;
  const copy = new Uint8Array(bytes);
  copy[18] = 1;
  copy[19] = 1;
  return copy;
}

/**
 * Consistent copy of the live database, safe in WAL mode: checkpoint, then `VACUUM INTO` a new
 * file (one read transaction, so committed WAL content is included and nothing half-written is).
 * The live file is never copied directly. Run with the live write queue held.
 */
export async function takeSnapshot(engine: BackupEngine, held: Db): Promise<Uint8Array> {
  await held.first('PRAGMA wal_checkpoint(TRUNCATE)');
  const path = engine.snapshotPath();
  await held.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return engine.readSnapshot(path);
}

export async function tableRowCounts(db: Db, opts: { dataOnly?: boolean } = {}): Promise<Record<string, number>> {
  const tables = await db.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    if (opts.dataOnly && UNTRACKED_TABLES.includes(name)) continue;
    const r = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`);
    counts[name] = r?.n ?? 0;
  }
  return counts;
}

/** Tables every Money Tracker database has had since v1. */
const CORE_TABLES = ['accounts', 'transactions', 'postings', 'categories', 'companies', 'settings'];

export type Inspection = {
  schemaVersion: number;
  integrity: string[];
  foreignKeyErrors: number;
  missingTables: string[];
  rowCounts: Record<string, number>;
};

export async function inspectDatabase(db: Db): Promise<Inspection> {
  const integrity = (await db.all<{ integrity_check: string }>('PRAGMA integrity_check')).map((r) => r.integrity_check);
  const version = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  const names = new Set(
    (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name),
  );
  const missingTables = CORE_TABLES.filter((t) => !names.has(t));
  const foreignKeyErrors = missingTables.length ? 0 : (await db.all('PRAGMA foreign_key_check')).length;
  return {
    schemaVersion: version,
    integrity,
    foreignKeyErrors,
    missingTables,
    rowCounts: missingTables.length ? {} : await tableRowCounts(db, { dataOnly: true }),
  };
}

/** Why a database cannot be restored, or null when it can. */
export function restoreProblem(i: Inspection, appSchema = SCHEMA_VERSION): { code: BackupErrorCode; message: string } | null {
  if (i.integrity.length !== 1 || i.integrity[0] !== 'ok') {
    return { code: 'corrupt', message: `The backup is damaged (integrity check: ${i.integrity.slice(0, 3).join('; ')}).` };
  }
  if (i.missingTables.length || i.schemaVersion < 1) {
    return { code: 'not-money-tracker', message: 'This file is not a Money Tracker database.' };
  }
  if (i.schemaVersion > appSchema) {
    return {
      code: 'newer-schema',
      message: `This backup was made by a newer version of the app (data v${i.schemaVersion}, this app reads up to v${appSchema}). Update the app, then restore it.`,
    };
  }
  if (i.foreignKeyErrors > 0) {
    return { code: 'corrupt', message: `The backup has ${i.foreignKeyErrors} broken links between records.` };
  }
  return null;
}

/**
 * Opens `bytes` and checks that they can be restored. Throws a BackupError otherwise. A snapshot
 * about to be uploaded only needs to be intact: refusing to back up imperfect data would be worse.
 */
async function openVerified(
  engine: BackupEngine,
  bytes: Uint8Array,
  purpose: 'restore' | 'snapshot' = 'restore',
): Promise<{ copy: DatabaseCopy; inspection: Inspection }> {
  if (!isSqliteFile(bytes)) throw new BackupError('not-a-database', 'This file is not a database backup.');
  let copy: DatabaseCopy;
  try {
    copy = await engine.open(withRollbackHeader(bytes));
  } catch (e) {
    throw new BackupError('corrupt', `The backup could not be opened: ${(e as Error).message}`);
  }
  try {
    let inspection: Inspection;
    try {
      inspection = await inspectDatabase(copy.db);
    } catch (e) {
      throw new BackupError('corrupt', `The backup could not be read: ${(e as Error).message}`);
    }
    const problem = restoreProblem(purpose === 'restore' ? inspection : { ...inspection, foreignKeyErrors: 0 });
    if (problem) throw new BackupError(problem.code, problem.message);
    return { copy, inspection };
  } catch (e) {
    await copy.close();
    throw e;
  }
}

export const MANIFEST_FORMAT = 'money-tracker-backup';

export type BackupManifest = {
  format: typeof MANIFEST_FORMAT;
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  deviceId: string;
  deviceName: string | null;
  sha256: string;
  size: number;
  /** sync_meta.change_seq inside the snapshot. */
  changeSeq: number;
  rowCounts: Record<string, number>;
};

/** Size and SHA-256 must match the manifest exactly; anything else is a damaged or different file. */
export async function verifyBytes(bytes: Uint8Array, expected: Pick<BackupManifest, 'size' | 'sha256'>): Promise<void> {
  if (bytes.length !== expected.size) {
    throw new BackupError(
      'size-mismatch',
      `The backup is incomplete or damaged: ${bytes.length} bytes instead of ${expected.size}.`,
    );
  }
  const sha = await sha256Hex(bytes);
  if (sha !== expected.sha256) {
    throw new BackupError('hash-mismatch', 'The backup is damaged: its SHA-256 does not match the one recorded when it was made.');
  }
}

export type Snapshot = { bytes: Uint8Array; manifest: BackupManifest };

/** Snapshot + manifest. The snapshot is opened and checked before anything uses it. */
export async function createSnapshot(
  engine: BackupEngine,
  ctx: { appVersion: string; deviceName: string | null },
  createdAt: string = nowISO(),
): Promise<Snapshot> {
  const bytes = await engine.live.exclusive((held) => takeSnapshot(engine, held));
  const { copy, inspection } = await openVerified(engine, bytes, 'snapshot');
  try {
    const meta = await getSyncMeta(copy.db);
    return {
      bytes,
      manifest: {
        format: MANIFEST_FORMAT,
        formatVersion: 1,
        backupId: newId(),
        createdAt,
        appVersion: ctx.appVersion,
        schemaVersion: inspection.schemaVersion,
        deviceId: meta.deviceId,
        deviceName: ctx.deviceName,
        sha256: await sha256Hex(bytes),
        size: bytes.length,
        changeSeq: meta.changeSeq,
        rowCounts: inspection.rowCounts,
      },
    };
  } finally {
    await copy.close();
  }
}

// ---------------------------------------------------------------------------
// Drive metadata

/**
 * Drive limits each app property to 124 bytes (key + value), so the scalar fields go in
 * `appProperties` and the row counts in `description`.
 */
export function manifestToDrive(m: BackupManifest): Omit<DriveUpload, 'bytes'> {
  return {
    name: `money-tracker-${m.createdAt.replace(/[:.]/g, '-')}.db`,
    appProperties: {
      mt_format: `${m.format}/${m.formatVersion}`,
      backup_id: m.backupId,
      created_at: m.createdAt,
      app_version: m.appVersion.slice(0, 40),
      schema: String(m.schemaVersion),
      device_id: m.deviceId,
      device_name: (m.deviceName ?? '').slice(0, 60),
      sha256: m.sha256,
      size: String(m.size),
      change_seq: String(m.changeSeq),
    },
    description: JSON.stringify({ rowCounts: m.rowCounts }),
  };
}

const intOrNull = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/** Reads a backup's manifest from its Drive metadata; null for files that are not valid backups. */
export function manifestFromDrive(f: DriveFile): BackupManifest | null {
  const p = f.appProperties ?? {};
  if (p.mt_format !== `${MANIFEST_FORMAT}/1`) return null;
  const schemaVersion = intOrNull(p.schema);
  const size = intOrNull(p.size);
  const changeSeq = intOrNull(p.change_seq);
  if (schemaVersion === null || size === null || changeSeq === null) return null;
  if (!p.backup_id || !p.created_at || !p.device_id || !/^[0-9a-f]{64}$/.test(p.sha256 ?? '')) return null;
  let rowCounts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(f.description ?? '{}') as { rowCounts?: Record<string, number> };
    if (parsed.rowCounts && typeof parsed.rowCounts === 'object') rowCounts = parsed.rowCounts;
  } catch {
    // Counts are informative only; the hash is what protects the data.
  }
  return {
    format: MANIFEST_FORMAT,
    formatVersion: 1,
    backupId: p.backup_id,
    createdAt: p.created_at,
    appVersion: p.app_version ?? '',
    schemaVersion,
    deviceId: p.device_id,
    deviceName: p.device_name || null,
    sha256: p.sha256,
    size,
    changeSeq,
    rowCounts,
  };
}

export type RemoteBackup = {
  fileId: string;
  name: string;
  size: number | null;
  createdTime: string | null;
  /** Null when the file is not a valid backup (it is listed, never restored or deleted automatically). */
  manifest: BackupManifest | null;
};

export function toRemoteBackups(files: DriveFile[]): RemoteBackup[] {
  return files
    .map((f) => ({
      fileId: f.id,
      name: f.name,
      size: f.size == null ? null : Number(f.size),
      createdTime: f.createdTime ?? null,
      manifest: manifestFromDrive(f),
    }))
    .sort((a, b) => (b.manifest?.createdAt ?? b.createdTime ?? '').localeCompare(a.manifest?.createdAt ?? a.createdTime ?? ''));
}

export async function listRemoteBackups(drive: DriveStore): Promise<RemoteBackup[]> {
  return toRemoteBackups(await drive.list());
}

// ---------------------------------------------------------------------------
// Divergence (backup/restore is not sync: warn when devices have different data)

export type DivergenceCode = 'unbacked-changes' | 'other-device' | 'older-than-local' | 'newer-from-other-device' | 'empty-local';

export type Divergence = { code: DivergenceCode; message: string };

export type LocalState = {
  deviceId: string;
  hasData: boolean;
  unbackedChanges: boolean;
  baselineCreatedAt: string | null;
  baselineBackupId: string | null;
};

export function localState(s: BackupStatus): LocalState {
  return {
    deviceId: s.meta.deviceId,
    hasData: s.hasData,
    unbackedChanges: s.unbackedChanges,
    baselineCreatedAt: s.meta.baselineCreatedAt,
    baselineBackupId: s.meta.baselineBackupId,
  };
}

export type RestoreAssessment = {
  warnings: Divergence[];
  /**
   * Restoring would replace changes that are in no backup. The user must choose explicitly
   * (back up first, or replace them; a recovery copy is kept either way).
   */
  requiresChoice: boolean;
};

/** `target` is null for a file without a manifest: only local changes can be judged then. */
export function assessRestore(local: LocalState, target: BackupManifest | null): RestoreAssessment {
  const warnings: Divergence[] = [];
  if (local.hasData && local.unbackedChanges) {
    warnings.push({
      code: 'unbacked-changes',
      message: 'This phone has changes that are not in any backup. Restoring replaces them.',
    });
  }
  if (local.hasData && target && target.deviceId !== local.deviceId) {
    warnings.push({
      code: 'other-device',
      message: `This backup comes from another device${target.deviceName ? ` (${target.deviceName})` : ''}. Its data may differ from this phone's; nothing is merged.`,
    });
  }
  if (local.hasData && target && local.baselineCreatedAt && target.createdAt < local.baselineCreatedAt) {
    warnings.push({
      code: 'older-than-local',
      message: "This backup is older than the data on this phone (last backed up or restored state).",
    });
  }
  return { warnings, requiresChoice: warnings.some((w) => w.code === 'unbacked-changes') };
}

/** Warnings before backing up: another device may hold data this phone has never seen. */
export function assessBackup(local: LocalState, remotes: RemoteBackup[]): Divergence[] {
  const warnings: Divergence[] = [];
  const others = remotes.filter(
    (r) =>
      r.manifest &&
      r.manifest.deviceId !== local.deviceId &&
      r.manifest.backupId !== local.baselineBackupId &&
      (!local.baselineCreatedAt || r.manifest.createdAt > local.baselineCreatedAt),
  );
  if (!local.hasData && remotes.some((r) => r.manifest)) {
    warnings.push({
      code: 'empty-local',
      message: 'This phone has no data yet, but backups exist. To get your data back, restore one instead of backing up.',
    });
  } else if (others.length > 0) {
    const newest = others[0].manifest!;
    warnings.push({
      code: 'newer-from-other-device',
      message: `Drive has a newer backup from ${newest.deviceName ?? 'another device'} (${newest.createdAt.slice(0, 10)}) that this phone's data does not include. Backing up keeps it, but the two devices now differ.`,
    });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Retention

/**
 * Which backups to delete after `verifiedId` was uploaded and verified. Only this device's
 * backups are considered (another device's backups may hold data this phone never had), files
 * that are not valid backups are never touched, and the verified backup and the newest backup
 * are always kept. Nothing is deleted unless `verifiedId` is known.
 */
export function planRetention(remotes: RemoteBackup[], opts: { keep: number; deviceId: string; verifiedId: string }): string[] {
  const valid = remotes.filter((r) => r.manifest);
  if (!valid.some((r) => r.fileId === opts.verifiedId)) return [];
  const newest = [...valid].sort((a, b) => b.manifest!.createdAt.localeCompare(a.manifest!.createdAt))[0];
  const mine = valid
    .filter((r) => r.manifest!.deviceId === opts.deviceId)
    .sort((a, b) => b.manifest!.createdAt.localeCompare(a.manifest!.createdAt));
  const keep = Math.max(1, opts.keep);
  const kept = new Set([opts.verifiedId, newest.fileId, ...mine.slice(0, keep).map((r) => r.fileId)]);
  return mine.filter((r) => !kept.has(r.fileId)).map((r) => r.fileId);
}

// ---------------------------------------------------------------------------
// Backup

export async function recordBackup(db: Db, m: BackupManifest, driveFileId: string | null, accountEmail: string | null, at = nowISO()) {
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO backups (id, created_at, drive_file_id, account_email, schema_version, app_version, sha256, size, device_id,
         device_name, row_counts, change_seq, status, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?)`,
      [
        m.backupId,
        m.createdAt,
        driveFileId,
        accountEmail,
        m.schemaVersion,
        m.appVersion,
        m.sha256,
        m.size,
        m.deviceId,
        m.deviceName,
        JSON.stringify(m.rowCounts),
        m.changeSeq,
        at,
      ],
    );
    // The baseline is the snapshot's change_seq: writes made during the upload stay "not backed up".
    await tx.run(
      `UPDATE sync_meta SET baseline_seq = ?, baseline_backup_id = ?, baseline_created_at = ?, baseline_device_id = ?,
         baseline_sha256 = ?, last_backup_at = ?, account_email = ?, updated_at = ? WHERE id = 1`,
      [m.changeSeq, m.backupId, m.createdAt, m.deviceId, m.sha256, m.createdAt, accountEmail, at],
    );
  });
}

export async function markBackupsDeleted(db: Db, driveFileIds: string[], at = nowISO()): Promise<void> {
  if (!driveFileIds.length) return;
  await db.run(
    `UPDATE backups SET status = 'deleted', deleted_at = ? WHERE drive_file_id IN (${driveFileIds.map(() => '?').join(',')})`,
    [at, ...driveFileIds],
  );
}

export type BackupResult = {
  manifest: BackupManifest;
  fileId: string;
  deleted: string[];
  /** Old backups could not be cleaned up; the new backup is still complete and verified. */
  retentionError: string | null;
};

/**
 * Snapshot → upload → download again and compare the SHA-256 → record → retention. Old backups
 * are deleted only after the new one is verified. A failed verification removes the bad upload.
 */
export async function backupToDrive(
  engine: BackupEngine,
  drive: DriveStore,
  ctx: { appVersion: string; deviceName: string | null; accountEmail: string | null },
): Promise<BackupResult> {
  const { bytes, manifest } = await createSnapshot(engine, ctx);
  const uploaded = await drive.upload({ ...manifestToDrive(manifest), bytes });
  try {
    await verifyBytes(await drive.download(uploaded.id), manifest);
  } catch (e) {
    await drive.remove(uploaded.id).catch(() => undefined);
    throw new BackupError('upload-unverified', `The upload could not be verified, so it was discarded: ${(e as Error).message}`);
  }
  await recordBackup(engine.live, manifest, uploaded.id, ctx.accountEmail);

  let deleted: string[] = [];
  let retentionError: string | null = null;
  try {
    const meta = await getSyncMeta(engine.live);
    const remotes = await listRemoteBackups(drive);
    const plan = planRetention(remotes, { keep: meta.keepBackups, deviceId: manifest.deviceId, verifiedId: uploaded.id });
    for (const id of plan) {
      await drive.remove(id);
      deleted.push(id);
    }
  } catch (e) {
    retentionError = (e as Error).message;
  }
  await markBackupsDeleted(engine.live, deleted);
  return { manifest, fileId: uploaded.id, deleted, retentionError };
}

/** Deletes one backup chosen by the user. The only valid backup is never deleted. */
export async function deleteRemoteBackup(db: Db, drive: DriveStore, fileId: string): Promise<void> {
  const remotes = await listRemoteBackups(drive);
  const valid = remotes.filter((r) => r.manifest);
  if (valid.length <= 1 && valid.some((r) => r.fileId === fileId)) {
    throw new Error('This is your only backup, so it is kept. Make a new backup first.');
  }
  await drive.remove(fileId);
  await markBackupsDeleted(db, [fileId]);
}

export type VerifyResult = { ok: true; inspection: Inspection } | { ok: false; code: BackupErrorCode | 'unknown'; message: string };

/** Downloads a backup and checks size, SHA-256, SQLite integrity and schema, without restoring it. */
export async function verifyRemoteBackup(engine: BackupEngine, drive: DriveStore, remote: RemoteBackup): Promise<VerifyResult> {
  if (!remote.manifest) return { ok: false, code: 'not-money-tracker', message: 'This file has no backup information.' };
  const bytes = await drive.download(remote.fileId);
  try {
    await verifyBytes(bytes, remote.manifest);
    const { copy, inspection } = await openVerified(engine, bytes);
    await copy.close();
    return { ok: true, inspection };
  } catch (e) {
    if (e instanceof BackupError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'unknown', message: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Restore

export type RestoreSource =
  | { kind: 'drive'; label: string; manifest: BackupManifest }
  | { kind: 'file'; label: string }
  | { kind: 'recovery'; label: string };

export type RestoreResult = {
  fromSchema: number;
  schemaVersion: number;
  rowCounts: Record<string, number>;
  recovery: { at: string; label: string; size: number };
};

async function copyRows(from: Db, to: Db, table: string): Promise<void> {
  const rows = await from.all<Record<string, BindValue>>(`SELECT * FROM ${table}`);
  for (const r of rows) {
    const cols = Object.keys(r);
    await to.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => r[c]));
  }
}

/**
 * The restored database gets this device's own metadata: its device id, backup log, retention
 * setting and account stay; the restore and the new recovery copy are recorded. For a Drive
 * backup, the data now matches that backup (no unsaved changes). A file or the recovery copy keeps
 * the baseline it carries, which says whether its data was in a backup.
 */
async function adoptLocalMetadata(
  staged: Db,
  held: Db,
  source: RestoreSource,
  recovery: { at: string; label: string; sha256: string; size: number },
): Promise<void> {
  const live = await getSyncMeta(held);
  const at = recovery.at;
  await staged.transaction(async (tx) => {
    await tx.exec('DELETE FROM backups');
    await copyRows(held, tx, 'backups');
    await tx.run(
      `UPDATE sync_meta SET device_id = ?, keep_backups = ?, account_email = ?, last_backup_at = ?, last_restore_at = ?,
         last_restore_source = ?, recovery_at = ?, recovery_label = ?, recovery_sha256 = ?, recovery_size = ?, updated_at = ?
       WHERE id = 1`,
      [
        live.deviceId,
        live.keepBackups,
        live.accountEmail,
        live.lastBackupAt,
        at,
        source.label,
        recovery.at,
        recovery.label,
        recovery.sha256,
        recovery.size,
        at,
      ],
    );
    if (source.kind === 'drive') {
      const m = source.manifest;
      await tx.run(
        `UPDATE sync_meta SET baseline_seq = change_seq, baseline_backup_id = ?, baseline_created_at = ?, baseline_device_id = ?,
           baseline_sha256 = ? WHERE id = 1`,
        [m.backupId, m.createdAt, m.deviceId, m.sha256],
      );
    }
  });
}

/**
 * Verified, reversible restore:
 * 1. check size + SHA-256 (Drive backups), open the copy, integrity check, schema ≤ this app;
 * 2. migrate the copy (an older backup is upgraded before anything on the phone changes);
 * 3. with the write queue held: snapshot the current data as the recovery copy and read it back;
 * 4. replace the live database in one SQLite transaction, run migrations, and compare every
 *    table's row count with the copy. On a mismatch the recovery copy is put back.
 */
export async function restoreFromBytes(engine: BackupEngine, bytes: Uint8Array, source: RestoreSource, at = nowISO()): Promise<RestoreResult> {
  if (source.kind === 'drive') await verifyBytes(bytes, source.manifest);
  const { copy: staged, inspection } = await openVerified(engine, bytes);
  try {
    try {
      await migrate(staged.db);
    } catch (e) {
      throw new BackupError('corrupt', `The backup could not be upgraded to this app's data format: ${(e as Error).message}`);
    }

    return await engine.live.exclusive(async (held) => {
      const before = await takeSnapshot(engine, held);
      const stored = await engine.saveRecovery(before);
      const check = await openVerified(engine, stored, 'snapshot');
      const expected = await tableRowCounts(held, { dataOnly: true });
      const actual = check.inspection.rowCounts;
      await check.copy.close();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new BackupError('restore-unverified', 'The recovery copy could not be verified, so nothing was restored.');
      }
      const recovery = {
        at,
        label: source.kind === 'recovery' ? 'Data before undoing the restore' : `Data before restoring ${source.label}`,
        sha256: await sha256Hex(stored),
        size: stored.length,
      };

      await adoptLocalMetadata(staged.db, held, source, recovery);
      const want = await tableRowCounts(staged.db);
      await engine.replaceLive(staged);
      try {
        await migrate(held);
        const quick = await held.first<{ quick_check: string }>('PRAGMA quick_check');
        const got = await tableRowCounts(held);
        if (quick?.quick_check !== 'ok' || JSON.stringify(got) !== JSON.stringify(want)) {
          throw new Error('the restored data does not match the backup');
        }
      } catch (e) {
        const back = await engine.open(withRollbackHeader(stored));
        try {
          await engine.replaceLive(back);
        } finally {
          await back.close();
        }
        throw new BackupError('restore-unverified', `Restore failed and your previous data was put back: ${(e as Error).message}`);
      }
      return {
        fromSchema: inspection.schemaVersion,
        schemaVersion: SCHEMA_VERSION,
        rowCounts: await tableRowCounts(held, { dataOnly: true }),
        recovery: { at: recovery.at, label: recovery.label, size: recovery.size },
      };
    });
  } finally {
    await staged.close();
  }
}

export async function restoreFromDrive(engine: BackupEngine, drive: DriveStore, remote: RemoteBackup): Promise<RestoreResult> {
  if (!remote.manifest) throw new BackupError('not-money-tracker', 'This file has no backup information and cannot be restored.');
  const bytes = await drive.download(remote.fileId);
  return restoreFromBytes(engine, bytes, {
    kind: 'drive',
    label: `the backup of ${remote.manifest.createdAt.slice(0, 16).replace('T', ' ')} UTC`,
    manifest: remote.manifest,
  });
}

/** Puts back the recovery copy (the data as it was before the last restore). Reversible too. */
export async function undoRestore(engine: BackupEngine): Promise<RestoreResult> {
  const meta = await getSyncMeta(engine.live);
  const bytes = await engine.loadRecovery();
  if (!bytes || !meta.recoverySha256) throw new BackupError('no-recovery', 'There is no recovery copy on this phone.');
  if ((await sha256Hex(bytes)) !== meta.recoverySha256 || bytes.length !== meta.recoverySize) {
    throw new BackupError('recovery-mismatch', 'The recovery copy on this phone is damaged and was not used.');
  }
  return restoreFromBytes(engine, bytes, { kind: 'recovery', label: 'the recovery copy (undo)' });
}
