import { migrate } from '@/db/migrations';
import { sha256Hex } from '@/lib/hash';
import { memoryAttachmentStore } from '@/test/attachment-store';
import { createFileTestDb, fakeDrive } from '@/test/backup-engine';
import { count, DH, dumpData, personalAccount, populate, today } from '@/test/fixtures';
import { createTestDb } from '@/test/node-db';
import {
  deleteTransactionWithFiles,
  findDuplicates,
  listAttachments,
  removeAttachment,
  saveExpenseWithAttachments,
  type NewAttachment,
} from './attachments';
import { accountBalances } from './balances';
import {
  backupToDrive,
  BackupError,
  createSnapshot,
  getSyncMeta,
  listRemoteBackups,
  restoreFromBytes,
  restoreFromDrive,
  verifyRemoteBackup,
} from './backup';
import { exportJson } from './export';

/** A fake JPEG: the bytes only need to be distinct and non-empty. */
const photo = (seed: number, size = 2048): NewAttachment => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) bytes[i] = (i * 31 + seed * 17) & 0xff;
  return { bytes, mime: 'image/jpeg' };
};

async function setup() {
  const db = await createTestDb();
  const wallet = await personalAccount(db, 'Wallet', 'cash', 800);
  const files = memoryAttachmentStore();
  return { db, wallet, ...files };
}

describe('receipt attachments', () => {
  it('saves an expense with its photo: file written, row in the same transaction, SHA-256 recorded', async () => {
    const { db, wallet, store, files } = await setup();
    const p = photo(1);
    const id = await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(100), accountId: wallet, merchantName: 'Marjane' }, null, {
      add: [p],
    });
    const [a] = await listAttachments(db, id);
    expect(a).toMatchObject({ transactionId: id, mime: 'image/jpeg', size: p.bytes.length, sha256: await sha256Hex(p.bytes) });
    expect(a.path).toMatch(/^attachments\/[0-9a-f-]+\.jpg$/);
    expect(files.get(a.path)).toEqual(p.bytes);
    // A photo never moves money.
    expect((await accountBalances(db)).find((b) => b.id === wallet)!.balanceMinor).toBe(DH(700));
  });

  it('a failed save leaves no orphan file and no row', async () => {
    const { db, wallet, store, files } = await setup();
    // Ledger refusal (future date) after the file was written.
    await expect(
      saveExpenseWithAttachments(db, store, { date: '2999-01-01', amountMinor: DH(10), accountId: wallet }, null, { add: [photo(1), photo(2)] }),
    ).rejects.toThrow(/Future dates/);
    // Refusal inside the transaction (unknown account).
    await expect(
      saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(10), accountId: 'nope' }, null, { add: [photo(3)] }),
    ).rejects.toThrow();
    expect(files.size).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM attachments')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('a failed file write saves nothing', async () => {
    const { db, wallet, store, files, state } = await setup();
    state.failWrites = true;
    await expect(
      saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(10), accountId: wallet }, null, { add: [photo(1)] }),
    ).rejects.toThrow(/No space/);
    expect(files.size).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('editing keeps photos, can add and remove them; removed files are deleted after the commit', async () => {
    const { db, wallet, store, files } = await setup();
    const input = { date: today, amountMinor: DH(50), accountId: wallet };
    const id = await saveExpenseWithAttachments(db, store, input, null, { add: [photo(1)] });
    const [first] = await listAttachments(db, id);
    await saveExpenseWithAttachments(db, store, { ...input, amountMinor: DH(55) }, id);
    expect((await listAttachments(db, id)).map((a) => a.id)).toEqual([first.id]);

    await saveExpenseWithAttachments(db, store, input, id, { add: [photo(2)], removeIds: [first.id] });
    const after = await listAttachments(db, id);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(first.id);
    expect(files.has(first.path)).toBe(false);
    expect([...files.keys()]).toEqual([after[0].path]);

    // Removing a photo that belongs to another expense is refused and changes nothing.
    const other = await saveExpenseWithAttachments(db, store, input, null, { add: [photo(3)] });
    const [otherPhoto] = await listAttachments(db, other);
    await expect(saveExpenseWithAttachments(db, store, input, id, { add: [photo(4)], removeIds: [otherPhoto.id] })).rejects.toThrow(/not found/);
    expect(files.size).toBe(2);

    await removeAttachment(db, store, after[0].id);
    expect(await listAttachments(db, id)).toEqual([]);
    expect([...files.keys()]).toEqual([otherPhoto.path]);
  });

  it('deleting a transaction removes its photos (rows and files)', async () => {
    const { db, wallet, store, files } = await setup();
    const id = await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(20), accountId: wallet }, null, {
      add: [photo(1), photo(2)],
    });
    const keep = await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(30), accountId: wallet }, null, { add: [photo(3)] });
    await deleteTransactionWithFiles(db, store, id);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM attachments WHERE transaction_id = ?', [id])).toBe(0);
    expect(files.size).toBe(1);
    expect((await listAttachments(db, keep))[0].path).toBe([...files.keys()][0]);
  });

  it('attachment writes count as changes for backup', async () => {
    const { db, wallet, store } = await setup();
    const id = await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(20), accountId: wallet });
    const seq = (await getSyncMeta(db)).changeSeq;
    await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(20), accountId: wallet }, id, { add: [photo(1)] });
    expect((await getSyncMeta(db)).changeSeq).toBeGreaterThan(seq);
    const triggers = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'attachments' ORDER BY name`);
    expect(triggers.map((t) => t.name)).toEqual(['trg_change_attachments_delete', 'trg_change_attachments_insert', 'trg_change_attachments_update']);
  });

  it('refuses non-photo files and paths outside the attachments folder', async () => {
    const { db, wallet, store, files } = await setup();
    await expect(
      saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(5), accountId: wallet }, null, {
        add: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'application/x-sh' }],
      }),
    ).rejects.toThrow(/Only photos/);
    const p = photo(1);
    await expect(
      saveExpenseWithAttachments(db, store, {
        date: today,
        amountMinor: DH(5),
        accountId: wallet,
        attachments: [{ id: 'x', path: '../money-tracker.db', mime: 'image/jpeg', sha256: await sha256Hex(p.bytes), size: 10 }],
      }),
    ).rejects.toThrow(/path is invalid/);
    expect(files.size).toBe(0);
  });
});

describe('duplicate guard', () => {
  it('finds the same image and the same amount + date + merchant, ignoring deleted and edited expenses', async () => {
    const { db, wallet, store } = await setup();
    const p = photo(7);
    const sha = await sha256Hex(p.bytes);
    const id = await saveExpenseWithAttachments(db, store, { date: today, amountMinor: DH(245.9), accountId: wallet, merchantName: 'Carrefour' }, null, {
      add: [p],
    });

    const d = await findDuplicates(db, { sha256s: [sha], amountMinor: DH(245.9), date: today, merchantName: 'CARREFOUR' });
    expect(d.sameImage.map((x) => x.transactionId)).toEqual([id]);
    expect(d.sameExpense).toEqual([{ transactionId: id, date: today, amountMinor: DH(245.9), currency: 'MAD', merchantName: 'Carrefour' }]);

    // Different amount or merchant: not a duplicate expense.
    expect((await findDuplicates(db, { amountMinor: DH(245.8), date: today, merchantName: 'Carrefour' })).sameExpense).toEqual([]);
    expect((await findDuplicates(db, { amountMinor: DH(245.9), date: today, merchantName: 'BIM' })).sameExpense).toEqual([]);
    // The expense being edited is not its own duplicate.
    expect(await findDuplicates(db, { sha256s: [sha], amountMinor: DH(245.9), date: today, merchantName: 'Carrefour', excludeId: id })).toEqual({
      sameImage: [],
      sameExpense: [],
    });
    // Deleted expenses do not count.
    await deleteTransactionWithFiles(db, store, id);
    expect(await findDuplicates(db, { sha256s: [sha], amountMinor: DH(245.9), date: today, merchantName: 'Carrefour' })).toEqual({
      sameImage: [],
      sameExpense: [],
    });
  });
});

describe('photos in backups', () => {
  const ctx = { appVersion: '1.0.0', deviceName: 'Galaxy S22', accountEmail: 'me@example.com' };
  const opened: Awaited<ReturnType<typeof createFileTestDb>>[] = [];
  const fileDb = async () => {
    const t = await createFileTestDb();
    opened.push(t);
    return t;
  };
  afterEach(() => {
    for (const t of opened.splice(0)) t.cleanup();
  });

  async function phoneWithPhotos() {
    const t = await fileDb();
    const ids = await populate(t.db);
    const a = photo(1, 4096);
    const b = photo(2, 3000);
    const tx = await saveExpenseWithAttachments(t.db, t.attachments, { date: today, amountMinor: DH(100), accountId: ids.wallet }, null, { add: [a, b] });
    return { t, ids, tx, shas: [await sha256Hex(a.bytes), await sha256Hex(b.bytes)] };
  }

  it('uploads each photo once, verified, before the database; the manifest lists them', async () => {
    const { t, shas } = await phoneWithPhotos();
    const { drive, files } = fakeDrive();
    const r = await backupToDrive(t.engine, drive, ctx);
    expect(r.photos).toEqual({ uploaded: 2, missing: 0 });
    expect(r.manifest.attachments).toEqual({ count: 2, bytes: 4096 + 3000 });
    const photos = [...files.values()].filter((f) => f.name.startsWith('money-tracker-photo-'));
    expect(photos.map((f) => f.appProperties?.sha256).sort()).toEqual([...shas].sort());
    // Photo files are not listed as backups.
    expect((await listRemoteBackups(drive)).map((b) => b.fileId)).toEqual([r.fileId]);
    expect((await listRemoteBackups(drive))[0].manifest?.attachments).toEqual({ count: 2, bytes: 7096 });

    // A second backup does not upload them again.
    expect((await backupToDrive(t.engine, drive, ctx)).photos).toEqual({ uploaded: 0, missing: 0 });

    const v = await verifyRemoteBackup(t.engine, drive, (await listRemoteBackups(drive))[0]);
    expect(v).toMatchObject({ ok: true, photos: { total: 2, onDrive: 2 } });
  });

  it('a damaged photo upload fails the backup and records nothing', async () => {
    const { t } = await phoneWithPhotos();
    const { drive, state } = fakeDrive();
    state.corruptNextDownload = true;
    await expect(backupToDrive(t.engine, drive, ctx)).rejects.toMatchObject({ code: 'upload-unverified' });
    expect(await count(t.db, 'SELECT COUNT(*) AS n FROM backups')).toBe(0);
  });

  it('counts photos missing on the phone and still backs up the money data', async () => {
    const { t, tx } = await phoneWithPhotos();
    const [first] = await listAttachments(t.db, tx);
    await t.attachments.remove(first.path);
    const { drive } = fakeDrive();
    const r = await backupToDrive(t.engine, drive, ctx);
    expect(r.photos).toEqual({ uploaded: 1, missing: 1 });
  });

  it('restores on a new phone: photos are fetched from Drive and verified before the data changes', async () => {
    const { t, tx } = await phoneWithPhotos();
    const { drive } = fakeDrive();
    await backupToDrive(t.engine, drive, ctx);
    const expected = await dumpData(t.db);

    const fresh = await fileDb();
    const r = await restoreFromDrive(fresh.engine, drive, (await listRemoteBackups(drive))[0]);
    expect(r.photos).toEqual({ fetched: 2, missing: 0 });
    expect(await dumpData(fresh.db)).toEqual(expected);
    for (const a of await listAttachments(fresh.db, tx)) {
      const bytes = await fresh.attachments.read(a.path);
      expect(await sha256Hex(bytes!)).toBe(a.sha256);
    }
  });

  it('a photo that is missing or damaged stops the restore unless the user accepts restoring without it', async () => {
    const { t, tx } = await phoneWithPhotos();
    const { drive, files } = fakeDrive();
    await backupToDrive(t.engine, drive, ctx);
    const [bad, good] = await listAttachments(t.db, tx);
    // Damage one photo on Drive.
    const onDrive = [...files.values()].find((f) => f.appProperties?.sha256 === bad.sha256)!;
    onDrive.bytes[100] ^= 0xff;

    const fresh = await fileDb();
    const before = await dumpData(fresh.db);
    const remote = (await listRemoteBackups(drive))[0];
    const err = await restoreFromDrive(fresh.engine, drive, remote).catch((e) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err).toMatchObject({ code: 'attachments-missing', missing: 1 });
    // Nothing changed on the phone, and the photo fetched for the aborted restore was removed.
    expect(await dumpData(fresh.db)).toEqual(before);
    expect(fresh.attachments.exists(good.path)).toBe(false);
    expect(fresh.attachments.exists(bad.path)).toBe(false);

    const r = await restoreFromDrive(fresh.engine, drive, remote, { allowMissingPhotos: true });
    expect(r.photos).toEqual({ fetched: 1, missing: 1 });
    expect((await listAttachments(fresh.db, tx)).map((a) => a.id)).toEqual([good.id]);
    expect(fresh.attachments.exists(bad.path)).toBe(false);
    // The money data is complete.
    expect(await accountBalances(fresh.db)).toEqual(await accountBalances(t.db));
  });

  it('restoring a .db file uses the photos already on the phone', async () => {
    const { t } = await phoneWithPhotos();
    const snap = await createSnapshot(t.engine, ctx);
    const r = await restoreFromBytes(t.engine, snap.bytes, { kind: 'file', label: 'backup.db' });
    expect(r.photos).toEqual({ fetched: 0, missing: 0 });
  });

  it('JSON export lists each expense’s photos (file, type, SHA-256, size), not the images', async () => {
    const { t, tx } = await phoneWithPhotos();
    const json = (await exportJson(t.db, { from: today, to: today, scope: 'personal', categoryIds: null }, { appVersion: '1.0.0' })) as {
      personal: { entries: { transaction_id: string; attachments: unknown }[] };
    };
    const entry = json.personal.entries.find((e) => e.transaction_id === tx)!;
    expect(entry.attachments).toEqual(
      (await listAttachments(t.db, tx)).map((a) => ({ file: a.path, mime: a.mime, sha256: a.sha256, size: a.size })),
    );
  });

  it('migration v6 on a v5 database with data changes nothing else', async () => {
    const db = await createTestDb(5);
    await populate(db);
    const before = await dumpData(db);
    expect(await migrate(db)).toBe(6);
    expect(await dumpData(db)).toEqual({ ...before, attachments: [] });
  });
});
