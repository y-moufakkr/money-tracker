import { readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { migrate, SCHEMA_VERSION, UNTRACKED_TABLES } from '@/db/migrations';
import { sha256Hex } from '@/lib/hash';
import { authErrorMessage } from '@/lib/google-errors';
import { createFileTestDb, fakeDrive } from '@/test/backup-engine';
import { DH, dumpData, populate, today } from '@/test/fixtures';
import { wrapNodeDb } from '@/test/node-db';
import { accountBalances, moneySummary } from './balances';
import {
  assessBackup,
  assessRestore,
  backupStatus,
  backupToDrive,
  BackupError,
  createSnapshot,
  deleteRemoteBackup,
  getSyncMeta,
  listRemoteBackups,
  localState,
  manifestFromDrive,
  manifestToDrive,
  planRetention,
  restoreFromBytes,
  restoreFromDrive,
  setKeepBackups,
  undoRestore,
  verifyRemoteBackup,
  withRollbackHeader,
  type BackupManifest,
  type RemoteBackup,
} from './backup';
import { saveExpense } from './ledger';
import { periodSummary } from './queries';

const ctx = { appVersion: '1.0.0', deviceName: 'Galaxy S22', accountEmail: 'me@example.com' };

type TestDb = Awaited<ReturnType<typeof createFileTestDb>>;
const opened: TestDb[] = [];
async function fileDb(version?: number) {
  const t = await createFileTestDb(version);
  opened.push(t);
  return t;
}
afterEach(() => {
  for (const t of opened.splice(0)) t.cleanup();
});

const tablesOf = async (db: TestDb['db']) =>
  (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map((r) => r.name);

function openBytes(bytes: Uint8Array) {
  const raw = new DatabaseSync(':memory:');
  raw.deserialize(withRollbackHeader(bytes));
  return wrapNodeDb(raw);
}

describe('snapshot', () => {
  it('is consistent with writes still in the WAL and contains every table, including company tables', async () => {
    const t = await fileDb();
    const ids = await populate(t.db);
    // An earlier automatic checkpoint moved everything into the main file; the next write is only in the WAL.
    t.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const lastExpense = await saveExpense(t.db, { date: today, amountMinor: DH(12), accountId: ids.wallet });

    // The latest writes are only in the -wal file: copying the database file directly would lose them.
    expect(statSync(`${t.livePath}-wal`).size).toBeGreaterThan(0);
    const rawCopy = openBytes(new Uint8Array(readFileSync(t.livePath)));
    expect(await rawCopy.first('SELECT id FROM transactions WHERE id = ?', [lastExpense])).toBeNull();
    expect(await rawCopy.first('SELECT id FROM transactions WHERE id = ?', [ids.groceries])).toEqual({ id: ids.groceries });

    const { bytes, manifest } = await createSnapshot(t.engine, ctx);
    const snap = openBytes(bytes);
    expect(await tablesOf(snap)).toEqual(await tablesOf(t.db));
    for (const table of ['company_liabilities', 'company_liability_payments', 'distributions', 'distribution_payments', 'tax_assumptions', 'company_fiscal_years', 'goal_allocations', 'transaction_tags', 'purchase_items']) {
      expect(manifest.rowCounts[table]).toBeGreaterThan(0);
    }
    expect(await dumpData(snap)).toEqual(await dumpData(t.db));
    expect(await snap.first('SELECT id FROM transactions WHERE id = ?', [lastExpense])).toEqual({ id: lastExpense });
    expect((await snap.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    // VACUUM INTO writes a standalone file (rollback journal), never a WAL-mode copy.
    expect([bytes[18], bytes[19]]).toEqual([1, 1]);
  });
});

describe('manifest and hash', () => {
  it('records the exact size, SHA-256, schema, device, change counter and row counts', async () => {
    const t = await fileDb();
    await populate(t.db);
    const { bytes, manifest } = await createSnapshot(t.engine, ctx, '2026-10-27T10:00:00.000Z');
    const meta = await getSyncMeta(t.db);
    expect(manifest).toMatchObject({
      format: 'money-tracker-backup',
      formatVersion: 1,
      createdAt: '2026-10-27T10:00:00.000Z',
      appVersion: '1.0.0',
      schemaVersion: SCHEMA_VERSION,
      deviceId: meta.deviceId,
      deviceName: 'Galaxy S22',
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      changeSeq: meta.changeSeq,
    });
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.rowCounts.transactions).toBe((await t.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions'))!.n);
    for (const table of UNTRACKED_TABLES) expect(manifest.rowCounts[table]).toBeUndefined();

    // Drive metadata round-trips and fits Drive's 124-byte limit per property.
    const drive = manifestToDrive(manifest);
    for (const [k, v] of Object.entries(drive.appProperties)) expect(new TextEncoder().encode(k + v).length).toBeLessThanOrEqual(124);
    expect(manifestFromDrive({ id: 'x', ...drive })).toEqual(manifest);
    expect(manifestFromDrive({ id: 'x', name: 'other.db', appProperties: { ...drive.appProperties, sha256: 'nope' } })).toBeNull();
    expect(manifestFromDrive({ id: 'x', name: 'random.txt' })).toBeNull();
  });

  it('rejects corrupted and truncated backups and leaves the data untouched', async () => {
    const source = await fileDb();
    await populate(source.db);
    const { bytes, manifest } = await createSnapshot(source.engine, ctx);
    const target = await fileDb();
    await populate(target.db);
    const before = await dumpData(target.db);
    const source_ = { kind: 'drive' as const, label: 'test', manifest };

    const flipped = new Uint8Array(bytes);
    flipped[flipped.length - 100] ^= 0x01;
    await expect(restoreFromBytes(target.engine, flipped, source_)).rejects.toMatchObject({ code: 'hash-mismatch' });
    await expect(restoreFromBytes(target.engine, bytes.slice(0, bytes.length - 4096), source_)).rejects.toMatchObject({ code: 'size-mismatch' });

    // Files without a manifest (a local backup file) are checked by opening them.
    await expect(restoreFromBytes(target.engine, bytes.slice(0, 50), { kind: 'file', label: 'f' })).rejects.toMatchObject({ code: 'not-a-database' });
    await expect(restoreFromBytes(target.engine, new TextEncoder().encode('a,b,c\n1,2,3\n'.repeat(20)), { kind: 'file', label: 'f' })).rejects.toBeInstanceOf(BackupError);
    await expect(restoreFromBytes(target.engine, bytes.slice(0, 8192), { kind: 'file', label: 'f' })).rejects.toMatchObject({ code: 'corrupt' });
    const notOurs = new DatabaseSync(':memory:');
    notOurs.exec('CREATE TABLE notes (x); PRAGMA user_version = 2');
    await expect(restoreFromBytes(target.engine, notOurs.serialize(), { kind: 'file', label: 'f' })).rejects.toMatchObject({ code: 'not-money-tracker' });

    expect(await dumpData(target.db)).toEqual(before);
    expect((await getSyncMeta(target.db)).recoveryAt).toBeNull();
  });
});

describe('schema versions', () => {
  it('refuses a backup from a newer schema', async () => {
    const source = await fileDb();
    await populate(source.db);
    const { bytes } = await createSnapshot(source.engine, ctx);
    const raw = new DatabaseSync(':memory:');
    raw.deserialize(bytes);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const newer = raw.serialize();

    const target = await fileDb();
    const before = await dumpData(target.db);
    await expect(restoreFromBytes(target.engine, newer, { kind: 'file', label: 'newer' })).rejects.toMatchObject({ code: 'newer-schema' });
    expect(await dumpData(target.db)).toEqual(before);
  });

  it('restores an older (v3) backup and migrates it', async () => {
    const old = await fileDb(3);
    const ids = await populate(old.db);
    const oldBalances = await accountBalances(old.db);
    // A v3 app has no sync_meta: snapshot it the way the v3 schema stores it.
    old.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    old.raw.exec(`VACUUM INTO '${old.dir}/v3.db'`);
    const bytes = new Uint8Array(readFileSync(`${old.dir}/v3.db`));

    const target = await fileDb();
    const deviceId = (await getSyncMeta(target.db)).deviceId;
    const r = await restoreFromBytes(target.engine, bytes, { kind: 'file', label: 'v3 file' });
    expect(r.fromSchema).toBe(3);
    expect(r.schemaVersion).toBe(SCHEMA_VERSION);
    expect((await target.db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    expect(await accountBalances(target.db)).toEqual(oldBalances);
    // The migrated copy (incl. the v5 transactions rebuild) gives the same personal money.
    const personal = (await moneySummary(target.db)).personal;
    expect(personal.liquid).toBe(oldBalances.filter((b) => b.ownership === 'personal').reduce((sum, b) => sum + b.balanceMinor, 0));
    expect(personal.reservedGoals).toBe(DH(5000));
    expect(await target.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await target.db.first('SELECT id FROM distributions WHERE id = ?', [ids.distribution])).toEqual({ id: ids.distribution });
    // The phone keeps its own identity; the restored data was never backed up from here.
    const status = await backupStatus(target.db);
    expect(status.meta.deviceId).toBe(deviceId);
    expect(status.unbackedChanges).toBe(true);
    // Change tracking works on the migrated data.
    const seq = status.meta.changeSeq;
    await saveExpense(target.db, { date: today, amountMinor: DH(5), accountId: ids.wallet });
    expect((await getSyncMeta(target.db)).changeSeq).toBeGreaterThan(seq);
  });
});

describe('restore and undo', () => {
  it('keeps a recovery copy, and undo puts back exactly the previous data', async () => {
    const phoneA = await fileDb();
    await populate(phoneA.db);
    const { drive } = fakeDrive();
    await backupToDrive(phoneA.engine, drive, ctx);

    const phoneB = await fileDb();
    const b = await populate(phoneB.db);
    await saveExpense(phoneB.db, { date: today, amountMinor: DH(33), accountId: b.wallet, note: 'only on B' });
    const beforeB = await dumpData(phoneB.db);
    const balancesB = await accountBalances(phoneB.db);
    const metaB = await getSyncMeta(phoneB.db);

    const [remote] = await listRemoteBackups(drive);
    const result = await restoreFromDrive(phoneB.engine, drive, remote);
    expect(result.recovery.label).toMatch(/before restoring/);
    expect(await dumpData(phoneB.db)).toEqual(await dumpData(phoneA.db));
    const restoredMeta = await getSyncMeta(phoneB.db);
    expect(restoredMeta.deviceId).toBe(metaB.deviceId);
    expect(restoredMeta.recoveryAt).not.toBeNull();
    expect(restoredMeta.lastRestoreSource).toMatch(/backup of/);
    // The data now matches that backup exactly: nothing unsaved.
    expect((await backupStatus(phoneB.db)).unbackedChanges).toBe(false);
    expect(restoredMeta.baselineBackupId).toBe(remote.manifest!.backupId);

    // The recovery copy holds B's data as it was.
    const recovery = openBytes((await phoneB.engine.loadRecovery())!);
    expect(await dumpData(recovery)).toEqual(beforeB);

    await undoRestore(phoneB.engine);
    expect(await dumpData(phoneB.db)).toEqual(beforeB);
    expect(await accountBalances(phoneB.db)).toEqual(balancesB);
    const undone = await getSyncMeta(phoneB.db);
    expect(undone.deviceId).toBe(metaB.deviceId);
    expect(undone.baselineSeq).toBe(metaB.baselineSeq);
    expect((await backupStatus(phoneB.db)).unbackedChanges).toBe(true);
    // Undo is reversible as well: the recovery copy is now the restored data.
    expect(await dumpData(openBytes((await phoneB.engine.loadRecovery())!))).toEqual(await dumpData(phoneA.db));
  });

  it('refuses a damaged recovery copy', async () => {
    const t = await fileDb();
    await expect(undoRestore(t.engine)).rejects.toMatchObject({ code: 'no-recovery' });
    await populate(t.db);
    const { bytes } = await createSnapshot(t.engine, ctx);
    await restoreFromBytes(t.engine, bytes, { kind: 'file', label: 'same data' });
    await t.db.run("UPDATE sync_meta SET recovery_sha256 = 'x' WHERE id = 1");
    await expect(undoRestore(t.engine)).rejects.toMatchObject({ code: 'recovery-mismatch' });
  });
});

describe('backup to Drive', () => {
  it('verifies the upload by downloading it again before recording it', async () => {
    const t = await fileDb();
    await populate(t.db);
    expect((await backupStatus(t.db)).unbackedChanges).toBe(true);
    const { drive, files } = fakeDrive();
    const r = await backupToDrive(t.engine, drive, ctx);
    expect(files.has(r.fileId)).toBe(true);
    const status = await backupStatus(t.db);
    expect(status.unbackedChanges).toBe(false);
    expect(status.lastBackup).toMatchObject({ id: r.manifest.backupId, driveFileId: r.fileId, sha256: r.manifest.sha256, accountEmail: 'me@example.com' });
    expect((await verifyRemoteBackup(t.engine, drive, (await listRemoteBackups(drive))[0])).ok).toBe(true);

    // Any later write counts as a local change.
    await saveExpense(t.db, { date: today, amountMinor: DH(1), accountId: (await t.db.first<{ id: string }>("SELECT id FROM accounts WHERE name = 'Wallet'"))!.id });
    expect((await backupStatus(t.db)).unbackedChanges).toBe(true);
  });

  it('discards an upload that does not verify and deletes nothing', async () => {
    const t = await fileDb();
    await populate(t.db);
    const { drive, files, state } = fakeDrive();
    const first = await backupToDrive(t.engine, drive, ctx);
    state.corruptNextDownload = true;
    await expect(backupToDrive(t.engine, drive, ctx)).rejects.toMatchObject({ code: 'upload-unverified' });
    expect([...files.keys()]).toEqual([first.fileId]);
    expect((await backupStatus(t.db)).lastBackup?.id).toBe(first.manifest.backupId);

    // An integrity check catches damage on Drive.
    state.corruptNextDownload = true;
    const v = await verifyRemoteBackup(t.engine, drive, (await listRemoteBackups(drive))[0]);
    expect(v).toMatchObject({ ok: false, code: 'hash-mismatch' });
  });

  it('keeps the configured number of backups, deleting old ones only after a verified upload', async () => {
    const t = await fileDb();
    await populate(t.db);
    await setKeepBackups(t.db, 2);
    const { drive, files, state } = fakeDrive();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await backupToDrive(t.engine, drive, ctx)).fileId);
    expect([...files.keys()].sort()).toEqual(ids.slice(2).sort());
    expect(await t.db.all(`SELECT drive_file_id FROM backups WHERE status = 'deleted' ORDER BY created_at`)).toEqual(
      ids.slice(0, 2).map((id) => ({ drive_file_id: id })),
    );

    // A failed clean-up never fails the backup itself.
    state.failRemove = true;
    const r = await backupToDrive(t.engine, drive, ctx);
    expect(r.retentionError).toMatch(/network/);
    expect(files.has(r.fileId)).toBe(true);
  });

  it('never deletes the only valid backup', async () => {
    const t = await fileDb();
    await populate(t.db);
    const { drive } = fakeDrive();
    const r = await backupToDrive(t.engine, drive, ctx);
    await expect(deleteRemoteBackup(t.db, drive, r.fileId)).rejects.toThrow(/only backup/);
    const r2 = await backupToDrive(t.engine, drive, ctx);
    await deleteRemoteBackup(t.db, drive, r.fileId);
    expect((await listRemoteBackups(drive)).map((x) => x.fileId)).toEqual([r2.fileId]);
  });
});

const manifest = (over: Partial<BackupManifest>): BackupManifest => ({
  format: 'money-tracker-backup',
  formatVersion: 1,
  backupId: 'b',
  createdAt: '2026-10-20T10:00:00.000Z',
  appVersion: '1.0.0',
  schemaVersion: SCHEMA_VERSION,
  deviceId: 'phone',
  deviceName: 'Galaxy S22',
  sha256: 'a'.repeat(64),
  size: 1000,
  changeSeq: 10,
  rowCounts: {},
  ...over,
});
const remote = (fileId: string, m: Partial<BackupManifest> | null): RemoteBackup => ({
  fileId,
  name: `${fileId}.db`,
  size: 1000,
  createdTime: m?.createdAt ?? null,
  manifest: m ? manifest({ backupId: fileId, ...m }) : null,
});

describe('retention plan', () => {
  const mine = (id: string, day: number) => remote(id, { deviceId: 'phone', createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z` });

  it('deletes only this device’s oldest backups beyond the limit', () => {
    const remotes = [mine('a', 1), mine('b', 2), mine('c', 3), mine('d', 4), remote('other', { deviceId: 'tablet', createdAt: '2026-09-01T00:00:00.000Z' }), remote('junk', null)];
    expect(planRetention(remotes, { keep: 2, deviceId: 'phone', verifiedId: 'd' }).sort()).toEqual(['a', 'b']);
  });

  it('never deletes the verified, the newest or the only backup, and nothing without a verified upload', () => {
    expect(planRetention([mine('a', 1)], { keep: 1, deviceId: 'phone', verifiedId: 'a' })).toEqual([]);
    // The newest backup overall is kept even if it is not the one just verified.
    expect(planRetention([mine('a', 1), mine('b', 2), mine('c', 3)], { keep: 1, deviceId: 'phone', verifiedId: 'a' })).toEqual(['b']);
    expect(planRetention([mine('a', 1), mine('b', 2), mine('c', 3)], { keep: 1, deviceId: 'phone', verifiedId: 'missing' })).toEqual([]);
    expect(planRetention([mine('a', 1), mine('b', 2)], { keep: 0, deviceId: 'phone', verifiedId: 'b' })).toEqual(['a']);
  });
});

describe('divergence', () => {
  const local = { deviceId: 'phone', hasData: true, unbackedChanges: false, baselineCreatedAt: '2026-10-20T10:00:00.000Z', baselineBackupId: 'base' };

  it('requires a choice when the phone has changes that are in no backup', () => {
    const a = assessRestore({ ...local, unbackedChanges: true }, manifest({ deviceId: 'tablet', deviceName: 'Tab S9', createdAt: '2026-10-10T10:00:00.000Z' }));
    expect(a.requiresChoice).toBe(true);
    expect(a.warnings.map((w) => w.code)).toEqual(['unbacked-changes', 'other-device', 'older-than-local']);
    expect(a.warnings[1].message).toMatch(/Tab S9/);
    // A file without backup information: only the local changes can be judged.
    expect(assessRestore({ ...local, unbackedChanges: true }, null)).toEqual({ requiresChoice: true, warnings: [expect.objectContaining({ code: 'unbacked-changes' })] });
  });

  it('warns about another device or an older backup even without local changes', () => {
    expect(assessRestore(local, manifest({ deviceId: 'tablet', createdAt: '2026-10-25T10:00:00.000Z' }))).toEqual({
      requiresChoice: false,
      warnings: [expect.objectContaining({ code: 'other-device' })],
    });
    expect(assessRestore(local, manifest({ createdAt: '2026-10-01T10:00:00.000Z' })).warnings.map((w) => w.code)).toEqual(['older-than-local']);
    expect(assessRestore(local, manifest({ createdAt: '2026-10-21T10:00:00.000Z' })).warnings).toEqual([]);
  });

  it('does not warn on a fresh install (no data): restoring is the expected recovery', () => {
    const fresh = { deviceId: 'new-install', hasData: false, unbackedChanges: false, baselineCreatedAt: null, baselineBackupId: null };
    expect(assessRestore(fresh, manifest({}))).toEqual({ warnings: [], requiresChoice: false });
    expect(assessBackup(fresh, [remote('x', {})]).map((w) => w.code)).toEqual(['empty-local']);
  });

  it('warns before backing up when another device made a newer backup', () => {
    const newer = remote('t', { deviceId: 'tablet', deviceName: 'Tab S9', createdAt: '2026-10-25T10:00:00.000Z' });
    expect(assessBackup(local, [newer]).map((w) => w.code)).toEqual(['newer-from-other-device']);
    expect(assessBackup(local, [remote('t', { deviceId: 'tablet', createdAt: '2026-10-01T10:00:00.000Z' })])).toEqual([]);
    expect(assessBackup({ ...local, baselineBackupId: 't' }, [newer])).toEqual([]);
    expect(assessBackup(local, [remote('p', { deviceId: 'phone', createdAt: '2026-10-25T10:00:00.000Z' })])).toEqual([]);
  });

  it('detects local changes made after the last backup on a real database', async () => {
    const t = await fileDb();
    const ids = await populate(t.db);
    const { drive } = fakeDrive();
    await backupToDrive(t.engine, drive, ctx);
    const [own] = await listRemoteBackups(drive);
    expect(assessRestore(localState(await backupStatus(t.db)), own.manifest!).requiresChoice).toBe(false);
    await saveExpense(t.db, { date: today, amountMinor: DH(9), accountId: ids.wallet });
    const after = assessRestore(localState(await backupStatus(t.db)), own.manifest!);
    expect(after.requiresChoice).toBe(true);
    expect(after.warnings.map((w) => w.code)).toEqual(['unbacked-changes']);
  });
});

describe('change tracking', () => {
  it('every user-data table has change triggers', async () => {
    const t = await fileDb();
    const tables = (await tablesOf(t.db)).filter((n) => !n.startsWith('sqlite_') && !UNTRACKED_TABLES.includes(n));
    const triggers = new Set((await t.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)).map((r) => r.name));
    for (const table of tables) {
      for (const op of ['insert', 'update', 'delete']) expect(triggers).toContain(`trg_change_${table}_${op}`);
    }
  });

  it('reads and settings preferences do not count as changes', async () => {
    const t = await fileDb();
    const ids = await populate(t.db);
    const seq = (await getSyncMeta(t.db)).changeSeq;
    await moneySummary(t.db);
    await periodSummary(t.db, { from: today, to: today });
    await t.db.run(`INSERT INTO settings (key, value) VALUES ('last_income_account', ?)`, [ids.bank]);
    expect((await getSyncMeta(t.db)).changeSeq).toBe(seq);
  });
});

describe('Google sign-in errors', () => {
  it('explains cancel, network and DEVELOPER_ERROR clearly', () => {
    expect(authErrorMessage({ code: '10', message: 'DEVELOPER_ERROR' })).toMatch(/signing key|SHA-1/);
    expect(authErrorMessage({ code: '7', message: 'NETWORK_ERROR' })).toMatch(/internet/);
    expect(authErrorMessage({ code: 'PLAY_SERVICES_NOT_AVAILABLE', message: '' })).toMatch(/Play services/);
    expect(authErrorMessage(new Error('boom'))).toMatch(/boom/);
  });
});

it('migrate is a no-op on a restored, current database', async () => {
  const t = await fileDb();
  expect(await migrate(t.db)).toBe(SCHEMA_VERSION);
});
