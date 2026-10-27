import { findAmounts, merchantKey, parseReceipt, toRows, type OcrLine } from './receipt-parse';

const today = '2026-10-27';
const lines = (text: string) => text.split('\n');

describe('amounts on receipts', () => {
  it('reads comma decimals, thousands separators and DH/MAD through money.ts', () => {
    const minors = (s: string) => findAmounts(s).map((a) => a.minor);
    expect(minors('TOTAL 1 234,50 DH')).toEqual([123450]);
    expect(minors('TOTAL 1.234,50')).toEqual([123450]);
    expect(minors('TOTAL 1,234.50 MAD')).toEqual([123450]);
    expect(minors('NET A PAYER 47,60Dhs')).toEqual([4760]);
    expect(minors('MONTANT 125 DH')).toEqual([12500]);
    expect(minors('PRIX 12,850 DH/L')).toEqual([1285]);
    expect(findAmounts('REMISE -4,50')[0]).toMatchObject({ minor: 450, negative: true });
  });

  it('never reads dates, times, codes or unrepresentable prices as amounts', () => {
    expect(findAmounts('27.10.26 18:42')).toEqual([]);
    expect(findAmounts('27/10/2026')).toEqual([]);
    expect(findAmounts('ICE 001234567000089')).toEqual([]);
    expect(findAmounts('PRIX 12,855')).toEqual([]);
    expect(findAmounts('CAISSE 07 TICKET 0042')).toEqual([]);
  });
});

describe('rows from OCR boxes', () => {
  it('joins a label and its amount printed on the same row, left to right', () => {
    const ocr: OcrLine[] = [
      { text: '245,90', box: { x: 600, y: 1210, width: 120, height: 40 }, confidence: 0.95 },
      { text: 'CARREFOUR', box: { x: 300, y: 80, width: 400, height: 90 }, confidence: 0.98 },
      { text: 'TOTAL', box: { x: 40, y: 1205, width: 140, height: 44 }, confidence: 0.97 },
      { text: 'ARTICLES 3', box: { x: 40, y: 1300, width: 200, height: 40 }, confidence: 0.9 },
    ];
    expect(toRows(ocr).map((r) => r.text)).toEqual(['CARREFOUR', 'TOTAL 245,90', 'ARTICLES 3']);
  });
});

describe('parseReceipt', () => {
  it('supermarket (Marjane): total TTC confirmed by cash − change, itemised lines that add up, brand merchant', () => {
    const r = parseReceipt(
      lines(`MARJANE
MARJANE HOLDING SA
HAY RIAD RABAT
ICE 001234567000089
TEL 05 37 71 22 33
TICKET N° 0042 CAISSE 07
27/10/2026 18:42
LAIT CENTRALE 1L
   2 X 7,50          15,00
PAIN COMPLET 400G      12,00
POULET 1,250 KG X 62,00  77,50
REMISE FIDELITE       -4,50
SOUS-TOTAL          100,00
TOTAL TTC           100,00
TVA 20%  HT 83,33  TVA 16,67
ESPECES             200,00
RENDU               100,00
MERCI DE VOTRE VISITE`),
      { today },
    );
    expect(r.totalMinor).toMatchObject({ value: 10000, confidence: 'high' });
    expect(r.date).toMatchObject({ value: '2026-10-27', confidence: 'high' });
    expect(r.merchantName).toMatchObject({ value: 'Marjane', merchantId: null, confidence: 'medium' });
    expect(r.items?.value).toEqual([
      { lineKind: 'product', name: 'Lait Centrale 1L', quantityMilli: 2000, unit: null, unitPriceMinor: 750, totalMinor: 1500 },
      { lineKind: 'product', name: 'Pain Complet 400G', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 1200 },
      { lineKind: 'product', name: 'Poulet', quantityMilli: 1250, unit: 'kg', unitPriceMinor: 6200, totalMinor: 7750 },
      { lineKind: 'discount', name: 'Remise Fidelite', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 450 },
    ]);
    expect(r.items?.confidence).toBe('high');
  });

  it('reuses an existing merchant, accent- and case-insensitively', () => {
    const merchants = [
      { id: 'm1', name: 'Marjane Market' },
      { id: 'm2', name: 'Épicerie Hôtel' },
      { id: 'm3', name: 'Carrefour' },
    ];
    expect(parseReceipt(['MARJANE', 'TOTAL 10,00'], { today, merchants }).merchantName).toMatchObject({
      value: 'Marjane Market',
      merchantId: 'm1',
      confidence: 'medium',
    });
    expect(parseReceipt(['EPICERIE HOTEL', 'TOTAL 10,00'], { today, merchants }).merchantName).toMatchObject({
      value: 'Épicerie Hôtel',
      merchantId: 'm2',
      confidence: 'high',
    });
    // An OCR slip (0 for O) still finds the existing merchant instead of creating a near-duplicate.
    expect(parseReceipt(['CARREF0UR MARKET', 'TOTAL 10,00'], { today, merchants }).merchantName).toMatchObject({
      merchantId: 'm3',
    });
    expect(merchantKey("Label'Vie — Hay Riad")).toBe('label vie hay riad');
  });

  it('Carrefour with OCR boxes: total read across the row', () => {
    const ocr: OcrLine[] = [
      { text: 'CARREFOUR MARKET', box: { x: 200, y: 40, width: 500, height: 80 }, confidence: 0.97 },
      { text: 'Date: 24/10/2026', box: { x: 40, y: 200, width: 300, height: 30 }, confidence: 0.95 },
      { text: 'TOTAL', box: { x: 40, y: 900, width: 120, height: 40 }, confidence: 0.96 },
      { text: '245,90', box: { x: 600, y: 905, width: 120, height: 40 }, confidence: 0.94 },
      { text: 'CB', box: { x: 40, y: 960, width: 60, height: 40 }, confidence: 0.95 },
      { text: '245,90', box: { x: 600, y: 962, width: 120, height: 40 }, confidence: 0.94 },
    ];
    const r = parseReceipt(ocr, { today });
    expect(r.totalMinor).toMatchObject({ value: 24590, confidence: 'high' });
    expect(r.date.value).toBe('2026-10-24');
    expect(r.merchantName).toMatchObject({ value: 'Carrefour Market', confidence: 'medium' });
  });

  it('pharmacy: NET A PAYER, a store name from the top line (low confidence) and items', () => {
    const r = parseReceipt(
      lines(`PHARMACIE AL AMAL
Dr. Benali
45 Bd Zerktouni Casablanca
Le 12/10/2026
DOLIPRANE 1000MG        15,60
VITAMINE C UPSA         32,00
NET A PAYER             47,60 DH`),
      { today },
    );
    expect(r.totalMinor).toMatchObject({ value: 4760, confidence: 'high' });
    expect(r.date).toMatchObject({ value: '2026-10-12', confidence: 'high' });
    expect(r.merchantName).toMatchObject({ value: 'Pharmacie Al Amal', merchantId: null, confidence: 'low' });
    expect(r.items?.value.map((i) => [i.name, i.totalMinor])).toEqual([
      ['Doliprane 1000MG', 1560],
      ['Vitamine C Upsa', 3200],
    ]);
  });

  it('café: leading counts and a two-digit year', () => {
    const r = parseReceipt(
      lines(`CAFE DE FRANCE
Table 4  Serveur: Karim
2 CAFE NOIR        24,00
1 JUS ORANGE       18,00
1 EAU MINERALE      8,00
TOTAL              50,00
Date: 25-10-26 10:15`),
      { today },
    );
    expect(r.totalMinor).toMatchObject({ value: 5000, confidence: 'medium' });
    expect(r.date.value).toBe('2026-10-25');
    expect(r.merchantName?.value).toBe('Cafe De France');
    expect(r.items?.value.map((i) => [i.name, i.quantityMilli, i.totalMinor])).toEqual([
      ['Cafe Noir', 2000, 2400],
      ['Jus Orange', 1000, 1800],
      ['Eau Minerale', 1000, 800],
    ]);
  });

  it('fuel station: MONTANT confirmed by the card line; volume and price are not items', () => {
    const r = parseReceipt(
      lines(`AFRIQUIA
STATION AL WAHDA
AUTOROUTE CASA-RABAT
26.10.2026  08:12
POMPE 3   GASOIL
VOLUME     45,23 L
PRIX       12,850 DH/L
MONTANT    581,21 DH
CB VISA    581,21`),
      { today },
    );
    expect(r.totalMinor).toMatchObject({ value: 58121, confidence: 'high' });
    expect(r.date.value).toBe('2026-10-26');
    expect(r.merchantName).toMatchObject({ value: 'Afriquia', confidence: 'medium' });
    expect(r.items).toBeUndefined();
  });

  it('invoice with TVA lines: TOTAL HT and TVA are ignored, TOTAL TTC is the amount', () => {
    const r = parseReceipt(
      lines(`RESTAURANT LE DAUPHIN
FACTURE N 2026-1043
DATE : 20/10/2026
TOTAL HT        250,00
TVA 10%          25,00
TOTAL TTC       275,00`),
      { today },
    );
    expect(r.totalMinor).toMatchObject({ value: 27500, confidence: 'high' });
    expect(r.date.value).toBe('2026-10-20');
    expect(r.items).toBeUndefined();
  });

  it('cash given and change: the total is the TOTAL line, never the cash or the change', () => {
    const r = parseReceipt(lines(`EPICERIE\nTOTAL 75,50\nESPECES 100,00\nRENDU 24,50`), { today });
    expect(r.totalMinor).toMatchObject({ value: 7550, confidence: 'high' });
    // Without a total line nothing is derived from the payment lines.
    const none = parseReceipt(lines(`EPICERIE\nESPECES 100,00\nRENDU 24,50\nCB 12,00`), { today });
    expect(none.totalMinor).toBeUndefined();
    expect(none.warnings.join(' ')).toMatch(/No total/);
  });

  it('a card payment that differs from the total lowers its confidence', () => {
    const r = parseReceipt(lines(`TOTAL TTC 120,00\nCB 102,00`), { today });
    expect(r.totalMinor).toMatchObject({ value: 12000, confidence: 'medium' });
    expect(r.warnings.join(' ')).toMatch(/card payment/);
  });

  it('different totals: the bottom one, with low confidence', () => {
    const r = parseReceipt(lines(`TOTAL 80,00\nTOTAL 85,00`), { today });
    expect(r.totalMinor).toMatchObject({ value: 8500, confidence: 'low' });
  });

  it('a label with its amount on the next row', () => {
    const r = parseReceipt(lines(`NET A PAYER\n  63,40 DH`), { today });
    expect(r.totalMinor?.value).toBe(6340);
  });

  it('weak OCR confidence lowers the field', () => {
    const r = parseReceipt([{ text: 'TOTAL TTC 99,90', confidence: 0.4 }], { today });
    expect(r.totalMinor?.confidence).toBe('medium');
  });

  it('blurry or partial receipt: nothing is invented', () => {
    const r = parseReceipt(lines(`M?RJ@NE\nT0TAL    1?5,4\n27/1O/2026`), { today });
    expect(r.totalMinor).toBeUndefined();
    expect(r.merchantName).toBeUndefined();
    expect(r.items).toBeUndefined();
    expect(r.date).toEqual({ value: today, confidence: 'low', source: null });
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('no text at all', () => {
    const r = parseReceipt([], { today });
    expect(r).toEqual({ date: { value: today, confidence: 'low', source: null }, warnings: [expect.stringMatching(/No text/)] });
  });

  it('rejects future and implausible dates (today is used, flagged)', () => {
    const future = parseReceipt(lines(`TOTAL 10,00\nDate 30/12/2026`), { today });
    expect(future.date).toMatchObject({ value: today, confidence: 'low' });
    expect(future.warnings.join(' ')).toMatch(/future/);
    const old = parseReceipt(lines(`TOTAL 10,00\n01/01/2019`), { today });
    expect(old.date.value).toBe(today);
    expect(old.warnings.join(' ')).toMatch(/looks wrong/);
    // Month and day are never swapped: 10/27/2026 is not a valid dd/mm date.
    expect(parseReceipt(['10/27/2026'], { today }).date.source).toBeNull();
    // Older than 90 days: kept but flagged.
    expect(parseReceipt(['02/03/2026'], { today }).date).toMatchObject({ value: '2026-03-02', confidence: 'low' });
  });

  it('phone numbers are not dates', () => {
    expect(parseReceipt(['TEL 06-12-10-26-11', 'TOTAL 5,00'], { today }).date.source).toBeNull();
  });

  it('items that do not add up to the total are not proposed', () => {
    const r = parseReceipt(lines(`BIM\nTOMATES 12,00\nOIGNONS 8,00\nTOTAL 35,00`), { today });
    expect(r.totalMinor?.value).toBe(3500);
    expect(r.items).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/did not add up/);
  });

  it('items within the small rounding tolerance are proposed with medium confidence', () => {
    const r = parseReceipt(lines(`BIM\nTOMATES 12,00\nOIGNONS 8,01\nTOTAL 20,00`), { today });
    expect(r.items?.confidence).toBe('medium');
  });

  it('a quantity × price that disagrees with the line total is dropped, the line is kept', () => {
    const r = parseReceipt(lines(`EAU 6 X 1,50 12,00\nTOTAL 12,00`), { today });
    expect(r.items?.value).toEqual([
      { lineKind: 'product', name: 'Eau', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 1200 },
    ]);
  });
});
