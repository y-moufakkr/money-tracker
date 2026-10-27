import { SYSTEM_CATEGORY } from '@/db/seed';
import type { Db } from '@/db/types';
import { addDays } from '@/domain/dates';
import type { Company, TaxAssumptions } from '@/domain/types';
import { createTestDb } from '@/test/node-db';
import { count, DH, personalAccount, start, today } from '@/test/fixtures';
import { createAccount, createCompany, getCompany, updateCompany } from './accounts';
import { accountBalances, moneySummary } from './balances';
import {
  computeTaxEstimate,
  emptyAssumptions,
  fiscalYearBounds,
  fiscalYearReport,
  loadCompanyPnl,
  saveFiscalYear,
  saveReserve,
  saveTaxAssumptions,
  saveTaxItem,
} from './company';
import { companyInsights, monthlyPnl } from './company-analytics';
import {
  approveDistribution,
  cancelDistribution,
  getDistribution,
  linkDistributionPayment,
  listDistributions,
  OverDistributionError,
  payDistribution,
  saveSimulation,
  simulateDistribution,
} from './distributions';
import { deleteTransaction, saveExpense, saveIncome, saveTransfer } from './ledger';
import { getLiability, linkLiabilityPayment, payLiability, saveLiability } from './obligations';
import { companyDashboard, threeTotals } from './overview';
import { listTransactions, periodSummary } from './queries';

let db: Db;
let companyId: string;
let bank: string;
let personal: string;
let fy: ReturnType<typeof fiscalYearBounds>;
let fyId: string;

beforeEach(async () => {
  db = await createTestDb();
  companyId = await createCompany(db, { name: 'Zenown SARL', ownershipBp: 9500 });
  bank = await createAccount(db, { name: 'Company bank', kind: 'bank', ownership: 'business', companyId, openingBalanceMinor: DH(100000), openingDate: start });
  personal = await personalAccount(db, 'Personal bank', 'bank', 20000);
  fy = fiscalYearBounds(1, today);
  fyId = await saveFiscalYear(db, { companyId, label: fy.label, startDate: fy.startDate, endDate: fy.endDate });
});

/** A year of company activity, all dated inside the current fiscal year. */
async function recordYear() {
  const on = fy.startDate;
  await saveIncome(db, { date: on, amountMinor: DH(200000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyRevenue, merchantName: 'Client A' });
  await saveExpense(db, { date: on, amountMinor: DH(50000), accountId: bank, categoryId: 'sys-cat-business', merchantName: 'Landlord' });
  const isLiability = await saveLiability(db, { companyId, kind: 'is', label: 'IS advance Q1', amountMinor: DH(10000), fiscalYearId: fyId });
  await payLiability(db, { liabilityId: isLiability, accountId: bank, date: on, amountMinor: DH(10000) });
  await saveExpense(db, { date: on, amountMinor: DH(5000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyTva });
  await saveTransfer(db, { date: on, fromAccountId: bank, toAccountId: personal, amountMinor: DH(30000), transferClass: 'salary' });
  await saveTransfer(db, { date: on, fromAccountId: personal, toAccountId: bank, amountMinor: DH(20000), transferClass: 'owner_loan' });
  await saveTransfer(db, { date: on, fromAccountId: personal, toAccountId: bank, amountMinor: DH(10000), transferClass: 'capital_contribution' });
  await saveTransfer(db, { date: on, fromAccountId: bank, toAccountId: personal, amountMinor: DH(5000), transferClass: 'loan_repayment' });
  await saveIncome(db, { date: on, amountMinor: DH(15000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyFinancing, note: 'Bank loan' });
  return { isLiability };
}

const COMPANY_CASH_AFTER_YEAR = DH(100000 + 200000 - 50000 - 10000 - 5000 - 30000 + 20000 + 10000 - 5000 + 15000);

function assumptions(a: Partial<TaxAssumptions>): TaxAssumptions {
  return { ...emptyAssumptions(fyId), ...a };
}

describe('company P&L', () => {
  it('excludes transfers, owner loans, capital, loan repayments, financing and IS/TVA payments', async () => {
    await recordYear();
    const pnl = await loadCompanyPnl(db, companyId, { from: fy.startDate, to: today });
    expect(pnl.revenue.totalMinor).toBe(DH(200000));
    expect(pnl.expenses.totalMinor).toBe(DH(50000));
    // The salary paid to you is a company cost (and your income on the personal side).
    expect(pnl.expenseTransfers.totalMinor).toBe(DH(30000));
    expect(pnl.costsMinor).toBe(DH(80000));
    expect(pnl.profitMinor).toBe(DH(120000));
    const excluded = Object.fromEntries(pnl.excluded.map((g) => [g.key, g.amountMinor]));
    expect(excluded).toEqual({
      [`cat:${SYSTEM_CATEGORY.companyIs}`]: DH(10000),
      [`cat:${SYSTEM_CATEGORY.companyTva}`]: DH(5000),
      [`cat:${SYSTEM_CATEGORY.companyFinancing}`]: DH(15000),
      'transfer:owner_loan:in': DH(20000),
      'transfer:capital_contribution:in': DH(10000),
      'transfer:loan_repayment:out': DH(5000),
    });
    // Company money stays out of personal totals: only the transfers themselves moved money.
    const summary = await moneySummary(db);
    expect(summary.companies[0].total).toBe(COMPANY_CASH_AFTER_YEAR);
    expect(summary.personal.liquid).toBe(DH(20000 + 30000 - 20000 - 10000 + 5000));
    const personalIncome = await periodSummary(db, { from: start, to: today });
    expect(personalIncome.incomeMinor).toBe(DH(30000));
    expect(personalIncome.expenseMinor).toBe(0);
    // Each excluded group drills down to exactly its transactions.
    const isGroup = pnl.excluded.find((g) => g.key === `cat:${SYSTEM_CATEGORY.companyIs}`)!;
    expect((await listTransactions(db, isGroup.drill)).map((t) => t.amountMinor)).toEqual([DH(10000)]);
  });

  it('counts reimbursements as costs, ignores internal company transfers and other companies', async () => {
    const savings = await createAccount(db, { name: 'Company savings', kind: 'savings', ownership: 'business', companyId, openingBalanceMinor: 0, openingDate: start });
    const other = await createCompany(db, { name: 'Other SARL' });
    const otherBank = await createAccount(db, { name: 'Other bank', kind: 'bank', ownership: 'business', companyId: other, openingBalanceMinor: DH(5000), openingDate: start });
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: savings, amountMinor: DH(40000) });
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: personal, amountMinor: DH(700), transferClass: 'expense_reimbursement' });
    await saveExpense(db, { date: today, amountMinor: DH(999), accountId: otherBank });
    const pnl = await loadCompanyPnl(db, companyId, { from: fy.startDate, to: today });
    expect(pnl.costsMinor).toBe(DH(700));
    expect(pnl.excluded).toEqual([]);
    expect(pnl.profitMinor).toBe(-DH(700));
  });

  it('builds month-over-month figures and explained insights', async () => {
    await recordYear();
    const pnl = await loadCompanyPnl(db, companyId, { from: fy.startDate, to: today });
    const months = monthlyPnl(pnl, [fy.startDate]);
    expect(months[0]).toEqual({ month: fy.startDate, revenueMinor: DH(200000), costsMinor: DH(80000), profitMinor: DH(120000) });
    const insights = companyInsights({ companyId, pnl, monthly: months, dashboard: null });
    const margin = insights.find((i) => i.id === 'co-margin')!;
    expect(margin.title).toContain('60%');
    expect(margin.calculation).toContain('200,000 DH');
    expect(insights.find((i) => i.id === 'co-top-cost')?.drill?.companyId).toBe(companyId);
  });
});

describe('tax estimate with user-entered rates', () => {
  const company: Company = { id: 'co', name: 'Co', legalForm: 'SARL', ownershipBp: 9500, currency: 'MAD', fiscalYearStartMonth: 1, tvaMode: 'ttc', payoutMode: 'detailed', simplePayoutBp: null };
  const fiscalYear = { id: 'fy', companyId: 'co', label: '2026', startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, notes: null };
  const pnl = (revenue: number, costs: number) => ({
    revenue: { totalMinor: revenue, facts: [], tags: new Map() },
    expenses: { totalMinor: costs, facts: [], tags: new Map() },
    expenseTransfers: { totalMinor: 0, facts: [], groups: [] },
    costsMinor: costs,
  });

  it('follows every step from revenue to distributable profit', () => {
    const e = computeTaxEstimate({
      company,
      fiscalYear,
      assumptions: { ...emptyAssumptions('fy'), isRateBp: 2000, withholdingRateBp: 1250, legalReserveRateBp: 500, tvaCollectedMinor: DH(20000), tvaDeductibleMinor: DH(5000) },
      items: [
        { id: 'a', fiscalYearId: 'fy', kind: 'adjustment', label: 'Fines (not deductible)', amountMinor: DH(5000), rateBp: null, base: null, sourceNote: null },
        { id: 'b', fiscalYearId: 'fy', kind: 'other_tax', label: 'Local tax', amountMinor: null, rateBp: 100, base: 'revenue', sourceNote: 'Commune notice' },
      ],
      pnl: pnl(DH(200000), DH(80000)),
      isLinkedPaymentsMinor: DH(10000),
      profitReserves: [],
      approvedGrossMinor: DH(30000),
    });
    expect(e.revenueHtMinor).toBe(DH(180000));
    expect(e.costsHtMinor).toBe(DH(75000));
    expect(e.accountingProfitMinor).toBe(DH(105000));
    expect(e.taxableProfitMinor).toBe(DH(110000));
    expect(e.isEstimatedMinor).toBe(DH(22000));
    expect(e.isAdvancesMinor).toBe(DH(10000));
    expect(e.isRemainingMinor).toBe(DH(12000));
    expect(e.otherTaxesMinor).toBe(DH(1800));
    expect(e.profitAfterTaxMinor).toBe(DH(105000 - 22000 - 1800));
    expect(e.profitReservesMinor).toBe(DH(4060));
    expect(e.distributableMinor).toBe(DH(81200 - 4060));
    expect(e.remainingDistributableMinor).toBe(DH(77140 - 30000));
    expect(e.missing).toEqual([]);
    const isStep = e.steps.find((s) => s.key === 'is')!;
    expect(isStep.calculation).toContain('110,000 DH × 20%');
    expect(isStep.calculation).toContain('your rate');
  });

  it('asks for missing inputs instead of guessing a rate', () => {
    const e = computeTaxEstimate({
      company,
      fiscalYear,
      assumptions: emptyAssumptions('fy'),
      items: [],
      pnl: pnl(DH(100000), DH(40000)),
      isLinkedPaymentsMinor: 0,
      profitReserves: [],
      approvedGrossMinor: 0,
    });
    expect(e.isEstimatedMinor).toBeNull();
    expect(e.profitAfterTaxMinor).toBeNull();
    expect(e.distributableMinor).toBeNull();
    expect(e.missing).toEqual(['TVA collected for this year', 'Deductible TVA for this year', 'IS rate for this fiscal year']);
  });

  it('applies a minimum tax, an override, recorded reserves and losses brought forward', () => {
    const base = { company: { ...company, tvaMode: 'ht' as const }, fiscalYear, items: [], pnl: pnl(DH(50000), DH(49000)), isLinkedPaymentsMinor: 0, approvedGrossMinor: 0 };
    const min = computeTaxEstimate({ ...base, assumptions: { ...emptyAssumptions('fy'), isRateBp: 2000, isMinimumMinor: DH(3000) }, profitReserves: [] });
    expect(min.isEstimatedMinor).toBe(DH(3000));
    expect(min.profitAfterTaxMinor).toBe(-DH(2000));
    expect(min.distributableMinor).toBe(0);
    const over = computeTaxEstimate({
      ...base,
      pnl: pnl(DH(150000), DH(50000)),
      assumptions: { ...emptyAssumptions('fy'), isRateBp: 2000, isOverrideMinor: DH(15000), legalReserveRateBp: 500, retainedEarningsMinor: -DH(10000) },
      profitReserves: [{ id: 'r', companyId: 'co', fiscalYearId: 'fy', kind: 'legal', name: 'Legal reserve', amountMinor: DH(2000), notes: null }],
    });
    expect(over.isEstimatedMinor).toBe(DH(15000));
    // The recorded legal reserve replaces the rate-based one.
    expect(over.profitReservesMinor).toBe(DH(2000));
    expect(over.distributableMinor).toBe(DH(85000 - 2000 - 10000));
  });

  it('uses linked IS payments as advances and reports when data is not enough', async () => {
    await recordYear();
    let r = await fiscalYearReport(db, fyId);
    expect(r.status.complete).toBe(false);
    expect(r.status.reasons.join(' ')).toMatch(/TVA collected/);
    expect(r.estimate.isAdvancesMinor).toBe(DH(10000));

    await saveTaxAssumptions(db, fyId, { ...assumptions({ isRateBp: 2000, withholdingRateBp: 1250, tvaCollectedMinor: DH(20000), tvaDeductibleMinor: DH(5000) }) });
    await saveTaxItem(db, { fiscalYearId: fyId, kind: 'adjustment', label: 'Non-deductible', amountMinor: DH(5000), rateBp: null, base: null, sourceNote: null });
    r = await fiscalYearReport(db, fyId);
    expect(r.status.complete).toBe(true);
    expect(r.estimate.accountingProfitMinor).toBe(DH(105000));
    expect(r.estimate.isEstimatedMinor).toBe(DH(22000));
    expect(r.estimate.isRemainingMinor).toBe(DH(12000));
  });

  it('flags a location opened during the year until pre-tracking figures are entered', async () => {
    await createAccount(db, { name: 'New cash box', kind: 'cash', ownership: 'business', companyId, openingBalanceMinor: 0, openingDate: today });
    await updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9500, tvaMode: 'ht' });
    await saveIncome(db, { date: today, amountMinor: DH(1000), accountId: bank });
    const late = today > fy.startDate;
    let r = await fiscalYearReport(db, fyId);
    expect(r.status.complete).toBe(!late);
    if (late) expect(r.status.reasons[0]).toMatch(/New cash box starts today/);
    await saveTaxAssumptions(db, fyId, assumptions({ preTrackingRevenueMinor: 0, preTrackingExpensesMinor: 0 }));
    r = await fiscalYearReport(db, fyId);
    expect(r.status.complete).toBe(true);
  });
});

describe('obligations are paid by real transactions and never subtracted twice', () => {
  it('paying a linked obligation lowers cash and the obligation equally', async () => {
    const tva = await saveLiability(db, { companyId, kind: 'tva', label: 'TVA September', amountMinor: DH(5000), dueDate: addDays(today, 10) });
    const before = await companyDashboard(db, companyId);
    expect(before!.position.cashMinor).toBe(DH(100000));
    expect(before!.position.obligationsMinor).toBe(DH(5000));
    expect(before!.position.liquidityMinor).toBe(DH(95000));

    await payLiability(db, { liabilityId: tva, accountId: bank, date: today, amountMinor: DH(5000) });
    const after = await companyDashboard(db, companyId);
    expect(after!.position.cashMinor).toBe(DH(95000));
    expect(after!.position.obligationsMinor).toBe(0);
    expect(after!.position.liquidityMinor).toBe(DH(95000));
    expect((await getLiability(db, tva))!.status).toBe('paid');
    // TVA paid to the state is not a cost.
    expect((await loadCompanyPnl(db, companyId, { from: fy.startDate, to: today })).costsMinor).toBe(0);
  });

  it('splits one payment across obligations but never links more than it paid', async () => {
    const cnss = await saveLiability(db, { companyId, kind: 'cnss', label: 'CNSS', amountMinor: DH(6000) });
    const payroll = await saveLiability(db, { companyId, kind: 'payroll', label: 'Payroll', amountMinor: DH(8000) });
    const tx = await saveExpense(db, { date: today, amountMinor: DH(10000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyCnss });
    await linkLiabilityPayment(db, { liabilityId: cnss, transactionId: tx });
    expect((await getLiability(db, cnss))!.paidMinor).toBe(DH(6000));
    await expect(linkLiabilityPayment(db, { liabilityId: payroll, transactionId: tx, amountMinor: DH(5000) })).rejects.toThrow(/Only 4,000 DH/);
    await linkLiabilityPayment(db, { liabilityId: payroll, transactionId: tx });
    expect((await getLiability(db, payroll))!.paidMinor).toBe(DH(4000));
    await expect(linkLiabilityPayment(db, { liabilityId: payroll, transactionId: tx })).rejects.toThrow(/already linked/);
    const s = await companyDashboard(db, companyId);
    expect(s!.position.obligationsMinor).toBe(DH(4000));
    expect(s!.position.liquidityMinor).toBe(DH(90000 - 4000));
  });

  it('only company outflows can pay, and deleting the payment re-opens the obligation', async () => {
    const l = await saveLiability(db, { companyId, kind: 'supplier', label: 'Printer', amountMinor: DH(1200) });
    const personalExpense = await saveExpense(db, { date: today, amountMinor: DH(1200), accountId: personal });
    await expect(linkLiabilityPayment(db, { liabilityId: l, transactionId: personalExpense })).rejects.toThrow(/company/);
    const income = await saveIncome(db, { date: today, amountMinor: DH(1200), accountId: bank });
    await expect(linkLiabilityPayment(db, { liabilityId: l, transactionId: income })).rejects.toThrow(/company/);
    await expect(payLiability(db, { liabilityId: l, accountId: bank, date: today, amountMinor: DH(1300) })).rejects.toThrow(/outstanding/);
    const paid = await payLiability(db, { liabilityId: l, accountId: bank, date: today, amountMinor: DH(1200) });
    await deleteTransaction(db, paid);
    expect((await getLiability(db, l))!.outstandingMinor).toBe(DH(1200));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM company_liability_payments')).toBe(0);
  });

  it('warns about tax payments that are not linked to an obligation', async () => {
    await saveExpense(db, { date: today, amountMinor: DH(3000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyIs });
    const dash = await companyDashboard(db, companyId);
    const check = dash!.checks.find((c) => c.id === 'unlinked-payments')!;
    expect(check.title).toMatch(/1 tax payment/);
    expect((await listTransactions(db, check.drill!)).length).toBe(1);
  });

  it('flags overdue obligations', async () => {
    await saveLiability(db, { companyId, kind: 'is', label: 'IS balance', amountMinor: DH(4000), dueDate: addDays(today, -3) });
    const dash = await companyDashboard(db, companyId);
    expect(dash!.liabilities[0].overdue).toBe(true);
    expect(dash!.liabilities[0].daysOverdue).toBe(3);
    expect(dash!.checks[0]).toMatchObject({ id: 'overdue', tone: 'danger' });
  });
});

describe('distributions: simulated → approved → paid', () => {
  it('simulates the owner share without touching any balance or total', async () => {
    const r = simulateDistribution({ distributableMinor: DH(60000), ownershipBp: 9500, withholdingBp: 1250, proposedMinor: DH(40000) });
    expect(r).toMatchObject({ ownerGrossMinor: DH(38000), withholdingMinor: DH(4750), netMinor: DH(33250), othersMinor: DH(2000), warnings: [] });
    expect(simulateDistribution({ distributableMinor: DH(30000), ownershipBp: 9500, withholdingBp: 1250, proposedMinor: DH(40000), liquidityMinor: DH(20000) }).warnings).toHaveLength(2);

    const balances = await accountBalances(db);
    const summary = await moneySummary(db);
    const income = await periodSummary(db, { from: start, to: today });
    await saveSimulation(db, { companyId, fiscalYearId: fyId, distributableMinor: DH(60000), ownershipBp: 9500, withholdingBp: 1250, proposedMinor: DH(40000) });
    await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(40000), ownershipBp: 9500, withholdingBp: 1250 });
    expect(await accountBalances(db)).toEqual(balances);
    expect(await moneySummary(db)).toEqual(summary);
    expect(await periodSummary(db, { from: start, to: today })).toEqual(income);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM transactions')).toBe(0);
  });

  it('an approval is a company obligation, not personal money', async () => {
    const id = await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(40000), ownershipBp: 9500, withholdingBp: 1250 });
    const dist = await getDistribution(db, id);
    expect(dist).toMatchObject({ ownerGrossMinor: DH(38000), withholdingMinor: DH(4750), netMinor: DH(33250), outstandingMinor: DH(33250), stage: 'approved' });
    const dash = await companyDashboard(db, companyId);
    // Your net + withholding + other partners = the whole distribution.
    expect(dash!.position.obligationsMinor).toBe(DH(40000));
    expect(dash!.position.liquidityMinor).toBe(DH(60000));
    expect(dash!.payout.approvedUnpaidMinor).toBe(DH(33250));
    expect((await moneySummary(db)).personal.liquid).toBe(DH(20000));
  });

  it('paying via a dividend transfer counts once as personal income and moves money from B to A', async () => {
    const id = await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(40000), ownershipBp: 9500, withholdingBp: 1250 });
    const before = await companyDashboard(db, companyId);
    await payDistribution(db, { distributionId: id, fromAccountId: bank, toAccountId: personal, date: today, amountMinor: DH(33250) });

    const income = await periodSummary(db, { from: start, to: today });
    expect(income.incomeMinor).toBe(DH(33250));
    expect(income.companyIncomeMinor).toBe(DH(33250));
    expect(await count(db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'income'")).toBe(0);
    expect((await moneySummary(db)).personal.liquid).toBe(DH(20000 + 33250));
    const after = await companyDashboard(db, companyId);
    expect(after!.position.cashMinor).toBe(before!.position.cashMinor - DH(33250));
    expect(after!.position.liquidityMinor).toBe(before!.position.liquidityMinor);
    expect(after!.payout.approvedUnpaidMinor).toBe(0);
    expect((await getDistribution(db, id))!.stage).toBe('paid');
    expect(after!.checks.find((c) => c.id.startsWith('unpaid-'))).toBeUndefined();
    // Not a company cost either.
    expect((await loadCompanyPnl(db, companyId, { from: fy.startDate, to: today })).costsMinor).toBe(0);
  });

  it('refuses to pay more than approved unless explicitly confirmed', async () => {
    const id = await approveDistribution(db, { companyId, approvedAt: today, totalGrossMinor: DH(10000), ownershipBp: 10000, withholdingBp: 1000 });
    await payDistribution(db, { distributionId: id, fromAccountId: bank, toAccountId: personal, date: today, amountMinor: DH(6000) });
    const extra = await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: personal, amountMinor: DH(4000), transferClass: 'dividend' });
    const err = await linkDistributionPayment(db, { distributionId: id, transactionId: extra }).catch((e) => e);
    expect(err).toBeInstanceOf(OverDistributionError);
    expect(err.message).toMatch(/1,000 DH more than the 9,000 DH net approved/);
    await expect(
      payDistribution(db, { distributionId: id, fromAccountId: bank, toAccountId: personal, date: today, amountMinor: DH(5000) }),
    ).rejects.toThrow(OverDistributionError);
    expect(await count(db, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'transfer' AND deleted_at IS NULL")).toBe(2);

    await linkDistributionPayment(db, { distributionId: id, transactionId: extra, allowExcess: true });
    const dist = await getDistribution(db, id);
    expect(dist).toMatchObject({ paidMinor: DH(10000), excessMinor: DH(1000), outstandingMinor: 0 });
    const dash = await companyDashboard(db, companyId);
    expect(dash!.checks.find((c) => c.id === `over-${id}`)?.tone).toBe('danger');
  });

  it('warns about dividend transfers without an approval, and approvals without a payment', async () => {
    await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: personal, amountMinor: DH(5000), transferClass: 'dividend' });
    const id = await approveDistribution(db, { companyId, approvedAt: today, totalGrossMinor: DH(10000), ownershipBp: 10000, withholdingBp: 0 });
    const dash = await companyDashboard(db, companyId);
    const ids = dash!.checks.map((c) => c.id);
    expect(ids).toContain('dividend-without-approval');
    expect(ids).toContain(`unpaid-${id}`);
    const transfer = (await listTransactions(db, dash!.checks.find((c) => c.id === 'dividend-without-approval')!.drill!))[0];
    await linkDistributionPayment(db, { distributionId: id, transactionId: transfer.id });
    const again = await companyDashboard(db, companyId);
    expect(again!.checks.map((c) => c.id)).not.toContain('dividend-without-approval');
  });

  it('only links a company → personal dividend transfer made after the approval', async () => {
    const id = await approveDistribution(db, { companyId, approvedAt: today, totalGrossMinor: DH(10000), ownershipBp: 10000, withholdingBp: 0 });
    const salary = await saveTransfer(db, { date: today, fromAccountId: bank, toAccountId: personal, amountMinor: DH(1000), transferClass: 'salary' });
    await expect(linkDistributionPayment(db, { distributionId: id, transactionId: salary })).rejects.toThrow(/dividend/);
    const early = await saveTransfer(db, { date: addDays(today, -5), fromAccountId: bank, toAccountId: personal, amountMinor: DH(1000), transferClass: 'dividend' });
    await expect(linkDistributionPayment(db, { distributionId: id, transactionId: early })).rejects.toThrow(/before the approval/);
  });

  it('cancels an unpaid approval together with its obligations', async () => {
    const id = await approveDistribution(db, { companyId, approvedAt: today, totalGrossMinor: DH(40000), ownershipBp: 9500, withholdingBp: 1250 });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM company_liabilities')).toBe(2);
    await cancelDistribution(db, id);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM company_liabilities')).toBe(0);
    expect((await companyDashboard(db, companyId))!.position.obligationsMinor).toBe(0);
  });
});

describe('three totals', () => {
  async function fullSetup() {
    await updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9500, tvaMode: 'ht' });
    await saveIncome(db, { date: fy.startDate, amountMinor: DH(100000), accountId: bank, categoryId: SYSTEM_CATEGORY.companyRevenue });
    await saveExpense(db, { date: fy.startDate, amountMinor: DH(20000), accountId: bank });
    await saveTaxAssumptions(db, fyId, assumptions({ isRateBp: 2000, withholdingRateBp: 1000 }));
    await saveReserve(db, { companyId, fiscalYearId: null, kind: 'cash', name: 'Runway', amountMinor: DH(10000), notes: null });
  }

  it('keeps company money out of A and never adds A, B and C', async () => {
    await fullSetup();
    const dist = await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(20000), ownershipBp: 9500, withholdingBp: 1000 });
    const t = await threeTotals(db);
    expect(Object.keys(t).sort()).toEqual(['a', 'b', 'c', 'currency', 'personalDividendIncome', 'scenarios']);
    expect(t.a.liquidMinor).toBe(DH(20000));
    expect(t.a.liquidMinor).toBe((await moneySummary(db)).personal.liquid);

    const b = t.b[0].position;
    expect(b.cashMinor).toBe(DH(180000));
    expect(b.obligationsMinor).toBe(DH(20000));
    expect(b.reservedMinor).toBe(DH(10000));
    expect(b.liquidityMinor).toBe(DH(150000));

    // Profit 80,000 − IS 16,000 = 64,000 distributable; 20,000 approved → 44,000 left.
    const payout = t.c.companies[0].payout;
    expect(payout.approvedUnpaidMinor).toBe(DH(17100));
    expect(payout.estimatedGrossMinor).toBe(DH(41800));
    expect(payout.estimatedWithholdingMinor).toBe(DH(4180));
    expect(t.c.estimatedNetMinor).toBe(DH(37620));
    expect(payout.calculation.join(' ')).toMatch(/× 95% your ownership/);

    const scenario = t.scenarios.find((s) => s.id === `pay-${dist}`)!;
    const [a, cash, liquidity, c] = scenario.lines;
    expect(a.afterMinor - a.beforeMinor).toBe(DH(17100));
    expect(cash.beforeMinor - cash.afterMinor).toBe(DH(17100));
    expect(liquidity.afterMinor).toBe(liquidity.beforeMinor);
    expect(c.beforeMinor - c.afterMinor).toBe(DH(17100));
    // Money moves, it is not created: A + company cash is the same before and after.
    expect(a.afterMinor + cash.afterMinor).toBe(a.beforeMinor + cash.beforeMinor);
  });

  it('limits the potential payout to the cash left after obligations', async () => {
    await fullSetup();
    await saveLiability(db, { companyId, kind: 'supplier', label: 'Big invoice', amountMinor: DH(150000) });
    const t = await threeTotals(db);
    // Liquidity 180,000 − 150,000 − 10,000 = 20,000, minus 16,000 IS not yet recorded = 4,000 (below the 64,000 distributable).
    expect(t.c.companies[0].payout.estimatedGrossMinor).toBe(DH(3800));
    expect(t.c.companies[0].payout.calculation.join(' ')).toMatch(/limited by cash/);
  });

  it('gives no estimate without the data it needs, and says why', async () => {
    const t = await threeTotals(db);
    expect(t.c.estimatedNetMinor).toBeNull();
    expect(t.c.companies[0].payout.missing[0]).toMatch(/No revenue or expenses/);
    expect(t.b[0].position.cashMinor).toBe(DH(100000));
    expect(t.a.liquidMinor).toBe(DH(20000));
  });

  it('flags personal income recorded as dividends (a possible double count)', async () => {
    await saveIncome(db, { date: today, amountMinor: DH(1000), accountId: personal, categoryId: 'sys-cat-dividends' });
    const t = await threeTotals(db);
    expect(t.personalDividendIncome).toMatchObject({ count: 1, totalMinor: DH(1000) });
    expect(await listTransactions(db, t.personalDividendIncome!.drill)).toHaveLength(1);
  });
});

describe('company settings', () => {
  it('stores the TVA mode and fiscal year start', async () => {
    await updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9000, fiscalYearStartMonth: 7, tvaMode: 'ht' });
    expect(await getCompany(db, companyId)).toMatchObject({ ownershipBp: 9000, fiscalYearStartMonth: 7, tvaMode: 'ht' });
    expect(fiscalYearBounds(7, '2026-03-10')).toEqual({ startDate: '2025-07-01', endDate: '2026-06-30', label: '2025–26' });
    expect(fiscalYearBounds(1, '2026-03-10')).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31', label: '2026' });
  });

  it('simple payout mode: an entered share of company money, no fiscal-year data needed, never added to personal money', async () => {
    // No revenue, assumptions or rates entered: the detailed estimate cannot say anything.
    expect((await companyDashboard(db, companyId))!.payout.estimatedNetMinor).toBeNull();
    await expect(updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9500, payoutMode: 'simple' })).rejects.toThrow(/share/);
    await updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9500, payoutMode: 'simple', simplePayoutBp: 2800 });
    expect(await getCompany(db, companyId)).toMatchObject({ payoutMode: 'simple', simplePayoutBp: 2800 });

    const before = await moneySummary(db);
    const t = await threeTotals(db);
    const payout = t.c.companies[0].payout;
    expect(payout).toMatchObject({ simple: true, approvedUnpaidMinor: 0, estimatedNetMinor: DH(28000) });
    expect(t.c.estimatedNetMinor).toBe(DH(28000));
    expect(t.a.liquidMinor).toBe(before.personal.liquid);
    expect((await moneySummary(db)).personal).toEqual(before.personal);

    // An approved dividend comes out of the same company money: part of the 28 %, not extra.
    await approveDistribution(db, { companyId, fiscalYearId: fyId, approvedAt: today, totalGrossMinor: DH(10000), ownershipBp: 10000, withholdingBp: 0 });
    let p = (await companyDashboard(db, companyId))!.payout;
    expect(p.approvedUnpaidMinor).toBe(DH(10000));
    expect(p.approvedUnpaidMinor + p.estimatedNetMinor!).toBe(DH(28000));
    // Paying it moves money to you: company money falls, so the share falls with it. Nothing is counted twice.
    await payDistribution(db, { distributionId: (await listDistributions(db, { companyId }))[0].id, fromAccountId: bank, toAccountId: personal, date: today, amountMinor: DH(10000) });
    p = (await companyDashboard(db, companyId))!.payout;
    expect(p.approvedUnpaidMinor).toBe(0);
    expect(p.estimatedNetMinor).toBe(DH(25200));

    // Back to detailed: the setting is kept, the estimate uses the accounting model again.
    await updateCompany(db, companyId, { name: 'Zenown SARL', ownershipBp: 9500, payoutMode: 'detailed' });
    expect(await getCompany(db, companyId)).toMatchObject({ payoutMode: 'detailed', simplePayoutBp: 2800 });
    expect((await companyDashboard(db, companyId))!.payout.simple).toBe(false);
  });

  it('refuses overlapping fiscal years', async () => {
    await expect(saveFiscalYear(db, { companyId, label: 'Dup', startDate: addDays(fy.startDate, 30), endDate: addDays(fy.endDate, 30) })).rejects.toThrow(/overlap/);
  });
});
