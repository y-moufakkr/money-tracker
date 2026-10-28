import { findAmounts, merchantKey, parseReceipt, receiptAmount, toRows, UNREAD_ITEM_NAME, type OcrLine, type ReceiptItem, type ReceiptParse } from './receipt-parse';

const today = '2026-10-27';
const lines = (text: string) => text.split('\n');
const brief = ({ lineKind, name, quantityMilli, unit, unitPriceMinor, totalMinor }: ReceiptItem) => ({
  lineKind,
  name,
  quantityMilli,
  unit,
  unitPriceMinor,
  totalMinor,
});
const named = (r: ReceiptParse) => r.items?.value.map((i) => [i.lineKind, i.name, i.totalMinor]);

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
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Lait Centrale 1L', quantityMilli: 2000, unit: null, unitPriceMinor: 750, totalMinor: 1500 },
      { lineKind: 'product', name: 'Pain Complet 400G', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 1200 },
      { lineKind: 'product', name: 'Poulet', quantityMilli: 1250, unit: 'kg', unitPriceMinor: 6200, totalMinor: 7750 },
      { lineKind: 'discount', name: 'Remise Fidelite', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 450 },
    ]);
    expect(r.items?.confidence).toBe('high');
    expect(r.items?.value.every((i) => i.confidence === 'high')).toBe(true);
    expect(r.unreadMinor).toBe(0);
    expect(r.finalMinor).toBeUndefined();
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

  it('café: leading counts and a two-digit year; items adding up confirm the total', () => {
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
    // TOTAL alone is "medium"; the lines adding up to it exactly raise it.
    expect(r.totalMinor).toMatchObject({ value: 5000, confidence: 'high' });
    expect(r.date.value).toBe('2026-10-25');
    expect(r.merchantName?.value).toBe('Cafe De France');
    expect(r.items?.value.map((i) => [i.name, i.quantityMilli, i.totalMinor])).toEqual([
      ['Cafe Noir', 2000, 2400],
      ['Jus Orange', 1000, 1800],
      ['Eau Minerale', 1000, 800],
    ]);
  });

  it('fuel station: MONTANT confirmed by the card line; the fuel is the one item, volume and price its quantity and price', () => {
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
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Gasoil', quantityMilli: 45230, unit: 'L', unitPriceMinor: 1285, totalMinor: 58121 },
    ]);
    expect(r.items?.value[0].confidence).toBe('high');
    expect(r.unreadMinor).toBe(0);
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
    const r = parseReceipt(lines(`M?RJ@NE\nT0TAL    1?5,4\n27/1?/2026`), { today });
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

  it('items short of the total are proposed, the rest on one "not read" line, so they add up to the amount', () => {
    const r = parseReceipt(lines(`BIM\nTOMATES 12,00\nOIGNONS 8,00\nTOTAL 35,00`), { today });
    expect(r.totalMinor?.value).toBe(3500);
    expect(named(r)).toEqual([
      ['product', 'Tomates', 1200],
      ['product', 'Oignons', 800],
      ['unallocated', UNREAD_ITEM_NAME, 1500],
    ]);
    expect(r.unreadMinor).toBe(1500);
    expect(r.items?.confidence).toBe('medium');
    expect(r.items?.value[2]).toMatchObject({ confidence: 'low', source: null });
    // The pair that disagrees is named.
    expect(r.warnings.join(' ')).toMatch(/item lines read add up to 20.*total is 35/);
    // The total is not confirmed by the lines: it stays as its label makes it.
    expect(r.totalMinor?.confidence).toBe('medium');
  });

  it('items adding up to more than the total: none are proposed (something was misread)', () => {
    const r = parseReceipt(lines(`BIM\nTOMATES 12,00\nOIGNONS 8,01\nTOTAL 20,00`), { today });
    expect(r.items).toBeUndefined();
    expect(r.unreadMinor).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/add up to 20[.,]01.*more than the total/);
  });

  it('a quantity × price that disagrees with the line total is dropped, the line is kept (low confidence)', () => {
    const r = parseReceipt(lines(`EAU 6 X 1,50 12,00\nTOTAL 12,00`), { today });
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Eau', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 1200 },
    ]);
    expect(r.items?.value[0].confidence).toBe('low');
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

describe('two amounts: the total and what was paid', () => {
  it('a global discount between TOTAL and NET A PAYER: the amount is what was paid, the discount is a line', () => {
    const r = parseReceipt(lines(`EPICERIE ATLAS\n26/10/2026\nLAIT 7,50\nPAIN 2,50\nTOTAL 10,00\nREMISE 10% -1,00\nNET A PAYER 9,00`), { today });
    expect(r.totalMinor).toMatchObject({ value: 1000 });
    expect(r.finalMinor).toMatchObject({ value: 900, confidence: 'high' });
    expect(receiptAmount(r)?.value).toBe(900);
    expect(named(r)).toEqual([
      ['product', 'Lait', 750],
      ['product', 'Pain', 250],
      ['discount', 'Remise', 100],
    ]);
    expect(r.unreadMinor).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('rounding (ARRONDI), confirmed by cash − change', () => {
    const r = parseReceipt(lines(`PHARMACIE ATLAS\nDOLIPRANE 15,63\nTOTAL TTC 15,63\nARRONDI -0,03\nA PAYER 15,60\nESPECES 20,00\nRENDU 4,40`), { today });
    expect(r.totalMinor?.value).toBe(1563);
    expect(r.finalMinor).toMatchObject({ value: 1560, confidence: 'high' });
    expect(named(r)).toEqual([
      ['product', 'Doliprane', 1563],
      ['discount', 'Arrondi', 3],
    ]);
  });

  it('stamp duty and service added to the total are charges', () => {
    const stamp = parseReceipt(lines(`QUINCAILLERIE\nVIS 100,00\nTOTAL 100,00\nDROIT DE TIMBRE 0,25\nNET A PAYER 100,25`), { today });
    expect(stamp.finalMinor?.value).toBe(10025);
    expect(named(stamp)).toEqual([
      ['product', 'Vis', 10000],
      ['charge', 'Droit De Timbre', 25],
    ]);
    const service = parseReceipt(lines(`CAFE ATLAS\n2 CAFE 20,00\n1 TARTE 30,00\nTOTAL 50,00\nSERVICE 10% 5,00\nA PAYER 55,00`), { today });
    expect(service.finalMinor?.value).toBe(5500);
    expect(named(service)?.at(-1)).toEqual(['charge', 'Service', 500]);
  });

  it('"dont droits de timbre" is inside the total: a charge line only when the lines leave room for it', () => {
    const r = parseReceipt(lines(`MARJANE\nCAFE 10,00\nTOTAL 10,25\nDONT DROITS DE TIMBRE 0,25\nESPECES 20,00\nRENDU 9,75`), { today });
    expect(r.finalMinor).toBeUndefined();
    expect(named(r)).toEqual([
      ['product', 'Cafe', 1000],
      ['charge', 'Droits de timbre', 25],
    ]);
    // Already in the item prices: not added again.
    const inside = parseReceipt(lines(`MARJANE\nCAFE 10,25\nTOTAL 10,25\nDONT DROITS DE TIMBRE 0,25`), { today });
    expect(named(inside)).toEqual([['product', 'Cafe', 1025]]);
  });

  it('a total and an amount to pay that disagree: the amount to pay, lowered, and a warning naming both', () => {
    const r = parseReceipt(lines(`BOUTIQUE\nSAC 100,00\nTOTAL 100,00\nNET A PAYER 85,00`), { today });
    expect(receiptAmount(r)).toMatchObject({ value: 8500, confidence: 'medium' });
    expect(r.warnings.join(' ')).toMatch(/total \(100.*amount to pay \(85.*no discount or charge/);
    // The lines add up to more than what was paid: no items rather than a wrong breakdown.
    expect(r.items).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/more than the amount to pay/);
    const off = parseReceipt(lines(`TOTAL 100,00\nREMISE -10,00\nNET A PAYER 85,00`), { today });
    expect(off.warnings.join(' ')).toMatch(/with the discounts and charges printed \(90.*does not match the amount to pay \(85/);
  });

  it('no NET A PAYER: a card payment equal to total − the discount printed after it is the amount (medium)', () => {
    const r = parseReceipt(lines(`EPICERIE ATLAS\n26/10/2026\nPAIN 4,00\nLAIT 6,00\nTOTAL 10,00\nREMISE -1,00\nCB 9,00`), { today });
    expect(r.totalMinor?.value).toBe(1000);
    expect(r.finalMinor).toEqual({ value: 900, confidence: 'medium', source: 'CB 9,00' });
    expect(named(r)?.at(-1)).toEqual(['discount', 'Remise', 100]);
    expect(r.warnings).toEqual([]);
  });

  it('cash − change that differs from the amount lowers it and says which pair disagrees', () => {
    const r = parseReceipt(lines(`TOTAL 75,50\nESPECES 100,00\nRENDU 20,00`), { today });
    expect(r.totalMinor).toMatchObject({ value: 7550, confidence: 'low' });
    expect(r.warnings.join(' ')).toMatch(/cash given minus the change \(80.*amount to pay \(75[.,]50/);
  });

  it('NET A PAYER alone is both the total and the amount paid', () => {
    const r = parseReceipt(lines(`NET A PAYER 47,60`), { today });
    expect(r.totalMinor?.value).toBe(4760);
    expect(r.finalMinor?.value).toBe(4760);
  });
});

describe('item layouts', () => {
  it('name row, then "qty x price" row, then the amount row', () => {
    const r = parseReceipt(lines(`BIM\nYAOURT NATURE\n3 x 2,50\n7,50\nEAU SIDI ALI 1,5L\n6,00\nTOTAL 13,50`), { today });
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Yaourt Nature', quantityMilli: 3000, unit: null, unitPriceMinor: 250, totalMinor: 750 },
      { lineKind: 'product', name: 'Eau Sidi Ali 1,5L', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 600 },
    ]);
    expect(r.items?.value[0].confidence).toBe('high');
  });

  it('name and amount, with the quantity row after (with or without the amount repeated)', () => {
    for (const qtyRow of ['  2 x 7,50', '  2 x 7,50     15,00']) {
      const r = parseReceipt(lines(`BIM\nLAIT CENTRALE 15,00\n${qtyRow}\nPAIN 3,00\nTOTAL 18,00`), { today });
      expect(r.items?.value.map(brief)).toEqual([
        { lineKind: 'product', name: 'Lait Centrale', quantityMilli: 2000, unit: null, unitPriceMinor: 750, totalMinor: 1500 },
        { lineKind: 'product', name: 'Pain', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 300 },
      ]);
    }
  });

  it('EAN / article codes before or after the name are dropped', () => {
    const r = parseReceipt(lines(`BIM\n6111245780012 HARIRA KNORR 4,50\nCOCA COLA 1L 6111252421227 9,00\n10234 SUCRE 5,00\nTOTAL 18,50`), { today });
    expect(named(r)).toEqual([
      ['product', 'Harira Knorr', 450],
      ['product', 'Coca Cola 1L', 900],
      ['product', 'Sucre', 500],
    ]);
  });

  it('weight lines, on the name row or below it', () => {
    const r = parseReceipt(lines(`MARCHE\nTOMATES 1,250 KG x 6,00 7,50\nBANANES\n0,850 kg x 14,00 11,90\nTOTAL 19,40`), { today });
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Tomates', quantityMilli: 1250, unit: 'kg', unitPriceMinor: 600, totalMinor: 750 },
      { lineKind: 'product', name: 'Bananes', quantityMilli: 850, unit: 'kg', unitPriceMinor: 1400, totalMinor: 1190 },
    ]);
  });

  it('QTE / PU columns, in either order, under a header row', () => {
    const r = parseReceipt(lines(`DROGUERIE\nDESIGNATION  QTE  PU  MONTANT\nLAIT CENTRALE  2  7,50  15,00\nPAIN  1  3,00  3,00\nTOTAL 18,00`), { today });
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Lait Centrale', quantityMilli: 2000, unit: null, unitPriceMinor: 750, totalMinor: 1500 },
      { lineKind: 'product', name: 'Pain', quantityMilli: 1000, unit: null, unitPriceMinor: 300, totalMinor: 300 },
    ]);
    const pu = parseReceipt(lines(`DROGUERIE\nARTICLE  PU  QTE  TOTAL\nSAVON  4,50  3  13,50\nTOTAL 13,50`), { today });
    expect(pu.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Savon', quantityMilli: 3000, unit: null, unitPriceMinor: 450, totalMinor: 1350 },
    ]);
    // Two price columns that disagree: the line total is kept, the line is marked unsure.
    const off = parseReceipt(lines(`DROGUERIE\nSAVON  4,50  13,00\nTOTAL 13,00`), { today });
    expect(off.items?.value[0]).toMatchObject({ name: 'Savon', totalMinor: 1300, unitPriceMinor: null, confidence: 'low' });
  });

  it('a bare discount row belongs to the item above it; a named one stays a discount of its own', () => {
    const r = parseReceipt(lines(`BIM\nLAIT CENTRALE 15,00\nREMISE -3,00\nPAIN 3,00\nPROMO FIDELITE -1,00\nTOTAL 14,00`), { today });
    expect(named(r)).toEqual([
      ['product', 'Lait Centrale', 1500],
      ['discount', 'Remise Lait Centrale', 300],
      ['product', 'Pain', 300],
      ['discount', 'Promo Fidelite', 100],
    ]);
    expect(r.unreadMinor).toBe(0);
  });

  it('VAT code letters and rates around the name or the amount are dropped', () => {
    const r = parseReceipt(lines(`BIM\nLAIT CENTRALE A 7,50\nPAIN 3,00 B\nEAU 5,00 *\nHUILE LESIEUR 5L 20% 89,90\nTOTAL 105,40`), { today });
    expect(named(r)).toEqual([
      ['product', 'Lait Centrale', 750],
      ['product', 'Pain', 300],
      ['product', 'Eau', 500],
      ['product', 'Huile Lesieur 5L', 8990],
    ]);
  });

  it('a name wrapped on two rows is joined; a row starting with a count is a new line', () => {
    const r = parseReceipt(lines(`EPICERIE ATLAS\nYAOURT AROMATISE JAOUDA\nFRAISE 4X110G 12,00\n2 CAFE 8,00\nTOTAL 20,00`), { today });
    expect(named(r)).toEqual([
      ['product', 'Yaourt Aromatise Jaouda Fraise 4X110G', 1200],
      ['product', 'Cafe', 800],
    ]);
    expect(r.items?.value[0].source).toBe('YAOURT AROMATISE JAOUDA / FRAISE 4X110G 12,00');
  });

  it('header rows (address, ticket, cashier) never join an item name', () => {
    const r = parseReceipt(lines(`EPICERIE ATLAS\nRUE 12 HAY NAHDA\nCaissier: Ahmed\nLAIT 7,50\nTOTAL 7,50`), { today });
    expect(named(r)).toEqual([['product', 'Lait', 750]]);
  });

  it('department subtotals are not items, and confirm the lines above them', () => {
    const r = parseReceipt(lines(`MARJANE\nCHOCOLAT GALAXY\n2 x 4,95 9,90\nBISCUITERIE 9,90\nFRITEUSE 139,00\nMENAGE\n139,00\nTOTAL 148,90`), { today });
    expect(named(r)).toEqual([
      ['product', 'Chocolat Galaxy', 990],
      ['product', 'Friteuse', 13900],
    ]);
  });

  it('fuel: volume × price that disagrees with the amount is not kept; the fuel line is', () => {
    const r = parseReceipt(lines(`SHELL\nSANS PLOMB\nQUANTITE 20,00 L\nP.U 13,20\nA PAYER 300,00`), { today });
    expect(r.items?.value.map(brief)).toEqual([
      { lineKind: 'product', name: 'Sans plomb', quantityMilli: null, unit: null, unitPriceMinor: null, totalMinor: 30000 },
    ]);
    expect(r.items?.value[0].confidence).toBe('low');
  });

  it('a line read with weak OCR or a garbled name is marked unsure on its own', () => {
    const r = parseReceipt(
      [{ text: 'BIM' }, { text: 'LAIT CENTRALE 7,50', confidence: 0.4 }, { text: 'PAIN 3,00', confidence: 0.95 }, { text: 'TOTAL 10,50', confidence: 0.95 }],
      { today },
    );
    expect(r.items?.value.map((i) => [i.name, i.confidence])).toEqual([
      ['Lait Centrale', 'medium'],
      ['Pain', 'high'],
    ]);
    expect(r.items?.confidence).toBe('medium');
  });
});

describe('item names and products', () => {
  it('names: codes, VAT rates, tax letters and "x1" removed; title case; sizes kept', () => {
    const r = parseReceipt(lines(`BIM\nLAIT CENTRALE 1L x1 7,50\nCRÈME FRAÎCHE 200G 9,90\nTOTAL 17,40`), { today });
    expect(named(r)).toEqual([
      ['product', 'Lait Centrale 1L', 750],
      ['product', 'Crème Fraîche 200G', 990],
    ]);
  });

  it('existing products are reused (accents, case, one OCR slip) and bring their usual category', () => {
    const products = [
      { id: 'p1', name: 'Lait Centrale 1L', categoryId: 'cat-food' },
      { id: 'p2', name: 'Pain complet', categoryId: 'cat-bread' },
      { id: 'p3', name: 'Café moulu', categoryId: 'cat-food' },
    ];
    const r = parseReceipt(lines(`BIM\nLAIT CENTRALE 1L 7,50\nPAIN C0MPLET 3,00\nCAFE MOULU 30,00\nBISCUIT 5,00\nTOTAL 45,50`), { today, products });
    expect(r.items?.value.map((i) => [i.name, i.productId, i.categoryId])).toEqual([
      ['Lait Centrale 1L', 'p1', 'cat-food'],
      ['Pain complet', 'p2', 'cat-bread'],
      ['Café moulu', 'p3', 'cat-food'],
      ['Biscuit', null, null],
    ]);
    expect(r.productCategoryId).toBe('cat-food');
  });

  it('a near match shared by two products matches neither', () => {
    const products = [
      { id: 'p1', name: 'Yaourt fraisa', categoryId: null },
      { id: 'p2', name: 'Yaourt fraisb', categoryId: null },
    ];
    const r = parseReceipt(lines(`BIM\nYAOURT FRAISE 4,00\nTOTAL 4,00`), { today, products });
    expect(r.items?.value[0]).toMatchObject({ name: 'Yaourt Fraise', productId: null });
  });
});

describe('dates', () => {
  const date = (text: string) => parseReceipt(lines(`TOTAL 10,00\n${text}`), { today }).date;

  it('with a time, a label, "Le", two-digit years', () => {
    expect(date('25/10/2026 14:32:01')).toMatchObject({ value: '2026-10-25', confidence: 'high' });
    expect(date('DATE: 25/10/26')).toMatchObject({ value: '2026-10-25', confidence: 'high' });
    expect(date('Le 25-10-2026 a 14h32')).toMatchObject({ value: '2026-10-25', confidence: 'high' });
  });

  it('French and English month names', () => {
    expect(date('25 OCT 2026').value).toBe('2026-10-25');
    expect(date('Le 25 octobre 2026').value).toBe('2026-10-25');
    expect(date('3 août 2026').value).toBe('2026-08-03');
    expect(date('1er sept. 2026').value).toBe('2026-09-01');
    expect(date('25-OCT-26').value).toBe('2026-10-25');
    expect(date('Oct 25, 2026').value).toBe('2026-10-25');
    expect(date('JUIN 2026').source).toBeNull();
  });

  it('OCR slips inside digit groups (O for 0, l for 1), one level less sure', () => {
    expect(date('27/1O/2026')).toMatchObject({ value: '2026-10-27', confidence: 'medium' });
    expect(date('O5/l0/2026')).toMatchObject({ value: '2026-10-05', confidence: 'medium' });
  });

  it('dates glued to a ticket number or a time, one level less sure', () => {
    expect(date('N°004225/10/2026')).toMatchObject({ value: '2026-10-25', confidence: 'medium' });
    expect(date('25/10/202614:32')).toMatchObject({ value: '2026-10-25', confidence: 'medium' });
  });

  it('still day first, never swapped; future and old dates rejected', () => {
    expect(date('10/27/2026').source).toBeNull();
    expect(date('25 DEC 2026').source).toBeNull();
    expect(date('25 DEC 2020').source).toBeNull();
  });
});
