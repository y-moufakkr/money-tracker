import { LedgerError, type Db } from '@/db/types';
import { sha256Hex } from '@/lib/hash';
import { newId } from '@/lib/id';
import { deleteTransaction, saveExpense, type AttachmentInput, type ExpenseInput } from './ledger';

/**
 * Receipt photos (Phase 5). A photo is a file under the app's documents directory plus a row in
 * `attachments` (path relative to that directory, mime, SHA-256, size). The file is written first
 * and its row inserted inside the expense's transaction; when the save fails the file is removed,
 * so nothing is left orphaned. Photos never move money.
 *
 * Native file access sits behind `AttachmentStore`, so these rules run against node in tests.
 */

/** Files relative to the documents directory (`attachments/<id>.jpg`). */
export interface AttachmentStore {
  /** Creates or replaces the file at `path`. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** The file's bytes, or null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Deletes the file; a missing file is not an error. */
  remove(path: string): Promise<void>;
}

export type NewAttachment = { bytes: Uint8Array; mime: string };

export type Attachment = AttachmentInput & { transactionId: string; createdAt: string };

export const ATTACHMENT_DIR = 'attachments';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export function attachmentPath(id: string, mime: string): string {
  const ext = EXTENSIONS[mime];
  if (!ext) throw new LedgerError('Only photos (JPEG, PNG, WebP or HEIC) can be attached.');
  return `${ATTACHMENT_DIR}/${id}.${ext}`;
}

/** Writes the file, reads it back and checks its SHA-256. Returns what the row will hold. */
export async function writeAttachmentFile(store: AttachmentStore, file: NewAttachment): Promise<AttachmentInput> {
  if (file.bytes.length === 0) throw new LedgerError('The photo is empty.');
  const id = newId();
  const path = attachmentPath(id, file.mime);
  const sha256 = await sha256Hex(file.bytes);
  await store.write(path, file.bytes);
  const back = await store.read(path);
  if (!back || back.length !== file.bytes.length || (await sha256Hex(back)) !== sha256) {
    await store.remove(path).catch(() => undefined);
    throw new LedgerError('The photo could not be saved on this phone.');
  }
  return { id, path, mime: file.mime, sha256, size: file.bytes.length };
}

async function removeFiles(store: AttachmentStore, paths: string[]) {
  // Best effort: the rows are already gone, and a leftover file holds no money.
  for (const p of paths) await store.remove(p).catch(() => undefined);
}

/**
 * Saves an expense with its photos: new files are written first, then the expense and the
 * attachment rows in one transaction. If anything fails, the new files are deleted. Files of
 * removed attachments are deleted only after the commit.
 */
export async function saveExpenseWithAttachments(
  db: Db,
  store: AttachmentStore,
  input: ExpenseInput,
  id: string | null = null,
  files: { add?: NewAttachment[]; removeIds?: string[] } = {},
): Promise<string> {
  const written: AttachmentInput[] = [];
  const removeIds = files.removeIds ?? [];
  let txId: string;
  let removedPaths: string[] = [];
  try {
    for (const f of files.add ?? []) written.push(await writeAttachmentFile(store, f));
    if (removeIds.length) {
      if (!id) throw new LedgerError('Photo not found on this expense.');
      removedPaths = (
        await db.all<{ path: string }>(
          `SELECT path FROM attachments WHERE transaction_id = ? AND id IN (${removeIds.map(() => '?').join(',')})`,
          [id, ...removeIds],
        )
      ).map((r) => r.path);
    }
    txId = await saveExpense(db, { ...input, attachments: [...(input.attachments ?? []), ...written], removeAttachmentIds: removeIds }, id);
  } catch (e) {
    await removeFiles(
      store,
      written.map((w) => w.path),
    );
    throw e;
  }
  await removeFiles(store, removedPaths);
  return txId;
}

/** Removes one photo from its transaction (row first, then the file). */
export async function removeAttachment(db: Db, store: AttachmentStore, attachmentId: string): Promise<void> {
  const path = await db.transaction(async (tx) => {
    const row = await tx.first<{ path: string }>('SELECT path FROM attachments WHERE id = ?', [attachmentId]);
    if (!row) throw new LedgerError('Photo not found.');
    await tx.run('DELETE FROM attachments WHERE id = ?', [attachmentId]);
    return row.path;
  });
  await removeFiles(store, [path]);
}

/** Deletes a transaction (see `deleteTransaction`) and then its photo files. */
export async function deleteTransactionWithFiles(db: Db, store: AttachmentStore, id: string): Promise<void> {
  await removeFiles(store, await deleteTransaction(db, id));
}

type AttachmentRow = { id: string; transaction_id: string; path: string; mime: string; sha256: string; size: number; created_at: string };

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  transactionId: r.transaction_id,
  path: r.path,
  mime: r.mime,
  sha256: r.sha256,
  size: r.size,
  createdAt: r.created_at,
});

export async function listAttachments(db: Db, transactionId: string): Promise<Attachment[]> {
  const rows = await db.all<AttachmentRow>('SELECT * FROM attachments WHERE transaction_id = ? ORDER BY created_at, id', [transactionId]);
  return rows.map(toAttachment);
}

export async function getAttachment(db: Db, id: string): Promise<Attachment | null> {
  const r = await db.first<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id]);
  return r ? toAttachment(r) : null;
}

// ---------------------------------------------------------------------------
// Duplicate guard

export type DuplicateMatch = { transactionId: string; date: string; amountMinor: number; currency: string; merchantName: string | null };

export type Duplicates = {
  /** Transactions that already have this exact photo (same SHA-256). */
  sameImage: DuplicateMatch[];
  /** Expenses with the same amount, date and merchant. */
  sameExpense: DuplicateMatch[];
};

/**
 * Looks for a receipt that may already be recorded, before saving. Only live (not deleted)
 * transactions count; `excludeId` is the expense being edited.
 */
export async function findDuplicates(
  db: Db,
  q: { sha256s?: string[]; amountMinor?: number | null; date?: string | null; merchantName?: string | null; excludeId?: string | null },
): Promise<Duplicates> {
  const exclude = q.excludeId ?? '';
  const select = `SELECT DISTINCT t.id, t.date, t.amount_minor, t.currency, m.name AS merchant_name
     FROM transactions t LEFT JOIN merchants m ON m.id = t.merchant_id`;
  type Row = { id: string; date: string; amount_minor: number; currency: string; merchant_name: string | null };
  const map = (rows: Row[]) =>
    rows.map((r) => ({ transactionId: r.id, date: r.date, amountMinor: r.amount_minor, currency: r.currency, merchantName: r.merchant_name }));

  const shas = [...new Set(q.sha256s ?? [])];
  const sameImage = shas.length
    ? await db.all<Row>(
        `${select} JOIN attachments a ON a.transaction_id = t.id
         WHERE a.sha256 IN (${shas.map(() => '?').join(',')}) AND t.deleted_at IS NULL AND t.id <> ?
         ORDER BY t.date DESC`,
        [...shas, exclude],
      )
    : [];

  const merchant = q.merchantName?.trim();
  const sameExpense =
    q.amountMinor && q.date && merchant
      ? await db.all<Row>(
          `${select}
           WHERE t.kind = 'expense' AND t.deleted_at IS NULL AND t.id <> ? AND t.amount_minor = ? AND t.date = ?
             AND m.name = ? COLLATE NOCASE
           ORDER BY t.created_at DESC`,
          [exclude, q.amountMinor, q.date, merchant],
        )
      : [];

  return { sameImage: map(sameImage), sameExpense: map(sameExpense) };
}
