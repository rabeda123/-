'use strict';

/* ---------- state ---------- */

const STORE_KEY = 'easyfit.v1';

function defaultState() {
  const times = {};
  MEALS.forEach(m => { times[m.id] = m.time; });
  return {
    settings: {
      times,
      nightMeal: true,
      waterTarget: 12,
      waterStart: '07:00',
      waterEnd: '21:00',
      kcalTarget: 1600,
      protTarget: 100,
      walksPerWeek: 3,
      walkMin: 30,
      walkTime: '18:00',
      notifications: false,
      lowStockTime: '18:00',
      shopDays: 7,
      stores: ['שופרסל', 'רמי לוי'],
      defaults: {},            // itemId -> option index
    },
    menu: null,                // null = built-in MEALS; otherwise an edited copy
    customProducts: {},        // productId -> full product definition
    productEdits: {},          // productId -> overridden fields of a built-in product
    inventory: {},             // productId -> qty (in product units)
    prices: {},                // productId -> [storeA, storeB]
    log: {},                   // dateKey -> { meals: {mealId: {choices, deducted, kcal, prot, at}}, water }
    walks: [],                 // [{date, min, at}]
    fired: {},                 // dateKey -> [reminderId]
    weights: [],               // [{date, kg}]
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...s.settings, times: { ...d.settings.times, ...(s.settings || {}).times } } };
  } catch (e) {
    return defaultState();
  }
}

let state = loadState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('שמירה נכשלה'); }
}

/* ---------- helpers ---------- */

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m % 60))}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const money = n => '₪' + n.toFixed(2);
const fmtQty = (n, unit) => `${+n.toFixed(n < 10 ? 2 : 0)} ${unit}`;
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const UNITS = ['גרם', 'מ"ל', 'יח׳', 'פרוסות', 'קופסאות', 'שקיות'];

function dayLog(k = dkey()) {
  if (!state.log[k]) state.log[k] = { meals: {}, water: 0 };
  return state.log[k];
}

/* ---------- products & nutrition ---------- */

function P(pid) {
  const base = PRODUCTS[pid] || state.customProducts[pid];
  return base ? { ...base, ...state.productEdits[pid] } : null;
}

function productIds() {
  return [...Object.keys(PRODUCTS), ...Object.keys(state.customProducts)];
}

// nutrition values are per 100 for grams/ml, per 1 for any other unit
const nutBase = unit => (unit === 'גרם' || unit === 'מ"ל') ? 100 : 1;
const nutLabel = unit => nutBase(unit) === 100 ? `ל-100 ${unit}` : `ל-1 ${unit}`;

function usesNutrition(uses) {
  let kcal = 0, prot = 0;
  for (const [pid, amt] of Object.entries(uses)) {
    const p = P(pid);
    if (!p) continue;
    const f = amt / nutBase(p.unit);
    kcal += (p.kcal || 0) * f;
    prot += (p.prot || 0) * f;
  }
  return { kcal, prot };
}

const nutText = n => `${Math.round(n.kcal)} קק״ל · ${Math.round(n.prot)} ג׳ חלבון`;

function price(pid, store) {
  const p = state.prices[pid];
  if (p && typeof p[store] === 'number') return p[store];
  return (P(pid).price || [0, 0])[store] || 0;
}

/* ---------- menu ---------- */

function menu() { return state.menu || MEALS; }

function editableMenu() {
  if (!state.menu) state.menu = JSON.parse(JSON.stringify(MEALS));
  return state.menu;
}

function activeMeals() {
  return menu().filter(m => !m.optional || state.settings.nightMeal)
    .map(m => ({ ...m, time: state.settings.times[m.id] || m.time }))
    .sort((a, b) => toMin(a.time) - toMin(b.time));
}

function findItem(itemId) {
  for (const m of editableMenu()) {
    const it = m.items.find(x => x.id === itemId);
    if (it) return { meal: m, item: it };
  }
  return {};
}

function defaultOpt(item) {
  const i = state.settings.defaults[item.id];
  return Number.isInteger(i) && item.options[i] ? i : 0;
}

function choiceOpt(item, choices) {
  const i = choices && choices[item.id];
  return item.options[Number.isInteger(i) && item.options[i] ? i : defaultOpt(item)];
}

function mealNutrition(meal, choices) {
  const uses = {};
  meal.items.forEach(it => {
    for (const [pid, amt] of Object.entries(choiceOpt(it, choices).uses)) uses[pid] = (uses[pid] || 0) + amt;
  });
  return usesNutrition(uses);
}

function plannedNutrition() {
  return activeMeals().reduce((a, m) => { const n = mealNutrition(m); return { kcal: a.kcal + n.kcal, prot: a.prot + n.prot }; }, { kcal: 0, prot: 0 });
}

function eatenNutrition(L) {
  let kcal = 0, prot = 0;
  for (const rec of Object.values(L.meals || {})) { kcal += rec.kcal || 0; prot += rec.prot || 0; }
  return { kcal, prot };
}

/* ---------- walking ---------- */

function weekStart(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay()); // week starts on Sunday
  return s;
}

function walkWeek(start) {
  const keys = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return dkey(d); });
  const walks = state.walks.filter(w => keys.includes(w.date));
  const days = new Set(walks.filter(w => w.min >= state.settings.walkMin).map(w => w.date));
  return { count: days.size, minutes: walks.reduce((a, w) => a + w.min, 0) };
}

function latestWeight() {
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  return w.length ? w[w.length - 1].kg : null;
}

// walking ≈ 3.5 MET
const walkKcal = min => Math.round(3.5 * (latestWeight() || 80) * min / 60);

/* ---------- inventory math ---------- */

function dailyUse() {
  const use = {};
  activeMeals().forEach(m => m.items.forEach(it => {
    for (const [pid, amt] of Object.entries(it.options[defaultOpt(it)].uses)) use[pid] = (use[pid] || 0) + amt;
  }));
  return use;
}

function stockStatus() {
  const use = dailyUse();
  return productIds().map(pid => {
    const qty = state.inventory[pid] || 0;
    const perDay = use[pid] || 0;
    const daysLeft = perDay ? qty / perDay : Infinity;
    return { pid, qty, perDay, daysLeft };
  });
}

function shoppingList() {
  const days = state.settings.shopDays;
  return stockStatus()
    .filter(s => s.perDay > 0 && s.daysLeft < days)
    .map(s => {
      const deficit = s.perDay * days - s.qty;
      const packs = Math.max(1, Math.ceil(deficit / P(s.pid).pkg - 1e-9));
      // urgent only for items whose stock was actually entered
      return { ...s, packs, urgent: s.daysLeft <= 1 && s.pid in state.inventory };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ---------- actions ---------- */

function markMeal(mealId, choices) {
  const meal = menu().find(m => m.id === mealId);
  const deducted = {};
  meal.items.forEach(it => {
    for (const [pid, amt] of Object.entries(choiceOpt(it, choices).uses)) {
      if (!(pid in state.inventory)) continue; // stock never entered — nothing to track
      const have = state.inventory[pid] || 0;
      const take = Math.min(have, amt);
      state.inventory[pid] = have - take;
      deducted[pid] = (deducted[pid] || 0) + take;
    }
  });
  const n = mealNutrition(meal, choices);
  const labels = {};
  meal.items.forEach(it => { labels[it.id] = choiceOpt(it, choices).label; });
  dayLog().meals[mealId] = { choices, labels, deducted, kcal: Math.round(n.kcal), prot: Math.round(n.prot), at: Date.now() };
  save(); render();
  toast(`${meal.emoji} כל הכבוד! ${meal.name} סומנה`);
}

function unmarkMeal(mealId) {
  const L = dayLog();
  const rec = L.meals[mealId];
  if (!rec) return;
  for (const [pid, amt] of Object.entries(rec.deducted || {})) state.inventory[pid] = (state.inventory[pid] || 0) + amt;
  delete L.meals[mealId];
  save(); render();
}

function addWater(delta) {
  const L = dayLog();
  L.water = Math.max(0, (L.water || 0) + delta);
  save(); render();
  if (delta > 0 && L.water === state.settings.waterTarget) toast('💧 הגעת ליעד המים היומי!');
}

function addWalk(min) {
  if (!(min > 0 && min <= 600)) { toast('הזן מספר דקות תקין'); return; }
  const before = walkWeek(weekStart()).count;
  state.walks.push({ date: dkey(), min, at: Date.now() });
  save(); render();
  const after = walkWeek(weekStart()).count;
  if (after >= state.settings.walksPerWeek && before < state.settings.walksPerWeek) toast('🏆 השלמת את יעד ההליכה השבועי!');
  else toast(`🚶 נרשמה הליכה של ${min} דק׳`);
}

/* ---------- reminders ---------- */

function waterTimes() {
  const s = toMin(state.settings.waterStart), e = toMin(state.settings.waterEnd);
  const n = state.settings.waterTarget;
  if (n <= 1) return [s];
  return Array.from({ length: n }, (_, i) => Math.round(s + (e - s) * i / (n - 1)));
}

function buildReminders() {
  const L = dayLog();
  const S = state.settings;
  const list = [];
  activeMeals().forEach(m => {
    const t = toMin(m.time);
    list.push({ id: `meal:${m.id}`, at: t, title: `${m.emoji} זמן ל${m.name}`,
      body: m.items.map(it => it.options[defaultOpt(it)].label).join(' • ') + '\nלפני הארוחה — כוס מים 💧',
      pending: () => !L.meals[m.id] });
    list.push({ id: `mealfu:${m.id}`, at: t + 60, title: `עוד לא סימנת ${m.name}`,
      body: 'אכלת? היכנס וסמן כדי להישאר במעקב ✔️', pending: () => !L.meals[m.id] });
  });
  waterTimes().forEach((t, i) => {
    list.push({ id: `water:${i}`, at: t, title: '💧 זמן לשתות כוס מים',
      body: `כוס ${i + 1} מתוך ${S.waterTarget}`, pending: () => (L.water || 0) <= i });
  });
  const wk = walkWeek(weekStart());
  list.push({ id: 'walk', at: toMin(S.walkTime), title: `🚶 זמן להליכה של ${S.walkMin} דק׳`,
    body: `השבוע: ${wk.count}/${S.walksPerWeek} הליכות. יוצאים?`,
    pending: () => wk.count < S.walksPerWeek && !state.walks.some(w => w.date === dkey()) });
  list.push({ id: 'stock', at: toMin(S.lowStockTime), title: '🛒 תזכורת קניות',
    body: '', pending: () => shoppingList().some(s => s.urgent) });
  return list;
}

async function notify(title, body, tag) {
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    const opts = { body, tag, icon: 'icon.svg', badge: 'icon.svg', dir: 'rtl', lang: 'he', renotify: true };
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) { /* ignore */ }
}

function checkReminders() {
  const k = dkey();
  const fired = state.fired[k] || (state.fired[k] = []);
  const m = nowMin();
  const canNotify = state.settings.notifications && 'Notification' in window && Notification.permission === 'granted';
  let changed = false;
  for (const r of buildReminders()) {
    if (fired.includes(r.id) || m < r.at) continue;
    // fire only within a 45-minute window so opening the app late doesn't flood
    if (m - r.at <= 45 && r.pending()) {
      let body = r.body;
      if (r.id === 'stock') body = 'מחר ייגמר: ' + shoppingList().filter(s => s.urgent).map(s => P(s.pid).name).join(', ');
      if (canNotify) notify(r.title, body, r.id);
      else if (document.visibilityState === 'visible') toast(r.title);
    }
    fired.push(r.id); changed = true;
  }
  for (const key of Object.keys(state.fired)) if (key !== k) { delete state.fired[key]; changed = true; }
  if (changed) save();
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('הדפדפן לא תומך בהתראות. נסה להתקין את האפליקציה למסך הבית.'); return; }
  const p = await Notification.requestPermission();
  state.settings.notifications = p === 'granted';
  save(); render();
  if (p === 'granted') notify('EasyFit 💪', 'ההתראות פעילות! נזכיר לך מה לאכול ומתי לשתות.', 'welcome');
  else toast('ההרשאה להתראות נדחתה');
}

/* ---------- calendar export (reliable reminders even when the app is closed) ---------- */

function exportICS() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = (uid, min, summary, desc) => {
    const hhmm = fromMin(min).replace(':', '');
    return [
      'BEGIN:VEVENT', `UID:${uid}@easyfit`, `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${hhmm}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      `SUMMARY:${summary}`, `DESCRIPTION:${desc.replace(/\n/g, '\\n').replace(/,/g, '\\,')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  };
  const S = state.settings;
  const events = [];
  activeMeals().forEach(m => events.push(ev(`meal-${m.id}`, toMin(m.time), `${m.emoji} ${m.name}`,
    m.items.map(it => '• ' + it.options.map(o => o.label).join(' / ')).join('\n'))));
  waterTimes().forEach((t, i) => events.push(ev(`water-${i}`, t, `💧 כוס מים ${i + 1}/${S.waterTarget}`, 'זמן לשתות כוס מים')));
  events.push(ev('walk', toMin(S.walkTime), `🚶 הליכה ${S.walkMin} דק׳`, `יעד: ${S.walksPerWeek} הליכות בשבוע`));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EasyFit//HE', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  download(new Blob([ics], { type: 'text/calendar' }), 'easyfit-reminders.ics');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- UI ---------- */

let tab = 'today';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const views = { today: renderToday, menu: renderMenu, shop: renderShop, stock: renderStock, track: renderTrack, settings: renderSettings };
  $('#view').innerHTML = views[tab]();
  const badge = shoppingList().filter(s => s.urgent).length;
  $('#shopBadge').textContent = badge || '';
  $('#shopBadge').hidden = !badge;
}

function ring(cls, pct, text, label) {
  return `<div class="stat"><div class="ring ${cls}" style="--p:${Math.max(0, Math.min(100, pct))}"><b>${text}</b></div><span>${label}</span></div>`;
}

function renderToday() {
  const L = dayLog();
  const S = state.settings;
  const meals = activeMeals();
  const done = meals.filter(m => L.meals[m.id]).length;
  const water = L.water || 0;
  const eaten = eatenNutrition(L);
  const m = nowMin();
  const next = meals.find(x => !L.meals[x.id] && toMin(x.time) + 90 >= m);
  const urgent = shoppingList().filter(s => s.urgent);
  const wk = walkWeek(weekStart());
  const todayWalks = state.walks.filter(w => w.date === dkey());
  const date = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const tip = TIPS[new Date().getDate() % TIPS.length];

  let html = `<h2 class="date">${esc(date)}</h2>`;

  if (!S.notifications) {
    html += `<div class="banner"><span>🔔 הפעל התראות כדי לקבל תזכורות לארוחות, למים ולהליכה</span><button class="btn small" data-act="notif">הפעל</button></div>`;
  }
  if (!Object.keys(state.inventory).length) {
    html += `<div class="banner"><span>📦 הזן את הכמויות שיש לך בבית כדי שנזכיר לך לקנות בזמן</span><button class="btn small" data-act="goto" data-tab="stock">למלאי</button></div>`;
  }
  if (urgent.length) {
    html += `<div class="banner warn"><span>🛒 מחר ייגמר: ${urgent.map(s => esc(P(s.pid).name)).join(', ')}</span><button class="btn small" data-act="goto" data-tab="shop">לקניות</button></div>`;
  }

  const over = eaten.kcal > S.kcalTarget;
  html += `<section class="summary">
    ${ring('', done / meals.length * 100, `${done}/${meals.length}`, 'ארוחות')}
    ${ring('water', water / S.waterTarget * 100, `${water}/${S.waterTarget}`, 'כוסות מים')}
    ${ring(over ? 'over' : 'kcal', eaten.kcal / S.kcalTarget * 100, Math.round(eaten.kcal), `קק״ל מתוך ${S.kcalTarget}`)}
    ${ring('prot', eaten.prot / S.protTarget * 100, Math.round(eaten.prot) + 'ג׳', `חלבון מתוך ${S.protTarget}ג׳`)}
  </section>`;

  html += `<section class="card water-card">
    <div class="row"><h3>💧 מים</h3><span class="muted">${water >= S.waterTarget ? 'יעד הושג! 🎉' : `נשארו ${S.waterTarget - water} כוסות`}</span></div>
    <div class="glasses">${Array.from({ length: S.waterTarget }, (_, i) => `<span class="glass ${i < water ? 'full' : ''}"></span>`).join('')}</div>
    <div class="row gap"><button class="btn ghost" data-act="water" data-d="-1" aria-label="הורד כוס">−</button>
    <button class="btn primary grow" data-act="water" data-d="1">שתיתי כוס מים ✔</button></div>
  </section>`;

  html += `<section class="card walk-card">
    <div class="row"><h3>🚶 הליכה</h3><span class="muted">השבוע: ${wk.count}/${S.walksPerWeek}${wk.count >= S.walksPerWeek ? ' 🏆' : ''}</span></div>
    <div class="dots">${Array.from({ length: S.walksPerWeek }, (_, i) => `<span class="dot ${i < wk.count ? 'full' : ''}"></span>`).join('')}
      <span class="small muted">לפחות ${S.walkMin} דק׳ בכל פעם</span></div>
    ${todayWalks.map(w => `<div class="row small"><span class="${w.min >= S.walkMin ? 'ok' : ''}">היום: ${w.min} דק׳ ${w.min >= S.walkMin ? '✔' : `(פחות מ-${S.walkMin})`} · <bdi>~${walkKcal(w.min)}</bdi> קק״ל</span><button class="btn link" data-act="delwalk" data-at="${w.at}">בטל</button></div>`).join('')}
    <div class="row gap"><input type="number" id="walkMin" inputmode="numeric" min="1" max="600" value="${S.walkMin}" aria-label="דקות הליכה"><span class="muted">דק׳</span>
    <button class="btn primary grow" data-act="walk">הלכתי ✔</button></div>
  </section>`;

  meals.forEach(meal => {
    const rec = L.meals[meal.id];
    const isNext = next && next.id === meal.id;
    const late = !rec && toMin(meal.time) + 60 < m;
    const n = rec ? rec : mealNutrition(meal);
    html += `<section class="card meal ${rec ? 'done' : ''} ${isNext ? 'next' : ''}">
      <div class="row"><h3>${meal.emoji} ${esc(meal.name)}${meal.optional ? ' <small class="muted">(אופציונלי)</small>' : ''}</h3>
      <span class="time ${late ? 'late' : ''}">${esc(meal.time)}</span></div>
      <ul>${meal.items.map(it => {
        const alt = it.options.length > 1 && !rec ? ` <small class="muted">(+${it.options.length - 1} חלופות)</small>` : '';
        return `<li>${esc((rec && rec.labels && rec.labels[it.id]) || choiceOpt(it, rec && rec.choices).label)}${alt}</li>`;
      }).join('')}</ul>
      <div class="nut small">${rec ? '' : '~'}${nutText(n)}</div>
      ${rec
        ? `<div class="row"><span class="ok">✔ נאכל ב-${new Date(rec.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span><button class="btn link" data-act="unmark" data-meal="${meal.id}">בטל</button></div>`
        : `<button class="btn ${isNext ? 'primary' : 'outline'} full" data-act="eat" data-meal="${meal.id}">אכלתי ✔</button>`}
    </section>`;
  });

  html += `<p class="tip">💡 ${esc(tip)}</p>`;
  return html;
}

function renderMenu() {
  const plan = plannedNutrition();
  const S = state.settings;
  let html = `<h2>📋 התפריט שלי</h2>
    <div class="card best"><b>תכנון יומי (ברירות מחדל):</b> ${nutText(plan)}
      <div class="small muted">יעד: ${S.kcalTarget} קק״ל · ${S.protTarget} ג׳ חלבון</div></div>
    <p class="muted small">⭐ = מה שאתה אוכל בדרך כלל (משפיע על התכנון, המלאי והקניות). אפשר להוסיף חלופות, פריטים ומוצרים חדשים.</p>`;

  activeMeals().forEach(meal => {
    html += `<section class="card"><div class="row"><h3>${meal.emoji} ${esc(meal.name)}</h3><span class="time">${esc(meal.time)}</span></div>`;
    meal.items.forEach((it, idx) => {
      const def = defaultOpt(it);
      html += `<div class="mitem"><div class="row"><span class="small muted">פריט ${idx + 1}</span>
        ${meal.items.length > 1 ? `<button class="btn link danger small" data-act="delitem" data-item="${it.id}">מחק פריט</button>` : ''}</div>
        ${it.options.map((o, i) => `<div class="mopt ${i === def ? 'def' : ''}">
          <button class="star" data-act="setdef" data-item="${it.id}" data-i="${i}" aria-label="קבע כברירת מחדל">${i === def ? '⭐' : '☆'}</button>
          <div class="grow">${esc(o.label)}<div class="small muted">${nutText(usesNutrition(o.uses))} · ${Object.entries(o.uses).map(([pid, a]) => P(pid) ? `${esc(P(pid).name)} ${+a} ${esc(P(pid).unit)}` : '').join(', ')}</div></div>
          ${it.options.length > 1 ? `<button class="btn link danger" data-act="delopt" data-item="${it.id}" data-i="${i}" aria-label="מחק חלופה">✕</button>` : ''}
        </div>`).join('')}
        <button class="btn link" data-act="addopt" data-meal="${meal.id}" data-item="${it.id}">+ הוסף חלופה</button>
      </div>`;
    });
    html += `<button class="btn outline full" data-act="addopt" data-meal="${meal.id}">+ פריט חדש בארוחה</button></section>`;
  });

  html += `<section class="card"><div class="row"><h3>🥫 מוצרים וערכים תזונתיים</h3><button class="btn small primary" data-act="editprod">+ מוצר</button></div>
    <table class="prods"><thead><tr><th>מוצר</th><th>קק״ל</th><th>חלבון</th><th></th></tr></thead><tbody>
    ${productIds().map(pid => [pid, P(pid)])
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'he'))
      .map(([pid, p]) => `<tr><td>${esc(p.name)}<div class="small muted">${nutLabel(p.unit)}</div></td>
        <td>${+(p.kcal || 0)}</td><td>${+(p.prot || 0)} ג׳</td>
        <td><button class="btn link" data-act="editprod" data-pid="${pid}">עריכה</button></td></tr>`).join('')}
    </tbody></table></section>
    ${state.menu ? '<button class="btn link danger" data-act="resetmenu">איפוס התפריט למקור</button>' : ''}`;
  return html;
}

function renderStock() {
  const rows = stockStatus().sort((a, b) => (b.perDay > 0) - (a.perDay > 0) || a.daysLeft - b.daysLeft);
  let html = `<h2>📦 מלאי בבית</h2>
    <p class="muted">הזן כמה יש לך מכל מוצר. האפליקציה מורידה מהמלאי אוטומטית כשאתה מסמן ארוחה, ומזכירה לך יום לפני שמשהו נגמר.</p>`;
  html += rows.map(s => {
    const p = P(s.pid);
    const days = s.perDay ? (s.daysLeft === 0 ? 'נגמר' : `~${Math.floor(s.daysLeft)} ימים`) : 'לא בתפריט הנוכחי';
    const cls = !s.perDay ? 'idle' : s.daysLeft <= 1 ? 'bad' : s.daysLeft <= 3 ? 'mid' : 'good';
    return `<div class="stock-row ${cls}">
      <div class="grow"><b>${esc(p.name)}</b><div class="muted small">${s.perDay ? `צריכה: ${fmtQty(s.perDay, p.unit)}/יום · ` : ''}<span class="days">${days}</span></div></div>
      <div class="qty"><input type="number" inputmode="decimal" min="0" step="any" value="${+s.qty.toFixed(2)}" data-inv="${s.pid}" aria-label="כמות ${esc(p.name)}"><span class="small muted">${esc(p.unit)}</span></div>
      <button class="btn small ghost" data-act="addpkg" data-pid="${s.pid}" title="הוסף ${esc(p.pkgLabel)}">+${esc(String(p.pkgLabel).split(' ')[0])}</button>
    </div>`;
  }).join('');
  return html;
}

function renderShop() {
  const list = shoppingList();
  const [A, B] = state.settings.stores;
  let html = `<h2>🛒 רשימת קניות</h2>
    <p class="muted">מוצרים שלא יספיקו ל-${state.settings.shopDays} הימים הקרובים לפי התפריט. כמויות בחבילות.</p>`;
  if (!list.length) return html + `<div class="empty">✨ המלאי מספיק לתקופה הקרובה. אין צורך בקניות.</div>` + renderPriceTable();

  let totA = 0, totB = 0, totSplit = 0;
  const rows = list.map(s => {
    const p = P(s.pid);
    const a = price(s.pid, 0) * s.packs, b = price(s.pid, 1) * s.packs;
    totA += a; totB += b; totSplit += Math.min(a, b);
    return `<tr class="${s.urgent ? 'urgent' : ''}">
      <td><b>${esc(p.name)}</b>${s.urgent ? ' <span class="tag">נגמר מחר</span>' : ''}<div class="small muted">${s.packs} × ${esc(p.pkgLabel)}</div></td>
      <td class="${a <= b ? 'cheap' : ''}">${money(a)}</td><td class="${b < a ? 'cheap' : ''}">${money(b)}</td></tr>`;
  }).join('');
  const best = totA <= totB ? A : B;
  const diff = Math.abs(totA - totB);

  html += `<div class="card best">
    <div>הסל הזול ביותר: <b>${esc(best)}</b> — ${money(Math.min(totA, totB))}</div>
    <div class="small muted">חיסכון של ${money(diff)} לעומת ${esc(best === A ? B : A)}</div>
    ${totSplit < Math.min(totA, totB) - 0.5 ? `<div class="small">פיצול בין שני הסופרים: ${money(totSplit)} (חיסכון נוסף ${money(Math.min(totA, totB) - totSplit)})</div>` : ''}
  </div>
  <table class="shop"><thead><tr><th>מוצר</th><th>${esc(A)}</th><th>${esc(B)}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>סה"כ</td><td class="${totA <= totB ? 'cheap' : ''}">${money(totA)}</td><td class="${totB < totA ? 'cheap' : ''}">${money(totB)}</td></tr></tfoot></table>
  <button class="btn primary full" data-act="bought">קניתי הכל — עדכן מלאי ✔</button>
  <p class="small muted">⚠️ המחירים הם הערכה ראשונית בלבד ולא מחירים חיים. עדכן אותם בטבלה למטה לפי הקבלה או האתר של הסופר.</p>`;
  return html + renderPriceTable();
}

function renderPriceTable() {
  const [A, B] = state.settings.stores;
  return `<details class="card"><summary>✏️ עריכת מחירים (לחבילה)</summary>
    <table class="prices"><thead><tr><th>מוצר</th><th>${esc(A)}</th><th>${esc(B)}</th></tr></thead><tbody>
    ${productIds().map(pid => { const p = P(pid); return `<tr><td>${esc(p.name)}<div class="small muted">${esc(p.pkgLabel)}</div></td>
      <td><input type="number" inputmode="decimal" step="0.1" min="0" value="${price(pid, 0)}" data-price="${pid}" data-store="0"></td>
      <td><input type="number" inputmode="decimal" step="0.1" min="0" value="${price(pid, 1)}" data-price="${pid}" data-store="1"></td></tr>`; }).join('')}
    </tbody></table></details>`;
}

function renderTrack() {
  const meals = activeMeals();
  const S = state.settings;
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  let html = `<h2>📈 מעקב</h2>
  <section class="card"><h3>⚖️ משקל</h3>
    <div class="row gap"><input type="number" id="kg" inputmode="decimal" step="0.1" placeholder="משקל היום (ק״ג)" class="grow">
    <button class="btn primary" data-act="weight">שמור</button></div>`;
  if (w.length) {
    const first = w[0].kg, last = w[w.length - 1].kg, delta = last - first;
    html += `<div class="row weight-sum"><span>התחלה: <b>${first}</b></span><span>נוכחי: <b>${last}</b></span>
      <span class="${delta <= 0 ? 'ok' : 'late'}">${delta <= 0 ? '▼' : '▲'} ${Math.abs(delta).toFixed(1)} ק״ג</span></div>`;
    html += sparkline(w.map(x => x.kg));
    html += `<ul class="wlist">${w.slice(-7).reverse().map(x => `<li><span>${new Date(x.date).toLocaleDateString('he-IL')}</span><b>${x.kg} ק״ג</b><button class="btn link" data-act="delweight" data-date="${x.date}">מחק</button></li>`).join('')}</ul>`;
  }
  html += `</section>`;

  html += `<section class="card"><h3>🚶 הליכה — ${S.walksPerWeek} פעמים בשבוע, ${S.walkMin} דק׳</h3>
    <table class="hist"><thead><tr><th>שבוע</th><th>הליכות</th><th>דקות</th><th></th></tr></thead><tbody>`;
  for (let i = 0; i < 6; i++) {
    const s = weekStart(); s.setDate(s.getDate() - 7 * i);
    const wk = walkWeek(s);
    const ok = wk.count >= S.walksPerWeek;
    html += `<tr><td>${i === 0 ? 'השבוע' : s.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</td>
      <td>${wk.count}/${S.walksPerWeek}</td><td>${wk.minutes}</td><td>${ok ? '🏆' : i === 0 ? '⏳' : '—'}</td></tr>`;
  }
  html += `</tbody></table></section>`;

  html += `<section class="card"><h3>🗓️ 14 הימים האחרונים</h3><table class="hist"><thead><tr><th>יום</th><th>ארוחות</th><th>מים</th><th>קק״ל</th><th>חלבון</th><th>🚶</th></tr></thead><tbody>`;
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dkey(d);
    const L = state.log[k] || { meals: {}, water: 0 };
    const md = meals.filter(m => L.meals[m.id]).length;
    const n = eatenNutrition(L);
    const walked = state.walks.filter(x => x.date === k).reduce((a, x) => a + x.min, 0);
    html += `<tr><td>${d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</td>
      <td>${md}/${meals.length}</td><td>${L.water || 0}/${S.waterTarget}</td>
      <td class="${n.kcal > S.kcalTarget ? 'late' : ''}">${Math.round(n.kcal) || '—'}</td><td>${Math.round(n.prot) || '—'}</td>
      <td>${walked ? `${walked}′` : ''}</td></tr>`;
  }
  return html + '</tbody></table></section>';
}

function sparkline(vals) {
  if (vals.length < 2) return '';
  const W = 300, H = 70, min = Math.min(...vals) - 0.5, max = Math.max(...vals) + 0.5;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * W).toFixed(1)},${(H - (v - min) / (max - min) * H).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="גרף משקל"><polyline points="${pts.join(' ')}"/></svg>`;
}

function renderSettings() {
  const S = state.settings;
  const plan = plannedNutrition();
  return `<h2>⚙️ הגדרות</h2>
  <section class="card"><h3>🔔 תזכורות</h3>
    <div class="row"><span>התראות בדפדפן</span>${S.notifications ? '<span class="ok">פעיל ✔</span>' : '<button class="btn small" data-act="notif">הפעל</button>'}</div>
    <p class="small muted">התראות מהאפליקציה עובדות כשהיא פתוחה או ברקע. לתזכורות שעובדות תמיד (גם כשהטלפון נעול והאפליקציה סגורה) — הוסף אותן ליומן:</p>
    <button class="btn outline full" data-act="ics">📅 הוסף תזכורות ליומן בטלפון</button>
  </section>
  <section class="card"><h3>🎯 יעדים תזונתיים</h3>
    <label class="row"><span>קלוריות ביום</span><input type="number" min="800" max="5000" value="${S.kcalTarget}" data-set="kcalTarget"></label>
    <label class="row"><span>חלבון ביום (ג׳)</span><input type="number" min="20" max="400" value="${S.protTarget}" data-set="protTarget"></label>
    <p class="small muted">התפריט הנוכחי מתוכנן ל-${nutText(plan)}.</p>
  </section>
  <section class="card"><h3>⏰ שעות ארוחות</h3>
    ${menu().map(m => `<label class="row"><span>${m.emoji} ${esc(m.name)}</span><input type="time" value="${esc(S.times[m.id])}" data-time="${m.id}"></label>`).join('')}
    <label class="row"><span>לכלול ארוחת לילה</span><input type="checkbox" ${S.nightMeal ? 'checked' : ''} data-set="nightMeal"></label>
  </section>
  <section class="card"><h3>💧 מים</h3>
    <label class="row"><span>כוסות ביום</span><input type="number" min="1" max="20" value="${S.waterTarget}" data-set="waterTarget"></label>
    <label class="row"><span>תזכורת ראשונה</span><input type="time" value="${S.waterStart}" data-set="waterStart"></label>
    <label class="row"><span>תזכורת אחרונה</span><input type="time" value="${S.waterEnd}" data-set="waterEnd"></label>
  </section>
  <section class="card"><h3>🚶 הליכה</h3>
    <label class="row"><span>הליכות בשבוע</span><input type="number" min="1" max="7" value="${S.walksPerWeek}" data-set="walksPerWeek"></label>
    <label class="row"><span>דקות מינימום להליכה</span><input type="number" min="5" max="180" value="${S.walkMin}" data-set="walkMin"></label>
    <label class="row"><span>שעת תזכורת</span><input type="time" value="${S.walkTime}" data-set="walkTime"></label>
  </section>
  <section class="card"><h3>🛒 קניות</h3>
    <label class="row"><span>לקנות מלאי לכמה ימים</span><input type="number" min="2" max="30" value="${S.shopDays}" data-set="shopDays"></label>
    <label class="row"><span>שעת תזכורת קניות</span><input type="time" value="${S.lowStockTime}" data-set="lowStockTime"></label>
    <label class="row"><span>סופר 1</span><input type="text" value="${esc(S.stores[0])}" data-store-name="0"></label>
    <label class="row"><span>סופר 2</span><input type="text" value="${esc(S.stores[1])}" data-store-name="1"></label>
  </section>
  <section class="card"><h3>💾 נתונים</h3>
    <div class="row gap"><button class="btn outline grow" data-act="export">גיבוי</button><button class="btn outline grow" data-act="import">שחזור</button></div>
    <button class="btn link danger" data-act="reset">מחיקת כל הנתונים</button>
  </section>`;
}

/* ---------- dialogs ---------- */

function openDialog(html, onOk) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog">${html}
    <div class="row gap"><button value="cancel" class="btn ghost" formnovalidate>ביטול</button><button value="ok" class="btn primary grow">שמור ✔</button></div></form>`;
  dlg.returnValue = '';
  dlg.onclose = () => { if (dlg.returnValue === 'ok') onOk(new FormData(dlg.querySelector('form'))); };
  dlg.showModal();
  return dlg;
}

function openMealDialog(mealId) {
  const meal = menu().find(m => m.id === mealId);
  const dlg = openDialog(`<h3>${meal.emoji} מה אכלת ב${esc(meal.name)}?</h3>
    ${meal.items.map(it => `<fieldset>${it.options.map((o, i) => `<label class="opt"><input type="radio" name="${it.id}" value="${i}" ${defaultOpt(it) === i ? 'checked' : ''}>
      <span>${esc(o.label)}<br><small class="muted">${nutText(usesNutrition(o.uses))}</small></span></label>`).join('')}</fieldset>`).join('')}
    <p class="nut" id="mealNut"></p>`, fd => {
    const choices = {};
    meal.items.forEach(it => { choices[it.id] = Number(fd.get(it.id) ?? defaultOpt(it)); });
    markMeal(mealId, choices);
  });
  dlg.querySelector('button[value=ok]').textContent = 'סמן שאכלתי ✔';
  const upd = () => {
    const fd = new FormData(dlg.querySelector('form'));
    const ch = {}; meal.items.forEach(it => { ch[it.id] = Number(fd.get(it.id)); });
    $('#mealNut').textContent = 'סה״כ: ' + nutText(mealNutrition(meal, ch));
  };
  dlg.querySelector('form').addEventListener('change', upd); upd();
}

function productOptions(selected) {
  return productIds().map(pid => [pid, P(pid)]).sort((a, b) => a[1].name.localeCompare(b[1].name, 'he'))
    .map(([pid, p]) => `<option value="${pid}" ${pid === selected ? 'selected' : ''}>${esc(p.name)} (${esc(p.unit)})</option>`).join('');
}

const useRow = (pid = '', amt = '') => `<div class="row gap userow">
  <select name="pid" class="grow">${productOptions(pid)}</select>
  <input type="number" name="amt" inputmode="decimal" step="any" min="0" placeholder="כמות" value="${amt}" required>
  <button type="button" class="btn link danger" data-act="delrow" aria-label="הסר">✕</button></div>`;

// add an option to an existing item, or (no itemId) a new item to the meal
function openOptionDialog(mealId, itemId) {
  const meal = editableMenu().find(m => m.id === mealId);
  const dlg = openDialog(`<h3>${itemId ? 'חלופה חדשה' : 'פריט חדש'} — ${esc(meal.name)}</h3>
    <label class="field">שם (איך זה יופיע בתפריט)<input name="label" placeholder="לדוגמה: 2 פרוסות לחם כוסמין" maxlength="80"></label>
    <div class="small muted">מוצרים וכמויות (ביחידות המוצר):</div>
    <div id="rows">${useRow()}</div>
    <button type="button" class="btn link" data-act="addrow">+ מוצר נוסף</button>
    <p class="small muted">לא מוצא מוצר? הוסף אותו במסך "תפריט" ← "מוצרים".</p>
    <p class="nut" id="optNut"></p>`, fd => {
    const pids = fd.getAll('pid'), amts = fd.getAll('amt').map(Number);
    const uses = {};
    pids.forEach((pid, i) => { if (amts[i] > 0) uses[pid] = (uses[pid] || 0) + amts[i]; });
    if (!Object.keys(uses).length) { toast('צריך לפחות מוצר אחד עם כמות'); return; }
    const label = String(fd.get('label') || '').trim() ||
      Object.entries(uses).map(([pid, a]) => `${+a} ${P(pid).unit} ${P(pid).name}`).join(' + ');
    const opt = { label, uses };
    if (itemId) findItem(itemId).item.options.push(opt);
    else meal.items.push({ id: newId('i_'), options: [opt] });
    save(); render(); toast('✔ התפריט עודכן');
  });
  const upd = () => {
    const fd = new FormData(dlg.querySelector('form'));
    const uses = {}, amts = fd.getAll('amt').map(Number);
    fd.getAll('pid').forEach((pid, i) => { if (amts[i] > 0) uses[pid] = (uses[pid] || 0) + amts[i]; });
    $('#optNut').textContent = nutText(usesNutrition(uses));
  };
  dlg.querySelector('form').addEventListener('input', upd);
  dlg.querySelector('form').addEventListener('change', upd);
  dlg._upd = upd; upd();
}

function openProductDialog(pid) {
  const p = pid ? P(pid) : { name: '', unit: 'גרם', pkg: 500, pkgLabel: '', kcal: '', prot: '' };
  const isCustom = pid && state.customProducts[pid];
  const used = pid && menu().some(m => m.items.some(it => it.options.some(o => pid in o.uses)));
  const dlg = openDialog(`<h3>${pid ? 'עריכת מוצר' : 'מוצר חדש'}</h3>
    <label class="field">שם המוצר<input name="name" required maxlength="40" value="${esc(p.name)}"></label>
    <div class="row gap">
      <label class="field grow">יחידה<select name="unit">${UNITS.map(u => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label class="field grow">גודל חבילה<input name="pkg" type="number" min="0.01" step="any" required value="${p.pkg}"></label>
    </div>
    <label class="field">תיאור חבילה<input name="pkgLabel" maxlength="30" placeholder="לדוגמה: שקית 500 גרם" value="${esc(p.pkgLabel)}"></label>
    <div class="small muted" id="nutBase">ערכים תזונתיים ${nutLabel(p.unit)}:</div>
    <div class="row gap">
      <label class="field grow">קלוריות<input name="kcal" type="number" min="0" step="any" required value="${p.kcal}"></label>
      <label class="field grow">חלבון (ג׳)<input name="prot" type="number" min="0" step="any" required value="${p.prot}"></label>
    </div>
    <div class="row gap">
      <label class="field grow">מחיר ב${esc(state.settings.stores[0])}<input name="pa" type="number" min="0" step="0.1" value="${pid ? price(pid, 0) : ''}"></label>
      <label class="field grow">מחיר ב${esc(state.settings.stores[1])}<input name="pb" type="number" min="0" step="0.1" value="${pid ? price(pid, 1) : ''}"></label>
    </div>
    ${isCustom ? `<button type="button" class="btn link danger" data-act="delprod" data-pid="${pid}" ${used ? 'disabled title="המוצר בשימוש בתפריט"' : ''}>מחק מוצר${used ? ' (בשימוש בתפריט)' : ''}</button>` : ''}`, fd => {
    const f = {
      name: String(fd.get('name')).trim(), unit: fd.get('unit'), pkg: Number(fd.get('pkg')),
      pkgLabel: String(fd.get('pkgLabel')).trim() || `${fd.get('pkg')} ${fd.get('unit')}`,
      kcal: Number(fd.get('kcal')), prot: Number(fd.get('prot')),
    };
    if (!f.name || !(f.pkg > 0)) { toast('חסרים פרטים'); return; }
    const id = pid || newId('p_');
    if (PRODUCTS[id]) state.productEdits[id] = f;
    else state.customProducts[id] = { ...f, price: [0, 0] };
    state.prices[id] = [Number(fd.get('pa')) || 0, Number(fd.get('pb')) || 0];
    save(); render(); toast(pid ? '✔ המוצר עודכן' : '✔ מוצר נוסף');
  });
  dlg.querySelector('select[name=unit]').addEventListener('change', e => { $('#nutBase').textContent = `ערכים תזונתיים ${nutLabel(e.target.value)}:`; });
}

/* ---------- events ---------- */

document.addEventListener('click', e => {
  const nav = e.target.closest('nav button');
  if (nav) { tab = nav.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'water') addWater(Number(b.dataset.d));
  else if (act === 'eat') openMealDialog(b.dataset.meal);
  else if (act === 'unmark') unmarkMeal(b.dataset.meal);
  else if (act === 'notif') enableNotifications();
  else if (act === 'goto') { tab = b.dataset.tab; render(); }
  else if (act === 'ics') exportICS();
  else if (act === 'walk') addWalk(parseInt($('#walkMin').value, 10));
  else if (act === 'delwalk') { state.walks = state.walks.filter(w => String(w.at) !== b.dataset.at); save(); render(); }
  else if (act === 'addpkg') {
    const p = P(b.dataset.pid);
    state.inventory[b.dataset.pid] = (state.inventory[b.dataset.pid] || 0) + p.pkg;
    save(); render(); toast(`נוסף: ${p.pkgLabel} ${p.name}`);
  } else if (act === 'bought') {
    shoppingList().forEach(s => { state.inventory[s.pid] = s.qty + s.packs * P(s.pid).pkg; });
    save(); render(); toast('🛒 המלאי עודכן');
  } else if (act === 'setdef') {
    state.settings.defaults[b.dataset.item] = Number(b.dataset.i);
    save(); render();
  } else if (act === 'delopt') {
    const { item } = findItem(b.dataset.item);
    const i = Number(b.dataset.i), def = defaultOpt(item);
    if (!confirm(`למחוק את "${item.options[i].label}"?`)) return;
    item.options.splice(i, 1);
    state.settings.defaults[item.id] = def === i ? 0 : def > i ? def - 1 : def;
    save(); render();
  } else if (act === 'delitem') {
    const { meal, item } = findItem(b.dataset.item);
    if (!confirm('למחוק את הפריט וכל החלופות שלו?')) return;
    meal.items = meal.items.filter(x => x !== item);
    delete state.settings.defaults[item.id];
    save(); render();
  } else if (act === 'addopt') openOptionDialog(b.dataset.meal, b.dataset.item);
  else if (act === 'addrow') { $('#rows').insertAdjacentHTML('beforeend', useRow()); $('#dlg')._upd && $('#dlg')._upd(); }
  else if (act === 'delrow') {
    if (document.querySelectorAll('#rows .userow').length > 1) b.closest('.userow').remove();
    $('#dlg')._upd && $('#dlg')._upd();
  } else if (act === 'editprod') openProductDialog(b.dataset.pid);
  else if (act === 'delprod') {
    const pid = b.dataset.pid;
    if (!confirm(`למחוק את "${P(pid).name}"?`)) return;
    delete state.customProducts[pid]; delete state.prices[pid]; delete state.inventory[pid];
    $('#dlg').close(); save(); render();
  } else if (act === 'resetmenu') {
    if (confirm('לאפס את התפריט למקור? חלופות ופריטים שהוספת יימחקו (המוצרים יישארו).')) { state.menu = null; state.settings.defaults = {}; save(); render(); }
  } else if (act === 'weight') {
    const kg = parseFloat($('#kg').value);
    if (!(kg > 20 && kg < 400)) { toast('הזן משקל תקין'); return; }
    const date = dkey();
    state.weights = state.weights.filter(w => w.date !== date).concat({ date, kg });
    save(); render(); toast('⚖️ נשמר');
  } else if (act === 'delweight') {
    state.weights = state.weights.filter(w => w.date !== b.dataset.date); save(); render();
  } else if (act === 'export') {
    download(new Blob([JSON.stringify(state)], { type: 'application/json' }), `easyfit-backup-${dkey()}.json`);
  } else if (act === 'import') {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = async () => {
      try { const s = JSON.parse(await inp.files[0].text()); if (!s.settings) throw 0; localStorage.setItem(STORE_KEY, JSON.stringify(s)); state = loadState(); render(); toast('שוחזר ✔'); }
      catch (err) { toast('קובץ לא תקין'); }
    };
    inp.click();
  } else if (act === 'reset') {
    if (confirm('למחוק את כל הנתונים? לא ניתן לבטל.')) { state = defaultState(); save(); render(); }
  }
});

document.addEventListener('change', e => {
  const t = e.target, S = state.settings;
  if (t.closest('dialog')) return;
  if (t.dataset.inv) state.inventory[t.dataset.inv] = Math.max(0, parseFloat(t.value) || 0);
  else if (t.dataset.price) {
    const p = [price(t.dataset.price, 0), price(t.dataset.price, 1)];
    p[+t.dataset.store] = Math.max(0, parseFloat(t.value) || 0);
    state.prices[t.dataset.price] = p;
  } else if (t.dataset.time) S.times[t.dataset.time] = t.value;
  else if (t.dataset.storeName) S.stores[+t.dataset.storeName] = t.value.trim() || S.stores[+t.dataset.storeName];
  else if (t.dataset.set) {
    const k = t.dataset.set;
    if (t.type === 'checkbox') S[k] = t.checked;
    else if (t.type === 'number') S[k] = Math.max(+t.min || 0, Math.min(+t.max || 9999, parseInt(t.value, 10) || S[k]));
    else S[k] = t.value;
  } else return;
  save(); render();
});

/* ---------- boot ---------- */

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
checkReminders();
setInterval(() => { checkReminders(); if (document.visibilityState === 'visible' && !document.querySelector('input:focus, dialog[open]')) render(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkReminders(); render(); } });
