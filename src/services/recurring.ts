/**
 * Recurring bills, expected income and one-off expected payments.
 *
 * Expected money is never money: nothing here touches a balance. Only a real transaction
 * (recorded from "Mark paid", or an existing one linked to the occurrence) moves money, and a
 * transaction can settle at most one expected payment.
 *
 * Occurrences of a rule are computed from its schedule. Only occurrences that were paid, skipped
 * or adjusted are stored (one row per rule and due date), so there is no background job and
 * editing a rule changes its future occurrences.
 *
 * Bills due within RESERVE_HORIZON_DAYS (and overdue ones) are reserved in My Money on the
 * location they are paid from, after goal reservations: see `services/balances.ts`.
 */
import { LedgerError, type BindValue, type Db } from '@/db/types';
import { addDays, daysBetweenInclusive, isValidISODate, todayISO } from '@/domain/dates';
import { dueDatesBetween, isDueDate, type IntervalUnit, type Schedule } from '@/domain/schedule';
import { newId, nowISO } from '@/lib/id';
import { requireAccount } from './accounts';
import { getDebt, recordRepayment } from './debts';
import { saveExpense, saveIncome } from './ledger';

/** Bills due within this many days (and overdue ones) are reserved; expected income is shown. */
export const RESERVE_HORIZON_DAYS = 30;

export type ExpectedDirection = 'expense' | 'income';
export type OccurrenceStatus = 'pending' | 'paid' | 'skipped';

export type RecurringRule = {
  id: string;
  name: string;
  direction: ExpectedDirection;
  amountMinor: number;
  currency: string;
  accountId: string;
  accountName: string;
  accountArchived: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  payee: string | null;
  debtId: string | null;
  debtName: string | null;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  remindDaysBefore: number;
  reserve: boolean;
  isPaused: boolean;
  notes: string | null;
  /** First pending occurrence (may be overdue); null when the schedule has ended or is paused. */
  next: Occurrence | null;
  overdueCount: number;
};

export type OccurrenceRef = { ruleId: string; dueDate: string } | { expectedId: string };

export type Occurrence = {
  key: string;
  ref: OccurrenceRef;
  ruleId: string | null;
  /** Stored row, when the occurrence was resolved or adjusted (always for one-offs). */
  expectedId: string | null;
  dueDate: string;
  name: string;
  direction: ExpectedDirection;
  /** Expected amount: the occurrence's own amount if adjusted, else the rule's. */
  amountMinor: number;
  currency: string;
  accountId: string;
  accountName: string;
  accountKind: string;
  categoryId: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  payee: string | null;
  debtId: string | null;
  reserve: boolean;
  remindDaysBefore: number;
  status: OccurrenceStatus;
  transactionId: string | null;
  /** Amount and date of the transaction that settled it. */
  paidMinor: number | null;
  paidDate: string | null;
  adjusted: boolean;
  notes: string | null;
  overdue: boolean;
  /** Pending and inside the rule's reminder window. */
  dueSoon: boolean;
  /** Days until due (negative when overdue). */
  daysUntil: number;
};

type RuleRow = {
  id: string;
  name: string;
  direction: ExpectedDirection;
  amount_minor: number;
  account_id: string;
  account_name: string;
  account_kind: string;
  account_archived: number;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  payee: string | null;
  debt_id: string | null;
  debt_name: string | null;
  interval_unit: IntervalUnit;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  remind_days_before: number;
  reserve: number;
  is_paused: number;
  notes: string | null;
};

type StoredRow = {
  id: string;
  rule_id: string | null;
  due_date: string;
  name: string | null;
  direction: ExpectedDirection | null;
  account_id: string | null;
  account_name: string | null;
  account_kind: string | null;
  currency: string | null;
  category_id: string | null;
  category_icon: string | null;
  category_color: string | null;
  amount_minor: number | null;
  reserve: number | null;
  status: OccurrenceStatus;
  transaction_id: string | null;
  paid_minor: number | null;
  paid_date: string | null;
  notes: string | null;
};

const RULE_SELECT = `
  SELECT r.*, a.name AS account_name, a.kind AS account_kind, a.is_archived AS account_archived, a.currency,
    c.name AS category_name, c.icon AS category_icon, c.color AS category_color, d.counterparty AS debt_name
  FROM recurring_rules r
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN debts d ON d.id = r.debt_id`;

const STORED_SELECT = `
  SELECT e.*, a.name AS account_name, a.kind AS account_kind, a.currency, c.icon AS category_icon, c.color AS category_color,
    t.amount_minor AS paid_minor, t.date AS paid_date
  FROM expected_payments e
  LEFT JOIN accounts a ON a.id = e.account_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL`;

const schedule = (r: RuleRow): Schedule => ({ startDate: r.start_date, endDate: r.end_date, unit: r.interval_unit, count: r.interval_count });

function timing(dueDate: string, status: OccurrenceStatus, remindDaysBefore: number, today: string) {
  const daysUntil = daysBetweenInclusive(today, dueDate) - 1;
  const pending = status === 'pending';
  return {
    overdue: pending && dueDate < today,
    dueSoon: pending && dueDate >= today && daysUntil <= remindDaysBefore,
    daysUntil,
  };
}

function ruleOccurrence(r: RuleRow, dueDate: string, stored: StoredRow | undefined, today: string): Occurrence {
  const status = stored?.status ?? 'pending';
  return {
    key: `${r.id}:${dueDate}`,
    ref: { ruleId: r.id, dueDate },
    ruleId: r.id,
    expectedId: stored?.id ?? null,
    dueDate,
    name: r.name,
    direction: r.direction,
    amountMinor: stored?.amount_minor ?? r.amount_minor,
    currency: r.currency,
    accountId: r.account_id,
    accountName: r.account_name,
    accountKind: r.account_kind,
    categoryId: r.category_id,
    categoryIcon: r.category_icon,
    categoryColor: r.category_color,
    payee: r.payee,
    debtId: r.debt_id,
    reserve: r.reserve === 1,
    remindDaysBefore: r.remind_days_before,
    status,
    transactionId: stored?.transaction_id ?? null,
    paidMinor: stored?.paid_minor ?? null,
    paidDate: stored?.paid_date ?? null,
    adjusted: stored?.amount_minor != null,
    notes: stored?.notes ?? null,
    ...timing(dueDate, status, r.remind_days_before, today),
  };
}

function oneOffOccurrence(e: StoredRow, today: string): Occurrence {
  const remind = 3;
  return {
    key: e.id,
    ref: { expectedId: e.id },
    ruleId: null,
    expectedId: e.id,
    dueDate: e.due_date,
    name: e.name ?? '',
    direction: e.direction ?? 'expense',
    amountMinor: e.amount_minor ?? 0,
    currency: e.currency ?? 'MAD',
    accountId: e.account_id ?? '',
    accountName: e.account_name ?? '',
    accountKind: e.account_kind ?? 'other',
    categoryId: e.category_id,
    categoryIcon: e.category_icon,
    categoryColor: e.category_color,
    payee: null,
    debtId: null,
    reserve: e.reserve === 1,
    remindDaysBefore: remind,
    status: e.status,
    transactionId: e.transaction_id,
    paidMinor: e.paid_minor,
    paidDate: e.paid_date,
    adjusted: false,
    notes: e.notes,
    ...timing(e.due_date, e.status, remind, today),
  };
}

const byDue = (a: Occurrence, b: Occurrence) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name));

export type OccurrenceQuery = {
  from: string;
  to: string;
  ruleId?: string;
  /** Leave out one-off expected payments. */
  rulesOnly?: boolean;
  statuses?: OccurrenceStatus[];
};

/**
 * Every occurrence due in [from, to]: computed from the schedules (paused rules have none
 * pending), merged with the stored ones (paid, skipped, adjusted, and one-offs).
 */
export async function listOccurrences(db: Db, q: OccurrenceQuery, today = todayISO()): Promise<Occurrence[]> {
  const ruleWhere = q.ruleId ? 'WHERE r.id = ?' : '';
  const storedWhere: string[] = ['e.due_date BETWEEN ? AND ?'];
  const storedParams: BindValue[] = [q.from, q.to];
  if (q.ruleId) {
    storedWhere.push('e.rule_id = ?');
    storedParams.push(q.ruleId);
  } else if (q.rulesOnly) storedWhere.push('e.rule_id IS NOT NULL');
  const [rules, stored] = await Promise.all([
    db.all<RuleRow>(`${RULE_SELECT} ${ruleWhere}`, q.ruleId ? [q.ruleId] : []),
    db.all<StoredRow>(`${STORED_SELECT} WHERE ${storedWhere.join(' AND ')}`, storedParams),
  ]);
  const out: Occurrence[] = [];
  const storedByKey = new Map(stored.filter((s) => s.rule_id).map((s) => [`${s.rule_id}:${s.due_date}`, s]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const r of rules) {
    if (r.is_paused) continue;
    for (const d of dueDatesBetween(schedule(r), q.from, q.to)) {
      const key = `${r.id}:${d}`;
      seen.add(key);
      out.push(ruleOccurrence(r, d, storedByKey.get(key), today));
    }
  }
  for (const s of stored) {
    if (s.rule_id) {
      const key = `${s.rule_id}:${s.due_date}`;
      const r = ruleById.get(s.rule_id);
      // Resolved occurrences stay in history even if the schedule changed or the rule is paused.
      if (!seen.has(key) && r && s.status !== 'pending') out.push(ruleOccurrence(r, s.due_date, s, today));
    } else {
      out.push(oneOffOccurrence(s, today));
    }
  }
  const filtered = q.statuses ? out.filter((o) => q.statuses!.includes(o.status)) : out;
  return filtered.sort(byDue);
}

/** Pending occurrences that are overdue or due within `days` days. */
export async function upcomingOccurrences(db: Db, days = RESERVE_HORIZON_DAYS, today = todayISO()): Promise<Occurrence[]> {
  return listOccurrences(db, { from: '1900-01-01', to: addDays(today, days), statuses: ['pending'] }, today);
}

/**
 * Bills to reserve, per location (in its currency): pending expense occurrences marked "reserve",
 * overdue or due within the horizon. Credit cards hold no money, so nothing is reserved on them.
 */
export async function billReservations(db: Db, today = todayISO()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const o of await upcomingOccurrences(db, RESERVE_HORIZON_DAYS, today)) {
    if (o.direction !== 'expense' || !o.reserve || o.accountKind === 'credit_card') continue;
    out.set(o.accountId, (out.get(o.accountId) ?? 0) + o.amountMinor);
  }
  return out;
}

/** Expected income within the horizon, per currency. A projection: never added to any balance. */
export async function expectedIncome(db: Db, today = todayISO()): Promise<{ currency: string; amountMinor: number; count: number }[]> {
  const by = new Map<string, { currency: string; amountMinor: number; count: number }>();
  for (const o of await upcomingOccurrences(db, RESERVE_HORIZON_DAYS, today)) {
    if (o.direction !== 'income' || o.dueDate < today) continue;
    const cur = by.get(o.currency) ?? { currency: o.currency, amountMinor: 0, count: 0 };
    cur.amountMinor += o.amountMinor;
    cur.count += 1;
    by.set(o.currency, cur);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------------------
// Rules

export async function listRules(db: Db, opts: { id?: string } = {}, today = todayISO()): Promise<RecurringRule[]> {
  const rows = await db.all<RuleRow>(
    `${RULE_SELECT} ${opts.id ? 'WHERE r.id = ?' : ''} ORDER BY r.is_paused, r.direction DESC, r.name COLLATE NOCASE`,
    opts.id ? [opts.id] : [],
  );
  // Five years ahead finds the next date of any yearly (or longer) schedule.
  const pending = await listOccurrences(db, { from: '1900-01-01', to: addDays(today, 1830), ruleId: opts.id, rulesOnly: true, statuses: ['pending'] }, today);
  return rows.map((r) => {
    const own = pending.filter((o) => o.ruleId === r.id);
    return {
      id: r.id,
      name: r.name,
      direction: r.direction,
      amountMinor: r.amount_minor,
      currency: r.currency,
      accountId: r.account_id,
      accountName: r.account_name,
      accountArchived: r.account_archived === 1,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryIcon: r.category_icon,
      categoryColor: r.category_color,
      payee: r.payee,
      debtId: r.debt_id,
      debtName: r.debt_name,
      intervalUnit: r.interval_unit,
      intervalCount: r.interval_count,
      startDate: r.start_date,
      endDate: r.end_date,
      remindDaysBefore: r.remind_days_before,
      reserve: r.reserve === 1,
      isPaused: r.is_paused === 1,
      notes: r.notes,
      next: own[0] ?? null,
      overdueCount: own.filter((o) => o.overdue).length,
    };
  });
}

export async function getRule(db: Db, id: string): Promise<RecurringRule | null> {
  return (await listRules(db, { id }))[0] ?? null;
}

async function requireRuleRow(db: Db, id: string): Promise<RuleRow> {
  const r = await db.first<RuleRow>(`${RULE_SELECT} WHERE r.id = ?`, [id]);
  if (!r) throw new LedgerError('Recurring payment not found.');
  return r;
}

export type RuleInput = {
  name: string;
  direction: ExpectedDirection;
  amountMinor: number;
  accountId: string;
  categoryId?: string | null;
  payee?: string | null;
  /** Repays this debt: "Mark paid" records a loan repayment instead of an expense or income. */
  debtId?: string | null;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  /** First due date. */
  startDate: string;
  endDate?: string | null;
  remindDaysBefore?: number;
  /** Reserve upcoming occurrences in My Money (bills only). */
  reserve?: boolean;
  notes?: string | null;
};

async function validateTarget(
  tx: Db,
  input: { direction: ExpectedDirection; accountId: string; categoryId?: string | null; debtId?: string | null },
  isNew: boolean,
) {
  const account = await requireAccount(tx, input.accountId);
  if (account.ownership !== 'personal') {
    throw new LedgerError('Recurring payments are personal. Record company bills as company obligations.');
  }
  if (isNew && account.isArchived) throw new LedgerError(`"${account.name}" is archived.`);
  if (input.direction === 'income' && account.kind === 'credit_card') throw new LedgerError('Income cannot be received on a credit card.');
  if (input.categoryId) {
    const c = await tx.first<{ kind: string }>('SELECT kind FROM categories WHERE id = ?', [input.categoryId]);
    if (!c) throw new LedgerError('Category not found.');
    if (c.kind !== input.direction) throw new LedgerError(`Choose an ${input.direction} category.`);
  }
  if (input.debtId) {
    const d = await getDebt(tx, input.debtId);
    if (!d) throw new LedgerError('Debt not found.');
    if ((d.direction === 'owe') !== (input.direction === 'expense')) {
      throw new LedgerError(d.direction === 'owe' ? 'Repaying a debt you owe is an outgoing payment.' : 'Money owed to you comes in: make it expected income.');
    }
    if (d.currency !== account.currency) throw new LedgerError(`The debt is in ${d.currency}. Choose a ${d.currency} location.`);
  }
  return account;
}

export async function saveRule(db: Db, input: RuleInput, id: string | null = null): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new LedgerError('Name the payment.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new LedgerError('Amount must be greater than zero.');
  if (!['day', 'week', 'month', 'year'].includes(input.intervalUnit)) throw new LedgerError('Choose how often it repeats.');
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1 || input.intervalCount > 366) {
    throw new LedgerError('The interval must be between 1 and 366.');
  }
  if (!isValidISODate(input.startDate)) throw new LedgerError('First due date is invalid.');
  if (input.endDate && !isValidISODate(input.endDate)) throw new LedgerError('End date is invalid.');
  if (input.endDate && input.endDate < input.startDate) throw new LedgerError('The end date is before the first due date.');
  const remind = input.remindDaysBefore ?? 3;
  if (!Number.isInteger(remind) || remind < 0 || remind > 60) throw new LedgerError('Remind between 0 and 60 days before.');

  return db.transaction(async (tx) => {
    const existing = id ? await requireRuleRow(tx, id) : null;
    await validateTarget(tx, input, !existing || existing.account_id !== input.accountId);
    const ts = nowISO();
    const values = [
      name,
      input.direction,
      input.amountMinor,
      input.accountId,
      input.categoryId ?? null,
      input.payee?.trim() || null,
      input.debtId ?? null,
      input.intervalUnit,
      input.intervalCount,
      input.startDate,
      input.endDate ?? null,
      remind,
      input.direction === 'expense' && (input.reserve ?? true) ? 1 : 0,
      input.notes?.trim() || null,
    ];
    if (existing) {
      await tx.run(
        `UPDATE recurring_rules SET name = ?, direction = ?, amount_minor = ?, account_id = ?, category_id = ?, payee = ?, debt_id = ?,
           interval_unit = ?, interval_count = ?, start_date = ?, end_date = ?, remind_days_before = ?, reserve = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [...values, ts, existing.id],
      );
      // Adjustments of occurrences that are no longer on the schedule go; resolved ones stay in history.
      const next: Schedule = { startDate: input.startDate, endDate: input.endDate ?? null, unit: input.intervalUnit, count: input.intervalCount };
      const pendingRows = await tx.all<{ id: string; due_date: string }>(
        `SELECT id, due_date FROM expected_payments WHERE rule_id = ? AND status = 'pending'`,
        [existing.id],
      );
      for (const p of pendingRows) if (!isDueDate(next, p.due_date)) await tx.run('DELETE FROM expected_payments WHERE id = ?', [p.id]);
      return existing.id;
    }
    const ruleId = newId();
    await tx.run(
      `INSERT INTO recurring_rules (name, direction, amount_minor, account_id, category_id, payee, debt_id, interval_unit, interval_count,
         start_date, end_date, remind_days_before, reserve, notes, is_paused, id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [...values, ruleId, ts, ts],
    );
    return ruleId;
  });
}

/** Paused rules have no pending occurrences (nothing reserved, nothing overdue). */
export async function setRulePaused(db: Db, id: string, paused: boolean): Promise<void> {
  await db.run('UPDATE recurring_rules SET is_paused = ?, updated_at = ? WHERE id = ?', [paused ? 1 : 0, nowISO(), id]);
}

/** Deletes the rule and its occurrence history. Transactions that paid it stay recorded. */
export async function deleteRule(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM expected_payments WHERE rule_id = ?', [id]);
    await tx.run('DELETE FROM recurring_rules WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------------------
// One-off expected payments

export type ExpectedInput = {
  name: string;
  direction: ExpectedDirection;
  amountMinor: number;
  accountId: string;
  dueDate: string;
  categoryId?: string | null;
  reserve?: boolean;
  notes?: string | null;
};

export async function saveExpected(db: Db, input: ExpectedInput, id: string | null = null): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new LedgerError('Name the payment.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new LedgerError('Amount must be greater than zero.');
  if (!isValidISODate(input.dueDate)) throw new LedgerError('Due date is invalid.');
  return db.transaction(async (tx) => {
    const existing = id ? await tx.first<{ id: string; status: string; rule_id: string | null; account_id: string }>('SELECT * FROM expected_payments WHERE id = ?', [id]) : null;
    if (id && (!existing || existing.rule_id)) throw new LedgerError('Expected payment not found.');
    if (existing && existing.status !== 'pending') throw new LedgerError('It is already settled. Reopen it before changing it.');
    await validateTarget(tx, input, !existing || existing.account_id !== input.accountId);
    const ts = nowISO();
    const values = [
      name,
      input.direction,
      input.accountId,
      input.categoryId ?? null,
      input.amountMinor,
      input.dueDate,
      input.direction === 'expense' && (input.reserve ?? true) ? 1 : 0,
      input.notes?.trim() || null,
    ];
    if (existing) {
      await tx.run(
        `UPDATE expected_payments SET name = ?, direction = ?, account_id = ?, category_id = ?, amount_minor = ?, due_date = ?, reserve = ?,
           notes = ?, updated_at = ? WHERE id = ?`,
        [...values, ts, existing.id],
      );
      return existing.id;
    }
    const expectedId = newId();
    await tx.run(
      `INSERT INTO expected_payments (name, direction, account_id, category_id, amount_minor, due_date, reserve, notes, status, id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [...values, expectedId, ts, ts],
    );
    return expectedId;
  });
}

/** Deletes a one-off expected payment. A transaction that paid it stays recorded. */
export async function deleteExpected(db: Db, id: string): Promise<void> {
  const row = await db.first<{ rule_id: string | null }>('SELECT rule_id FROM expected_payments WHERE id = ?', [id]);
  if (!row) return;
  if (row.rule_id) throw new LedgerError('This belongs to a recurring payment: skip it instead.');
  await db.run('DELETE FROM expected_payments WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Settling occurrences

/** The occurrence as it stands; throws when the date is not on the rule's schedule. */
export async function getOccurrence(db: Db, ref: OccurrenceRef, today = todayISO()): Promise<Occurrence> {
  if ('expectedId' in ref) {
    const e = await db.first<StoredRow>(`${STORED_SELECT} WHERE e.id = ?`, [ref.expectedId]);
    if (!e) throw new LedgerError('Expected payment not found.');
    if (e.rule_id) {
      const r = await requireRuleRow(db, e.rule_id);
      return ruleOccurrence(r, e.due_date, e, today);
    }
    return oneOffOccurrence(e, today);
  }
  const r = await requireRuleRow(db, ref.ruleId);
  const stored = await db.first<StoredRow>(`${STORED_SELECT} WHERE e.rule_id = ? AND e.due_date = ?`, [r.id, ref.dueDate]);
  if (!stored && !isDueDate(schedule(r), ref.dueDate)) throw new LedgerError('This date is not on the payment’s schedule.');
  return ruleOccurrence(r, ref.dueDate, stored ?? undefined, today);
}

/** Writes the occurrence's stored row (creating it for a rule occurrence). */
async function writeOccurrence(
  tx: Db,
  o: Occurrence,
  fields: { status: OccurrenceStatus; transactionId: string | null; amountMinor?: number | null; notes?: string | null },
) {
  const ts = nowISO();
  const resolvedAt = fields.status === 'pending' ? null : ts;
  const amount = o.ruleId ? (fields.amountMinor !== undefined ? fields.amountMinor : o.adjusted ? o.amountMinor : null) : o.amountMinor;
  const notes = fields.notes !== undefined ? fields.notes : o.notes;
  if (o.expectedId) {
    await tx.run(
      `UPDATE expected_payments SET status = ?, transaction_id = ?, resolved_at = ?, amount_minor = ?, notes = ?, updated_at = ? WHERE id = ?`,
      [fields.status, fields.transactionId, resolvedAt, amount, notes, ts, o.expectedId],
    );
    return;
  }
  await tx.run(
    `INSERT INTO expected_payments (id, rule_id, due_date, status, transaction_id, resolved_at, amount_minor, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), o.ruleId, o.dueDate, fields.status, fields.transactionId, resolvedAt, amount, notes, ts, ts],
  );
}

function requirePending(o: Occurrence) {
  if (o.status === 'paid') throw new LedgerError('This payment is already marked paid.');
  if (o.status === 'skipped') throw new LedgerError('This payment was skipped. Reopen it first.');
}

/** Changes what one occurrence is expected to cost (this month's electricity…). Null resets it. */
export async function adjustOccurrence(db: Db, ref: OccurrenceRef, amountMinor: number | null, notes?: string | null): Promise<void> {
  if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) throw new LedgerError('Amount must be greater than zero.');
  await db.transaction(async (tx) => {
    const o = await getOccurrence(tx, ref);
    requirePending(o);
    if (!o.ruleId) throw new LedgerError('Edit the expected payment instead.');
    await writeOccurrence(tx, o, { status: 'pending', transactionId: null, amountMinor, notes: notes === undefined ? undefined : notes?.trim() || null });
  });
}

export type PayOccurrenceInput = {
  ref: OccurrenceRef;
  date: string;
  /** What was actually paid or received; it may differ from the expected amount. */
  amountMinor: number;
  /** Defaults to the occurrence's location. */
  accountId?: string | null;
  /** Interest on top of a loan repayment. */
  interestMinor?: number | null;
  note?: string | null;
};

/**
 * Records the real transaction (expense, income, or loan repayment) and marks the occurrence
 * paid, atomically. This is the only way an expected payment reaches a balance.
 */
export async function payOccurrence(db: Db, input: PayOccurrenceInput): Promise<string> {
  return db.transaction(async (tx) => {
    const o = await getOccurrence(tx, input.ref);
    requirePending(o);
    const accountId = input.accountId ?? o.accountId;
    const note = input.note?.trim() || o.name;
    let txId: string;
    if (o.debtId) {
      txId = await recordRepayment(tx, { debtId: o.debtId, accountId, date: input.date, amountMinor: input.amountMinor, interestMinor: input.interestMinor, note });
    } else if (input.interestMinor) {
      throw new LedgerError('Interest only applies to loan repayments.');
    } else if (o.direction === 'expense') {
      txId = await saveExpense(tx, { date: input.date, amountMinor: input.amountMinor, accountId, categoryId: o.categoryId, merchantName: o.payee, note });
    } else {
      txId = await saveIncome(tx, { date: input.date, amountMinor: input.amountMinor, accountId, categoryId: o.categoryId, merchantName: o.payee, note });
    }
    await writeOccurrence(tx, o, { status: 'paid', transactionId: txId });
    return txId;
  });
}

type LinkTx = { id: string; kind: string; deleted_at: string | null; parent_id: string | null; signed: number | null; ownership: string | null };

/** Marks the occurrence paid by a transaction already recorded. */
export async function linkOccurrence(db: Db, ref: OccurrenceRef, transactionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const o = await getOccurrence(tx, ref);
    requirePending(o);
    const t = await tx.first<LinkTx>(
      `SELECT t.id, t.kind, t.deleted_at, t.parent_id, p.amount_minor AS signed, a.ownership FROM transactions t
       LEFT JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
       LEFT JOIN accounts a ON a.id = p.account_id WHERE t.id = ?`,
      [transactionId],
    );
    if (!t || t.deleted_at) throw new LedgerError('Transaction not found.');
    const fits =
      t.ownership === 'personal' &&
      !t.parent_id &&
      (o.direction === 'expense' ? t.kind === 'expense' || (t.kind === 'debt' && (t.signed ?? 0) < 0) : t.kind === 'income' || (t.kind === 'debt' && (t.signed ?? 0) > 0));
    if (!fits) {
      throw new LedgerError(o.direction === 'expense' ? 'Choose a personal expense or loan repayment.' : 'Choose personal income or a repayment received.');
    }
    const origin = await tx.first('SELECT id FROM debts WHERE origin_transaction_id = ?', [t.id]);
    if (origin) throw new LedgerError('This movement starts a debt; it does not pay a bill.');
    const used = await tx.first<{ id: string }>('SELECT id FROM expected_payments WHERE transaction_id = ?', [t.id]);
    if (used) throw new LedgerError('This transaction already settles another expected payment.');
    await writeOccurrence(tx, o, { status: 'paid', transactionId: t.id });
  });
}

/** Not paying this one (cancelled, waived, paid outside the app). Nothing is reserved for it any more. */
export async function skipOccurrence(db: Db, ref: OccurrenceRef, note?: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const o = await getOccurrence(tx, ref);
    requirePending(o);
    await writeOccurrence(tx, o, { status: 'skipped', transactionId: null, notes: note === undefined ? undefined : note?.trim() || null });
  });
}

/** Back to pending: unlinks the paying transaction (which stays recorded) or undoes a skip. */
export async function reopenOccurrence(db: Db, ref: OccurrenceRef): Promise<void> {
  await db.transaction(async (tx) => {
    const o = await getOccurrence(tx, ref);
    if (o.status === 'pending') return;
    if (o.ruleId && !o.adjusted && !o.notes) {
      await tx.run('DELETE FROM expected_payments WHERE id = ?', [o.expectedId]);
      return;
    }
    await writeOccurrence(tx, o, { status: 'pending', transactionId: null });
  });
}

export type LinkCandidate = { transactionId: string; date: string; kind: string; amountMinor: number; label: string; accountName: string; sameAccount: boolean };

/** Recent personal transactions that could settle this occurrence, closest in date first. */
export async function occurrenceCandidates(db: Db, ref: OccurrenceRef): Promise<LinkCandidate[]> {
  const o = await getOccurrence(db, ref);
  const rows = await db.all<{
    id: string;
    date: string;
    kind: string;
    amount_minor: number;
    note: string | null;
    merchant: string | null;
    category: string | null;
    account_id: string;
    account_name: string;
  }>(
    `SELECT t.id, t.date, t.kind, t.amount_minor, t.note, m.name AS merchant, c.name AS category, a.id AS account_id, a.name AS account_name
     FROM transactions t
     JOIN postings p ON p.transaction_id = t.id AND p.role = 'main'
     JOIN accounts a ON a.id = p.account_id AND a.ownership = 'personal'
     LEFT JOIN merchants m ON m.id = t.merchant_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.deleted_at IS NULL AND t.parent_id IS NULL AND t.date BETWEEN ? AND ?
       AND ${o.direction === 'expense' ? `(t.kind = 'expense' OR (t.kind = 'debt' AND p.amount_minor < 0))` : `(t.kind = 'income' OR (t.kind = 'debt' AND p.amount_minor > 0))`}
       AND NOT EXISTS (SELECT 1 FROM expected_payments e WHERE e.transaction_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM debts d WHERE d.origin_transaction_id = t.id)
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 200`,
    [addDays(o.dueDate, -45), addDays(o.dueDate, 45)],
  );
  const distance = (d: string) => Math.abs(daysBetweenInclusive(d < o.dueDate ? d : o.dueDate, d < o.dueDate ? o.dueDate : d));
  return rows
    .map((r) => ({
      transactionId: r.id,
      date: r.date,
      kind: r.kind,
      amountMinor: r.amount_minor,
      label: r.merchant ?? r.note ?? r.category ?? r.kind,
      accountName: r.account_name,
      sameAccount: r.account_id === o.accountId,
      score: (r.account_id === o.accountId ? 0 : 30) + (r.amount_minor === o.amountMinor ? 0 : 15) + distance(r.date),
    }))
    .sort((a, b) => a.score - b.score)
    .map(({ score: _score, ...c }) => c);
}

/** The expected payment a transaction settles (transaction detail screen). */
export async function transactionExpected(db: Db, transactionId: string, today = todayISO()): Promise<Occurrence | null> {
  const e = await db.first<{ id: string }>('SELECT id FROM expected_payments WHERE transaction_id = ?', [transactionId]);
  return e ? getOccurrence(db, { expectedId: e.id }, today) : null;
}
