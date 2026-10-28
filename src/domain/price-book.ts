/**
 * Starter price list: typical retail prices in Morocco (Casablanca/Rabat souks and supermarkets),
 * used only to split an amount paid across items whose price was not recorded. A price here is
 * never shown as a fact or stored as a price: your own prices and your purchases take over.
 *
 * Update it by editing this file (bump PRICE_BOOK_DATE). Prices are integer centimes per `unit`;
 * `typical` is the usual quantity bought, in thousandths of `unit` (1000 = 1 kg).
 * Aliases: French, Darija (Latin letters) and English spellings, matched without accents.
 */

export const PRICE_BOOK_DATE = '2026-10';

export type PriceGroup = 'vegetables' | 'fruit' | 'meat' | 'fish' | 'dairy' | 'bakery' | 'grocery' | 'drinks' | 'household';

export const PRICE_GROUP_LABEL: Record<PriceGroup, string> = {
  vegetables: 'Vegetables & herbs',
  fruit: 'Fruit',
  meat: 'Meat & poultry',
  fish: 'Fish',
  dairy: 'Dairy & eggs',
  bakery: 'Bread, flour & grains',
  grocery: 'Groceries',
  drinks: 'Drinks',
  household: 'Household & hygiene',
};

export type BookEntry = {
  name: string;
  aliases: readonly string[];
  unit: string;
  priceMinor: number;
  typicalMilli: number;
  group: PriceGroup;
};

type Row = [name: string, aliases: string, unit: string, priceMinor: number, typicalMilli: number];

const ROWS: Record<PriceGroup, Row[]> = {
  vegetables: [
    ['Tomatoes', 'tomate, tomato, matecha, maticha', 'kg', 800, 1000],
    ['Onions', 'oignon, onion, bssla, besla, basla', 'kg', 600, 1000],
    ['Potatoes', 'pomme de terre, patate, potato, batata', 'kg', 600, 1000],
    ['Carrots', 'carotte, carrot, khizou, khizzou', 'kg', 500, 1000],
    ['Courgettes', 'courgette, zucchini, gar3a, slawiya', 'kg', 700, 1000],
    ['Aubergines', 'aubergine, eggplant, denjal, bdenjal, badenjal', 'kg', 700, 1000],
    ['Peppers', 'poivron, pepper, felfla, felfel', 'kg', 800, 500],
    ['Chili peppers', 'piment, chili, sudaniya, harr', 'kg', 1500, 250],
    ['Garlic', 'ail, garlic, touma, tuma', 'kg', 3000, 250],
    ['Cucumbers', 'concombre, cucumber, khyar, khiyar', 'kg', 600, 1000],
    ['Lettuce', 'laitue, salade, salad, khass', 'piece', 500, 1000],
    ['Green beans', 'haricot vert, loubia khadra', 'kg', 1200, 500],
    ['Peas', 'petit pois, jelbana, jalbana', 'kg', 1200, 1000],
    ['Turnips', 'navet, turnip, left', 'kg', 500, 1000],
    ['Cabbage', 'chou, krumb, kromb', 'kg', 500, 1000],
    ['Cauliflower', 'chou fleur, chiflor, chouflour', 'kg', 800, 1000],
    ['Pumpkin', 'courge, potiron, gar3a hamra, karaa hamra', 'kg', 800, 1000],
    ['Beetroot', 'betterave, beet, barba, lbarba', 'kg', 600, 1000],
    ['Sweet potatoes', 'patate douce, sweet potato, btata hlowa', 'kg', 1200, 1000],
    ['Artichokes', 'artichaut, artichoke, qoq, guernina', 'kg', 1000, 1000],
    ['Lemons', 'citron, lemon, hamed, hamd', 'kg', 1000, 500],
    ['Parsley', 'persil, parsley, maadnous, madnous', 'piece', 200, 1000],
    ['Coriander', 'coriandre, cilantro, coriander, qasbour, kasbour', 'piece', 200, 1000],
    ['Mint', 'menthe, mint, naanaa, nanaa, na3na3', 'piece', 300, 1000],
    ['Celery', 'celeri, celery, krafes', 'piece', 300, 1000],
  ],
  fruit: [
    ['Bananas', 'banane, banana, banan', 'kg', 1400, 1000],
    ['Apples', 'pomme, apple, tuffah, teffah', 'kg', 1500, 1000],
    ['Oranges', 'orange, limoun, lchine', 'kg', 600, 2000],
    ['Clementines', 'clementine, mandarine, mandarin', 'kg', 800, 1000],
    ['Grapes', 'raisin, grape, 3neb, aneb', 'kg', 1500, 1000],
    ['Watermelon', 'pasteque, watermelon, dellah, dlah', 'kg', 500, 4000],
    ['Melon', 'melon, btikh, bttikh', 'kg', 800, 2000],
    ['Strawberries', 'fraise, strawberry, tut, tout', 'kg', 1500, 1000],
    ['Pears', 'poire, pear, bouaouid, lenjas', 'kg', 1800, 1000],
    ['Peaches', 'peche, peach, khokh, khoukh', 'kg', 1500, 1000],
    ['Pomegranates', 'grenade, pomegranate, rman, rmman', 'kg', 1200, 1000],
    ['Figs', 'figue, fig, kermous, karmouss', 'kg', 2000, 500],
    ['Avocados', 'avocat, avocado, lavoka', 'kg', 2500, 500],
    ['Dates', 'datte, date, tmer, tmar', 'kg', 5000, 500],
  ],
  meat: [
    ['Beef', 'viande, boeuf, beef, lhem, lham bgri, lhem bgri, viande hachee boeuf', 'kg', 11000, 500],
    ['Lamb', 'agneau, mouton, lamb, mutton, lhem ghenmi, ghanmi', 'kg', 13000, 500],
    ['Minced meat', 'viande hachee, hache, kefta, kafta, minced', 'kg', 11000, 500],
    ['Chicken', 'poulet, chicken, djaj, dajaj, poulet entier', 'kg', 2200, 1500],
    ['Free-range chicken', 'poulet beldi, djaj beldi, beldi chicken', 'piece', 9000, 1000],
    ['Chicken breast', 'blanc de poulet, escalope poulet, chicken breast, filet poulet', 'kg', 5500, 500],
    ['Turkey', 'dinde, turkey, bibi, escalope dinde', 'kg', 6000, 500],
    ['Liver', 'foie, liver, kebda, kebda', 'kg', 14000, 250],
    ['Merguez', 'merguez, saucisse', 'kg', 8000, 500],
    ['Cold cuts', 'cachir, kachir, charcuterie, jambon', 'kg', 7000, 250],
  ],
  fish: [
    ['Sardines', 'sardine, sardin', 'kg', 1500, 1000],
    ['Hake', 'merlan, colin, hake, merla', 'kg', 6000, 1000],
    ['Shrimp', 'crevette, shrimp, qamroun, gambas', 'kg', 10000, 500],
    ['Sole', 'sole, solea', 'kg', 8000, 500],
    ['Squid', 'calamar, squid, calamars', 'kg', 9000, 500],
  ],
  dairy: [
    ['Eggs', 'oeuf, egg, bid, beid', 'piece', 140, 12000],
    ['Milk', 'lait, milk, hlib, halib, 7lib', 'L', 700, 1000],
    ['Lben', 'lben, leben, lait fermente, buttermilk', 'L', 800, 500],
    ['Raibi', 'raibi, raib, rayeb', 'piece', 250, 1000],
    ['Yogurt', 'yaourt, yoghourt, yogurt, danone, yawurt', 'piece', 250, 4000],
    ['Butter', 'beurre, butter, zebda', 'kg', 10000, 250],
    ['Cheese', 'fromage, cheese, edam, gouda, frmaj', 'kg', 10000, 250],
    ['Cheese portions', 'vache qui rit, fromage portion, kiri, triangle', 'pack', 2000, 1000],
    ['Jben', 'jben, fromage frais', 'piece', 1000, 1000],
    ['Smen', 'smen, beurre rance', 'kg', 12000, 250],
  ],
  bakery: [
    ['Bread', 'pain, bread, khobz, khoubz, baguette', 'piece', 150, 4000],
    ['Msemen', 'msemen, msmen, rghaif, harcha, baghrir', 'piece', 250, 4000],
    ['Flour', 'farine, flour, fhina, dqiq, dkik', 'kg', 800, 1000],
    ['Semolina', 'semoule, semolina, smida', 'kg', 1000, 1000],
    ['Rice', 'riz, rice, rouz', 'kg', 1600, 1000],
    ['Pasta', 'pate, pasta, spaghetti, macaroni, maqarona, vermicelle, chaariya', 'kg', 1400, 500],
    ['Couscous', 'couscous, kesksou, seksou', 'kg', 1600, 1000],
    ['Lentils', 'lentille, lentil, ladess, l3des, adass', 'kg', 2000, 1000],
    ['Chickpeas', 'pois chiche, chickpea, hommos, hummus', 'kg', 2200, 500],
    ['White beans', 'haricot blanc, loubia, white bean', 'kg', 2000, 1000],
    ['Biscuits', 'biscuit, gateau, cookie, gaufrette', 'pack', 300, 1000],
  ],
  grocery: [
    ['Sugar', 'sucre, sugar, sokar, sokkar, sanida', 'kg', 800, 1000],
    ['Sugar loaf', 'pain de sucre, qaleb sokar, qalb', 'piece', 1300, 1000],
    ['Tea', 'the, the vert, tea, atay, sultan', 'kg', 12000, 200],
    ['Coffee', 'cafe, coffee, qahwa, kahwa', 'kg', 14000, 250],
    ['Cooking oil', 'huile, huile de table, oil, zit, lesieur', 'L', 1900, 1000],
    ['Olive oil', "huile d olive, olive oil, zit zitoun, zit l3oud", 'L', 9000, 1000],
    ['Salt', 'sel, salt, melha', 'kg', 300, 1000],
    ['Tomato paste', 'concentre de tomate, tomato paste, maajoun, aicha', 'piece', 800, 1000],
    ['Canned tuna', 'thon, tuna, ton', 'piece', 1200, 1000],
    ['Olives', 'olive, zitoun, zitoune', 'kg', 3000, 500],
    ['Jam', 'confiture, jam, konfitur', 'piece', 2000, 1000],
    ['Honey', 'miel, honey, aasel, 3sel', 'kg', 20000, 500],
    ['Chocolate spread', 'nutella, pate a tartiner, choco', 'piece', 3500, 1000],
    ['Cumin', 'cumin, kamoun, kamoune', 'kg', 12000, 100],
    ['Paprika', 'paprika, tahmira, felfla hlwa', 'kg', 10000, 100],
    ['Spices', 'epice, spice, ras el hanout, skinjbir, gingembre, curcuma, kharqoum', 'kg', 15000, 100],
    ['Yeast', 'levure, yeast, khmira, khmira', 'piece', 150, 1000],
    ['Crisps', 'chips, crisps', 'pack', 500, 1000],
  ],
  drinks: [
    ['Water', 'eau, water, sidi ali, ain saiss, bahia, lma', 'L', 400, 1500],
    ['Sparkling water', 'eau gazeuse, oulmes, sparkling', 'L', 700, 1000],
    ['Soft drink', 'soda, coca, cola, fanta, pepsi, hawai, poms, limonade', 'L', 900, 1000],
    ['Juice', 'jus, juice, aseer, 3asir', 'L', 1200, 1000],
  ],
  household: [
    ['Butane gas', 'butane, gaz, bouta, bonbonne, gas', 'piece', 6000, 1000],
    ['Laundry detergent', 'lessive, detergent, tide, omo, ariel, sabon tid', 'kg', 2500, 1000],
    ['Dish soap', 'liquide vaisselle, vaisselle, dish soap, pril, mira', 'piece', 1500, 1000],
    ['Bleach', 'javel, eau de javel, bleach, jafil', 'L', 600, 1000],
    ['Toilet paper', 'papier toilette, papier hygienique, toilet paper, kleenex', 'pack', 2000, 1000],
    ['Soap', 'savon, soap, sabon', 'piece', 600, 1000],
    ['Shampoo', 'shampoing, shampooing, shampoo', 'piece', 3000, 1000],
    ['Toothpaste', 'dentifrice, toothpaste, signal', 'piece', 1500, 1000],
    ['Bin bags', 'sac poubelle, sacs poubelle, bin bag, mika', 'pack', 1000, 1000],
  ],
};

export const PRICE_BOOK: readonly BookEntry[] = (Object.keys(ROWS) as PriceGroup[]).flatMap((group) =>
  ROWS[group].map(([name, aliases, unit, priceMinor, typicalMilli]) => ({
    name,
    aliases: aliases.split(',').map((a) => a.trim()),
    unit,
    priceMinor,
    typicalMilli,
    group,
  })),
);
