/**
 * Reference data: categories, merchants, products and tags. Renames and
 * merges re-point history inside one SQLite transaction, so no transaction,
 * item, budget line or tag link is ever lost or counted under two names.
 */
import { LedgerError, type Db } from '@/db/types';
import type { Category, CategoryKind, Tag } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';

function clean(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

// ---------------------------------------------------------------------------
// Categories (two levels: a category and its subcategories)

export type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  essential: number | null;
  is_system: number;
  is_archived: number;
};

export const mapCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  parentId: r.parent_id,
  icon: r.icon,
  color: r.color,
  essential: r.essential === null ? null : r.essential === 1,
  isSystem: r.is_system === 1,
  isArchived: r.is_archived === 1,
});

export type CategoryWithUsage = Category & { useCount: number };

/** Every category of a kind, archived included, parents in default order. */
export async function listAllCategories(db: Db, kind: CategoryKind): Promise<CategoryWithUsage[]> {
  const rows = await db.all<CategoryRow & { n: number }>(
    `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS n
     FROM categories c WHERE c.kind = ? ORDER BY c.sort_order, c.name`,
    [kind],
  );
  return rows.map((r) => ({ ...mapCategory(r), useCount: r.n }));
}

export type CategoryInput = {
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
  icon?: string | null;
  color?: string | null;
  /** true = essential, false = discretionary, null = not classified (inherits from the parent). */
  essential?: boolean | null;
};

async function requireCategory(tx: Db, id: string): Promise<Category> {
  const r = await tx.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
  if (!r) throw new LedgerError('Category not found.');
  return mapCategory(r);
}

/** Only one level of nesting, within one kind, never under itself. */
async function assertParent(tx: Db, id: string | null, kind: CategoryKind, parentId: string | null | undefined) {
  if (!parentId) return;
  if (parentId === id) throw new LedgerError('A category cannot be its own parent.');
  const parent = await requireCategory(tx, parentId);
  if (parent.kind !== kind) throw new LedgerError('A subcategory must have the same type (expense or income) as its parent.');
  if (parent.parentId) throw new LedgerError(`"${parent.name}" is already a subcategory. Only one level of subcategories is supported.`);
  if (id) {
    const child = await tx.first<{ id: string }>('SELECT id FROM categories WHERE parent_id = ? LIMIT 1', [id]);
    if (child) throw new LedgerError('This category has subcategories, so it cannot become a subcategory itself.');
  }
}

const essentialValue = (e: boolean | null | undefined) => (e === undefined || e === null ? null : e ? 1 : 0);

export async function createCategory(db: Db, input: CategoryInput): Promise<string> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Category name is required.');
  return db.transaction(async (tx) => {
    await assertParent(tx, null, input.kind, input.parentId);
    const parent = input.parentId ? await requireCategory(tx, input.parentId) : null;
    const id = newId();
    const ts = nowISO();
    await tx.run(
      `INSERT INTO categories (id, name, kind, parent_id, icon, color, essential, sort_order, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), 0, ?, ?)`,
      [
        id,
        name,
        input.kind,
        input.parentId ?? null,
        input.icon ?? parent?.icon ?? 'label',
        input.color ?? parent?.color ?? '#8B8F98',
        essentialValue(input.essential),
        ts,
        ts,
      ],
    );
    return id;
  });
}

export async function updateCategory(db: Db, id: string, input: Omit<CategoryInput, 'kind'>): Promise<void> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Category name is required.');
  await db.transaction(async (tx) => {
    const existing = await requireCategory(tx, id);
    await assertParent(tx, id, existing.kind, input.parentId);
    await tx.run(
      `UPDATE categories SET name = ?, parent_id = ?, icon = ?, color = ?, essential = ?, updated_at = ? WHERE id = ?`,
      [
        name,
        input.parentId ?? null,
        input.icon ?? existing.icon,
        input.color ?? existing.color,
        essentialValue(input.essential),
        nowISO(),
        id,
      ],
    );
  });
}

/**
 * Archived categories disappear from pickers but keep their history.
 * Archiving a category also archives its subcategories.
 */
export async function setCategoryArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await requireCategory(tx, id);
    if (archived && c.isSystem) throw new LedgerError(`"${c.name}" is used by the app and cannot be archived.`);
    const ts = nowISO();
    await tx.run('UPDATE categories SET is_archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, ts, id]);
    if (archived) await tx.run('UPDATE categories SET is_archived = 1, updated_at = ? WHERE parent_id = ?', [ts, id]);
  });
}

/**
 * Moves everything recorded under `sourceId` to `targetId`, then removes the
 * source. Transactions, item lines, merchant/product defaults, subcategories
 * and budget lines are re-pointed; budget lines for both are added together.
 */
export async function mergeCategory(db: Db, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new LedgerError('Choose a different category to merge into.');
  await db.transaction(async (tx) => {
    const source = await requireCategory(tx, sourceId);
    const target = await requireCategory(tx, targetId);
    if (source.isSystem) throw new LedgerError(`"${source.name}" is used by the app and cannot be merged away.`);
    if (source.kind !== target.kind) throw new LedgerError('Both categories must be expense categories, or both income.');
    if (target.parentId === sourceId) {
      throw new LedgerError(`"${target.name}" is a subcategory of "${source.name}". Move it out first, or merge the other way.`);
    }
    const ts = nowISO();
    await tx.run('UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id = ?', [targetId, ts, sourceId]);
    await tx.run('UPDATE purchase_items SET category_id = ? WHERE category_id = ?', [targetId, sourceId]);
    await tx.run('UPDATE merchants SET default_category_id = ?, updated_at = ? WHERE default_category_id = ?', [
      targetId,
      ts,
      sourceId,
    ]);
    await tx.run('UPDATE products SET category_id = ?, updated_at = ? WHERE category_id = ?', [targetId, ts, sourceId]);
    // Keep one level of nesting: the source's subcategories join the target's level.
    await tx.run('UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ?', [
      target.parentId ?? targetId,
      ts,
      sourceId,
    ]);

    const lines = await tx.all<{ id: string; budget_id: string; amount_minor: number }>(
      'SELECT id, budget_id, amount_minor FROM budget_lines WHERE category_id = ?',
      [sourceId],
    );
    for (const l of lines) {
      const existing = await tx.first<{ id: string }>('SELECT id FROM budget_lines WHERE budget_id = ? AND category_id = ?', [
        l.budget_id,
        targetId,
      ]);
      if (existing) {
        await tx.run('UPDATE budget_lines SET amount_minor = amount_minor + ?, updated_at = ? WHERE id = ?', [
          l.amount_minor,
          ts,
          existing.id,
        ]);
        await tx.run('DELETE FROM budget_lines WHERE id = ?', [l.id]);
      } else {
        await tx.run('UPDATE budget_lines SET category_id = ?, updated_at = ? WHERE id = ?', [targetId, ts, l.id]);
      }
    }
    await tx.run('DELETE FROM categories WHERE id = ?', [sourceId]);
  });
}

// ---------------------------------------------------------------------------
// Merchants

async function assertUniqueName(tx: Db, table: 'merchants' | 'products' | 'tags', name: string, id: string | null) {
  const clash = await tx.first<{ id: string; name: string }>(
    `SELECT id, name FROM ${table} WHERE name = ? COLLATE NOCASE AND id <> ?`,
    [name, id ?? ''],
  );
  if (clash) throw new LedgerError(`"${clash.name}" already exists. Merge into it instead, so its history is combined.`);
}

export async function renameMerchant(db: Db, id: string, name: string): Promise<void> {
  const n = clean(name);
  if (!n) throw new LedgerError('Merchant name is required.');
  await db.transaction(async (tx) => {
    await assertUniqueName(tx, 'merchants', n, id);
    const r = await tx.run('UPDATE merchants SET name = ?, updated_at = ? WHERE id = ?', [n, nowISO(), id]);
    if (r.changes === 0) throw new LedgerError('Merchant not found.');
  });
}

export async function setMerchantArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.run('UPDATE merchants SET is_archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, nowISO(), id]);
}

/** All transactions of `sourceId` now belong to `targetId`; the source is removed. */
export async function mergeMerchant(db: Db, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new LedgerError('Choose a different merchant to merge into.');
  await db.transaction(async (tx) => {
    const both = await tx.all<{ id: string; default_category_id: string | null }>(
      'SELECT id, default_category_id FROM merchants WHERE id IN (?, ?)',
      [sourceId, targetId],
    );
    if (both.length !== 2) throw new LedgerError('Merchant not found.');
    const ts = nowISO();
    await tx.run('UPDATE transactions SET merchant_id = ?, updated_at = ? WHERE merchant_id = ?', [targetId, ts, sourceId]);
    const sourceCategory = both.find((m) => m.id === sourceId)?.default_category_id ?? null;
    await tx.run(
      'UPDATE merchants SET default_category_id = COALESCE(default_category_id, ?), updated_at = ? WHERE id = ?',
      [sourceCategory, ts, targetId],
    );
    await tx.run('DELETE FROM merchants WHERE id = ?', [sourceId]);
  });
}

// ---------------------------------------------------------------------------
// Products

export async function renameProduct(db: Db, id: string, name: string): Promise<void> {
  const n = clean(name);
  if (!n) throw new LedgerError('Product name is required.');
  await db.transaction(async (tx) => {
    await assertUniqueName(tx, 'products', n, id);
    const r = await tx.run('UPDATE products SET name = ?, updated_at = ? WHERE id = ?', [n, nowISO(), id]);
    if (r.changes === 0) throw new LedgerError('Product not found.');
  });
}

/**
 * Item lines of `sourceId` now belong to `targetId`. Each line keeps the
 * name, quantity and unit it was recorded with, so price history stays exact.
 */
export async function mergeProduct(db: Db, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new LedgerError('Choose a different product to merge into.');
  await db.transaction(async (tx) => {
    const both = await tx.all<{ id: string; default_unit: string | null; category_id: string | null }>(
      'SELECT id, default_unit, category_id FROM products WHERE id IN (?, ?)',
      [sourceId, targetId],
    );
    if (both.length !== 2) throw new LedgerError('Product not found.');
    const source = both.find((p) => p.id === sourceId)!;
    const ts = nowISO();
    await tx.run('UPDATE purchase_items SET product_id = ? WHERE product_id = ?', [targetId, sourceId]);
    await tx.run(
      `UPDATE products SET default_unit = COALESCE(default_unit, ?), category_id = COALESCE(category_id, ?), updated_at = ?
       WHERE id = ?`,
      [source.default_unit, source.category_id, ts, targetId],
    );
    await tx.run('DELETE FROM products WHERE id = ?', [sourceId]);
  });
}

// ---------------------------------------------------------------------------
// Tags

type TagRow = { id: string; name: string; color: string | null; is_archived: number };

const mapTag = (r: TagRow): Tag => ({ id: r.id, name: r.name, color: r.color, isArchived: r.is_archived === 1 });

export type TagWithUsage = Tag & { transactionCount: number; itemCount: number };

export async function listTags(db: Db, opts: { includeArchived?: boolean } = {}): Promise<TagWithUsage[]> {
  const rows = await db.all<TagRow & { tx_n: number; item_n: number }>(
    `SELECT g.*,
       (SELECT COUNT(*) FROM transaction_tags tt JOIN transactions t ON t.id = tt.transaction_id
        WHERE tt.tag_id = g.id AND t.deleted_at IS NULL) AS tx_n,
       (SELECT COUNT(*) FROM item_tags it JOIN purchase_items pi ON pi.id = it.item_id
        JOIN transactions t ON t.id = pi.transaction_id WHERE it.tag_id = g.id AND t.deleted_at IS NULL) AS item_n
     FROM tags g ${opts.includeArchived ? '' : 'WHERE g.is_archived = 0'}
     ORDER BY g.is_archived, tx_n + item_n DESC, g.name`,
  );
  return rows.map((r) => ({ ...mapTag(r), transactionCount: r.tx_n, itemCount: r.item_n }));
}

export async function createTag(db: Db, input: { name: string; color?: string | null }): Promise<string> {
  const name = clean(input.name);
  if (!name) throw new LedgerError('Tag name is required.');
  return db.transaction(async (tx) => {
    const existing = await tx.first<{ id: string; is_archived: number }>(
      'SELECT id, is_archived FROM tags WHERE name = ? COLLATE NOCASE',
      [name],
    );
    if (existing) {
      if (existing.is_archived) await tx.run('UPDATE tags SET is_archived = 0, updated_at = ? WHERE id = ?', [nowISO(), existing.id]);
      return existing.id;
    }
    const id = newId();
    const ts = nowISO();
    await tx.run('INSERT INTO tags (id, name, color, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', [
      id,
      name,
      input.color ?? null,
      ts,
      ts,
    ]);
    return id;
  });
}

export async function renameTag(db: Db, id: string, name: string): Promise<void> {
  const n = clean(name);
  if (!n) throw new LedgerError('Tag name is required.');
  await db.transaction(async (tx) => {
    await assertUniqueName(tx, 'tags', n, id);
    const r = await tx.run('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?', [n, nowISO(), id]);
    if (r.changes === 0) throw new LedgerError('Tag not found.');
  });
}

export async function setTagArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.run('UPDATE tags SET is_archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, nowISO(), id]);
}

/** Moves every use of `sourceId` to `targetId` (a transaction tagged with both keeps one link), then removes the source. */
export async function mergeTag(db: Db, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new LedgerError('Choose a different tag to merge into.');
  await db.transaction(async (tx) => {
    const n = await tx.first<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE id IN (?, ?)', [sourceId, targetId]);
    if (n?.n !== 2) throw new LedgerError('Tag not found.');
    const ts = nowISO();
    await tx.run(
      `INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, created_at)
       SELECT transaction_id, ?, ? FROM transaction_tags WHERE tag_id = ?`,
      [targetId, ts, sourceId],
    );
    await tx.run(
      `INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at) SELECT item_id, ?, ? FROM item_tags WHERE tag_id = ?`,
      [targetId, ts, sourceId],
    );
    await tx.run('DELETE FROM transaction_tags WHERE tag_id = ?', [sourceId]);
    await tx.run('DELETE FROM item_tags WHERE tag_id = ?', [sourceId]);
    await tx.run('DELETE FROM tags WHERE id = ?', [sourceId]);
  });
}

/** Removes a tag and its links. Amounts are untouched: tags never hold money. */
export async function deleteTag(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM transaction_tags WHERE tag_id = ?', [id]);
    await tx.run('DELETE FROM item_tags WHERE tag_id = ?', [id]);
    await tx.run('DELETE FROM tags WHERE id = ?', [id]);
  });
}
