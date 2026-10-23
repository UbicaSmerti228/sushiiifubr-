(() => {
'use strict';
const $ = s => document.querySelector(s);
const view = $('#view');
const KEY = 'fudkost:v1';
const TEST = /[?&]test\b/.test(location.search);

/* =========================================================================
   Данные
   Общие для всех точек: продукты и блюда (техкарты).
   У каждой точки свои: продажи, остатки, постоянные расходы, каналы продаж,
   эквайринг, доставка, налоги, план закупки.
   ========================================================================= */
const UNITS = { 'кг': { per: 'г', k: 1000 }, 'л': { per: 'мл', k: 1000 }, 'шт': { per: 'шт', k: 1 } };
const uid = () => Math.random().toString(36).slice(2, 9);

function newPoint(name) {
  return {
    id: uid(), name,
    sales: { days: 30, qty: {} },
    fixed: [],                                    // постоянные расходы в месяц
    channels: [],                                 // агрегаторы: { name, share %, fee % }
    pay: { share: 0, fee: 0 },                    // оплата картой и СБП: доля %, комиссия %
    delivery: { check: 0, share: 0, cost: 0 },    // средний чек, доля заказов с доставкой %, цена одной доставки
    tax: { mode: 'none', rate: 6, reduce: 0, fixed: 0, vat: 0, entity: 'ip' },
    plan: { days: 7, reserve: 10 },
    moves: [],                                    // склад: приходы, списания, продажи, инвентаризации
    shifts: [],                                   // кассовые смены
    staff: [],                                    // сотрудники и условия оплаты
    paid: []                                      // выплаты зарплаты
  };
}

// пустая база для нового заведения
function blank() {
  return migrate({ v: 3, org: '', target: 35, round: '10', ing: [], dishes: [], points: [newPoint('Основная точка')] });
}

// старые сохранения (без точек, с категориями) поднимаются до текущей версии
function migrate(d) {
  d.target = +d.target || 35;
  d.round = d.round || '10';
  d.org = d.org || '';
  d.ing = d.ing || []; d.dishes = d.dishes || [];
  d.ing.forEach(i => { i.hist = i.hist || []; i.waste = +i.waste || 0; i.ctrl = i.ctrl || ''; });
  d.dishes.forEach(x => {
    if (x.category === 'Роллы только в сетах') x.setOnly = true;
    delete x.category;
    x.parts = x.parts || []; x.sub = x.sub || [];
    x.pack = +x.pack || 0; x.yield = +x.yield || 0;
  });
  if (!Array.isArray(d.points) || !d.points.length) {
    const p = newPoint('Основная точка');
    if (d.sales) p.sales = { days: +d.sales.days || 30, qty: d.sales.qty || {} };
    if (d.stock) p.stock = d.stock;
    if (d.fixed) p.fixed = d.fixed;
    if (d.plan) p.plan = d.plan;
    if (d.channel && +d.channel.share) p.channels = [{ name: 'Агрегатор', share: +d.channel.share, fee: +d.channel.fee || 0 }];
    d.points = [p];
  }
  for (const k of ['sales', 'stock', 'fixed', 'plan', 'channel']) delete d[k];
  d.points = d.points.map(p => Object.assign(newPoint(p.name || 'Точка'), p, {
    sales: Object.assign({ days: 30, qty: {} }, p.sales),
    pay: Object.assign({ share: 0, fee: 0 }, p.pay),
    delivery: Object.assign({ check: 0, share: 0, cost: 0 }, p.delivery),
    tax: Object.assign({ mode: 'none', rate: 6, reduce: 0, fixed: 0, vat: 0, entity: 'ip' }, p.tax),
    plan: Object.assign({ days: 7, reserve: 10 }, p.plan),
    moves: p.moves || [], shifts: p.shifts || [], staff: p.staff || [], paid: p.paid || []
  }));
  // остатки из старой «Сверки» становятся первой инвентаризацией
  for (const p of d.points) {
    if (p.stock) {
      const lines = Object.entries(p.stock).filter(([, v]) => v && (v.now !== undefined || v.end !== undefined))
        .map(([ing, v]) => ({ ing, qty: +(v.now !== undefined ? v.now : v.end) || 0, expected: +(v.now !== undefined ? v.now : v.end) || 0 }));
      if (lines.length && !p.moves.length) { const t = new Date(); p.moves.push({ id: uid(), t: Date.now(), date: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`, type: 'inv', lines }); }
      delete p.stock;
    }
    p.fixed.forEach(f => { f.day = +f.day || 0; });
  }
  if (!d.points.some(p => p.id === d.cur)) d.cur = d.points[0].id;
  d.v = 3;
  return d;
}

let db = null; // загружается в самом конце, когда все функции объявлены
let saveFail = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); saveFail = false; }
  catch (e) { if (!saveFail) note('Браузер не даёт сохранять данные. Всё работает, но после закрытия вкладки пропадёт: сохраните данные в «Настройках».'); saveFail = true; }
}
const P = () => db.points.find(p => p.id === db.cur) || db.points[0];

/* =========================================================================
   Расчёт
   ========================================================================= */
const ingById = id => db.ing.find(i => i.id === id);
const dishById = id => db.dishes.find(d => d.id === id);
const wasteK = i => 1 - Math.min(95, Math.max(0, +i.waste || 0)) / 100;
const packOf = i => +i.qty > 0 ? (+i.price || 0) / +i.qty : 0;     // ₽ за кг / л / шт по накладной
const toUnit = (v, i) => v / UNITS[i.unit].k;                        // г → кг, мл → л

// цена грамма (мл, штуки) нетто: с учётом отхода при обработке
function unitPrice(i) {
  if (!(+i.qty > 0)) return 0;
  return (+i.price || 0) / (+i.qty * UNITS[i.unit].k) / wasteK(i);
}
// себестоимость; упаковка считается только у того, что продаётся, а не у роллов внутри набора
function cost(d, withPack = true, seen = new Set()) {
  if (seen.has(d.id)) return NaN;
  seen.add(d.id);
  let s = 0;
  for (const p of d.parts) { const i = ingById(p.ing); if (i) s += unitPrice(i) * (+p.qty || 0); }
  for (const x of d.sub) { const sd = dishById(x.dish); if (sd) s += cost(sd, false, new Set(seen)) * (+x.n || 0); }
  return s + (withPack ? +d.pack || 0 : 0);
}
const hasRecipe = d => d.parts.length > 0 || d.sub.length > 0;
const isSet = d => d.sub.length > 0;
function missingIn(d, seen = new Set(), out = new Set()) {
  if (seen.has(d.id)) return out; seen.add(d.id);
  for (const x of d.sub) { const sd = dishById(x.dish); if (!sd) continue; if (!hasRecipe(sd)) out.add(sd); else missingIn(sd, seen, out); }
  return out;
}
function usesIng(d, id, seen = new Set()) {
  if (seen.has(d.id)) return false; seen.add(d.id);
  return d.parts.some(p => p.ing === id) || d.sub.some(x => { const sd = dishById(x.dish); return sd && usesIng(sd, id, seen); });
}
const usesDish = (d, id) => d.sub.some(x => x.dish === id);

// Доли от цены, которые уходят с каждой продажи: агрегатор, эквайринг, доставка, НДС, УСН «доходы».
function rates(pt) {
  const n = v => Math.max(0, +v || 0) / 100;
  const chShare = Math.min(1, pt.channels.reduce((a, c) => a + n(c.share), 0));
  const ch = pt.channels.reduce((a, c) => a + n(c.share) * n(c.fee), 0);
  const own = 1 - chShare;                                   // заказы через свой сайт, телефон, зал
  const acq = own * n(pt.pay.share) * n(pt.pay.fee);         // агрегатор платит сам, эквайринг только на свои заказы
  const del = +pt.delivery.check > 0 ? own * n(pt.delivery.share) * (+pt.delivery.cost || 0) / +pt.delivery.check : 0;
  const v = +pt.tax.vat || 0, vat = v ? v / (100 + v) : 0;   // НДС сидит внутри цены
  const usn = pt.tax.mode === 'usn6' ? n(pt.tax.rate) * (1 - vat) : 0;
  return { ch, own, acq, del, vat, usn, total: ch + acq + del + vat + usn };
}
function roundPrice(p) {
  if (!isFinite(p) || p <= 0) return 0;
  if (db.round === '90') return Math.ceil((p + 10) / 100) * 100 - 10;
  if (db.round === '50') return Math.ceil(p / 50) * 50;
  return Math.ceil(p / 10) * 10;
}
function stats(d, pt = P()) {
  const c = cost(d), price = +d.price || 0, miss = [...missingIn(d)], r = rates(pt);
  return {
    c, price, miss, empty: !hasRecipe(d), blank: !hasRecipe(d) || miss.length > 0,
    fc: price ? c / price * 100 : NaN,
    margin: price - c,                                   // цена минус продукты и упаковка
    eff: price * (1 - r.total) - c,                      // остаётся после комиссий, доставки и налогов с выручки
    rec: roundPrice(c / (db.target / 100)),              // цена под цель по фудкосту
    min: r.total < 1 ? Math.ceil(c / (1 - r.total)) : NaN // ниже этой цены каждая продажа в минус
  };
}
// расход продуктов на порцию до обработки (брутто), в г / мл / шт
function usage(d, mult = 1, out = new Map(), seen = new Set()) {
  if (seen.has(d.id)) return out;
  const s2 = new Set(seen); s2.add(d.id);
  for (const p of d.parts) { const i = ingById(p.ing); if (i) out.set(i.id, (out.get(i.id) || 0) + (+p.qty || 0) / wasteK(i) * mult); }
  for (const x of d.sub) { const sd = dishById(x.dish); if (sd) usage(sd, mult * (+x.n || 0), out, s2); }
  return out;
}
const qtyOf = (d, pt = P()) => +pt.sales.qty[d.id] || 0;
function salesUsage(pt, scale = 1) {
  const out = new Map();
  for (const d of db.dishes) { const q = qtyOf(d, pt); if (q) usage(d, q * scale, out); }
  return out;
}

// Деньги точки за период продаж
function econ(pt) {
  const D = +pt.sales.days || 30, r = rates(pt);
  let qty = 0, rev = 0, food = 0, effSum = 0; const skipped = [];
  for (const d of db.dishes) {
    const q = qtyOf(d, pt); if (!q) continue;
    const s = stats(d, pt);
    if (s.blank || !s.price || !isFinite(s.c)) { skipped.push(d); continue; }
    qty += q; rev += q * s.price; food += q * s.c; effSum += q * s.eff;
  }
  const agg = rev * r.ch, acq = rev * r.acq, del = rev * r.del, vat = rev * r.vat;
  const fixed = pt.fixed.reduce((a, f) => a + (+f.sum || 0), 0) * D / 30;
  const inc = rev - vat;                                // доход для УСН: без НДС
  const t = pt.tax, rate = Math.max(0, +t.rate || 0) / 100;
  let tax = 0, taxNote = '', red = 0;
  if (t.mode === 'usn6') {
    const full = inc * rate; red = Math.min(full, (+t.reduce || 0) * D / 30);
    tax = full - red; taxNote = red ? `${pct(rate * 100)} с дохода минус ${rub(red)} взносов` : `${pct(rate * 100)} с дохода`;
  } else if (t.mode === 'usn15') {
    const base = inc - food - agg - acq - del - fixed, byBase = Math.max(0, base) * rate, minimal = inc * 0.01;
    tax = Math.max(byBase, minimal); taxNote = byBase >= minimal ? `${pct(rate * 100)} с разницы доходов и расходов` : 'минимальный налог 1% с дохода';
  } else if (t.mode === 'fixed') { tax = (+t.fixed || 0) * D / 30; taxNote = 'фиксированная сумма'; }
  const gross = rev - food - agg - acq - del - vat;
  const net = gross - fixed - tax;
  const avgEff = qty ? effSum / qty : 0;
  // точка безубыточности: постоянные расходы и та часть налога, что не зависит от продаж
  const fixedPart = fixed + (t.mode === 'fixed' ? tax : 0) - red;
  const be = avgEff > 0 ? Math.ceil(Math.max(0, fixedPart) / avgEff) : NaN;
  return { D, r, qty, rev, food, agg, acq, del, vat, fixed, tax, taxNote, gross, net, avgEff, be, skipped, annual: rev * 365 / D };
}

/* =========================================================================
   Формат и мелочи
   ========================================================================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rub = (n, d = 0) => isFinite(n) ? n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ₽' : '—';
const mln = n => (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн ₽';
const pct = n => isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString('ru-RU') + '%' : '—';
const num = n => isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '';
const parseNum = s => +String(s).replace(',', '.').replace(/\s/g, '') || 0;
const plural = (n, a, b, c) => { n = Math.abs(Math.round(n)); const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const key = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
const fmtQ = (v, i) => {
  if (!isFinite(v)) return '—';
  const f = i.unit === 'шт' ? 10 : 100;
  return (Math.round(v * f) / f).toLocaleString('ru-RU') + ' ' + i.unit;
};
const noSales = () => `<div class="card"><p>В точке «${esc(P().name)}» пока нет продаж. Внесите, сколько чего продали за период, во вкладке <a href="#sales">«Продажи»</a>: отсюда считаются анализ, сверка и закупка.</p></div>`;
function copyText(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = t, 1500); };
  const manual = () => note('Скопируйте вручную:<br><textarea readonly rows="6" style="width:100%;margin-top:8px" onfocus="this.select()">' + esc(text) + '</textarea>');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, manual); else manual();
}
function note(html, acts = []) {
  const n = $('#notice');
  n.innerHTML = `<div class="notice-in"><div>${html}</div><div class="acts">${acts.length
    ? acts.map((a, i) => `<button data-i="${i}" class="${i ? 'ghost' : 'main'}">${esc(a[0])}</button>`).join('')
    : '<button data-i="x" class="ghost">Закрыть</button>'}</div></div>`;
  n.hidden = false;
  n.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i !== 'x') acts[+b.dataset.i][1]();
    n.hidden = true;
  };
}
const keepScroll = fn => { const y = scrollY; fn(); scrollTo(0, y); };
const refocus = sel => { const i = $(sel); if (i) { i.focus(); const l = i.value.length; try { i.setSelectionRange(l, l); } catch (e) {} } };

/* =========================================================================
   Меню
   ========================================================================= */
let menuState = { q: '', show: 'all', sort: 'name' };
function renderMenu() {
  const pt = P();
  const all = db.dishes.map(d => ({ d, s: stats(d, pt) }));
  const over = all.filter(x => !x.s.blank && x.s.fc > db.target).length;
  const loss = all.filter(x => !x.s.blank && x.s.price && x.s.eff < 0).length;
  const empty = all.filter(x => x.s.empty).length;
  const q = key(menuState.q);
  const show = {
    all: () => true, sets: x => isSet(x.d), single: x => !isSet(x.d),
    empty: x => x.s.blank, over: x => !x.s.blank && x.s.fc > db.target, loss: x => !x.s.blank && x.s.price && x.s.eff < 0
  }[menuState.show];
  const list = all.filter(x => (!q || key(x.d.name).includes(q)) && show(x));
  const sorts = {
    name: (a, b) => a.d.name.localeCompare(b.d.name, 'ru'),
    fc: (a, b) => (b.s.blank ? -1 : b.s.fc || 0) - (a.s.blank ? -1 : a.s.fc || 0),
    eff: (a, b) => (a.s.blank ? 1e9 : a.s.eff) - (b.s.blank ? 1e9 : b.s.eff)
  };
  list.sort(sorts[menuState.sort]);

  const rows = list.map(({ d, s }) => `<tr class="row${!s.blank && s.fc > db.target ? ' over' : ''}" data-id="${d.id}">
      <td>${esc(d.name)}${isSet(d) ? ` <span class="tag">набор из ${d.sub.reduce((a, x) => a + (+x.n || 0), 0)}</span>` : ''}${d.setOnly ? ' <span class="tag">только в наборах</span>' : ''}</td>
      <td class="r">${s.price ? rub(s.price) : '<span class="muted">нет цены</span>'}</td>
      <td class="r">${s.empty ? '<span class="muted">нет состава</span>' : s.miss.length ? `<span class="muted">нет состава у ${s.miss.length}</span>` : rub(s.c)}</td>
      <td class="r fc">${s.blank || !s.price ? '' : pct(Math.round(s.fc))}</td>
      <td class="r hide-m ${!s.blank && s.price && s.eff < 0 ? 'bad' : ''}">${s.blank || !s.price ? '' : rub(s.eff)}</td></tr>`).join('');

  const emptyMenu = !db.dishes.length ? `<div class="card"><h2>Меню пока пустое</h2>
      <p>Начните с продуктов: во вкладке <a href="#products">«Продукты»</a> заведите то, что закупаете, с ценой из накладной. Потом добавьте блюда и их состав.</p>
      <p class="muted">Если у вас есть сайт доставки с файлом <code>menu.json</code>, загрузите его в <a href="#settings">«Настройках»</a>: блюда, цены и наборы подтянутся сами.</p></div>` : '';
  view.innerHTML = `
    <div class="head"><h1>Меню</h1><button class="main" id="add">Добавить блюдо</button></div>
    ${emptyMenu}
    <p class="lead"${db.dishes.length ? '' : ' hidden'}>${db.dishes.length} ${plural(db.dishes.length, 'позиция', 'позиции', 'позиций')}.
      ${over ? `<b class="bad">${over}</b> дороже цели ${db.target}% по фудкосту.` : `Все посчитанные блюда укладываются в ${db.target}%.`}
      ${loss ? `<b class="bad">${loss}</b> продаются в убыток после комиссий и налогов.` : ''}
      ${empty ? `У ${empty} не заполнен состав.` : ''}
</p>
    <div class="card"${db.dishes.length ? '' : ' hidden'}>
      <div class="bar">
        <input type="search" id="q" placeholder="Найти блюдо" value="${esc(menuState.q)}">
        <select id="show">
          <option value="all">Все блюда</option><option value="single">Без наборов</option><option value="sets">Только наборы</option>
          <option value="over">Дороже цели</option><option value="loss">В убыток</option><option value="empty">Без состава</option>
        </select>
        <select id="sort"><option value="name">По алфавиту</option><option value="fc">Сначала высокий фудкост</option><option value="eff">Сначала мало остаётся</option></select>
      </div>
      <div class="tw"><table>
        <thead><tr><th>Блюдо</th><th class="r">Цена</th><th class="r"><span class="hide-m">Себестоимость</span><span class="show-m">Себест.</span></th><th class="r">Фудкост</th><th class="r hide-m">Остаётся</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">Ничего не нашлось.</td></tr>'}</tbody>
      </table></div>
      <p class="small muted">«Остаётся» — сколько рублей с порции остаётся после продуктов, упаковки, комиссий, эквайринга, доставки и налогов с выручки точки «${esc(pt.name)}». Из этого платятся аренда и зарплаты.</p>
    </div>`;
  $('#show').value = menuState.show; $('#sort').value = menuState.sort;
  $('#q').oninput = e => { menuState.q = e.target.value; renderMenu(); refocus('#q'); };
  $('#show').onchange = e => { menuState.show = e.target.value; renderMenu(); };
  $('#sort').onchange = e => { menuState.sort = e.target.value; renderMenu(); };
  $('#add').onclick = () => {
    const d = { id: uid(), name: 'Новое блюдо', price: 0, pack: 0, yield: 0, parts: [], sub: [] };
    db.dishes.push(d); save(); location.hash = '#dish/' + d.id;
  };
  view.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr.row'); if (tr) location.hash = '#dish/' + tr.dataset.id; };
}

/* =========================================================================
   Блюдо (техкарта)
   ========================================================================= */
function renderDish(id) {
  const d = dishById(id);
  if (!d) { location.hash = '#menu'; return; }
  const pt = P();
  const ingOpts = sel => db.ing.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(i => `<option value="${i.id}"${i.id === sel ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
  const dishOpts = sel => db.dishes.filter(x => x.id !== d.id).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  const usedIn = db.dishes.filter(x => usesDish(x, d.id));

  view.innerHTML = `
    <a class="back no-print" href="#menu">К меню</a>
    <div class="print-only ttk-head">
      <p><b>Технологическая карта</b>${db.org ? ` · ${esc(db.org)}` : ''}</p>
      <p>Дата: ${new Date().toLocaleDateString('ru-RU')}</p>
    </div>
    <div class="card">
      <div class="dish-head">
        <label class="wide">Название <input id="dn" value="${esc(d.name)}"></label>
        <label>Цена, ₽ <input id="dp" type="number" min="0" step="10" value="${+d.price || ''}"></label>
        <label>Упаковка, ₽ <input id="dk" type="number" min="0" step="1" value="${+d.pack || 0}"></label>
        <label>Выход, г <input id="dy" type="number" min="0" step="5" value="${+d.yield || ''}" placeholder="вес готового"></label>
      </div>
      <label class="check no-print"><input type="checkbox" id="dso"${d.setOnly ? ' checked' : ''}> продаётся только в составе наборов</label>
      <dl class="sum" id="sum"></dl>
      <p class="advice" id="advice"></p>
      <p class="muted small" id="sold"></p>
    </div>

    <div class="card">
      <h2>Состав</h2>
      <p class="muted small no-print">Нетто — сколько продукта идёт в блюдо после чистки и разделки. Брутто считается по проценту отхода из «Продуктов».</p>
      <div class="tw"><table class="edit">
        <thead><tr><th>Продукт</th><th class="r">Брутто</th><th class="r">Нетто</th><th class="r hide-m">Цена</th><th class="r">Стоимость</th><th class="no-print"></th></tr></thead>
        <tbody id="parts">${d.parts.map((p, k) => `<tr data-k="${k}">
          <td><select data-f="ing">${ingOpts(p.ing)}</select></td>
          <td class="r muted" data-br></td>
          <td class="r"><input class="n" data-f="qty" inputmode="decimal" value="${num(p.qty)}"><span class="unit" data-u></span></td>
          <td class="r muted hide-m" data-up></td><td class="r" data-c></td>
          <td class="no-print"><button class="del" data-del>убрать</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Продуктов пока нет.</td></tr>'}
        </tbody>
      </table></div>
      <div class="bar no-print">
        ${db.ing.length ? '<button class="ghost" id="addPart">Добавить продукт</button>' : '<span class="muted">Сначала заведите продукты во вкладке «Продукты».</span>'}
        ${db.dishes.length > 1 ? '<button class="ghost" id="addSub">Добавить блюдо в набор</button>' : ''}
      </div>
    </div>

    ${d.sub.length ? `<div class="card"><h2>Блюда в наборе</h2>
    <div class="tw"><table class="edit">
      <thead><tr><th>Блюдо</th><th class="r">Сколько</th><th class="r">Себестоимость</th><th class="r">Стоимость</th><th class="no-print"></th></tr></thead>
      <tbody id="subs">${d.sub.map((x, k) => `<tr data-k="${k}">
        <td><select data-f="dish">${dishOpts(x.dish)}</select></td>
        <td class="r"><input class="n" data-f="n" inputmode="decimal" value="${num(x.n)}"></td>
        <td class="r muted" data-up></td><td class="r" data-c></td>
        <td class="no-print"><button class="del" data-del>убрать</button></td></tr>`).join('')}
      </tbody>
    </table></div><p class="muted small">Упаковка блюд внутри набора не считается: у набора своя.</p></div>` : ''}

    ${usedIn.length ? `<p class="muted no-print">Это блюдо входит в: ${usedIn.map(x => `<a href="#dish/${x.id}">${esc(x.name)}</a>`).join(', ')}.</p>` : ''}

    <div class="bar no-print">
      <button class="ghost" id="print">Распечатать техкарту</button>
      <button class="ghost" id="dup">Сделать копию</button>
      <span class="grow"></span>
      <button class="link" id="delDish">удалить блюдо</button>
    </div>`;

  function refresh() {
    const s = stats(d, pt);
    view.querySelectorAll('#parts tr[data-k]').forEach(tr => {
      const p = d.parts[+tr.dataset.k], i = ingById(p.ing);
      if (!i) return;
      const per = UNITS[i.unit].per;
      tr.querySelector('[data-u]').textContent = per;
      tr.querySelector('[data-br]').textContent = num((+p.qty || 0) / wasteK(i)) + ' ' + per;
      tr.querySelector('[data-up]').textContent = rub(packOf(i)) + '/' + i.unit;
      tr.querySelector('[data-c]').textContent = rub(unitPrice(i) * (+p.qty || 0), 2);
    });
    view.querySelectorAll('#subs tr').forEach(tr => {
      const x = d.sub[+tr.dataset.k], sd = dishById(x.dish), c = sd ? cost(sd, false) : NaN;
      tr.querySelector('[data-up]').textContent = rub(c, 2);
      tr.querySelector('[data-c]').textContent = rub(c * (+x.n || 0), 2);
    });
    const loop = !isFinite(s.c), ok = s.price && !s.blank && !loop;
    $('#sum').innerHTML = `
      <div><dt>Себестоимость</dt><dd>${loop ? '—' : rub(s.c, 2)}</dd></div>
      <div><dt>Фудкост</dt><dd class="${ok && s.fc > db.target ? 'bad' : ''}">${ok ? pct(Math.round(s.fc)) : '—'}</dd></div>
      <div><dt>Наценка</dt><dd>${ok && s.c ? pct(Math.round((s.price - s.c) / s.c * 100)) : '—'}</dd></div>
      <div><dt>Остаётся с порции</dt><dd class="${ok && s.eff < 0 ? 'bad' : 'accent'}">${ok ? rub(s.eff) : '—'}</dd></div>`;
    const adv = $('#advice');
    if (loop) adv.innerHTML = '<span class="bad">Набор ссылается сам на себя. Уберите лишнее блюдо из набора.</span>';
    else if (s.empty) adv.innerHTML = '<span class="muted">Добавьте продукты, и здесь появится себестоимость.</span>';
    else if (s.miss.length) adv.innerHTML = `<span class="bad">Себестоимость пока занижена:</span> не заполнен состав у ${s.miss.map(x => `<a href="#dish/${x.id}">${esc(x.name)}</a>`).join(', ')}.`;
    else {
      const minTxt = isFinite(s.min) ? ` Дешевле ${rub(s.min)} каждая продажа в точке «${esc(pt.name)}» уходит в минус.` : '';
      if (!s.price) adv.innerHTML = `При цели ${db.target}% цена должна быть от <b>${rub(s.rec)}</b>. <button class="link" id="setRec">поставить</button>${minTxt}`;
      else if (s.fc > db.target) adv.innerHTML = `<span class="bad">Дороже цели на ${Math.round(s.fc - db.target)} п.п.</span> Чтобы уложиться в ${db.target}%, нужна цена ${rub(s.rec)} или себестоимость до ${rub(s.price * db.target / 100, 2)}. <button class="link" id="setRec">поставить ${rub(s.rec)}</button>${minTxt}`;
      else adv.innerHTML = `<span class="good">Укладывается в цель.</span> Цена под цель ${db.target}%: ${rub(s.rec)}.${minTxt}`;
    }
    const sr = $('#setRec'); if (sr) sr.onclick = () => { d.price = s.rec; $('#dp').value = s.rec; save(); refresh(); };
    const q = qtyOf(d, pt);
    $('#sold').innerHTML = q && ok ? `В точке «${esc(pt.name)}» за ${days(pt.sales.days)} продано ${q} шт, осталось ${rub(q * s.eff)}.` : '';
  }
  refresh();

  const bind = (sel, f) => { $(sel).oninput = e => { f(e.target.value); save(); refresh(); }; };
  bind('#dn', v => d.name = v.trim() || 'Без названия');
  bind('#dp', v => d.price = parseNum(v));
  bind('#dk', v => d.pack = parseNum(v));
  bind('#dy', v => d.yield = parseNum(v));
  $('#dso').onchange = e => { d.setOnly = e.target.checked; save(); };

  const onRow = (tbodySel, arr) => {
    const tb = $(tbodySel); if (!tb) return;
    tb.oninput = tb.onchange = e => {
      const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
      const item = arr()[+tr.dataset.k];
      item[f] = (f === 'ing' || f === 'dish') ? e.target.value : parseNum(e.target.value);
      save(); refresh();
    };
    tb.onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; arr().splice(+b.closest('tr').dataset.k, 1); save(); keepScroll(() => renderDish(id)); };
  };
  onRow('#parts', () => d.parts);
  onRow('#subs', () => d.sub);

  const ap = $('#addPart');
  if (ap) ap.onclick = () => {
    const used = new Set(d.parts.map(p => p.ing));
    const next = db.ing.find(i => !used.has(i.id)) || db.ing[0];
    d.parts.push({ ing: next.id, qty: next.unit === 'шт' ? 1 : 10 }); save(); keepScroll(() => renderDish(id));
    const sels = view.querySelectorAll('#parts select'); sels[sels.length - 1].focus();
  };
  const as = $('#addSub');
  if (as) as.onclick = () => {
    const other = db.dishes.find(x => x.id !== d.id && !d.sub.some(s => s.dish === x.id)) || db.dishes.find(x => x.id !== d.id);
    d.sub.push({ dish: other.id, n: 1 }); save(); keepScroll(() => renderDish(id));
  };
  $('#print').onclick = () => print();
  $('#dup').onclick = () => {
    const c = JSON.parse(JSON.stringify(d)); c.id = uid(); c.name = d.name + ' (копия)';
    db.dishes.push(c); save(); location.hash = '#dish/' + c.id;
  };
  $('#delDish').onclick = () => {
    if (usedIn.length) { note(`Нельзя удалить: «${esc(d.name)}» входит в ${usedIn.map(x => '«' + esc(x.name) + '»').join(', ')}. Сначала уберите его оттуда.`); return; }
    const snap = JSON.stringify(db);
    db.dishes = db.dishes.filter(x => x.id !== d.id);
    for (const p of db.points) delete p.sales.qty[d.id];
    save(); location.hash = '#menu';
    note(`Блюдо «${esc(d.name)}» удалено.`, [['Вернуть', () => { db = JSON.parse(snap); save(); route(); }], ['Ок', () => {}]]);
  };
}

/* =========================================================================
   Продукты
   ========================================================================= */
function histCell(i) {
  const since = Date.now() - 183 * 864e5, h = (i.hist || []).filter(x => x.t >= since);
  if (!h.length || !(h[0].v > 0)) return '';
  const ch = (packOf(i) - h[0].v) / h[0].v * 100;
  if (Math.abs(ch) < .5) return '';
  const when = new Date(h[0].t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `<span class="${ch > 0 ? 'bad' : 'good'}" title="было ${rub(h[0].v)} за ${i.unit}">${ch > 0 ? '+' : ''}${pct(Math.round(ch))}</span> <span class="muted">с ${when}</span>`;
}
function renderProducts() {
  const sorted = db.ing.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const net = i => i.unit === 'шт' ? rub(unitPrice(i), 2) + '/шт' : rub(unitPrice(i) * 1000) + '/' + i.unit;
  view.innerHTML = `
    <div class="head"><h1>Продукты</h1><button class="main" id="addIng">Добавить продукт</button></div>
    <p class="lead">Цена как в накладной: за упаковку. Общие для всех точек.</p>
    <div class="card">
      <div class="tw"><table class="edit">
        <thead><tr><th>Продукт</th><th class="r">Упаковка</th><th></th><th class="r">Цена, ₽</th><th class="r">Отход, %</th><th class="r">Цена нетто</th><th class="r hide-m">За полгода</th><th class="hide-m">Учёт</th><th class="r hide-m">Блюд</th><th></th></tr></thead>
        <tbody id="ings">${sorted.map(i => `<tr data-id="${i.id}">
          <td><input data-f="name" value="${esc(i.name)}" placeholder="Название"></td>
          <td class="r"><input class="n s" data-f="qty" inputmode="decimal" value="${num(i.qty)}"></td>
          <td><select data-f="unit">${Object.keys(UNITS).map(u => `<option${u === i.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
          <td class="r"><input class="n" data-f="price" inputmode="decimal" value="${num(i.price)}"></td>
          <td class="r"><input class="n s" data-f="waste" inputmode="decimal" value="${num(i.waste || 0)}"></td>
          <td class="r" data-net>${net(i)}</td>
          <td class="r hide-m" data-hist>${histCell(i)}</td>
          <td class="hide-m"><select data-f="ctrl">${Object.entries(CTRL).map(([k, n]) => `<option value="${k}"${k === (i.ctrl || '') ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
          <td class="r muted hide-m">${db.dishes.filter(d => usesIng(d, i.id)).length || ''}</td>
          <td><button class="del" data-del>убрать</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Продуктов пока нет.</td></tr>'}</tbody>
      </table></div>
      <p class="small muted">«Учёт» подсказывает при приходе: «Меркурий» — для мяса, рыбы, молочки, яиц (нужно гасить ВСД), «Честный знак» — для маркированной воды, молочки, пива и других товаров с кодами.</p>
      <p class="small muted">Отход — сколько процентов веса уходит при чистке и разделке. Он зависит от того, что вы покупаете: целая рыба и готовое филе дают очень разный отход. Точнее всего взвесить один раз: (вес до обработки − вес после) / вес до × 100.</p>
    </div>`;

  const tb = $('#ings');
  let before = null;
  tb.addEventListener('focusin', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id;
    if (before && before.id === id) return;
    before = { id, snap: JSON.stringify(ingById(id)), fc: Object.fromEntries(db.dishes.filter(d => usesIng(d, id)).map(d => [d.id, stats(d).fc])) };
  });
  tb.oninput = tb.onchange = e => {
    const tr = e.target.closest('tr[data-id]'), f = e.target.dataset.f; if (!tr || !f) return;
    const i = ingById(tr.dataset.id);
    i[f] = (f === 'name' || f === 'unit' || f === 'ctrl') ? e.target.value : parseNum(e.target.value);
    tr.querySelector('[data-net]').textContent = net(i);
    save();
  };
  tb.addEventListener('focusout', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr || !before || before.id !== tr.dataset.id) return;
    if (tr.contains(e.relatedTarget)) return;
    const i = ingById(before.id), b = before; before = null;
    if (!i || JSON.stringify(i) === b.snap) return;
    const old = JSON.parse(b.snap);
    if (+old.qty > 0 && old.unit === i.unit && packOf(old) !== packOf(i)) { i.hist.push({ t: Date.now(), v: packOf(old) }); save(); tr.querySelector('[data-hist]').innerHTML = histCell(i); }
    impact(i, b);
  });
  tb.onclick = e => {
    const btn = e.target.closest('[data-del]'); if (!btn) return;
    const id = btn.closest('tr').dataset.id, i = ingById(id);
    const users = db.dishes.filter(d => d.parts.some(p => p.ing === id));
    if (users.length) { note(`«${esc(i.name)}» есть в составе: ${users.slice(0, 10).map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}${users.length > 10 ? '…' : ''}. Уберите его оттуда, потом удалите.`); return; }
    db.ing = db.ing.filter(x => x.id !== id);
    for (const p of db.points) if (p.moves.some(m => m.lines.some(l => l.ing === id))) { note(`«${esc(i.name)}» есть в складском журнале точки «${esc(p.name)}». Удалить его нельзя, переименуйте или оставьте.`); return; }
    save(); keepScroll(renderProducts);
  };
  $('#addIng').onclick = () => {
    const i = { id: uid(), name: '', unit: 'кг', qty: 1, price: 0, waste: 0, hist: [] };
    db.ing.push(i); save(); renderProducts();
    view.querySelector(`#ings tr[data-id="${i.id}"] input`).focus();
  };
}
function impact(i, b) {
  const rows = Object.entries(b.fc).map(([id, fc0]) => {
    const d = dishById(id), s = stats(d);
    return { d, fc0, fc1: s.fc, crossed: fc0 <= db.target && s.fc > db.target };
  }).filter(r => isFinite(r.fc0) && isFinite(r.fc1) && Math.abs(r.fc1 - r.fc0) >= .5)
    .sort((a, c) => (c.fc1 - c.fc0) - (a.fc1 - a.fc0));
  if (!rows.length) return;
  const crossed = rows.filter(r => r.crossed);
  const list = rows.slice(0, 8).map(r => `<li><a href="#dish/${r.d.id}">${esc(r.d.name)}</a>: было ${pct(Math.round(r.fc0))}, стало <b class="${r.fc1 > db.target ? 'bad' : ''}">${pct(Math.round(r.fc1))}</b></li>`).join('');
  const old = JSON.parse(b.snap);
  note(`Цена «${esc(i.name)}» изменилась, это задело ${rows.length} ${plural(rows.length, 'блюдо', 'блюда', 'блюд')}${crossed.length ? `, из них <b class="bad">${crossed.length}</b> теперь дороже цели ${db.target}%` : ''}.<ul>${list}</ul>${rows.length > 8 ? `<span class="muted">и ещё ${rows.length - 8}</span>` : ''}`,
    [['Понятно', () => {}], ['Вернуть старую цену', () => { const cur = ingById(i.id); const h = cur.hist; Object.assign(cur, old, { hist: h.slice(0, -1) }); save(); route(true); }]]);
}

/* =========================================================================
   Продажи
   ========================================================================= */
let salesQ = '';
function renderSales(report) {
  const pt = P();
  const q = key(salesQ);
  const list = db.dishes.filter(d => !d.setOnly && (!q || key(d.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const totals = () => { let t = 0, r = 0; for (const d of db.dishes) { t += qtyOf(d, pt); r += qtyOf(d, pt) * (+d.price || 0); } return [t, r]; };
  const [total, revenue] = totals();
  view.innerHTML = `
    <div class="head"><h1>Продажи</h1></div>
    <p class="lead">Точка «${esc(pt.name)}». Сколько порций продано за период: отсюда считаются анализ, сверка и закупка.</p>
    <div class="card">
      <div class="bar"><label>Период, дней <input id="days" type="number" min="1" max="366" value="${pt.sales.days}" class="s"></label>
        <span class="muted">Итого <b id="tot">${total}</b> порций на <b id="rev">${rub(revenue)}</b></span>
        ${pt.shifts.some(s => s.dishes && Object.keys(s.dishes).length) ? '<span class="grow"></span><button class="ghost" id="fromShifts">Взять из смен за этот период</button>' : ''}</div>
    </div>
    <div class="card">
      <h2>Вставить из кассы или Excel</h2>
      <p class="muted small">По строке на блюдо: название и количество через табуляцию, точку с запятой или пробел. Так выгружают отчёт «Продажи по блюдам» большинство касс: скопируйте два столбца и вставьте сюда.</p>
      <textarea id="paste" rows="5" placeholder="Название блюда	количество"></textarea>
      <div class="bar"><button class="main" id="parse">Разобрать</button><label class="check"><input type="checkbox" id="add2"> прибавить к текущим</label></div>
      ${report || ''}
    </div>
    <div class="card">
      <div class="bar"><input type="search" id="sq" placeholder="Найти блюдо" value="${esc(salesQ)}"><span class="grow"></span><button class="link" id="clr">обнулить продажи точки</button></div>
      <div class="tw"><table class="edit"><thead><tr><th>Блюдо</th><th class="r">Продано</th><th class="r hide-m">Выручка</th></tr></thead>
      <tbody id="srows">${list.map(d => `<tr data-id="${d.id}"><td>${esc(d.name)}</td>
        <td class="r"><input class="n" inputmode="numeric" value="${qtyOf(d, pt) || ''}" placeholder="0"></td>
        <td class="r muted hide-m">${qtyOf(d, pt) && d.price ? rub(qtyOf(d, pt) * d.price) : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>`;

  const fs = $('#fromShifts');
  if (fs) fs.onclick = () => {
    const from = addDays(isoDay(), -(+pt.sales.days || 30) + 1), snap = JSON.stringify(pt.sales.qty), q = {};
    let n = 0;
    for (const s of pt.shifts) if (s.date >= from && s.dishes) { n++; for (const id in s.dishes) q[id] = (q[id] || 0) + (+s.dishes[id] || 0); }
    pt.sales.qty = q; save(); renderSales();
    note(`Продажи собраны из ${n} ${plural(n, 'смены', 'смен', 'смен')} с ${fmtDay(from)}.`, [['Ок', () => {}], ['Вернуть как было', () => { pt.sales.qty = JSON.parse(snap); save(); renderSales(); }]]);
  };
  $('#days').oninput = e => { const v = Math.round(parseNum(e.target.value)); if (v >= 1 && v <= 366) { pt.sales.days = v; save(); } };
  $('#sq').oninput = e => { salesQ = e.target.value; renderSales(); refocus('#sq'); };
  $('#srows').oninput = e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const v = Math.max(0, Math.round(parseNum(e.target.value)));
    if (v) pt.sales.qty[tr.dataset.id] = v; else delete pt.sales.qty[tr.dataset.id];
    save();
    const [t, r] = totals(); $('#tot').textContent = t; $('#rev').textContent = rub(r);
    const d = dishById(tr.dataset.id); tr.lastElementChild.textContent = v && d.price ? rub(v * d.price) : '';
  };
  $('#clr').onclick = () => {
    const snap = JSON.stringify(pt.sales.qty); pt.sales.qty = {}; save(); renderSales();
    note(`Продажи точки «${esc(pt.name)}» обнулены.`, [['Ок', () => {}], ['Вернуть', () => { pt.sales.qty = JSON.parse(snap); save(); renderSales(); }]]);
  };
  $('#parse').onclick = () => {
    const byName = new Map(db.dishes.map(d => [key(d.name), d]));
    const add = $('#add2').checked, got = new Map(), miss = [];
    for (const line of $('#paste').value.split('\n')) {
      const m = line.trim().match(/^(.+?)[\t;,\s]+(\d+(?:[.,]\d+)?)\s*(?:шт\.?|порц\.?)?$/i);
      if (!m) continue;
      const d = byName.get(key(m[1].replace(/[\t;,]+$/, '')));
      if (!d) { miss.push(m[1].trim()); continue; }
      got.set(d.id, (got.get(d.id) || 0) + Math.round(parseNum(m[2])));
    }
    if (!got.size && !miss.length) { renderSales('<div class="report">Не нашёл ни одной строки вида «название количество».</div>'); return; }
    const snap = JSON.stringify(pt.sales.qty);
    if (!add) pt.sales.qty = {};
    for (const [id, v] of got) pt.sales.qty[id] = (add ? qtyOf(dishById(id), pt) : 0) + v;
    save();
    renderSales(`<div class="report"><b>Готово.</b> Узнано блюд: ${got.size}.
      ${miss.length ? `<br>Нет в меню: <ul>${miss.slice(0, 12).map(m => `<li>${esc(m)}</li>`).join('')}</ul>${miss.length > 12 ? `<span class="muted">и ещё ${miss.length - 12}</span>` : ''}` : ''}
      <div class="bar"><a class="btn ghost" href="#analysis">К анализу</a><button class="link" id="undoS">отменить</button></div></div>`);
    $('#undoS').onclick = () => { pt.sales.qty = JSON.parse(snap); save(); renderSales(); };
  };
}

/* =========================================================================
   Анализ
   ========================================================================= */
// Матрица меню-инжиниринга (Kasavana и Smith): популярность против денег с порции.
const QUAD = {
  star: { name: 'Звёзды', hint: 'Продаются хорошо и приносят много. Не меняйте рецепт и цену, держите их на виду: первыми в меню, на баннерах, в рассылке.' },
  horse: { name: 'Рабочие лошадки', hint: 'Берут часто, но зарабатываете на них мало. Их улучшить проще всего: немного поднять цену, проверить вес порции, заменить дорогой продукт или продавать в наборе с выгодным блюдом.' },
  puzzle: { name: 'Загадки', hint: 'Выгодные, но их мало берут. Переименуйте, сделайте хорошее фото, поднимите выше в меню, пусть оператор предлагает их при заказе.' },
  dog: { name: 'Собаки', hint: 'Мало берут и мало приносят. Попробуйте месяц переделать или переименовать. Если не помогло, уберите: меню станет короче, закупка проще.' }
};
let anaKind = 'single', whatIf = { ing: '', pct: 20 };
function moneyTable(e, pt) {
  const row = (name, v, hint) => v > 0.5 ? `<tr><td>${name}</td><td class="r">−${rub(v)}</td><td class="muted">${hint || ''}</td></tr>` : '';
  return `<div class="tw"><table class="money">
    <tr><td>Выручка</td><td class="r">${rub(e.rev)}</td><td class="muted">${e.qty} порций, ${rub(e.rev / e.D)} в день</td></tr>
    ${row('Продукты и упаковка', e.food, `${pct(Math.round(e.food / e.rev * 100))} от выручки`)}
    ${row('Комиссия агрегаторов', e.agg, `${pct(e.agg / e.rev * 100)} от выручки`)}
    ${row('Эквайринг и СБП', e.acq, `${pct(e.acq / e.rev * 100)} от выручки`)}
    ${row('Своя доставка', e.del)}
    ${row('НДС', e.vat, `${pt.tax.vat}%, внутри цены`)}
    <tr class="sub"><td>Остаётся с блюд</td><td class="r">${rub(e.gross)}</td><td class="muted">${rub(e.qty ? e.gross / e.qty : 0)} с порции</td></tr>
    ${row('Постоянные расходы', e.fixed, e.D === 30 ? 'за месяц' : `пересчитано на ${days(e.D)}`)}
    ${row('Налог', e.tax, e.taxNote)}
    <tr class="total"><td>Прибыль</td><td class="r ${e.net < 0 ? 'bad' : 'good'}">${rub(e.net)}</td><td class="muted">${rub(e.net / e.D)} в день</td></tr>
  </table></div>`;
}
function analysisRows(pt, kind) {
  return db.dishes.map(d => ({ d, s: stats(d, pt), q: qtyOf(d, pt) }))
    .filter(x => x.q > 0 && !x.s.blank && x.s.price && isFinite(x.s.c) && (kind === 'all' || (kind === 'sets') === isSet(x.d)));
}
function renderAnalysis() {
  const pt = P();
  const cmp = db.points.length > 1 ? `<div class="card"><h2>Точки</h2><div class="tw"><table>
    <thead><tr><th>Точка</th><th class="r">Выручка</th><th class="r">Фудкост</th><th class="r hide-m">С порции</th><th class="r">Прибыль</th><th class="r hide-m">В день</th></tr></thead>
    <tbody>${db.points.map(p => { const e = econ(p); return `<tr class="row${p.id === pt.id ? ' cur' : ''}" data-pt="${p.id}"><td>${esc(p.name)}</td><td class="r">${rub(e.rev)}</td><td class="r">${e.rev ? pct(Math.round(e.food / e.rev * 100)) : '—'}</td><td class="r hide-m">${e.qty ? rub(e.gross / e.qty) : '—'}</td><td class="r ${e.net < 0 ? 'bad' : ''}">${rub(e.net)}</td><td class="r hide-m">${rub(e.net / e.D)}</td></tr>`; }).join('')}</tbody>
    </table></div><p class="small muted">Каждая точка считается за свой период продаж. Нажмите на строку, чтобы открыть точку.</p></div>` : '';

  if (!db.dishes.some(d => qtyOf(d, pt))) { view.innerHTML = '<div class="head"><h1>Анализ</h1></div>' + cmp + noSales(); bindCmp(); return; }
  const e = econ(pt);
  const rows = analysisRows(pt, anaKind);
  const tq = rows.reduce((a, x) => a + x.q, 0);
  const popLine = rows.length ? 0.7 * tq / rows.length : 0;           // правило 70%
  const mLine = tq ? rows.reduce((a, x) => a + x.q * x.s.eff, 0) / tq : 0; // средняя с порции, взвешенная по продажам
  for (const x of rows) x.k = x.q >= popLine ? (x.s.eff >= mLine ? 'star' : 'horse') : (x.s.eff >= mLine ? 'puzzle' : 'dog');
  const groups = Object.keys(QUAD).map(k => {
    const list = rows.filter(x => x.k === k).sort((a, b) => b.q * b.s.eff - a.q * a.s.eff);
    if (!list.length) return '';
    return `<div class="quad ${k}"><h3>${QUAD[k].name} <span class="muted">${list.length}</span></h3><p class="muted small">${QUAD[k].hint}</p><ul class="qlist">${list.map(x => {
      let tip = '';
      if (k === 'horse') { const up = db.round === '90' ? 100 : db.round === '50' ? 50 : 30; tip = ` <span class="muted">Цена +${up} ₽ даст ${rub(x.q * up * (1 - e.r.total))} за период, если продажи не упадут.</span>`; }
      if (k === 'dog') tip = ` <span class="muted">${pct(x.q * x.s.price / e.rev * 100)} выручки.</span>`;
      return `<li><a href="#dish/${x.d.id}">${esc(x.d.name)}</a>: ${x.q} шт, ${rub(x.s.eff)} с порции, всего ${rub(x.q * x.s.eff)}.${tip}</li>`;
    }).join('')}</ul></div>`;
  }).join('');

  const all = analysisRows(pt, 'all');
  const usedIngs = db.ing.filter(i => all.some(x => usesIng(x.d, i.id))).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!usedIngs.some(i => i.id === whatIf.ing)) {
    const u = salesUsage(pt); let best = null, bv = -1;
    for (const i of usedIngs) { const v = (u.get(i.id) || 0) * unitPrice(i) * wasteK(i); if (v > bv) { bv = v; best = i; } }
    whatIf.ing = best ? best.id : '';
  }
  const loss = all.filter(x => x.s.eff < 0);

  view.innerHTML = `
    <div class="head"><h1>Анализ</h1></div>
    <p class="lead">Точка «${esc(pt.name)}» за ${days(e.D)}.${e.skipped.length ? ` Не учтены ${e.skipped.length} ${plural(e.skipped.length, 'блюдо', 'блюда', 'блюд')} без состава или цены: ${e.skipped.slice(0, 4).map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}${e.skipped.length > 4 ? '…' : ''}.` : ''}</p>
    ${cmp}
    <div class="card">
      <h2>Деньги за период</h2>
      ${moneyTable(e, pt)}
      ${isFinite(e.be) ? `<p>Точка безубыточности: <b>${e.be}</b> ${plural(e.be, 'порция', 'порции', 'порций')} за период, ${Math.ceil(e.be / e.D)} в день. Сейчас продаётся ${Math.round(e.qty / e.D)} в день${e.qty >= e.be ? `, запас ${pct(Math.round((e.qty - e.be) / e.qty * 100))}` : `, <b class="bad">не хватает ${Math.ceil((e.be - e.qty) / e.D)} в день</b>`}.</p>` : ''}
      ${loss.length ? `<p class="bad">В убыток с каждой продажи: ${loss.map(x => `<a href="#dish/${x.d.id}">${esc(x.d.name)}</a>`).join(', ')}.</p>` : ''}
      ${taxWarnings(pt, e)}
      <p class="small muted">Расходы, комиссии и налог точки настраиваются во вкладке <a href="#costs">«Расходы»</a>.</p>
    </div>

    <div class="card">
      <h2>Меню-инжиниринг</h2>
      <p class="muted small">Каждое блюдо сравнивается с остальными: как часто его берут и сколько рублей остаётся с порции. Наборы стоят дороже одного ролла, поэтому сравнивайте их отдельно.</p>
      <div class="bar"><select id="akind"><option value="single">Блюда без наборов</option><option value="sets">Только наборы</option><option value="all">Всё вместе</option></select></div>
      ${rows.length >= 3 ? matrixSvg(rows, popLine, mLine) + `<div class="quads">${groups}</div>` : '<p class="muted">Нужно хотя бы три блюда с продажами и составом.</p>'}
    </div>

    <div class="card">
      <h2>Что если подорожает</h2>
      ${usedIngs.length ? `<div class="bar">
        <select id="wiIng">${usedIngs.map(i => `<option value="${i.id}"${i.id === whatIf.ing ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
        <label>на <input id="wiPct" type="number" step="5" value="${whatIf.pct}" class="s"> %</label></div>
        <div id="wiOut"></div>` : '<p class="muted">Нет продуктов в проданных блюдах.</p>'}
    </div>`;
  $('#akind').value = anaKind;
  $('#akind').onchange = ev => { anaKind = ev.target.value; keepScroll(renderAnalysis); };
  bindCmp();

  function drawWhatIf() {
    const out = $('#wiOut'); if (!out) return;
    const i = ingById(whatIf.ing), k = whatIf.pct / 100;
    if (!i || !k) { out.innerHTML = ''; return; }
    const before = new Map(all.map(x => [x.d.id, x.s]));
    const old = i.price; i.price = old * (1 + k);
    const after = all.map(x => ({ x, s: stats(x.d, pt) }));
    i.price = old;
    let lossSum = 0; const crossed = [], raise = [];
    for (const { x, s } of after) {
      const dc = s.c - before.get(x.d.id).c; if (Math.abs(dc) < .01) continue;
      lossSum += dc * x.q;
      if (before.get(x.d.id).fc <= db.target && s.fc > db.target) crossed.push(x.d);
      const need = roundPrice(x.s.price + dc / (1 - e.r.total)) - x.s.price;
      if (need > 0) raise.push([x.d, need, x.q]);
    }
    raise.sort((a, b) => b[1] * b[2] - a[1] * a[2]);
    out.innerHTML = `<p>Если «${esc(i.name)}» ${k > 0 ? 'подорожает' : 'подешевеет'} на ${Math.abs(whatIf.pct)}%, прибыль за ${days(e.D)} ${lossSum > 0 ? 'упадёт' : 'вырастет'} на <b class="${lossSum > 0 ? 'bad' : 'good'}">${rub(Math.abs(lossSum))}</b>${e.net > 0 ? `, это ${pct(Math.round(Math.abs(lossSum) / e.net * 100))} от текущей прибыли` : ''}.</p>
      ${crossed.length ? `<p>Станут дороже цели ${db.target}%: ${crossed.map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}.</p>` : ''}
      ${k > 0 && raise.length ? `<p class="muted">Чтобы не потерять в деньгах, хватит поднять цены:</p><ul class="qlist">${raise.slice(0, 8).map(([d, n]) => `<li>${esc(d.name)}: на ${rub(n)}, до ${rub(d.price + n)}</li>`).join('')}</ul>` : ''}`;
  }
  drawWhatIf();
  const wi = $('#wiIng'); if (wi) wi.onchange = ev => { whatIf.ing = ev.target.value; drawWhatIf(); };
  const wp = $('#wiPct'); if (wp) wp.oninput = ev => { whatIf.pct = parseNum(ev.target.value); drawWhatIf(); };
}
function bindCmp() {
  view.querySelectorAll('tr[data-pt]').forEach(tr => tr.onclick = () => { db.cur = tr.dataset.pt; save(); syncPoint(); keepScroll(renderAnalysis); });
}
// Подсказки по налогам РФ с 2026 года
function taxWarnings(pt, e) {
  const t = pt.tax, out = [];
  const total = db.points.reduce((a, p) => a + econ(p).annual, 0);
  const many = db.points.length > 1, top = Math.max(e.annual, total);
  const est = `${mln(e.annual)} в год${many ? `, по всем точкам ${mln(total)}` : ''}`;
  if (t.mode === 'usn6' || t.mode === 'usn15') {
    if (!+t.vat && top > 20e6)
      out.push(`Выручка выходит около ${est}. С 2026 года на УСН НДС платят, если доходы за год больше 20 млн ₽. Общепит может быть освобождён по ст. 149 НК РФ, если на него приходится не меньше 70% доходов и выполнены остальные условия. Если льготы нет, выберите НДС 5% или 7% во вкладке «Расходы». Уточните у бухгалтера.`);
    if (+t.vat === 5 && top > 272.5e6)
      out.push(`НДС 5% на УСН можно применять, пока доходы за 2026 год не больше 272,5 млн ₽. У вас выходит около ${est}.`);
    if (top > 490.5e6)
      out.push(`Лимит доходов для УСН в 2026 году 490,5 млн ₽, у вас выходит около ${est}.`);
  }
  return out.map(x => `<p class="warn">${x}</p>`).join('');
}

function matrixSvg(rows, popLine, mLine) {
  const W = 680, H = 380, L = 64, R = 16, T = 18, B = 40;
  const maxQ = Math.max(...rows.map(x => x.q), popLine) * 1.08;
  const ms = rows.map(x => x.s.eff), minM = Math.min(0, ...ms), maxM = Math.max(...ms, mLine) * 1.1;
  const sx = q => L + Math.sqrt(q / maxQ) * (W - L - R);   // корень: блюда с малыми продажами не слипаются у нуля
  const sy = m => T + (1 - (m - minM) / (maxM - minM || 1)) * (H - T - B);
  const px = sx(popLine), py = sy(mLine);
  const order = rows.slice().sort((a, b) => b.q * b.s.eff - a.q * a.s.eff);
  const boxes = order.map(x => ({ x: sx(x.q) - 6, y: sy(x.s.eff) - 6, w: 12, h: 12 })), labels = new Map();
  const hit = b => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const x of order) {
    const cx = sx(x.q), cy = sy(x.s.eff);
    const t = x.d.name.length > 22 ? x.d.name.slice(0, 21) + '…' : x.d.name, w = t.length * 6.4 + 4;
    const mid = Math.min(Math.max(cx - w / 2, L + 2), W - R - w);
    for (const [bx, by] of [[cx + 8, cy - 7], [cx - 8 - w, cy - 7], [mid, cy - 22], [mid, cy + 8]]) {
      const b = { x: bx, y: by, w, h: 14 };
      if (bx < L || bx + w > W - R || by < T || by + 14 > H - B || hit(b)) continue;
      boxes.push(b); labels.set(x.d.id, { t, x: bx + 2, y: by + 11 }); break;
    }
  }
  const ticks = [0];
  for (const v of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) if (v <= maxQ / 1.08 && sx(v) - sx(ticks[ticks.length - 1]) >= 44) ticks.push(v);
  const dots = rows.map(x => {
    const cx = sx(x.q), cy = sy(x.s.eff), lb = labels.get(x.d.id);
    return `<a href="#dish/${x.d.id}"><circle class="dot ${x.k}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5"><title>${esc(x.d.name)}: ${x.q} шт, ${rub(x.s.eff)} с порции</title></circle>${lb ? `<text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" class="lbl">${esc(lb.t)}</text>` : ''}</a>`;
  }).join('');
  return `<div class="tw"><svg class="matrix" viewBox="0 0 ${W} ${H}" role="img" aria-label="Матрица меню: продажи по горизонтали, деньги с порции по вертикали">
    <rect x="${px}" y="${T}" width="${W - R - px}" height="${py - T}" class="q-star" rx="10"/>
    <text x="${W - R - 8}" y="${T + 18}" text-anchor="end" class="qname">звёзды</text>
    <text x="${L + 8}" y="${T + 18}" class="qname">загадки</text>
    <text x="${W - R - 8}" y="${H - B - 10}" text-anchor="end" class="qname">лошадки</text>
    <text x="${L + 8}" y="${H - B - 10}" class="qname">собаки</text>
    <line x1="${px}" x2="${px}" y1="${T}" y2="${H - B}" class="th"/><line x1="${L}" x2="${W - R}" y1="${py}" y2="${py}" class="th"/>
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ax"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="ax"/>
    ${ticks.map(v => `<text x="${sx(v)}" y="${H - B + 16}" text-anchor="middle" class="tick">${v}</text>`).join('')}
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="tick">продано, шт</text>
    <text x="${L - 8}" y="${py + 4}" text-anchor="end" class="tick">${Math.round(mLine)} ₽</text>
    <text x="${L - 8}" y="${T + 10}" text-anchor="end" class="tick">${Math.round(maxM / 1.1)} ₽</text>
    ${minM < 0 ? `<line x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}" class="zero"/><text x="${L - 8}" y="${sy(0) + 4}" text-anchor="end" class="tick">0 ₽</text>` : ''}
    <text x="14" y="${(T + H - B) / 2}" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle" class="tick">остаётся с порции</text>
    ${dots}</svg></div>`;
}

/* =========================================================================
   Расходы и налоги точки
   ========================================================================= */
function renderCosts() {
  const pt = P(), t = pt.tax, r = rates(pt);
  const fld = (id, label, val, hint, unit = '') => `<label class="fld">${label}<span class="inp"><input id="${id}" type="number" min="0" step="any" value="${val || val === 0 ? val : ''}">${unit ? `<span class="unit">${unit}</span>` : ''}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const fixedSum = pt.fixed.reduce((a, f) => a + (+f.sum || 0), 0);
  view.innerHTML = `
    <div class="head"><h1>Расходы</h1></div>
    <p class="lead">Точка «${esc(pt.name)}». С каждой продажи сейчас уходит ${pct(r.total * 100)} цены на комиссии, эквайринг, доставку и налоги с выручки.</p>

    <div class="card">
      <h2>Постоянные расходы в месяц</h2>
      <div class="tw"><table class="edit"><thead><tr><th>Статья</th><th class="r">В месяц</th><th class="r">День оплаты</th><th></th></tr></thead><tbody id="fixed">${pt.fixed.map((f, k) => `<tr data-k="${k}">
        <td><input data-f="name" value="${esc(f.name)}" placeholder="Например, аренда"></td><td class="r"><input class="n" data-f="sum" inputmode="numeric" value="${+f.sum || ''}"><span class="unit">₽</span></td>
        <td class="r"><input class="n s" data-f="day" inputmode="numeric" value="${+f.day || ''}" placeholder="—"><span class="unit hide-m">число</span></td>
        <td><button class="del" data-del>убрать</button></td></tr>`).join('') || '<tr><td class="muted">Пока пусто.</td></tr>'}</tbody>
        <tfoot><tr class="total"><td>Итого</td><td class="r">${rub(fixedSum)}</td><td></td><td></td></tr></tfoot></table></div>
      <div class="bar"><button class="ghost" id="addFixed">Добавить расход</button></div>
      <p class="small muted">Аренда, зарплаты вместе со страховыми взносами, реклама, коммунальные, связь, программы (касса, сайт), вывоз мусора. Всё, что платится, даже если заказов нет. По дню оплаты платёж попадёт в календарь во вкладке «Деньги».</p>
    </div>

    <div class="card">
      <h2>Агрегаторы</h2>
      <div class="tw"><table class="edit"><thead><tr><th>Сервис</th><th class="r">Доля заказов</th><th class="r">Комиссия</th><th></th></tr></thead><tbody id="chs">${pt.channels.map((c, k) => `<tr data-k="${k}">
        <td><input data-f="name" value="${esc(c.name)}" placeholder="Яндекс Еда, Маркет Деливери…"></td>
        <td class="r"><input class="n s" data-f="share" inputmode="decimal" value="${num(c.share)}"><span class="unit">%</span></td>
        <td class="r"><input class="n s" data-f="fee" inputmode="decimal" value="${num(c.fee)}"><span class="unit">%</span></td>
        <td><button class="del" data-del>убрать</button></td></tr>`).join('') || '<tr><td class="muted" colspan="4">Заказы только через свои каналы.</td></tr>'}</tbody></table></div>
      <div class="bar"><button class="ghost" id="addCh">Добавить агрегатор</button></div>
      <p class="small muted">Долю заказов возьмите из кассы за тот же период. Комиссию — из договора: она разная для доставки курьерами сервиса и своими, плюс бывает плата за продвижение. Эквайринг и своя доставка ниже считаются только на остальные заказы.</p>
    </div>

    <div class="card">
      <h2>Оплата и доставка</h2>
      <div class="grid">
        ${fld('payShare', 'Оплачивают картой или СБП', pt.pay.share, 'доля своих заказов', '%')}
        ${fld('payFee', 'Комиссия банка', pt.pay.fee, 'по тарифу эквайринга; у СБП обычно ниже, чем у карт', '%')}
        ${fld('dCheck', 'Средний чек', pt.delivery.check, 'чтобы посчитать число заказов', '₽')}
        ${fld('dShare', 'Заказов с доставкой', pt.delivery.share, 'среди своих заказов', '%')}
        ${fld('dCost', 'Стоимость одной доставки', pt.delivery.cost, 'сдельная оплата курьеру, такси, бензин. Если курьер на окладе и оклад уже в постоянных расходах, ставьте 0', '₽')}
      </div>
    </div>

    <div class="card">
      <h2>Налоги</h2>
      <div class="grid">
        <label class="fld">Кто вы<span class="inp"><select id="taxEntity"><option value="ip">ИП</option><option value="org">Организация (ООО)</option></select></span><span class="hint">от этого зависят сроки налогов и взносы ИП за себя</span></label>
        <label class="fld">Режим<span class="inp"><select id="taxMode">
          <option value="none">Не учитывать</option><option value="usn6">УСН «Доходы»</option><option value="usn15">УСН «Доходы минус расходы»</option><option value="fixed">Патент или другая сумма в месяц</option>
        </select></span></label>
        ${t.mode === 'usn6' || t.mode === 'usn15' ? fld('taxRate', 'Ставка', t.rate, t.mode === 'usn6' ? 'обычно 6%, в некоторых регионах ниже' : 'обычно 15%, в некоторых регионах ниже; минимальный налог 1% с доходов', '%') : ''}
        ${t.mode === 'usn6' ? fld('taxReduce', 'Взносы, на которые уменьшается налог', t.reduce, 'в месяц. ИП без работников уменьшает налог на все свои взносы, ИП с работниками и организации — не больше чем наполовину', '₽') : ''}
        ${t.mode === 'fixed' ? fld('taxFixed', 'Сумма в месяц', t.fixed, 'стоимость патента или другой налог, разделённый на 12', '₽') : ''}
        ${t.mode === 'usn6' || t.mode === 'usn15' ? `<label class="fld">НДС<span class="inp"><select id="taxVat"><option value="0">Не плачу или освобождён</option><option value="5">5%</option><option value="7">7%</option></select></span><span class="hint">С 2026 года на УСН НДС платят при доходах больше 20 млн ₽ за год. Ставка 5% до 272,5 млн ₽ дохода, 7% до 490,5 млн ₽.</span></label>` : ''}
      </div>
      ${taxWarnings(pt, econ(pt))}
      <p class="small muted">Налог считается примерно: этого хватает, чтобы оценить прибыль, но бухгалтера не заменяет.</p>
    </div>`;

  $('#taxMode').value = t.mode;
  $('#taxEntity').value = t.entity || 'ip';
  const tv = $('#taxVat'); if (tv) tv.value = String(+t.vat || 0);
  const upd = (id, fn) => { const el = $('#' + id); if (el) el.onchange = ev => { fn(ev.target.value); save(); keepScroll(renderCosts); }; };
  upd('payShare', v => pt.pay.share = Math.min(100, parseNum(v)));
  upd('payFee', v => pt.pay.fee = Math.min(100, parseNum(v)));
  upd('dCheck', v => pt.delivery.check = parseNum(v));
  upd('dShare', v => pt.delivery.share = Math.min(100, parseNum(v)));
  upd('dCost', v => pt.delivery.cost = parseNum(v));
  upd('taxMode', v => { t.mode = v; if (v === 'usn6' && (!+t.rate || +t.rate === 15)) t.rate = 6; if (v === 'usn15' && (!+t.rate || +t.rate === 6)) t.rate = 15; if (v === 'none' || v === 'fixed') t.vat = 0; });
  upd('taxRate', v => t.rate = Math.min(100, parseNum(v)));
  upd('taxReduce', v => t.reduce = parseNum(v));
  upd('taxFixed', v => t.fixed = parseNum(v));
  upd('taxVat', v => t.vat = +v);
  upd('taxEntity', v => t.entity = v);

  const table = (sel, arr, mk) => {
    const tb = $(sel);
    tb.onchange = ev => {
      const tr = ev.target.closest('tr[data-k]'), f = ev.target.dataset.f; if (!tr || !f) return;
      arr[+tr.dataset.k][f] = f === 'name' ? ev.target.value : f === 'day' ? Math.min(31, Math.max(0, Math.round(parseNum(ev.target.value)))) : parseNum(ev.target.value);
      save(); keepScroll(renderCosts);
      if (f === 'share' && arr.reduce((a, c) => a + (+c.share || 0), 0) > 100) note('Сумма долей заказов агрегаторов больше 100%. Проверьте цифры.');
    };
    tb.onclick = ev => { const b = ev.target.closest('[data-del]'); if (!b) return; arr.splice(+b.closest('tr').dataset.k, 1); save(); keepScroll(renderCosts); };
    return () => { arr.push(mk()); save(); keepScroll(renderCosts); const ins = view.querySelectorAll(sel + ' input[data-f="name"]'); ins[ins.length - 1].focus(); };
  };
  $('#addFixed').onclick = table('#fixed', pt.fixed, () => ({ name: '', sum: 0, day: 0 }));
  $('#addCh').onclick = table('#chs', pt.channels, () => ({ name: '', share: 0, fee: 0 }));
}

/* =========================================================================
   Даты
   ========================================================================= */
const pad = n => String(n).padStart(2, '0');
const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d || 1); };
const fmtDay = s => dayOf(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const addDays = (s, n) => { const d = dayOf(s); d.setDate(d.getDate() + n); return isoDay(d); };
const mkey = m => `${m.date}|${String(m.t || 0).padStart(15, '0')}`;
const CTRL = { '': 'обычный', vsd: 'Меркурий', mark: 'Честный знак' };

/* =========================================================================
   Склад: движения продуктов
   in — приход по накладной (qty в кг / л / шт, sum ₽)
   out — списание по акту (reason)
   sale — расход по продажам смены, посчитан по техкартам на момент продажи
   inv — инвентаризация: пересчитанный остаток (expected — сколько ожидалось)
   ========================================================================= */
function balances(pt, untilKey = null) {
  const bal = new Map(), lastInv = new Map();
  const moves = pt.moves.filter(m => !untilKey || mkey(m) < untilKey).sort((a, b) => mkey(a) < mkey(b) ? -1 : 1);
  for (const m of moves) for (const l of m.lines) {
    const v = +l.qty || 0;
    if (m.type === 'inv') { bal.set(l.ing, v); lastInv.set(l.ing, m.date); }
    else if (m.type === 'in') bal.set(l.ing, (bal.get(l.ing) || 0) + v);
    else bal.set(l.ing, (bal.get(l.ing) || 0) - v);
  }
  return { bal, lastInv };
}
// расход продуктов на проданные блюда: { ing: qty в кг / л / шт }
function salesToLines(qtyMap) {
  const u = new Map();
  for (const id in qtyMap) { const d = dishById(id); if (d && +qtyMap[id]) usage(d, +qtyMap[id], u); }
  return [...u].map(([ing, g]) => { const i = ingById(ing); return { ing, qty: Math.round(toUnit(g, i) * 1000) / 1000 }; }).filter(l => l.qty > 0);
}
const lineMoney = (m, l) => m.type === 'in' ? +l.sum || 0 : (+l.qty || 0) * packOf(ingById(l.ing) || {});
const REASONS = ['Испортилось', 'Истёк срок', 'Брак поставщика', 'Проработка и пробы', 'Питание персонала', 'Другое'];

let stockForm = null; // 'in' | 'out' | 'inv' | null
function renderStock() {
  const pt = P();
  const { bal, lastInv } = balances(pt);
  const perDay = new Map();
  const u = salesUsage(pt);
  for (const [id, g] of u) perDay.set(id, toUnit(g, ingById(id)) / (+pt.sales.days || 30));
  const ings = db.ing.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const tracked = ings.filter(i => bal.has(i.id) || perDay.has(i.id));
  const worth = tracked.reduce((a, i) => a + Math.max(0, bal.get(i.id) || 0) * packOf(i), 0);
  const lastInvMove = pt.moves.filter(m => m.type === 'inv').sort((a, b) => mkey(b) < mkey(a) ? -1 : 1)[0];
  const invLoss = lastInvMove ? lastInvMove.lines.reduce((a, l) => a + ((+l.expected || 0) - (+l.qty || 0)) * packOf(ingById(l.ing) || {}), 0) : 0;
  const month = isoDay().slice(0, 7);
  const outMonth = pt.moves.filter(m => m.type === 'out' && m.date.startsWith(month)).reduce((a, m) => a + m.lines.reduce((s, l) => s + lineMoney(m, l), 0), 0);
  const recent = pt.moves.slice().sort((a, b) => mkey(b) < mkey(a) ? -1 : 1).slice(0, 40);

  view.innerHTML = `
    <div class="head"><h1>Склад</h1>
      <div class="bar tight"><button class="main" data-form="in">Приход</button><button class="ghost" data-form="out">Списание</button><button class="ghost" data-form="inv">Инвентаризация</button></div></div>
    <p class="lead">Точка «${esc(pt.name)}». Остаток считается сам: последняя инвентаризация плюс приходы минус списания и продажи по техкартам. Продажи списываются при закрытии смены во вкладке «Деньги».</p>
    <div id="form"></div>
    <div class="facts">
      <div class="fact"><span>На складе</span><b>${rub(worth)}</b></div>
      <div class="fact"><span>Списано в этом месяце</span><b>${rub(outMonth)}</b></div>
      ${lastInvMove ? `<div class="fact ${invLoss > 0.5 ? 'bad' : ''}"><span>Инвентаризация ${fmtDay(lastInvMove.date)}</span><b>${invLoss > 0.5 ? 'недостача ' + rub(invLoss) : invLoss < -0.5 ? 'излишек ' + rub(-invLoss) : 'сошлось'}</b></div>` : ''}
    </div>
    <div class="card">
      <h2>Остатки</h2>
      ${tracked.length ? `<div class="tw"><table><thead><tr><th>Продукт</th><th class="r">Остаток</th><th class="r hide-m">Стоимость</th><th class="r">Хватит</th><th class="r hide-m">Пересчитан</th><th class="hide-m">Учёт</th></tr></thead><tbody>
      ${tracked.map(i => {
        const b = bal.get(i.id) || 0, pd = perDay.get(i.id) || 0, left = pd > 0 ? b / pd : Infinity;
        return `<tr><td>${esc(i.name)}</td><td class="r ${b < 0 ? 'bad' : ''}">${fmtQ(b, i)}</td><td class="r hide-m">${rub(Math.max(0, b) * packOf(i))}</td>
          <td class="r ${left < 2 ? 'bad' : left < 4 ? 'warn-t' : 'muted'}">${pd > 0 ? (left <= 0 ? 'закончился' : left > 60 ? 'больше 60 дн.' : `${(Math.floor(left * 10) / 10).toLocaleString('ru-RU')} дн.`) : ''}</td>
          <td class="r muted hide-m">${lastInv.has(i.id) ? fmtDay(lastInv.get(i.id)) : '—'}</td><td class="muted small hide-m">${i.ctrl ? CTRL[i.ctrl] : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="small muted">«Хватит» — на сколько дней остатка при продажах как за последний период. Отрицательный остаток значит, что не внесён приход или техкарта занижает расход: проведите инвентаризацию.</p>` : '<p class="muted">Склад пока пуст. Начните с инвентаризации: пересчитайте, что есть, и внесите. Дальше остатки будут считаться сами.</p>'}
    </div>
    <div class="card">
      <h2>Журнал</h2>
      ${recent.length ? `<div class="tw"><table><thead><tr><th>Дата</th><th>Что</th><th class="hide-m">Подробно</th><th class="r">Сумма</th><th></th></tr></thead><tbody id="journal">
      ${recent.map(m => {
        const money = m.lines.reduce((a, l) => a + lineMoney(m, l), 0);
        const what = { in: 'Приход' + (m.supplier ? ': ' + esc(m.supplier) : ''), out: 'Списание: ' + esc(m.reason || ''), sale: m.note ? esc(m.note) : 'Продажи смены', inv: 'Инвентаризация' }[m.type];
        const det = m.lines.slice(0, 4).map(l => { const i = ingById(l.ing); return i ? `${esc(i.name)} ${fmtQ(+l.qty, i)}` : ''; }).join(', ') + (m.lines.length > 4 ? ` и ещё ${m.lines.length - 4}` : '');
        const lossInv = m.type === 'inv' ? m.lines.reduce((a, l) => a + ((+l.expected || 0) - (+l.qty || 0)) * packOf(ingById(l.ing) || {}), 0) : 0;
        return `<tr data-id="${m.id}"><td class="muted">${fmtDay(m.date)}</td><td>${what}</td><td class="muted small hide-m">${det}</td>
          <td class="r ${m.type === 'inv' && lossInv > 0.5 ? 'bad' : ''}">${m.type === 'inv' ? (Math.abs(lossInv) > 0.5 ? (lossInv > 0 ? 'недостача ' : 'излишек ') + rub(Math.abs(lossInv)) : 'сошлось') : rub(money)}</td>
          <td>${m.shift ? '' : '<button class="del" data-del>удалить</button>'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted">Записей пока нет.</p>'}
    </div>`;

  view.querySelectorAll('[data-form]').forEach(b => b.onclick = () => { stockForm = b.dataset.form; drawForm(); $('#form').scrollIntoView({ block: 'start' }); });
  const jr = $('#journal');
  if (jr) jr.onclick = e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const id = b.closest('tr').dataset.id, snap = JSON.stringify(pt.moves);
    pt.moves = pt.moves.filter(m => m.id !== id); save(); keepScroll(renderStock);
    note('Запись удалена.', [['Ок', () => {}], ['Вернуть', () => { pt.moves = JSON.parse(snap); save(); renderStock(); }]]);
  };
  if (stockForm) drawForm();

  function drawForm() {
    const box = $('#form'), type = stockForm;
    const opts = sel => ings.map(i => `<option value="${i.id}"${i.id === sel ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
    const title = { in: 'Приход по накладной', out: 'Списание', inv: 'Инвентаризация' }[type];
    let body = '';
    if (type === 'inv') {
      body = `<p class="muted small">Впишите, сколько есть на самом деле. Пустые строки не меняются. Справа — сколько должно быть по расчёту.</p>
        <div class="tw"><table class="edit"><thead><tr><th>Продукт</th><th class="r">По расчёту</th><th class="r">Пересчитано</th></tr></thead><tbody id="fl">
        ${ings.map(i => `<tr data-ing="${i.id}"><td>${esc(i.name)}</td><td class="r muted">${bal.has(i.id) ? fmtQ(bal.get(i.id), i) : '—'}</td><td class="r"><input class="n" data-f="qty" inputmode="decimal"><span class="unit">${i.unit}</span></td></tr>`).join('')}
        </tbody></table></div>`;
    } else {
      body = `<div class="tw"><table class="edit"><thead><tr><th>Продукт</th><th class="r">Количество</th>${type === 'in' ? '<th class="r">Сумма, ₽</th>' : ''}<th></th></tr></thead><tbody id="fl">
        ${[0, 1, 2].map(() => `<tr><td><select data-f="ing"><option value="">выберите</option>${opts('')}</select></td><td class="r"><input class="n" data-f="qty" inputmode="decimal"><span class="unit" data-u></span></td>${type === 'in' ? '<td class="r"><input class="n" data-f="sum" inputmode="decimal"></td>' : ''}<td></td></tr>`).join('')}
        </tbody></table></div><div class="bar"><button class="ghost" id="addLine">Ещё строка</button></div>`;
    }
    box.innerHTML = `<div class="card form">
      <div class="head"><h2>${title}</h2><button class="link" id="fClose">закрыть</button></div>
      <div class="grid">
        <label class="fld">Дата<span class="inp"><input id="fDate" type="date" value="${isoDay()}"></span></label>
        ${type === 'in' ? '<label class="fld">Поставщик<span class="inp"><input id="fSup" placeholder="необязательно"></span></label>' : ''}
        ${type === 'out' ? `<label class="fld">Причина<span class="inp"><select id="fReason">${REASONS.map(r => `<option>${r}</option>`).join('')}</select></span></label>` : ''}
      </div>
      ${body}
      ${type === 'in' ? '<label class="check"><input type="checkbox" id="fPrice" checked> обновить цены продуктов по этой накладной</label>' : ''}
      <div class="bar"><button class="main" id="fSave">Сохранить</button></div>
    </div>`;
    const fl = $('#fl');
    const unitOf = tr => { const s = tr.querySelector('[data-f="ing"]'); const i = s && ingById(s.value); const u = tr.querySelector('[data-u]'); if (u) u.textContent = i ? i.unit : ''; };
    fl.onchange = e => { const tr = e.target.closest('tr'); if (tr) unitOf(tr); };
    const al = $('#addLine');
    if (al) al.onclick = () => { const tr = fl.rows[0].cloneNode(true); tr.querySelectorAll('input').forEach(x => x.value = ''); tr.querySelector('select').value = ''; fl.appendChild(tr); unitOf(tr); };
    $('#fClose').onclick = () => { stockForm = null; box.innerHTML = ''; };
    $('#fSave').onclick = () => {
      const date = $('#fDate').value || isoDay();
      const m = { id: uid(), t: Date.now(), date, type, lines: [] };
      if (type === 'inv') {
        for (const tr of fl.rows) { const v = tr.querySelector('input').value.trim(); if (v !== '') m.lines.push({ ing: tr.dataset.ing, qty: parseNum(v) }); }
        const before = balances(pt, mkey(m)).bal;
        m.lines.forEach(l => l.expected = Math.round((before.get(l.ing) || 0) * 1000) / 1000);
      } else {
        for (const tr of fl.rows) {
          const ing = tr.querySelector('[data-f="ing"]').value, qty = parseNum(tr.querySelector('[data-f="qty"]').value);
          if (!ing || !(qty > 0)) continue;
          const l = { ing, qty }; if (type === 'in') l.sum = parseNum(tr.querySelector('[data-f="sum"]').value);
          m.lines.push(l);
        }
        if (type === 'in') m.supplier = $('#fSup').value.trim();
        if (type === 'out') m.reason = $('#fReason').value;
      }
      if (!m.lines.length) { note('Заполните хотя бы одну строку: продукт и количество.'); return; }
      let msg = [];
      if (type === 'in' && $('#fPrice').checked) {
        const ch = [];
        for (const l of m.lines) {
          const i = ingById(l.ing); if (!(l.sum > 0) || !(+i.qty > 0)) continue;
          const newPack = l.sum / l.qty * +i.qty;
          if (Math.abs(newPack - +i.price) > 0.005) { i.hist.push({ t: Date.now(), v: packOf(i) }); ch.push(`${esc(i.name)}: ${rub(+i.price)} стало ${rub(newPack)}`); i.price = Math.round(newPack * 100) / 100; }
        }
        if (ch.length) msg.push('Цены обновлены: ' + ch.join('; ') + '.');
      }
      const ctrl = k => [...new Set(m.lines.map(l => ingById(l.ing)).filter(i => i && i.ctrl === k).map(i => esc(i.name)))];
      if (type === 'in' && ctrl('vsd').length) msg.push(`Под ветконтролем: ${ctrl('vsd').join(', ')}. Погасите ВСД в «Меркурии» при приёмке: за приёмку без ВСД организации грозит штраф 10–20 тыс. ₽.`);
      if (type === 'in' && ctrl('mark').length) msg.push(`Маркированные товары: ${ctrl('mark').join(', ')}. Примите УПД в ЭДО, иначе коды не перейдут на вас в «Честном знаке».`);
      if (type === 'out' && ctrl('mark').length) msg.push(`Списание маркированных товаров (${ctrl('mark').join(', ')}) нужно оформить и в «Честном знаке».`);
      if (type === 'inv') {
        const loss = m.lines.reduce((a, l) => a + ((+l.expected || 0) - l.qty) * packOf(ingById(l.ing)), 0);
        msg.unshift(Math.abs(loss) < 0.5 ? 'Инвентаризация сошлась с расчётом.' : loss > 0 ? `Недостача на <b class="bad">${rub(loss)}</b> по сравнению с расчётом.` : `Излишек на ${rub(-loss)}: возможно, не все продажи списаны или техкарты завышены.`);
      }
      pt.moves.push(m); save(); stockForm = null; renderStock();
      note(['Сохранено.', ...msg].join('<br>'));
    };
  }
}

/* =========================================================================
   Деньги: смены, зарплата, сводка месяца, календарь платежей
   ========================================================================= */
const PAYS = [['cash', 'Наличные'], ['card', 'Карта'], ['sbp', 'СБП'], ['online', 'Оплата на сайте'], ['agg', 'Выплаты агрегатора']];
const ROLES = ['Повар', 'Сушист', 'Оператор', 'Курьер', 'Администратор', 'Другое'];
const KINDS = { work: 'трудовой договор', self: 'самозанятый', gph: 'договор ГПХ' };
const shiftRev = s => PAYS.reduce((a, [k]) => a + (+s[k] || 0), 0);
const shiftExp = s => (s.exp || []).reduce((a, x) => a + (+x.sum || 0), 0);
const cashExpected = s => (+s.start || 0) + (+s.cash || 0) - shiftExp(s) - (+s.withdrawn || 0);
function payFor(st, s) {
  const w = (s.staff || []).find(x => x.id === st.id); if (!w) return 0;
  return (+st.rate || 0) + shiftRev(s) * (+st.pct || 0) / 100 + (+w.orders || 0) * (+st.perOrder || 0);
}
let moneyMonth = isoDay().slice(0, 7), shiftEdit = null;

function renderMoney() {
  const pt = P();
  const shifts = pt.shifts.filter(s => s.date.startsWith(moneyMonth)).sort((a, b) => a.date < b.date ? 1 : -1);
  const rev = shifts.reduce((a, s) => a + shiftRev(s), 0);
  const byPay = PAYS.map(([k, n]) => [n, shifts.reduce((a, s) => a + (+s[k] || 0), 0)]).filter(x => x[1]);
  const cashOut = shifts.reduce((a, s) => a + shiftExp(s), 0);
  const buys = pt.moves.filter(m => m.type === 'in' && m.date.startsWith(moneyMonth)).reduce((a, m) => a + m.lines.reduce((s, l) => s + (+l.sum || 0), 0), 0);
  const pay = pt.staff.map(st => {
    const due = shifts.reduce((a, s) => a + payFor(st, s), 0);
    const paid = pt.paid.filter(p => p.staff === st.id && p.month === moneyMonth).reduce((a, p) => a + (+p.sum || 0), 0);
    return { st, due, paid, n: shifts.filter(s => (s.staff || []).some(x => x.id === st.id)).length };
  });
  const payDue = pay.reduce((a, x) => a + x.due, 0);
  const diffs = shifts.filter(s => s.counted !== undefined && s.counted !== '' && Math.abs(+s.counted - cashExpected(s)) >= 1);
  const left = rev - buys - cashOut - payDue;

  view.innerHTML = `
    <div class="head"><h1>Деньги</h1><div class="bar tight"><input type="month" id="mon" value="${moneyMonth}"><button class="main" id="newShift">Закрыть смену</button></div></div>
    <p class="lead">Точка «${esc(pt.name)}». Живые деньги: что пришло в кассу и на счёт, что ушло на закупку и людей. Расчётная прибыль по техкартам — во вкладке «Анализ».</p>
    <div id="shiftForm"></div>
    <div class="facts">
      <div class="fact"><span>Выручка за ${shifts.length} ${plural(shifts.length, 'смену', 'смены', 'смен')}</span><b>${rub(rev)}</b></div>
      <div class="fact"><span>Закупки по накладным</span><b>${rub(buys)}</b></div>
      <div class="fact"><span>Зарплата начислена</span><b>${rub(payDue)}</b></div>
      <div class="fact ${left < 0 ? 'bad' : ''}"><span>Осталось на аренду, налоги и прибыль</span><b>${rub(left)}</b></div>
    </div>
    <div class="card">
      <h2>Месяц</h2>
      <div class="tw"><table class="money">
        <tr><td>Выручка</td><td class="r">${rub(rev)}</td><td class="muted">${byPay.map(([n, v]) => `${n.toLowerCase()} ${rub(v)}`).join(', ')}</td></tr>
        <tr><td>Закупки по накладным</td><td class="r">−${rub(buys)}</td><td class="muted">${rev ? pct(Math.round(buys / rev * 100)) + ' от выручки' : ''}</td></tr>
        <tr><td>Расходы из кассы</td><td class="r">−${rub(cashOut)}</td><td class="muted"></td></tr>
        <tr><td>Зарплата</td><td class="r">−${rub(payDue)}</td><td class="muted">${rev ? pct(Math.round(payDue / rev * 100)) + ' от выручки' : ''}</td></tr>
        <tr class="total"><td>Осталось</td><td class="r ${left < 0 ? 'bad' : 'good'}">${rub(left)}</td><td class="muted">до аренды, налогов и других постоянных расходов</td></tr>
      </table></div>
      ${diffs.length ? `<p class="warn">Не сошлась касса в ${diffs.length} ${plural(diffs.length, 'смене', 'сменах', 'сменах')}: ${diffs.map(s => `${fmtDay(s.date)} ${+s.counted - cashExpected(s) > 0 ? '+' : '−'}${rub(Math.abs(+s.counted - cashExpected(s)))}`).join(', ')}.</p>` : ''}
    </div>

    <div class="card">
      <h2>Смены</h2>
      ${shifts.length ? `<div class="tw"><table><thead><tr><th>Дата</th><th class="r">Выручка</th><th class="r hide-m">Расходы</th><th class="r">Касса</th><th class="hide-m">Кто работал</th><th></th></tr></thead><tbody id="shifts">
        ${shifts.map(s => { const d = s.counted !== undefined && s.counted !== '' ? +s.counted - cashExpected(s) : null; return `<tr data-id="${s.id}"><td>${fmtDay(s.date)}</td><td class="r">${rub(shiftRev(s))}</td><td class="r hide-m">${shiftExp(s) ? rub(shiftExp(s)) : ''}</td>
          <td class="r ${d !== null && Math.abs(d) >= 1 ? 'bad' : 'muted'}">${d === null ? '—' : Math.abs(d) < 1 ? 'сошлась' : (d > 0 ? '+' : '−') + rub(Math.abs(d))}</td>
          <td class="muted small hide-m">${(s.staff || []).map(w => { const st = pt.staff.find(x => x.id === w.id); return st ? esc(st.name) : ''; }).filter(Boolean).join(', ')}</td>
          <td class="r"><button class="del" data-edit>изменить</button><button class="del" data-del>удалить</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted">В этом месяце смен нет. Закрывайте смену в конце дня: выручка по видам оплаты, расходы из кассы, кто работал и что продано.</p>'}
    </div>

    <div class="card">
      <h2>Зарплата</h2>
      ${pt.staff.length ? `<div class="tw"><table><thead><tr><th>Сотрудник</th><th class="r">Смен</th><th class="r">Начислено</th><th class="r">Выплачено</th><th class="r">К выплате</th><th></th></tr></thead><tbody id="payroll">
        ${pay.map(x => `<tr data-id="${x.st.id}"><td>${esc(x.st.name)} <span class="muted small">${esc(x.st.role)}</span></td><td class="r">${x.n}</td><td class="r">${rub(x.due)}</td><td class="r">${rub(x.paid)}</td>
          <td class="r ${x.due - x.paid > 0.5 ? 'accent' : 'muted'}"><b>${rub(Math.max(0, x.due - x.paid))}</b></td><td class="r">${x.due - x.paid > 0.5 ? '<button class="ghost sm" data-pay>Выплатил</button>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Добавьте сотрудников ниже, и зарплата будет считаться по сменам сама.</p>'}
      ${pt.staff.some(s => s.kind === 'self') ? '<p class="warn">Самозанятому на каждую выплату нужен чек из «Мой налог». Если человек работает по графику и подчиняется как сотрудник, налоговая может признать отношения трудовыми.</p>' : ''}
      ${pt.staff.some(s => s.kind === 'work') ? '<p class="small muted">По трудовому договору из начисленного удерживается НДФЛ, а страховые взносы работодатель платит сверху. Заложите их в постоянные расходы во вкладке «Расходы».</p>' : ''}
      <h3 style="margin-top:14px">Сотрудники и условия</h3>
      <div class="tw"><table class="edit"><thead><tr><th>Имя</th><th>Должность</th><th>Оформление</th><th class="r">За смену, ₽</th><th class="r">% выручки</th><th class="r">За заказ, ₽</th><th></th></tr></thead><tbody id="staff">
        ${pt.staff.map(s => `<tr data-id="${s.id}"><td><input data-f="name" value="${esc(s.name)}" placeholder="Имя"></td>
          <td><select data-f="role">${ROLES.map(r => `<option${r === s.role ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
          <td><select data-f="kind">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
          <td class="r"><input class="n" data-f="rate" inputmode="numeric" value="${+s.rate || ''}"></td>
          <td class="r"><input class="n s" data-f="pct" inputmode="decimal" value="${num(s.pct || 0)}"></td>
          <td class="r"><input class="n s" data-f="perOrder" inputmode="numeric" value="${+s.perOrder || ''}"></td>
          <td><button class="del" data-del>убрать</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="bar"><button class="ghost" id="addStaff">Добавить сотрудника</button></div>
    </div>

    <div class="card">
      <h2>Платежи на 60 дней</h2>
      ${calendarHtml(pt)}
    </div>`;

  $('#mon').onchange = e => { moneyMonth = e.target.value || isoDay().slice(0, 7); renderMoney(); };
  $('#newShift').onclick = () => { shiftEdit = { id: uid(), date: isoDay(), staff: [], exp: [], dishes: {} }; drawShift(); };
  const sh = $('#shifts');
  if (sh) sh.onclick = e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const s = pt.shifts.find(x => x.id === tr.dataset.id);
    if (e.target.closest('[data-edit]')) { shiftEdit = JSON.parse(JSON.stringify(s)); drawShift(); }
    if (e.target.closest('[data-del]')) {
      const snap = JSON.stringify({ shifts: pt.shifts, moves: pt.moves });
      pt.shifts = pt.shifts.filter(x => x.id !== s.id); pt.moves = pt.moves.filter(m => m.shift !== s.id); save(); keepScroll(renderMoney);
      note(`Смена ${fmtDay(s.date)} удалена вместе со списанием продаж со склада.`, [['Ок', () => {}], ['Вернуть', () => { const o = JSON.parse(snap); pt.shifts = o.shifts; pt.moves = o.moves; save(); renderMoney(); }]]);
    }
  };
  const pr = $('#payroll');
  if (pr) pr.onclick = e => {
    if (!e.target.closest('[data-pay]')) return;
    const x = pay.find(p => p.st.id === e.target.closest('tr').dataset.id);
    const sum = Math.round((x.due - x.paid) * 100) / 100;
    pt.paid.push({ id: uid(), staff: x.st.id, month: moneyMonth, sum, date: isoDay() }); save(); keepScroll(renderMoney);
    note(`Отмечено: ${esc(x.st.name)} получил ${rub(sum)}.`, [['Ок', () => {}], ['Отменить', () => { pt.paid.pop(); save(); renderMoney(); }]]);
  };
  const stb = $('#staff');
  stb.onchange = e => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    const s = pt.staff.find(x => x.id === tr.dataset.id);
    s[f] = ['name', 'role', 'kind'].includes(f) ? e.target.value : parseNum(e.target.value);
    save(); keepScroll(renderMoney);
  };
  stb.onclick = e => {
    if (!e.target.closest('[data-del]')) return;
    const id = e.target.closest('tr').dataset.id, s = pt.staff.find(x => x.id === id), snap = JSON.stringify(pt.staff);
    pt.staff = pt.staff.filter(x => x.id !== id); save(); keepScroll(renderMoney);
    note(`${esc(s.name || 'Сотрудник')} убран из списка. Старые смены остаются.`, [['Ок', () => {}], ['Вернуть', () => { pt.staff = JSON.parse(snap); save(); renderMoney(); }]]);
  };
  $('#addStaff').onclick = () => {
    pt.staff.push({ id: uid(), name: '', role: 'Повар', kind: 'work', rate: 0, pct: 0, perOrder: 0 }); save(); keepScroll(renderMoney);
    const ins = view.querySelectorAll('#staff input[data-f="name"]'); ins[ins.length - 1].focus();
  };
  if (shiftEdit) drawShift();

  function drawShift() {
    const s = shiftEdit, box = $('#shiftForm');
    const isNew = !pt.shifts.some(x => x.id === s.id);
    const prev = pt.shifts.filter(x => x.date < s.date).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (isNew && s.start === undefined && prev && prev.counted !== undefined && prev.counted !== '') s.start = +prev.counted;
    const dishesTxt = Object.entries(s.dishes || {}).map(([id, q]) => { const d = dishById(id); return d ? `${d.name}\t${q}` : ''; }).filter(Boolean).join('\n');
    box.innerHTML = `<div class="card form">
      <div class="head"><h2>${isNew ? 'Закрыть смену' : 'Смена ' + fmtDay(s.date)}</h2><button class="link" id="sClose">закрыть</button></div>
      <div class="grid">
        <label class="fld">Дата<span class="inp"><input id="sDate" type="date" value="${s.date}"></span></label>
        ${PAYS.map(([k, n]) => `<label class="fld">${n}<span class="inp"><input data-k="${k}" type="number" min="0" step="any" value="${s[k] ?? ''}"><span class="unit">₽</span></span></label>`).join('')}
      </div>
      <h3 style="margin-top:14px">Наличные в кассе</h3>
      <div class="grid">
        <label class="fld">На начало смены<span class="inp"><input data-k="start" type="number" min="0" step="any" value="${s.start ?? ''}"><span class="unit">₽</span></span></label>
        <label class="fld">Изъято или сдано в банк<span class="inp"><input data-k="withdrawn" type="number" min="0" step="any" value="${s.withdrawn ?? ''}"><span class="unit">₽</span></span></label>
        <label class="fld">Пересчитано в конце<span class="inp"><input data-k="counted" type="number" min="0" step="any" value="${s.counted ?? ''}"><span class="unit">₽</span></span><span class="hint" id="sCash"></span></label>
      </div>
      <h3 style="margin-top:14px">Расходы из кассы</h3>
      <div class="tw"><table class="edit"><tbody id="sExp">${(s.exp.length ? s.exp : [{ name: '', sum: '' }]).map(x => `<tr><td><input data-e="name" value="${esc(x.name)}" placeholder="На что потрачено"></td><td class="r"><input class="n" data-e="sum" inputmode="decimal" value="${x.sum || ''}"><span class="unit">₽</span></td></tr>`).join('')}</tbody></table></div>
      <div class="bar"><button class="ghost" id="sAddExp">Ещё расход</button></div>
      ${pt.staff.length ? `<h3>Кто работал</h3><div class="tw"><table class="edit"><tbody id="sStaff">${pt.staff.map(st => { const w = s.staff.find(x => x.id === st.id); return `<tr data-id="${st.id}"><td><label class="check" style="margin:0"><input type="checkbox"${w ? ' checked' : ''}> ${esc(st.name || 'Без имени')} <span class="muted small">${esc(st.role)}</span></label></td>
        <td class="r">${+st.perOrder ? `<input class="n s" data-o inputmode="numeric" value="${w ? w.orders || '' : ''}" placeholder="0"><span class="unit">заказов</span>` : ''}</td><td class="r muted" data-p></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted small">Сотрудников пока нет, их можно добавить ниже в «Зарплате».</p>'}
      <h3 style="margin-top:14px">Что продано</h3>
      <p class="muted small">Вставьте отчёт кассы за смену: название и количество. Продукты по техкартам спишутся со склада.</p>
      <textarea id="sDishes" rows="4" placeholder="Название блюда	количество">${esc(dishesTxt)}</textarea>
      <div class="bar"><button class="main" id="sSave">Сохранить смену</button><span class="muted" id="sTotal"></span></div>
    </div>`;
    box.scrollIntoView({ block: 'start' });
    const read = () => {
      s.date = $('#sDate').value || isoDay();
      box.querySelectorAll('[data-k]').forEach(i => { const v = i.value.trim(); if (v === '') delete s[i.dataset.k]; else s[i.dataset.k] = parseNum(v); });
      s.exp = [...box.querySelectorAll('#sExp tr')].map(tr => ({ name: tr.querySelector('[data-e="name"]').value.trim(), sum: parseNum(tr.querySelector('[data-e="sum"]').value) })).filter(x => x.name || x.sum);
      s.staff = [...box.querySelectorAll('#sStaff tr')].filter(tr => tr.querySelector('input[type=checkbox]').checked)
        .map(tr => { const o = tr.querySelector('[data-o]'); return { id: tr.dataset.id, orders: o ? Math.round(parseNum(o.value)) : 0 }; });
    };
    const live = () => {
      read();
      const exp = cashExpected(s);
      $('#sCash').innerHTML = `по расчёту должно быть ${rub(exp)}` + (s.counted !== undefined ? (Math.abs(s.counted - exp) < 1 ? ', <span class="good">сходится</span>' : `, <span class="bad">${s.counted > exp ? 'излишек' : 'недостача'} ${rub(Math.abs(s.counted - exp))}</span>`) : '');
      box.querySelectorAll('#sStaff tr').forEach(tr => { const st = pt.staff.find(x => x.id === tr.dataset.id); tr.querySelector('[data-p]').textContent = s.staff.some(w => w.id === st.id) ? rub(payFor(st, s)) : ''; });
      $('#sTotal').textContent = `Выручка ${rub(shiftRev(s))}`;
    };
    box.oninput = box.onchange = live; live();
    $('#sAddExp').onclick = () => { read(); s.exp.push({ name: '', sum: '' }); drawShift(); };
    $('#sClose').onclick = () => { shiftEdit = null; box.innerHTML = ''; };
    $('#sSave').onclick = () => {
      read();
      const byName = new Map(db.dishes.map(d => [key(d.name), d])), miss = [];
      s.dishes = {};
      for (const line of $('#sDishes').value.split('\n')) {
        const m = line.trim().match(/^(.+?)[\t;,\s]+(\d+(?:[.,]\d+)?)\s*(?:шт\.?|порц\.?)?$/i);
        if (!m) continue;
        const d = byName.get(key(m[1].replace(/[\t;,]+$/, '')));
        if (!d) { miss.push(m[1].trim()); continue; }
        s.dishes[d.id] = (s.dishes[d.id] || 0) + Math.round(parseNum(m[2]));
      }
      pt.shifts = pt.shifts.filter(x => x.id !== s.id).concat([s]);
      pt.moves = pt.moves.filter(m => m.shift !== s.id);
      const lines = salesToLines(s.dishes);
      if (lines.length) pt.moves.push({ id: uid(), t: Date.now(), date: s.date, type: 'sale', shift: s.id, lines });
      save(); shiftEdit = null; moneyMonth = s.date.slice(0, 7); renderMoney();
      const msg = [`Смена ${fmtDay(s.date)} сохранена: выручка ${rub(shiftRev(s))}.`];
      if (lines.length) msg.push(`Со склада списаны продукты по техкартам: ${lines.length} ${plural(lines.length, 'позиция', 'позиции', 'позиций')}.`);
      if (miss.length) msg.push(`Нет в меню: ${miss.slice(0, 8).map(esc).join(', ')}.`);
      note(msg.join('<br>'));
    };
  }
}

// Календарь: постоянные расходы с днём оплаты и налоговые сроки (ЕНП, 2026)
function calendarHtml(pt) {
  const t0 = isoDay(), t1 = addDays(t0, 60), items = [];
  const e = econ(pt), perMonthTax = e.tax / e.D * 30, perMonthVat = e.vat / e.D * 30;
  const d0 = dayOf(t0);
  for (let k = 0; k < 3; k++) {
    const y = d0.getFullYear(), m = d0.getMonth() + k, last = new Date(y, m + 1, 0).getDate();
    for (const f of pt.fixed) if (+f.day >= 1) items.push({ date: isoDay(new Date(y, m, Math.min(+f.day, last))), name: f.name || 'Расход', sum: +f.sum || 0 });
  }
  const years = [d0.getFullYear(), d0.getFullYear() + 1];
  const t = pt.tax, usn = t.mode === 'usn6' || t.mode === 'usn15';
  for (const y of years) {
    if (usn) {
      items.push({ date: `${y}-04-28`, name: 'УСН: аванс за I квартал', sum: perMonthTax * 3, tax: 1 });
      items.push({ date: `${y}-07-28`, name: 'УСН: аванс за полугодие', sum: perMonthTax * 3, tax: 1 });
      items.push({ date: `${y}-10-28`, name: 'УСН: аванс за 9 месяцев', sum: perMonthTax * 3, tax: 1 });
      items.push({ date: t.entity === 'org' ? `${y}-03-28` : `${y}-04-28`, name: `УСН за ${y - 1} год`, sum: perMonthTax * 3, tax: 1 });
    }
    if (usn && +t.vat) for (let mo = 1; mo <= 12; mo++) items.push({ date: `${y}-${pad(mo)}-28`, name: 'НДС: треть за прошлый квартал', sum: perMonthVat, tax: 1 });
    if (t.entity !== 'org') {
      items.push({ date: `${y}-12-28`, name: `Фиксированные взносы ИП за ${y}`, sum: y === 2026 ? 57390 : NaN, tax: 1 });
      items.push({ date: `${y}-07-01`, name: `Взнос ИП 1% с дохода выше 300 тыс. ₽ за ${y - 1}`, sum: Math.max(0, (e.annual - 300000) * 0.01), tax: 1 });
    }
  }
  const list = items.filter(x => x.date >= t0 && x.date <= t1).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!list.length) return '<p class="muted">В ближайшие 60 дней платежей нет. Укажите день оплаты у постоянных расходов во вкладке «Расходы».</p>';
  const days = s => Math.round((dayOf(s) - dayOf(t0)) / 864e5);
  return `<div class="tw"><table><tbody>${list.map(x => `<tr><td class="muted nowrap">${fmtDay(x.date)}</td><td>${esc(x.name)}${x.tax ? ' <span class="tag">налог</span>' : ''}</td>
    <td class="r">${isFinite(x.sum) && x.sum > 0.5 ? (x.tax && !/^Фикс/.test(x.name) ? 'около ' : '') + rub(x.sum) : ''}</td><td class="r muted small">${days(x.date) === 0 ? 'сегодня' : 'через ' + days(x.date) + ' дн.'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Суммы налогов примерные: по продажам текущего периода. Налоги платятся единым налоговым платежом. Если 28-е выпадает на выходной, срок переносится на ближайший рабочий день. ${pt.tax.mode === 'fixed' ? 'Сроки оплаты патента зависят от его срока: смотрите в самом патенте.' : ''}</p>`;
}

/* =========================================================================
   Закупка
   ========================================================================= */
function renderBuy() {
  const pt = P();
  if (!db.dishes.some(d => qtyOf(d, pt))) { view.innerHTML = '<div class="head"><h1>Закупка</h1></div>' + noSales(); return; }
  const Pl = pt.plan;
  view.innerHTML = `
    <div class="head"><h1>Закупка</h1><button class="main" id="copyBuy">Скопировать для поставщика</button></div>
    <p class="lead">Точка «${esc(pt.name)}». Сколько купить, если продажи пойдут как за последние ${days(pt.sales.days)}. Остатки берутся со склада.</p>
    <div class="card">
      <div class="bar"><label>На сколько дней <input id="pDays" type="number" min="1" max="60" value="${Pl.days}" class="s"></label>
        <label>Запас <input id="pRes" type="number" min="0" max="100" value="${Pl.reserve}" class="s"> %</label></div>
      <div class="tw"><table class="edit"><thead><tr><th>Продукт</th><th class="r">Нужно</th><th class="r">Есть</th><th class="r">Купить</th><th class="r hide-m">Упаковок</th><th class="r">Сумма</th></tr></thead>
      <tbody id="buy"></tbody><tfoot><tr class="total"><td colspan="5">Итого</td><td class="r" id="buyTot"></td></tr></tfoot></table></div>
      <p class="small muted">Нужно — брутто, с учётом отхода и запаса. Купить округляется вверх до целых упаковок. Если остатки неточные, проведите инвентаризацию во вкладке «Склад».</p>
    </div>`;
  const rows = () => {
    const u = salesUsage(pt, Pl.days / (+pt.sales.days || 30) * (1 + Pl.reserve / 100)), bal = balances(pt).bal;
    return db.ing.filter(i => u.get(i.id) > 0).map(i => {
      const need = toUnit(u.get(i.id), i);
      const have = Math.max(0, bal.get(i.id) || 0);
      const buy = Math.max(0, need - have), packs = +i.qty > 0 ? Math.ceil(buy / +i.qty - 1e-9) : 0;
      return { i, need, have, buy, packs, sum: packs * (+i.price || 0) };
    }).sort((a, b) => b.sum - a.sum);
  };
  const draw = () => {
    const r = rows();
    $('#buy').innerHTML = r.map(x => `<tr data-id="${x.i.id}"><td>${esc(x.i.name)}</td><td class="r muted">${fmtQ(x.need, x.i)}</td>
      <td class="r muted">${fmtQ(x.have, x.i)}</td>
      <td class="r"><b>${x.packs ? fmtQ(x.packs * x.i.qty, x.i) : '—'}</b></td><td class="r muted hide-m">${x.packs ? x.packs + ' × ' + num(x.i.qty) + ' ' + x.i.unit : ''}</td>
      <td class="r">${x.sum ? rub(x.sum) : ''}</td></tr>`).join('');
    $('#buyTot').textContent = rub(r.reduce((a, x) => a + x.sum, 0));
  };
  draw();
  $('#pDays').oninput = e => { const v = parseNum(e.target.value); if (v >= 1) { Pl.days = v; save(); draw(); } };
  $('#pRes').oninput = e => { Pl.reserve = Math.max(0, parseNum(e.target.value)); save(); draw(); };
  $('#copyBuy').onclick = e => {
    const r = rows().filter(x => x.packs);
    copyText(`${db.org ? db.org + ', ' : ''}${pt.name}. Заказ на ${days(Pl.days)}:\n` + r.map(x => `${x.i.name}: ${num(x.packs * x.i.qty)} ${x.i.unit}`).join('\n'), e.target);
  };
}

/* =========================================================================
   Настройки: заведение, точки, импорт, данные
   ========================================================================= */
function importMenu(items, opt = {}) {
  if (!Array.isArray(items)) throw new Error('В файле нет списка блюд.');
  let added = 0, updated = 0;
  const byName = new Map(db.dishes.map(d => [key(d.name), d]));
  const touched = [];
  for (const it of items) {
    if (!it || !it.name) continue;
    const price = +it.price || (Array.isArray(it.sizes) && it.sizes[0] ? +it.sizes[0].price || 0 : 0);
    const w = String(it.description || '').match(/(\d+)\s*(?:гр|г)\b/i);
    let d = byName.get(key(it.name));
    if (d) { d.price = price || d.price; if (!d.yield && w) d.yield = +w[1]; updated++; }
    else { d = { id: uid(), name: String(it.name).trim(), price, pack: 0, yield: w ? +w[1] : 0, parts: [], sub: [] }; db.dishes.push(d); byName.set(key(d.name), d); added++; }
    touched.push([d, it]);
  }
  let sets = 0, found = 0; const missing = new Map();
  const clean = l => key(l.replace(/\s*[x×х]\s*\d+$/i, ''));
  for (const [d, it] of touched) {
    if (hasRecipe(d) || !it.description) continue;
    const lines = String(it.description).split('\n').map(s => s.trim()).filter(s => s && !/^вес\s*:/i.test(s));
    if (lines.length < 2) continue;
    const hits = lines.map(l => byName.get(clean(l))).filter(x => x && x !== d);
    if (hits.length < 2 && !(opt.createMissing && /set|сет/i.test(it.category || ''))) continue;
    sets++;
    for (const l of lines) {
      let sd = byName.get(clean(l));
      if (!sd && opt.createMissing) {
        sd = { id: uid(), name: l.replace(/\s*[x×х]\s*\d+$/i, ''), price: 0, pack: 0, yield: 0, parts: [], sub: [], setOnly: true };
        db.dishes.push(sd); byName.set(clean(l), sd); added++;
      }
      if (sd && sd !== d) { const ex = d.sub.find(x => x.dish === sd.id); ex ? ex.n++ : d.sub.push({ dish: sd.id, n: 1 }); found++; }
      else if (!sd) missing.set(l, 1);
    }
  }
  db.demo = false; save();
  return { added, updated, sets, found, missing: [...missing.keys()] };
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function renderSettings(report) {
  view.innerHTML = `
    <div class="head"><h1>Настройки</h1></div>
    <div class="card">
      <h2>Заведение</h2>
      <div class="grid">
        <label class="fld">Название<span class="inp"><input id="org" value="${esc(db.org)}" placeholder="Название кафе или доставки"></span><span class="hint">в шапке, техкартах и заявке поставщику</span></label>
        <label class="fld">Цель по фудкосту<span class="inp"><input id="target" type="number" min="5" max="90" value="${db.target}"><span class="unit">%</span></span><span class="hint">для доставки роллов обычно 30–35%</span></label>
        <label class="fld">Округлять цены<span class="inp"><select id="round"><option value="10">до 10 ₽</option><option value="50">до 50 ₽</option><option value="90">на 90: 490, 590</option></select></span></label>
      </div>
    </div>

    <div class="card">
      <h2>Точки</h2>
      <p class="muted small">Меню и продукты общие. У каждой точки свои продажи, остатки, расходы и налоги.</p>
      <div class="tw"><table class="edit"><thead><tr><th>Название</th><th class="r">Продаж</th><th></th></tr></thead><tbody id="pts">${db.points.map(p => `<tr data-id="${p.id}">
        <td><input data-f="name" value="${esc(p.name)}"></td>
        <td class="r muted">${Object.values(p.sales.qty).reduce((a, v) => a + (+v || 0), 0)}</td>
        <td class="r">${db.points.length > 1 ? '<button class="del" data-del>удалить</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="bar"><button class="ghost" id="addPt">Добавить точку</button><label class="check"><input type="checkbox" id="copyPt" checked> с расходами и налогами точки «${esc(P().name)}»</label></div>
    </div>

    <div class="card">
      <h2>Меню с сайта</h2>
      <p class="muted small">Загрузите <code>menu.json</code> сайта доставки. Подтянутся названия, цены и вес. Наборы, у которых в описании по строкам перечислены роллы, соберутся из них сами.</p>
      <div class="drop" id="drop"><input type="file" id="menuFile" accept=".json,application/json"> <span class="muted">или перетащите файл сюда</span></div>
      ${report || ''}
    </div>

    <div class="card">
      <h2>Данные</h2>
      <p class="muted small">Всё хранится только в этом браузере. Чтобы открыть на другом устройстве, передайте ссылкой или файлом.</p>
      <div class="bar">
        <button class="main" id="mkLink">Ссылка с данными</button>
        <button class="ghost" id="exp">Сохранить файл</button>
        <label class="btn ghost">Открыть файл <input type="file" id="impFile" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted small" id="linkInfo"></p>
      <div class="bar"><button class="link" id="reset">стереть все данные</button></div>
    </div>`;

  $('#round').value = db.round;
  $('#org').oninput = e => { db.org = e.target.value; save(); syncHeader(); };
  $('#target').onchange = e => { const v = parseNum(e.target.value); if (v >= 5 && v <= 90) { db.target = v; save(); } else e.target.value = db.target; };
  $('#round').onchange = e => { db.round = e.target.value; save(); };

  const pts = $('#pts');
  pts.onchange = e => { const tr = e.target.closest('tr'); if (!tr) return; const p = db.points.find(x => x.id === tr.dataset.id); p.name = e.target.value.trim() || 'Точка'; save(); syncPoint(); };
  pts.onclick = e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const id = b.closest('tr').dataset.id, p = db.points.find(x => x.id === id), snap = JSON.stringify(db);
    db.points = db.points.filter(x => x.id !== id); if (db.cur === id) db.cur = db.points[0].id;
    save(); syncPoint(); keepScroll(() => renderSettings());
    note(`Точка «${esc(p.name)}» удалена вместе с её продажами и остатками.`, [['Ок', () => {}], ['Вернуть', () => { db = JSON.parse(snap); save(); syncPoint(); renderSettings(); }]]);
  };
  $('#addPt').onclick = () => {
    const p = newPoint('Точка ' + (db.points.length + 1));
    if ($('#copyPt').checked) { const c = JSON.parse(JSON.stringify(P())); Object.assign(p, { fixed: c.fixed, channels: c.channels, pay: c.pay, delivery: c.delivery, tax: c.tax, plan: c.plan }); }
    db.points.push(p); db.cur = p.id; save(); syncPoint(); keepScroll(() => renderSettings());
    const ins = view.querySelectorAll('#pts input'); ins[ins.length - 1].select();
  };

  const readFile = (file, cb) => {
    const r = new FileReader();
    r.onload = () => { try { cb(JSON.parse(r.result)); } catch (err) { note('Не получилось прочитать файл: ' + esc(err.message)); } };
    r.readAsText(file);
  };
  const run = (items, opt = {}, snap = JSON.stringify(db)) => {
    let r; try { r = importMenu(items, opt); } catch (err) { note(esc(err.message)); return; }
    renderSettings(`<div class="report"><b>Готово.</b> Новых позиций: ${r.added}, обновлено: ${r.updated}. Наборов собрано: ${r.sets}, блюд в них узнано: ${r.found}.
      ${r.missing.length ? `<br>В наборах есть блюда, которых нет в меню. Обычно это роллы только для наборов или опечатка в названии: <ul>${r.missing.slice(0, 15).map(m => `<li>${esc(m)}</li>`).join('')}</ul>${r.missing.length > 15 ? `<span class="muted">и ещё ${r.missing.length - 15}</span>` : ''}` : ''}
      <div class="bar"><a class="btn ghost" href="#menu">К меню</a>${r.missing.length ? `<button class="main" id="mkMissing">Завести их как блюда (${r.missing.length})</button>` : ''}<button class="link" id="undoImp">отменить импорт</button></div></div>`);
    $('#undoImp').onclick = () => { db = JSON.parse(snap); save(); renderSettings(); };
    const mk = $('#mkMissing'); if (mk) mk.onclick = () => { db = JSON.parse(snap); run(items, { createMissing: true }, snap); };
  };
  $('#menuFile').onchange = e => e.target.files[0] && readFile(e.target.files[0], items => run(items));
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) readFile(f, items => run(items)); };

  $('#mkLink').onclick = async e => {
    if (!('CompressionStream' in window)) { $('#linkInfo').textContent = 'Этот браузер не умеет сжимать данные. Сохраните файл.'; return; }
    const link = await packLink();
    $('#linkInfo').textContent = `Длина ссылки ${link.length.toLocaleString('ru-RU')} знаков.` + (link.length > 60000 ? ' Это много, мессенджер может её обрезать, надёжнее файлом.' : '');
    copyText(link, e.target);
  };
  $('#exp').onclick = () => download(`fudkost-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db, null, 1));
  $('#impFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    readFile(f, data => {
      if (!data || !Array.isArray(data.ing) || !Array.isArray(data.dishes)) { note('Это не файл Фудкоста. Меню сайта загружайте в блок «Меню с сайта».'); return; }
      const snap = JSON.stringify(db);
      db = migrate(data); save(); syncHeader(); route();
      note(`Открыт файл «${esc(f.name)}»: ${db.dishes.length} блюд, ${db.ing.length} продуктов, ${db.points.length} ${plural(db.points.length, 'точка', 'точки', 'точек')}.`, [['Ок', () => {}], ['Вернуть как было', () => { db = JSON.parse(snap); save(); syncHeader(); route(); }]]);
    });
  };
  const replace = (fresh, msg) => {
    const snap = JSON.stringify(db); db = fresh; save(); syncHeader(); location.hash = '#menu'; route();
    note(msg, [['Ок', () => {}], ['Отменить', () => { db = JSON.parse(snap); save(); syncHeader(); route(); }]]);
  };
  $('#reset').onclick = () => replace(Object.assign(blank(), { org: db.org, target: db.target, round: db.round }), 'Все данные стёрты.');
}

/* ---------- передача ссылкой: вся база сжимается в адрес ---------- */
async function packLink() {
  const buf = await new Response(new Blob([JSON.stringify(db)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  let bin = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  return location.href.split('#')[0] + '#share=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackLink(s) {
  const bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}
function takeShare() {
  const code = location.hash.slice(7);
  history.replaceState(null, '', location.pathname + location.search + '#menu');
  route();
  if (!('DecompressionStream' in window)) { note('Этот браузер слишком старый, чтобы открыть ссылку с данными. Попробуйте свежий Chrome, Яндекс Браузер или Safari.'); return; }
  unpackLink(code).then(data => {
    if (!data || !Array.isArray(data.dishes)) throw new Error('пусто');
    note(`По ссылке пришли данные${data.org ? ` «${esc(data.org)}»` : ''}: ${data.dishes.length} блюд, ${data.ing.length} продуктов. Открыть их вместо ваших?`, [
      ['Открыть', () => { const snap = JSON.stringify(db); db = migrate(data); db.demo = false; save(); syncHeader(); route();
        note('Открыто. Ваши прежние данные можно вернуть.', [['Ок', () => {}], ['Вернуть мои', () => { db = JSON.parse(snap); save(); syncHeader(); route(); }]]); }],
      ['Не надо', () => {}]]);
  }).catch(() => note('Ссылка повреждена: скорее всего, она обрезалась при пересылке.'));
}

/* =========================================================================
   Шапка и навигация
   ========================================================================= */
function syncPoint() {
  const sel = $('#point');
  sel.innerHTML = db.points.map(p => `<option value="${p.id}"${p.id === db.cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#pointWrap').hidden = db.points.length < 2;
}
function syncHeader() {
  $('#orgName').textContent = db.org || '';
  syncPoint();
}
$('#point').onchange = e => { db.cur = e.target.value; save(); route(true); };

const TABS = { menu: renderMenu, products: renderProducts, stock: renderStock, sales: renderSales, money: renderMoney, analysis: renderAnalysis, buy: renderBuy, costs: renderCosts, settings: renderSettings };
function route(keep) {
  let [tab, id] = (location.hash.slice(1) || 'menu').split('/');
  if (tab === 'data') tab = 'settings';
  if (tab === 'check') tab = 'stock';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === (tab === 'dish' ? 'menu' : tab)));
  if (tab === 'dish') renderDish(id);
  else (TABS[tab] || renderMenu)();
  if (keep !== true) scrollTo(0, 0);
}
addEventListener('hashchange', () => location.hash.startsWith('#share=') ? takeShare() : route());
try { db = JSON.parse(localStorage.getItem(KEY)); db = db && !db.demo ? migrate(db) : null; } catch (e) { db = null; }
if (!db) { db = blank(); save(); }
syncHeader();
if (location.hash.startsWith('#share=')) takeShare(); else route();

if (TEST) window.__fk = { get db() { return db; }, set db(v) { db = v; }, stats, econ, rates, cost, unitPrice, usage, importMenu, migrate, roundPrice, P, balances };
})();
