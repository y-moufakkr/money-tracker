/**
 * Profit distributions: simulated → approved → paid.
 *
 * - A simulation is a calculation. It is stored separately and never touches
 *   a balance or a total.
 * - An approval records the partners' decision. It is still not personal
 *   money: it becomes a company obligation (your net share, plus withholding
 *   and other partners' shares as linked obligations).
 * - Only a real company → personal transfer classified "dividend" moves money.
 *   Paying a distribution links that transfer; it never creates a second
 *   income. The transfer alone is what personal income counts.
 */
import { LedgerError, type Db } from '@/db/types';
import { formatDateLabel, isValidISODate, todayISO } from '@/domain/dates';
import { applyBp, formatBp, formatMoney } from '@/domain/money';
import type { DistributionSimulation, DistributionStatus } from '@/domain/types';
import { newId, nowISO } from '@/lib/id';
import { requireAccount, requireCompany } from './accounts';
import { saveTransfer } from './ledger';
import type { TransactionFilter } from './queries';

// ---------------------------------------------------------------------------
// Simulation (pure)

export const PAYOUT_LABEL = 'Estimated potential personal payout — not yet personal money.';

export type SimulationInput = {
  distributableMinor: number;
  ownershipBp: number;
  withholdingBp: number;
  /** Total distribution proposed to all partners. */
  proposedMinor: number;
  /** Company liquidity after obligations, to warn when the cash is not there. */
  liquidityMinor?: number | null;
};

export type SimulationResult = {
  ownerGrossMinor: number;
  withholdingMinor: number;
  netMinor: number;
  /** Shares of other partners (total − yours). */
  othersMinor: number;
  calculation: string[];
  warnings: string[];
};

export function simulateDistribution(input: SimulationInput): SimulationResult {
  const gross = applyBp(input.proposedMinor, input.ownershipBp);
  const withholding = applyBp(gross, input.withholdingBp);
  const net = gross - withholding;
  const warnings: string[] = [];
  if (input.proposedMinor > input.distributableMinor) {
    warnings.push(
      `The proposal is ${formatMoney(input.proposedMinor - input.distributableMinor)} more than the estimated distributable profit (${formatMoney(input.distributableMinor)}). Profit that is not distributable cannot be paid out.`,
    );
  }
  if (input.liquidityMinor !== null && input.liquidityMinor !== undefined && input.proposedMinor > input.liquidityMinor) {
    warnings.push(
      `The company's estimated liquidity after obligations is ${formatMoney(input.liquidityMinor)}: it may not have the cash to pay ${formatMoney(input.proposedMinor)}.`,
    );
  }
  return {
    ownerGrossMinor: gross,
    withholdingMinor: withholding,
    netMinor: net,
    othersMinor: input.proposedMinor - gross,
    calculation: [
      `Your gross share: ${formatMoney(input.proposedMinor)} × ${formatBp(input.ownershipBp)} ownership = ${formatMoney(gross)}`,
      `Withholding: ${formatMoney(gross)} × ${formatBp(input.withholdingBp)} (your rate) = ${formatMoney(withholding)}`,
      `Estimated net: ${formatMoney(gross)} − ${formatMoney(withholding)} = ${formatMoney(net)}`,
    ],
    warnings,
  };
}

function validateSimulation(input: SimulationInput) {
  for (const [v, label] of [
    [input.distributableMinor, 'Distributable profit'],
    [input.proposedMinor, 'Proposed distribution'],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new LedgerError(`${label} is invalid.`);
  }
  if (input.proposedMinor <= 0) throw new LedgerError('Enter the proposed distribution.');
  for (const [v, label] of [
    [input.ownershipBp, 'Ownership'],
    [input.withholdingBp, 'The withholding rate'],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 10000) throw new LedgerError(`${label} must be between 0% and 100%.`);
  }
}

type SimulationRow = {
  id: string;
  company_id: string;
  fiscal_year_id: string | null;
  name: string | null;
  distributable_minor: number;
  ownership_bp: number;
  withholding_bp: number;
  proposed_minor: number;
  owner_gross_minor: number;
  withholding_minor: number;
  net_minor: number;
  notes: string | null;
  created_at: string;
};

export async function listSimulations(db: Db, companyId: string): Promise<DistributionSimulation[]> {
  const rows = await db.all<SimulationRow>('SELECT * FROM distribution_simulations WHERE company_id = ? ORDER BY created_at DESC', [companyId]);
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    fiscalYearId: r.fiscal_year_id,
    name: r.name,
    distributableMinor: r.distributable_minor,
    ownershipBp: r.ownership_bp,
    withholdingBp: r.withholding_bp,
    proposedMinor: r.proposed_minor,
    ownerGrossMinor: r.owner_gross_minor,
    withholdingMinor: r.withholding_minor,
    netMinor: r.net_minor,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

export async function saveSimulation(
  db: Db,
  input: SimulationInput & { companyId: string; fiscalYearId?: string | null; name?: string | null; notes?: string | null },
): Promise<string> {
  validateSimulation(input);
  const r = simulateDistribution(input);
  const id = newId();
  const ts = nowISO();
  await db.transaction(async (tx) => {
    await requireCompany(tx, input.companyId);
    await tx.run(
      `INSERT INTO distribution_simulations (id, company_id, fiscal_year_id, name, distributable_minor, ownership_bp, withholding_bp,
         proposed_minor, owner_gross_minor, withholding_minor, net_minor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.companyId,
        input.fiscalYearId ?? null,
        input.name?.trim() || null,
        input.distributableMinor,
        input.ownershipBp,
        input.withholdingBp,
        input.proposedMinor,
        r.ownerGrossMinor,
        r.withholdingMinor,
        r.netMinor,
        input.notes?.trim() || null,
        ts,
        ts,
      ],
    );
  });
  return id;
}

export async function deleteSimulation(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM distribution_simulations WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Approved distributions

export type DistributionPayment = { id: string; transactionId: string; date: string; amountMinor: number; transferClass: string | null };

export type Distribution = {
  id: string;
  companyId: string;
  fiscalYearId: string | null;
  fiscalYearLabel: string | null;
  simulationId: string | null;
  approvedAt: string;
  totalGrossMinor: number;
  ownershipBp: number;
  ownerGrossMinor: number;
  withholdingBp: number;
  withholdingMinor: number;
  /** Your net share: what the dividend transfers should add up to. */
  netMinor: number;
  status: DistributionStatus;
  notes: string | null;
  payments: DistributionPayment[];
  paidMinor: number;
  /** Net still owed to you (≥ 0). */
  outstandingMinor: number;
  /** Paid above the approved net (≥ 0). */
  excessMinor: number;
  stage: 'cancelled' | 'approved' | 'partially_paid' | 'paid';
};

type DistributionRow = {
  id: string;
  company_id: string;
  fiscal_year_id: string | null;
  fy_label: string | null;
  simulation_id: string | null;
  approved_at: string;
  total_gross_minor: number;
  ownership_bp: number;
  owner_gross_minor: number;
  withholding_bp: number;
  withholding_minor: number;
  net_minor: number;
  status: DistributionStatus;
  notes: string | null;
};

export async function listDistributions(db: Db, opts: { companyId?: string; id?: string } = {}): Promise<Distribution[]> {
  const rows = await db.all<DistributionRow>(
    `SELECT d.*, fy.label AS fy_label FROM distributions d
     LEFT JOIN company_fiscal_years fy ON fy.id = d.fiscal_year_id
     WHERE (? IS NULL OR d.company_id = ?) AND (? IS NULL OR d.id = ?)
     ORDER BY d.approved_at DESC, d.created_at DESC`,
    [opts.companyId ?? null, opts.companyId ?? null, opts.id ?? null, opts.id ?? null],
  );
  const payments = await db.all<{ id: string; distribution_id: string; transaction_id: string; date: string; amount_minor: number; transfer_class: string | null }>(
    `SELECT dp.id, dp.distribution_id, dp.transaction_id, t.date, t.amount_minor, t.transfer_class
     FROM distribution_payments dp JOIN transactions t ON t.id = dp.transaction_id AND t.deleted_at IS NULL
     ORDER BY t.date`,
  );
  return rows.map((r) => {
    const own = payments
      .filter((p) => p.distribution_id === r.id)
      .map((p) => ({ id: p.id, transactionId: p.transaction_id, date: p.date, amountMinor: p.amount_minor, transferClass: p.transfer_class }));
    const paid = own.reduce((s, p) => s + p.amountMinor, 0);
    const stage: Distribution['stage'] =
      r.status === 'cancelled' ? 'cancelled' : paid === 0 ? 'approved' : paid < r.net_minor ? 'partially_paid' : 'paid';
    return {
      id: r.id,
      companyId: r.company_id,
      fiscalYearId: r.fiscal_year_id,
      fiscalYearLabel: r.fy_label,
      simulationId: r.simulation_id,
      approvedAt: r.approved_at,
      totalGrossMinor: r.total_gross_minor,
      ownershipBp: r.ownership_bp,
      ownerGrossMinor: r.owner_gross_minor,
      withholdingBp: r.withholding_bp,
      withholdingMinor: r.withholding_minor,
      netMinor: r.net_minor,
      status: r.status,
      notes: r.notes,
      payments: own,
      paidMinor: paid,
      outstandingMinor: r.status === 'cancelled' ? 0 : Math.max(0, r.net_minor - paid),
      excessMinor: Math.max(0, paid - r.net_minor),
      stage,
    };
  });
}

export async function getDistribution(db: Db, id: string): Promise<Distribution | null> {
  return (await listDistributions(db, { id }))[0] ?? null;
}

async function requireDistribution(db: Db, id: string): Promise<Distribution> {
  const d = await getDistribution(db, id);
  if (!d) throw new LedgerError('Distribution not found.');
  return d;
}

export type ApproveInput = {
  companyId: string;
  fiscalYearId?: string | null;
  simulationId?: string | null;
  approvedAt: string;
  /** Total distribution to all partners (gross). */
  totalGrossMinor: number;
  ownershipBp: number;
  withholdingBp: number;
  notes?: string | null;
  /**
   * Also record what the company now owes besides your net share: the
   * withholding on your share and the other partners' gross shares. Default true.
   */
  createObligations?: boolean;
  obligationsDueDate?: string | null;
};

/** Records an approved distribution. No money moves and no balance changes. */
export async function approveDistribution(db: Db, input: ApproveInput): Promise<string> {
  validateSimulation({ distributableMinor: input.totalGrossMinor, ownershipBp: input.ownershipBp, withholdingBp: input.withholdingBp, proposedMinor: input.totalGrossMinor });
  if (!isValidISODate(input.approvedAt)) throw new LedgerError('Approval date is invalid.');
  if (input.approvedAt > todayISO()) throw new LedgerError('Record an approval once it has been decided (no future dates).');
  if (input.obligationsDueDate && !isValidISODate(input.obligationsDueDate)) throw new LedgerError('Due date is invalid.');
  const r = simulateDistribution({ distributableMinor: input.totalGrossMinor, ownershipBp: input.ownershipBp, withholdingBp: input.withholdingBp, proposedMinor: input.totalGrossMinor });
  return db.transaction(async (tx) => {
    const company = await requireCompany(tx, input.companyId);
    let fyLabel: string | null = null;
    if (input.fiscalYearId) {
      const fy = await tx.first<{ company_id: string; label: string }>('SELECT company_id, label FROM company_fiscal_years WHERE id = ?', [input.fiscalYearId]);
      if (!fy || fy.company_id !== company.id) throw new LedgerError('Fiscal year not found for this company.');
      fyLabel = fy.label;
    }
    const id = newId();
    const ts = nowISO();
    await tx.run(
      `INSERT INTO distributions (id, company_id, fiscal_year_id, simulation_id, approved_at, total_gross_minor, ownership_bp,
         owner_gross_minor, withholding_bp, withholding_minor, net_minor, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
      [
        id,
        company.id,
        input.fiscalYearId ?? null,
        input.simulationId ?? null,
        input.approvedAt,
        input.totalGrossMinor,
        input.ownershipBp,
        r.ownerGrossMinor,
        input.withholdingBp,
        r.withholdingMinor,
        r.netMinor,
        input.notes?.trim() || null,
        ts,
        ts,
      ],
    );
    if (input.createObligations ?? true) {
      const suffix = fyLabel ? ` (${fyLabel} profit)` : '';
      const obligations: [string, string, number][] = [
        ['withholding', `Withholding on your dividend${suffix}`, r.withholdingMinor],
        ['dividend', `Dividends to other partners${suffix}`, r.othersMinor],
      ];
      for (const [kind, label, amount] of obligations) {
        if (amount <= 0) continue;
        await tx.run(
          `INSERT INTO company_liabilities (id, company_id, fiscal_year_id, distribution_id, kind, label, amount_minor, currency, due_date,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId(), company.id, input.fiscalYearId ?? null, id, kind, label, amount, company.currency, input.obligationsDueDate ?? null, ts, ts],
        );
      }
    }
    return id;
  });
}

/**
 * Cancels an approval that was never paid. Its obligations go with it, unless
 * a payment is already linked to them.
 */
export async function cancelDistribution(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const d = await requireDistribution(tx, id);
    if (d.payments.length > 0) throw new LedgerError('Payments are linked to this distribution. Unlink them before cancelling.');
    const paid = await tx.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM company_liability_payments lp
       JOIN company_liabilities l ON l.id = lp.liability_id
       JOIN transactions t ON t.id = lp.transaction_id AND t.deleted_at IS NULL
       WHERE l.distribution_id = ?`,
      [id],
    );
    if ((paid?.n ?? 0) > 0) throw new LedgerError('Its withholding or partner obligations already have payments. Unlink them first.');
    await tx.run('DELETE FROM company_liability_payments WHERE liability_id IN (SELECT id FROM company_liabilities WHERE distribution_id = ?)', [id]);
    await tx.run('DELETE FROM company_liabilities WHERE distribution_id = ?', [id]);
    await tx.run("UPDATE distributions SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowISO(), id]);
  });
}

/** Thrown when payments would exceed the approved net. Retry with `allowExcess` after the user confirms. */
export class OverDistributionError extends LedgerError {
  constructor(
    readonly approvedNetMinor: number,
    readonly paidAfterMinor: number,
  ) {
    super(
      `This would bring the payments to ${formatMoney(paidAfterMinor)}, ${formatMoney(paidAfterMinor - approvedNetMinor)} more than the ${formatMoney(approvedNetMinor)} net approved. ` +
        'Paying more than was approved needs a new or amended approval.',
    );
    this.name = 'OverDistributionError';
  }
}

type DividendRow = {
  id: string;
  kind: string;
  date: string;
  amount_minor: number;
  transfer_class: string | null;
  deleted_at: string | null;
  from_co: string | null;
  to_own: string | null;
};

async function dividendTransfer(tx: Db, transactionId: string): Promise<DividendRow> {
  const t = await tx.first<DividendRow>(
    `SELECT t.id, t.kind, t.date, t.amount_minor, t.transfer_class, t.deleted_at, af.company_id AS from_co, at2.ownership AS to_own
     FROM transactions t
     LEFT JOIN postings pf ON pf.transaction_id = t.id AND pf.role = 'from' LEFT JOIN accounts af ON af.id = pf.account_id
     LEFT JOIN postings pt ON pt.transaction_id = t.id AND pt.role = 'to' LEFT JOIN accounts at2 ON at2.id = pt.account_id
     WHERE t.id = ?`,
    [transactionId],
  );
  if (!t || t.deleted_at) throw new LedgerError('Transaction not found.');
  return t;
}

export type LinkDistributionInput = { distributionId: string; transactionId: string; allowExcess?: boolean };

/** Links an existing company → personal dividend transfer as (part of) a distribution's payment. */
export async function linkDistributionPayment(db: Db, input: LinkDistributionInput): Promise<void> {
  await db.transaction(async (tx) => {
    const d = await requireDistribution(tx, input.distributionId);
    if (d.status === 'cancelled') throw new LedgerError('This distribution was cancelled.');
    const t = await dividendTransfer(tx, input.transactionId);
    if (t.kind !== 'transfer' || t.transfer_class !== 'dividend' || t.from_co !== d.companyId || t.to_own !== 'personal') {
      throw new LedgerError('Only a transfer from this company to a personal account, classified as a dividend, can pay a distribution.');
    }
    if (t.date < d.approvedAt) {
      throw new LedgerError(`This transfer (${formatDateLabel(t.date)}) is before the approval (${formatDateLabel(d.approvedAt)}). Correct the approval date if it is wrong.`);
    }
    const other = await tx.first('SELECT id FROM distribution_payments WHERE transaction_id = ?', [t.id]);
    if (other) throw new LedgerError('This transfer already pays a distribution.');
    const liab = await tx.first('SELECT id FROM company_liability_payments WHERE transaction_id = ?', [t.id]);
    if (liab) throw new LedgerError('This transfer is linked to an obligation; unlink it there first.');
    const after = d.paidMinor + t.amount_minor;
    if (after > d.netMinor && !input.allowExcess) throw new OverDistributionError(d.netMinor, after);
    await tx.run('INSERT INTO distribution_payments (id, distribution_id, transaction_id, created_at) VALUES (?, ?, ?, ?)', [
      newId(),
      d.id,
      t.id,
      nowISO(),
    ]);
  });
}

export async function unlinkDistributionPayment(db: Db, paymentId: string): Promise<void> {
  await db.run('DELETE FROM distribution_payments WHERE id = ?', [paymentId]);
}

export type PayDistributionInput = {
  distributionId: string;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amountMinor: number;
  /** Needed when the personal account has another currency. */
  receivedMinor?: number | null;
  note?: string | null;
  allowExcess?: boolean;
};

/**
 * Records the one real dividend transfer that pays a distribution and links
 * it, atomically. This transfer is the only thing that adds to your money.
 */
export async function payDistribution(db: Db, input: PayDistributionInput): Promise<string> {
  return db.transaction(async (tx) => {
    const d = await requireDistribution(tx, input.distributionId);
    if (d.status === 'cancelled') throw new LedgerError('This distribution was cancelled.');
    const from = await requireAccount(tx, input.fromAccountId);
    const to = await requireAccount(tx, input.toAccountId);
    if (from.companyId !== d.companyId) throw new LedgerError('Pay the distribution from one of the company’s accounts.');
    if (to.ownership !== 'personal') throw new LedgerError('A dividend is paid into one of your personal accounts.');
    const after = d.paidMinor + input.amountMinor;
    if (after > d.netMinor && !input.allowExcess) throw new OverDistributionError(d.netMinor, after);
    const txId = await saveTransfer(tx, {
      date: input.date,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinor: input.amountMinor,
      receivedMinor: input.receivedMinor,
      transferClass: 'dividend',
      note: input.note?.trim() || `Dividend${d.fiscalYearLabel ? ` (${d.fiscalYearLabel} profit)` : ''}`,
    });
    await linkDistributionPayment(tx, { distributionId: d.id, transactionId: txId, allowExcess: input.allowExcess });
    return txId;
  });
}

export type DividendCandidate = { transactionId: string; date: string; amountMinor: number; toName: string };

/** Dividend transfers from this company that do not pay any distribution yet. */
export async function unmatchedDividendTransfers(db: Db, companyId: string): Promise<DividendCandidate[]> {
  const rows = await db.all<{ id: string; date: string; amount_minor: number; to_name: string }>(
    `SELECT t.id, t.date, t.amount_minor, at2.name AS to_name
     FROM transactions t
     JOIN postings pf ON pf.transaction_id = t.id AND pf.role = 'from' JOIN accounts af ON af.id = pf.account_id
     JOIN postings pt ON pt.transaction_id = t.id AND pt.role = 'to' JOIN accounts at2 ON at2.id = pt.account_id
     WHERE t.deleted_at IS NULL AND t.kind = 'transfer' AND t.transfer_class = 'dividend'
       AND af.company_id = ? AND at2.ownership = 'personal'
       AND NOT EXISTS (SELECT 1 FROM distribution_payments dp WHERE dp.transaction_id = t.id)
     ORDER BY t.date DESC`,
    [companyId],
  );
  return rows.map((r) => ({ transactionId: r.id, date: r.date, amountMinor: r.amount_minor, toName: r.to_name }));
}

// ---------------------------------------------------------------------------
// Consistency checks

export type CompanyCheck = {
  id: string;
  tone: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  drill?: TransactionFilter;
  href?: string;
};

/** Pure: mismatches between dividend transfers and approved distributions. */
export function distributionChecks(companyId: string, distributions: Distribution[], unmatched: DividendCandidate[]): CompanyCheck[] {
  const out: CompanyCheck[] = [];
  if (unmatched.length > 0) {
    const total = unmatched.reduce((s, x) => s + x.amountMinor, 0);
    out.push({
      id: 'dividend-without-approval',
      tone: 'warning',
      title: `${unmatched.length} dividend transfer${unmatched.length > 1 ? 's' : ''} (${formatMoney(total)}) without an approved distribution`,
      detail:
        'A dividend is paid out of profit the partners approved. Record the approval and link the transfer to it, or reclassify the transfer (salary, loan…) if it was not a dividend.',
      drill: { companyId, kinds: ['transfer'], transferClass: 'dividend' },
    });
  }
  for (const d of distributions) {
    if (d.status === 'cancelled') continue;
    const label = `Distribution approved ${formatDateLabel(d.approvedAt)}${d.fiscalYearLabel ? ` (${d.fiscalYearLabel})` : ''}`;
    if (d.excessMinor > 0) {
      out.push({
        id: `over-${d.id}`,
        tone: 'danger',
        title: `${label}: paid ${formatMoney(d.excessMinor)} more than approved`,
        detail: `Approved net ${formatMoney(d.netMinor)}, paid ${formatMoney(d.paidMinor)}. Amend the approval or correct the transfers.`,
        href: `/company/distribution/${d.id}`,
      });
    }
    const wrong = d.payments.filter((p) => p.transferClass !== 'dividend');
    if (wrong.length > 0) {
      out.push({
        id: `class-${d.id}`,
        tone: 'warning',
        title: `${label}: a linked payment is no longer classified as a dividend`,
        detail: 'Its classification was changed after it was linked. Unlink it or classify it as a dividend again.',
        href: `/company/distribution/${d.id}`,
      });
    }
    if (d.paidMinor === 0) {
      out.push({
        id: `unpaid-${d.id}`,
        tone: 'info',
        title: `${label}: ${formatMoney(d.netMinor)} net not paid yet`,
        detail: 'Approved, so the company owes it, but it is not your money until the dividend transfer is made.',
        href: `/company/distribution/${d.id}`,
      });
    }
  }
  return out;
}
