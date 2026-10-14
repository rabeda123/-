// נתוני התפריט והמוצרים.
// מחירים: הערכה בלבד (₪) — ניתנים לעריכה במסך "קניות". אינם מחירים חיים מהסופר.

const PRODUCTS = {
  bread:      { name: 'לחם קל / מלא',        unit: 'פרוסות', pkg: 20,  pkgLabel: 'כיכר (~20 פרוסות)',  price: [14.9, 12.9] },
  cottage:    { name: "קוטג' 5%",             unit: 'גרם',    pkg: 250, pkgLabel: 'גביע 250 גרם',       price: [6.9, 6.5] },
  whitecheese:{ name: 'גבינה לבנה 5%',        unit: 'גרם',    pkg: 250, pkgLabel: 'גביע 250 גרם',       price: [5.9, 5.6] },
  eggs:       { name: 'ביצים L',              unit: 'יח׳',    pkg: 12,  pkgLabel: 'תבנית 12',           price: [13.9, 13.5] },
  cucumber:   { name: 'מלפפונים',             unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [6.9, 4.9] },
  tomato:     { name: 'עגבניות',              unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [8.9, 6.9] },
  pepper:     { name: 'פלפל',                 unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [12.9, 9.9] },
  coffee:     { name: 'קפה נמס',              unit: 'גרם',    pkg: 200, pkgLabel: 'צנצנת 200 גרם',      price: [32.9, 29.9] },
  tea:        { name: 'תה',                   unit: 'שקיות',  pkg: 25,  pkgLabel: 'קופסה 25 שקיות',     price: [9.9, 8.9] },
  milk:       { name: 'חלב 1%',               unit: 'מ"ל',    pkg: 1000,pkgLabel: 'קרטון 1 ליטר',       price: [6.9, 6.9] },
  apples:     { name: 'תפוחים',               unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [12.9, 9.9] },
  berries:    { name: 'פירות יער קפואים',     unit: 'גרם',    pkg: 500, pkgLabel: 'שקית 500 גרם',       price: [21.9, 19.9] },
  almonds:    { name: 'שקדים טבעיים',         unit: 'גרם',    pkg: 200, pkgLabel: 'שקית 200 גרם',       price: [19.9, 16.9] },
  walnuts:    { name: 'אגוזי מלך',            unit: 'גרם',    pkg: 200, pkgLabel: 'שקית 200 גרם',       price: [22.9, 24.9] },
  chicken:    { name: 'חזה עוף',              unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [39.9, 34.9] },
  fish:       { name: 'פילה אמנון/סלמון',     unit: 'גרם',    pkg: 800, pkgLabel: 'שקית קפואה 800 גרם', price: [34.9, 29.9] },
  lentils:    { name: 'עדשים / קטניות',       unit: 'גרם',    pkg: 500, pkgLabel: 'שקית 500 גרם',       price: [8.9, 7.9] },
  rice:       { name: 'אורז מלא',             unit: 'גרם',    pkg: 1000,pkgLabel: 'שקית 1 ק"ג',         price: [13.9, 11.9] },
  quinoa:     { name: 'קינואה',               unit: 'גרם',    pkg: 500, pkgLabel: 'שקית 500 גרם',       price: [16.9, 14.9] },
  sweetpotato:{ name: 'בטטה',                 unit: 'גרם',    pkg: 1000,pkgLabel: 'ק"ג',                price: [7.9, 5.9] },
  broccoli:   { name: 'ברוקולי / כרובית קפוא', unit: 'גרם',   pkg: 800, pkgLabel: 'שקית 800 גרם',       price: [13.9, 11.9] },
  oliveoil:   { name: 'שמן זית',              unit: 'מ"ל',    pkg: 750, pkgLabel: 'בקבוק 750 מ"ל',      price: [44.9, 39.9] },
  ricecakes:  { name: 'פריכיות אורז / פתיבר', unit: 'יח׳',    pkg: 20,  pkgLabel: 'חבילה ~20 יח׳',      price: [8.9, 7.9] },
  bars:       { name: 'חטיף אנרגיה (עד 100 קל׳)', unit: 'יח׳', pkg: 6,  pkgLabel: 'מארז 6',             price: [16.9, 17.9] },
  tuna:       { name: 'טונה במים',            unit: 'קופסאות',pkg: 4,   pkgLabel: 'רביעייה',            price: [26.9, 22.9] },
  bulgarian:  { name: 'בולגרית / צפתית 5%',   unit: 'גרם',    pkg: 250, pkgLabel: 'גביע 250 גרם',       price: [12.9, 11.9] },
  avocado:    { name: 'אבוקדו',               unit: 'יח׳',    pkg: 1,   pkgLabel: 'יחידה',              price: [3.9, 2.9] },
  tahini:     { name: 'טחינה גולמית',         unit: 'גרם',    pkg: 500, pkgLabel: 'צנצנת 500 גרם',      price: [14.9, 15.9] },
  yogurt:     { name: 'יוגורט חלבון 0%–2%',   unit: 'יח׳',    pkg: 1,   pkgLabel: 'גביע',               price: [6.4, 5.9] },
  pudding:    { name: 'מעדן לייט',            unit: 'יח׳',    pkg: 1,   pkgLabel: 'גביע',               price: [4.9, 4.5] },
};

// כל פריט בארוחה כולל אפשרויות; האפשרות הראשונה היא ברירת המחדל (ניתן לשנות בהגדרות).
const MEALS = [
  {
    id: 'breakfast', name: 'ארוחת בוקר', emoji: '🍳', time: '07:30',
    items: [
      { id: 'b_bread', options: [{ label: '2 פרוסות לחם קל או מלא', uses: { bread: 2 } }] },
      { id: 'b_protein', options: [
        { label: "2–3 כפות קוטג' 5%", uses: { cottage: 50 } },
        { label: '2–3 כפות גבינה לבנה 5%', uses: { whitecheese: 50 } },
        { label: 'ביצה אחת', uses: { eggs: 1 } },
      ] },
      { id: 'b_veg', options: [{ label: 'ירקות חתוכים (מלפפון, עגבנייה, פלפל)', uses: { cucumber: 100, tomato: 100, pepper: 50 } }] },
      { id: 'b_drink', options: [
        { label: 'קפה ללא סוכר', uses: { coffee: 2 } },
        { label: 'תה ללא סוכר', uses: { tea: 1 } },
      ] },
    ],
  },
  {
    id: 'snack1', name: 'ביניים (בוקר)', emoji: '🍏', time: '10:30',
    items: [
      { id: 's1_fruit', options: [
        { label: 'תפוח / אגס', uses: { apples: 180 } },
        { label: 'כוס פירות יער', uses: { berries: 100 } },
      ] },
      { id: 's1_nuts', options: [
        { label: '5–7 שקדים טבעיים', uses: { almonds: 8 } },
        { label: '2 אגוזי מלך', uses: { walnuts: 10 } },
      ] },
    ],
  },
  {
    id: 'lunch', name: 'ארוחת צהריים', emoji: '🍗', time: '13:30',
    items: [
      { id: 'l_protein', options: [
        { label: '150 גרם חזה עוף בגריל', uses: { chicken: 150 } },
        { label: 'פילה דג בתנור (סלמון/אמנון)', uses: { fish: 150 } },
        { label: 'כוס קטניות / קציצות קטניות', uses: { lentils: 70 } },
      ] },
      { id: 'l_carb', options: [
        { label: '3–4 כפות אורז מלא', uses: { rice: 40 } },
        { label: '3–4 כפות קינואה', uses: { quinoa: 40 } },
        { label: 'בטטה אפויה', uses: { sweetpotato: 150 } },
      ] },
      { id: 'l_veg', options: [
        { label: 'סלט ירקות עשיר + כפית שמן זית', uses: { cucumber: 150, tomato: 150, oliveoil: 5 } },
        { label: 'ירקות אפויים (ברוקולי/כרובית) + כפית שמן זית', uses: { broccoli: 200, oliveoil: 5 } },
      ] },
    ],
  },
  {
    id: 'snack2', name: 'ביניים (אחה"צ)', emoji: '☕', time: '16:30',
    items: [
      { id: 's2_coffee', options: [{ label: 'קפה עם מעט חלב', uses: { coffee: 2, milk: 50 } }] },
      { id: 's2_snack', options: [
        { label: '2 פריכיות אורז / פתיבר', uses: { ricecakes: 2 } },
        { label: 'חטיף אנרגיה (עד 100 קל׳)', uses: { bars: 1 } },
      ] },
    ],
  },
  {
    id: 'dinner', name: 'ארוחת ערב', emoji: '🥗', time: '19:30',
    items: [
      { id: 'd_protein', options: [
        { label: 'קופסת טונה במים', uses: { tuna: 1 } },
        { label: 'ביצה (קשה / חביתה במעט שמן)', uses: { eggs: 1 } },
        { label: '100 גרם בולגרית/צפתית 5%', uses: { bulgarian: 100 } },
      ] },
      { id: 'd_bread', options: [{ label: '1–2 פרוסות לחם קל/מלא', uses: { bread: 2 } }] },
      { id: 'd_fat', options: [
        { label: 'רבע אבוקדו', uses: { avocado: 0.25 } },
        { label: 'כף טחינה גולמית', uses: { tahini: 15 } },
      ] },
      { id: 'd_salad', options: [{ label: 'סלט ירקות גדול', uses: { cucumber: 150, tomato: 150, pepper: 100 } }] },
    ],
  },
  {
    id: 'night', name: 'ארוחת לילה', emoji: '🥛', time: '21:30', optional: true,
    items: [
      { id: 'n_dairy', options: [
        { label: 'יוגורט חלבון 0%–2% ללא סוכר', uses: { yogurt: 1 } },
        { label: 'מעדן לייט', uses: { pudding: 1 } },
      ] },
    ],
  },
];

const TIPS = [
  'כוס מים לפני הארוחה מגבירה שובע ומונעת בלבול בין צמא לרעב.',
  'חלבון רזה + סיבים = שובע ממושך ושמירה על מסת שריר.',
  'הליכה של 30–40 דקות ביום תומכת בקצב חילוף החומרים.',
  'גירעון של כ-500 קלוריות ביום ≈ ירידה של כחצי ק"ג בשבוע.',
  'זה תפריט כללי — מומלץ להתאים אותו אישית עם דיאטנית קלינית בקופה.',
];
