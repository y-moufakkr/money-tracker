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

describe('real receipts (photos from the S22, lines and boxes as OCR returns them)', () => {
  const ln = (text: string, x: number, y: number, width: number, height: number, confidence: number): OcrLine => ({
    text,
    confidence,
    box: { x, y, width, height },
  });
  const merchants = [
    { id: 'm1', name: 'Marjane' },
    { id: 'm2', name: 'BIM' },
  ];

  const marjane: OcrLine[] = [
    ln('Marjane', 319, 140, 191, 48, 1),
    ln('MARJANE HOLDING', 362, 278, 430, 36, 1),
    ln('MARJANE SAFI', 489, 328, 176, 31, 1),
    ln('ICE : 001531173000020', 412, 372, 332, 32, 1),
    ln('21/05/2017 15:45:10 84 3 2751', 362, 460, 428, 40, 1),
    ln('(5)6221134002638 CHOCOLAT GALAXY', 157, 499, 472, 41, 1),
    ln('2 x 4.95', 332, 552, 122, 37, 0.5),
    ln('BISCUITERIE', 157, 594, 327, 42, 1),
    ln('(5)8435123220332 FRITEUSE EMAILL', 189, 641, 469, 43, 1),
    ln('MENAGE', 166, 686, 172, 32, 1),
    ln('TOTA', 177, 761, 197, 30, 0.3),
    ln('L', 392, 770, 34, 22, 0.5),
    ln('NONT DROITS DE TIMBRE : 0.37', 185, 792, 381, 38, 0.5),
    ln('IMBRE', 360, 892, 64, 28, 0.5),
    ln("•ORE D'ARTICLES", 228, 970, 206, 38, 0.3),
    ln('TVA POUR INFORMATION', 201, 1012, 260, 43, 1),
    ln('5', 252, 1108, 16, 28, 0.5),
    ln('total', 248, 1154, 68, 30, 1),
    ln('20.00', 326, 1110, 74, 38, 1),
    ln('HT', 537, 1082, 34, 30, 1),
    ln('124.07', 511, 1122, 82, 36, 1),
    ln('124.07', 508, 1166, 86, 40, 1),
    ln('TAXE', 661, 1092, 62, 34, 1),
    ln('24.83', 653, 1140, 76, 40, 1),
    ln('24.83', 657, 1184, 72, 36, 1),
    ln('00521004', 440, 1262, 170, 16, 0.3),
    ln('9.90', 933, 560, 62, 34, 1),
    ln('9.90', 831, 606, 118, 42, 1),
    ln('139.00', 899, 653, 92, 37, 1),
    ln('139.00', 771, 700, 174, 40, 1),
    ln('149.27', 765, 782, 170, 34, 1),
    ln('200.00', 869, 874, 90, 41, 1),
    ln('0.37', 897, 920, 62, 40, 1),
    ln('50.73', 885, 966, 74, 36, 1),
    ln('3', 939, 1018, 18, 26, 0.5),
    ln('-', 927, 1070, 16, 14, 0.5),
    ln('TTC', 839, 1102, 48, 34, 1),
    ln('148.90', 807, 1150, 88, 38, 1),
    ln('148.90', 807, 1200, 92, 38, 1),
  ];
  const bim: OcrLine[] = [
    ln('BIM MAROC', 151, 75, 178, 34, 1),
    ln('Magasin GHAZA', 149, 117, 131, 33, 1),
    ln('Avenue Gaza Lot 2422', 113, 137, 196, 32, 1),
    ln('Al Wifaq Temara', 132, 164, 146, 20, 1),
    ln('TEMARA', 178, 184, 62, 19, 1),
    ln('15/11/2024', 35, 227, 85, 27, 1),
    ln('TIME: 09:29:39', 38, 248, 117, 20, 1),
    ln('LAIT 600G KEFIF', 32, 286, 132, 20, 1),
    ln('YRT NATUR KEFIR 500G', 32, 304, 180, 20, 1),
    ln('N° ticket: 0012', 246, 218, 159, 25, 1),
    ln('20%', 256, 282, 34, 20, 1),
    ln('20%', 256, 302, 34, 20, 1),
    ln('22.90', 350, 281, 54, 21, 1),
    ln('19.90', 350, 302, 54, 20, 1),
    ln('SOUS TOTAL', 34, 344, 158, 16, 0.5),
    ln('42.80', 350, 342, 56, 22, 1),
    ln('TOTAL TTC', 34, 382, 92, 30, 0.5),
    ln('Dont', 36, 414, 38, 18, 1),
    ln('TVA', 94, 416, 30, 18, 1),
    ln('CARTE BANCAIRE', 36, 451, 127, 21, 1),
    ln('42.80 DH', 308, 386, 102, 41, 1),
    ln('7.13 DH', 320, 424, 88, 20, 0.5),
    ln('42.80', 350, 458, 56, 26, 1),
    ln('NOMBRE ARTICLES', 35, 487, 137, 23, 1),
    ln('2', 244, 498, 10, 16, 1),
    ln('M:1826 P:001 C:77012 AZOUZI ZINEB', 35, 502, 310, 41, 0.5),
    ln('MERCI DE VOTRE VISITE ET A BIENTOT:', 35, 523, 326, 38, 0.5),
    ln('PATENTE:26901134', 35, 541, 148, 28, 0.5),
    ln('Id.Fiscal: 1108770', 208, 554, 162, 18, 0.5),
    ln('R.C.No :8633', 37, 563, 109, 20, 0.5),
    ln('ICE', 38, 580, 28, 18, 1),
    ln('CNSS', 206, 572, 40, 18, 1),
    ln(': 1794987', 294, 565, 74, 25, 0.5),
    ln(':001527053000001', 99, 583, 148, 29, 1),
  ];

  it('Marjane: letter-spaced "T O T A L" with its amount on the next row; the TVA table total is ignored', () => {
    const r = parseReceipt(marjane, { today, merchants });
    expect(r.totalMinor?.value).toBe(14927); // not 148,90 from the TVA table (it leaves out the stamp duty)
    expect(r.merchantName).toMatchObject({ merchantId: 'm1' });
  });

  it('BIM: "TOTAL TTC / dont TVA" joined by the large amount; items without the VAT rate column', () => {
    const r = parseReceipt(bim, { today, merchants });
    expect(r.totalMinor?.value).toBe(4280);
    expect(r.date.value).toBe('2024-11-15');
    expect(r.merchantName).toMatchObject({ merchantId: 'm2' });
    expect(r.items?.value.map((it) => [it.name, it.totalMinor])).toEqual([
      ['Lait 600G Kefif', 2290],
      ['Yrt Natur Kefir 500G', 1990],
    ]);
  });
});

describe('total labels', () => {
  it('"dont TVA" after the total is part of it: the larger amount is the total', () => {
    expect(parseReceipt(lines('TOTAL TTC 120,00 DONT TVA 20,00'), { today }).totalMinor?.value).toBe(12000);
  });

  it('a tax table row (HT, TVA, TTC columns) is not the total', () => {
    const r = parseReceipt(lines('TOTAL 50,00\nTVA POUR INFORMATION\ntotal 41,67 8,33 50,00 50,00'), { today });
    expect(r.totalMinor).toMatchObject({ value: 5000, source: 'TOTAL 50,00' });
  });

  it('letter-spaced labels are read, and still excluded when they say SOUS TOTAL', () => {
    expect(parseReceipt(lines('T O T A L 42,80'), { today }).totalMinor?.value).toBe(4280);
    expect(parseReceipt(lines('S O U S T O T A L 40,00\nTOTAL 42,80'), { today }).totalMinor?.value).toBe(4280);
  });

  it('an amount on the next row counts only if its box starts within the label row', () => {
    const below: OcrLine[] = [
      { text: 'TOTAL', box: { x: 40, y: 100, width: 120, height: 30 }, confidence: 1 },
      { text: 'ESPECES', box: { x: 40, y: 140, width: 140, height: 30 }, confidence: 1 },
      { text: '200,00', box: { x: 600, y: 140, width: 120, height: 30 }, confidence: 1 },
    ];
    expect(parseReceipt(below, { today }).totalMinor).toBeUndefined();
  });
});
