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
      notifications: false,
      lowStockTime: '18:00',
      shopDays: 7,
      stores: ['שופרסל', 'רמי לוי'],
      defaults: {},            // itemId -> option index
    },
    inventory: {},             // productId -> qty (in product units)
    prices: {},                // productId -> [storeA, storeB]
    log: {},                   // dateKey -> { meals: {mealId: {choices, deducted, at}}, water }
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

function dayLog(k = dkey()) {
  if (!state.log[k]) state.log[k] = { meals: {}, water: 0 };
  return state.log[k];
}

function activeMeals() {
  return MEALS.filter(m => !m.optional || state.settings.nightMeal)
    .map(m => ({ ...m, time: state.settings.times[m.id] || m.time }))
    .sort((a, b) => toMin(a.time) - toMin(b.time));
}

function defaultOpt(item) {
  const i = state.settings.defaults[item.id];
  return Number.isInteger(i) && item.options[i] ? i : 0;
}

function price(pid, store) {
  const p = state.prices[pid];
  return p && typeof p[store] === 'number' ? p[store] : PRODUCTS[pid].price[store];
}

/* ---------- inventory math ---------- */

function dailyUse() {
  const use = {};
  activeMeals().forEach(m => m.items.forEach(it => {
    const opt = it.options[defaultOpt(it)];
    for (const [pid, amt] of Object.entries(opt.uses)) use[pid] = (use[pid] || 0) + amt;
  }));
  return use;
}

function stockStatus() {
  const use = dailyUse();
  return Object.keys(PRODUCTS).map(pid => {
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
      const P = PRODUCTS[s.pid];
      const deficit = s.perDay * days - s.qty;
      const packs = Math.max(1, Math.ceil(deficit / P.pkg - 1e-9));
      // urgent only for items whose stock was actually entered
      return { ...s, packs, urgent: s.daysLeft <= 1 && s.pid in state.inventory };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ---------- actions ---------- */

function markMeal(mealId, choices) {
  const meal = MEALS.find(m => m.id === mealId);
  const deducted = {};
  meal.items.forEach(it => {
    const opt = it.options[choices[it.id] ?? defaultOpt(it)];
    for (const [pid, amt] of Object.entries(opt.uses)) {
      const have = state.inventory[pid] || 0;
      const take = Math.min(have, amt);
      state.inventory[pid] = have - take;
      deducted[pid] = (deducted[pid] || 0) + take;
    }
  });
  dayLog().meals[mealId] = { choices, deducted, at: Date.now() };
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

/* ---------- reminders ---------- */

function waterTimes() {
  const s = toMin(state.settings.waterStart), e = toMin(state.settings.waterEnd);
  const n = state.settings.waterTarget;
  if (n <= 1) return [s];
  return Array.from({ length: n }, (_, i) => Math.round(s + (e - s) * i / (n - 1)));
}

function buildReminders() {
  const L = dayLog();
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
      body: `כוס ${i + 1} מתוך ${state.settings.waterTarget}`, pending: () => (L.water || 0) <= i });
  });
  list.push({ id: 'stock', at: toMin(state.settings.lowStockTime), title: '🛒 תזכורת קניות',
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
      if (r.id === 'stock') body = 'מחר ייגמר: ' + shoppingList().filter(s => s.urgent).map(s => PRODUCTS[s.pid].name).join(', ');
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
  const events = [];
  activeMeals().forEach(m => events.push(ev(`meal-${m.id}`, toMin(m.time), `${m.emoji} ${m.name}`,
    m.items.map(it => '• ' + it.options.map(o => o.label).join(' / ')).join('\n'))));
  waterTimes().forEach((t, i) => events.push(ev(`water-${i}`, t, `💧 כוס מים ${i + 1}/${state.settings.waterTarget}`, 'זמן לשתות כוס מים')));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EasyFit//HE', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'easyfit-reminders.ics'; a.click();
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
  const views = { today: renderToday, shop: renderShop, stock: renderStock, track: renderTrack, settings: renderSettings };
  $('#view').innerHTML = views[tab]();
  const badge = shoppingList().filter(s => s.urgent).length;
  $('#shopBadge').textContent = badge || '';
  $('#shopBadge').hidden = !badge;
}

function renderToday() {
  const L = dayLog();
  const meals = activeMeals();
  const done = meals.filter(m => L.meals[m.id]).length;
  const target = state.settings.waterTarget;
  const water = L.water || 0;
  const m = nowMin();
  const next = meals.find(x => !L.meals[x.id] && toMin(x.time) + 90 >= m);
  const urgent = shoppingList().filter(s => s.urgent);
  const date = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const tip = TIPS[new Date().getDate() % TIPS.length];

  let html = `<h2 class="date">${esc(date)}</h2>`;

  if (!state.settings.notifications) {
    html += `<div class="banner"><span>🔔 הפעל התראות כדי לקבל תזכורות לארוחות ולמים</span><button class="btn small" data-act="notif">הפעל</button></div>`;
  }
  if (!Object.keys(state.inventory).length) {
    html += `<div class="banner"><span>📦 הזן את הכמויות שיש לך בבית כדי שנזכיר לך לקנות בזמן</span><button class="btn small" data-act="goto" data-tab="stock">למלאי</button></div>`;
  }
  if (urgent.length) {
    html += `<div class="banner warn"><span>🛒 מחר ייגמר: ${urgent.map(s => esc(PRODUCTS[s.pid].name)).join(', ')}</span><button class="btn small" data-act="goto" data-tab="shop">לקניות</button></div>`;
  }

  html += `<section class="summary">
    <div class="stat"><div class="ring" style="--p:${done / meals.length * 100}"><b>${done}/${meals.length}</b></div><span>ארוחות</span></div>
    <div class="stat"><div class="ring water" style="--p:${Math.min(100, water / target * 100)}"><b>${water}/${target}</b></div><span>כוסות מים</span></div>
  </section>`;

  html += `<section class="card water-card">
    <div class="row"><h3>💧 מים</h3><span class="muted">${water >= target ? 'יעד הושג! 🎉' : `נשארו ${target - water} כוסות`}</span></div>
    <div class="glasses">${Array.from({ length: target }, (_, i) => `<span class="glass ${i < water ? 'full' : ''}"></span>`).join('')}</div>
    <div class="row gap"><button class="btn ghost" data-act="water" data-d="-1" aria-label="הורד כוס">−</button>
    <button class="btn primary grow" data-act="water" data-d="1">שתיתי כוס מים ✔</button></div>
  </section>`;

  meals.forEach(meal => {
    const rec = L.meals[meal.id];
    const isNext = next && next.id === meal.id;
    const late = !rec && toMin(meal.time) + 60 < m;
    html += `<section class="card meal ${rec ? 'done' : ''} ${isNext ? 'next' : ''}">
      <div class="row"><h3>${meal.emoji} ${esc(meal.name)}${meal.optional ? ' <small class="muted">(אופציונלי)</small>' : ''}</h3>
      <span class="time ${late ? 'late' : ''}">${esc(meal.time)}</span></div>
      <ul>${meal.items.map(it => {
        const idx = rec ? (rec.choices[it.id] ?? defaultOpt(it)) : defaultOpt(it);
        const alt = it.options.length > 1 && !rec ? ` <small class="muted">(+${it.options.length - 1} חלופות)</small>` : '';
        return `<li>${esc(it.options[idx].label)}${alt}</li>`;
      }).join('')}</ul>
      ${rec
        ? `<div class="row"><span class="ok">✔ נאכל ב-${new Date(rec.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span><button class="btn link" data-act="unmark" data-meal="${meal.id}">בטל</button></div>`
        : `<button class="btn ${isNext ? 'primary' : 'outline'} full" data-act="eat" data-meal="${meal.id}">אכלתי ✔</button>`}
    </section>`;
  });

  html += `<p class="tip">💡 ${esc(tip)}</p>`;
  return html;
}

function renderStock() {
  const rows = stockStatus().sort((a, b) => (b.perDay > 0) - (a.perDay > 0) || a.daysLeft - b.daysLeft);
  let html = `<h2>📦 מלאי בבית</h2>
    <p class="muted">הזן כמה יש לך מכל מוצר. האפליקציה מורידה מהמלאי אוטומטית כשאתה מסמן ארוחה, ומזכירה לך יום לפני שמשהו נגמר.</p>`;
  html += rows.map(s => {
    const P = PRODUCTS[s.pid];
    const days = s.perDay ? (s.daysLeft === 0 ? 'נגמר' : `~${Math.floor(s.daysLeft)} ימים`) : 'לא בתפריט הנוכחי';
    const cls = !s.perDay ? 'idle' : s.daysLeft <= 1 ? 'bad' : s.daysLeft <= 3 ? 'mid' : 'good';
    return `<div class="stock-row ${cls}">
      <div class="grow"><b>${esc(P.name)}</b><div class="muted small">${s.perDay ? `צריכה: ${fmtQty(s.perDay, P.unit)}/יום · ` : ''}<span class="days">${days}</span></div></div>
      <div class="qty"><input type="number" inputmode="decimal" min="0" step="any" value="${+s.qty.toFixed(2)}" data-inv="${s.pid}" aria-label="כמות ${esc(P.name)}"><span class="small muted">${esc(P.unit)}</span></div>
      <button class="btn small ghost" data-act="addpkg" data-pid="${s.pid}" title="הוסף ${esc(P.pkgLabel)}">+${esc(P.pkgLabel.split(' ')[0])}</button>
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
    const P = PRODUCTS[s.pid];
    const a = price(s.pid, 0) * s.packs, b = price(s.pid, 1) * s.packs;
    totA += a; totB += b; totSplit += Math.min(a, b);
    return `<tr class="${s.urgent ? 'urgent' : ''}">
      <td><b>${esc(P.name)}</b>${s.urgent ? ' <span class="tag">נגמר מחר</span>' : ''}<div class="small muted">${s.packs} × ${esc(P.pkgLabel)}</div></td>
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
    ${Object.entries(PRODUCTS).map(([pid, P]) => `<tr><td>${esc(P.name)}<div class="small muted">${esc(P.pkgLabel)}</div></td>
      <td><input type="number" inputmode="decimal" step="0.1" min="0" value="${price(pid, 0)}" data-price="${pid}" data-store="0"></td>
      <td><input type="number" inputmode="decimal" step="0.1" min="0" value="${price(pid, 1)}" data-price="${pid}" data-store="1"></td></tr>`).join('')}
    </tbody></table></details>`;
}

function renderTrack() {
  const meals = activeMeals();
  const target = state.settings.waterTarget;
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
  html += `</section><section class="card"><h3>🗓️ 14 הימים האחרונים</h3><table class="hist"><thead><tr><th>יום</th><th>ארוחות</th><th>מים</th><th></th></tr></thead><tbody>`;
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const L = state.log[dkey(d)] || { meals: {}, water: 0 };
    const md = meals.filter(m => L.meals[m.id]).length;
    const pct = Math.round(((md / meals.length) + Math.min(1, (L.water || 0) / target)) / 2 * 100);
    html += `<tr><td>${d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</td>
      <td>${md}/${meals.length}</td><td>${L.water || 0}/${target}</td>
      <td><div class="bar"><i style="width:${pct}%"></i></div></td></tr>`;
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
  return `<h2>⚙️ הגדרות</h2>
  <section class="card"><h3>🔔 תזכורות</h3>
    <div class="row"><span>התראות בדפדפן</span>${S.notifications ? '<span class="ok">פעיל ✔</span>' : '<button class="btn small" data-act="notif">הפעל</button>'}</div>
    <p class="small muted">התראות מהאפליקציה עובדות כשהיא פתוחה או ברקע. לתזכורות שעובדות תמיד (גם כשהטלפון נעול והאפליקציה סגורה) — הוסף אותן ליומן:</p>
    <button class="btn outline full" data-act="ics">📅 הוסף תזכורות ליומן בטלפון</button>
  </section>
  <section class="card"><h3>⏰ שעות ארוחות</h3>
    ${MEALS.map(m => `<label class="row"><span>${m.emoji} ${esc(m.name)}</span><input type="time" value="${esc(S.times[m.id])}" data-time="${m.id}"></label>`).join('')}
    <label class="row"><span>לכלול ארוחת לילה</span><input type="checkbox" ${S.nightMeal ? 'checked' : ''} data-set="nightMeal"></label>
  </section>
  <section class="card"><h3>💧 מים</h3>
    <label class="row"><span>כוסות ביום</span><input type="number" min="1" max="20" value="${S.waterTarget}" data-set="waterTarget"></label>
    <label class="row"><span>תזכורת ראשונה</span><input type="time" value="${S.waterStart}" data-set="waterStart"></label>
    <label class="row"><span>תזכורת אחרונה</span><input type="time" value="${S.waterEnd}" data-set="waterEnd"></label>
  </section>
  <section class="card"><h3>🍽️ ברירות מחדל בתפריט</h3>
    <p class="small muted">מה אתה אוכל בדרך כלל — משפיע על חישוב המלאי ורשימת הקניות.</p>
    ${MEALS.flatMap(m => m.items.filter(it => it.options.length > 1).map(it => `<label class="row"><span class="small">${m.emoji}</span>
      <select data-default="${it.id}" class="grow">${it.options.map((o, i) => `<option value="${i}" ${defaultOpt(it) === i ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`)).join('')}
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

/* ---------- meal dialog ---------- */

function openMealDialog(mealId) {
  const meal = MEALS.find(m => m.id === mealId);
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog">
    <h3>${meal.emoji} מה אכלת ב${esc(meal.name)}?</h3>
    ${meal.items.map(it => `<fieldset>${it.options.map((o, i) => `<label class="opt"><input type="radio" name="${it.id}" value="${i}" ${defaultOpt(it) === i ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}</fieldset>`).join('')}
    <div class="row gap"><button value="cancel" class="btn ghost">ביטול</button><button value="ok" class="btn primary grow">סמן שאכלתי ✔</button></div>
  </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const fd = new FormData(dlg.querySelector('form'));
    const choices = {};
    meal.items.forEach(it => { choices[it.id] = Number(fd.get(it.id) ?? defaultOpt(it)); });
    markMeal(mealId, choices);
  };
  dlg.returnValue = '';
  dlg.showModal();
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
  else if (act === 'addpkg') {
    const P = PRODUCTS[b.dataset.pid];
    state.inventory[b.dataset.pid] = (state.inventory[b.dataset.pid] || 0) + P.pkg;
    save(); render(); toast(`נוסף: ${P.pkgLabel} ${P.name}`);
  } else if (act === 'bought') {
    shoppingList().forEach(s => { state.inventory[s.pid] = s.qty + s.packs * PRODUCTS[s.pid].pkg; });
    save(); render(); toast('🛒 המלאי עודכן');
  } else if (act === 'weight') {
    const kg = parseFloat($('#kg').value);
    if (!(kg > 20 && kg < 400)) { toast('הזן משקל תקין'); return; }
    const date = dkey();
    state.weights = state.weights.filter(w => w.date !== date).concat({ date, kg });
    save(); render(); toast('⚖️ נשמר');
  } else if (act === 'delweight') {
    state.weights = state.weights.filter(w => w.date !== b.dataset.date); save(); render();
  } else if (act === 'export') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `easyfit-backup-${dkey()}.json`; a.click();
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
  if (t.dataset.inv) state.inventory[t.dataset.inv] = Math.max(0, parseFloat(t.value) || 0);
  else if (t.dataset.price) {
    const p = state.prices[t.dataset.price] || [price(t.dataset.price, 0), price(t.dataset.price, 1)];
    p[+t.dataset.store] = Math.max(0, parseFloat(t.value) || 0);
    state.prices[t.dataset.price] = p;
  } else if (t.dataset.time) S.times[t.dataset.time] = t.value;
  else if (t.dataset.default) S.defaults[t.dataset.default] = Number(t.value);
  else if (t.dataset.storeName) S.stores[+t.dataset.storeName] = t.value.trim() || S.stores[+t.dataset.storeName];
  else if (t.dataset.set) {
    const k = t.dataset.set;
    if (t.type === 'checkbox') S[k] = t.checked;
    else if (t.type === 'number') S[k] = Math.max(+t.min || 0, Math.min(+t.max || 999, parseInt(t.value, 10) || S[k]));
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
