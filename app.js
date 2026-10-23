(() => {
'use strict';
const $ = s => document.querySelector(s);
const view = $('#view');
const KEY = 'fudkost:v1';

/* ---------- данные ---------- */
// Продукт: цена за упаковку, размер упаковки, отход при обработке.
// Блюдо: продукты в граммах/мл/шт + другие блюда (так собираются сеты) + упаковка в рублях.
const UNITS = { 'кг': { per: 'г', k: 1000 }, 'л': { per: 'мл', k: 1000 }, 'шт': { per: 'шт', k: 1 } };
const uid = () => Math.random().toString(36).slice(2, 9);

function demo() {
  const I = (name, unit, qty, price, waste = 0) => ({ id: uid(), name, unit, qty, price, waste });
  const ing = [
    I('Нори', 'шт', 50, 690), I('Рис для суши', 'кг', 1, 210), I('Рисовый уксус', 'л', 1, 380),
    I('Лосось охлаждённый', 'кг', 1, 2100, 18), I('Сыр сливочный', 'кг', 1, 1150), I('Огурец', 'кг', 1, 190, 8),
    I('Авокадо', 'кг', 1, 780, 30), I('Снежный краб', 'кг', 1, 520), I('Икра тобико', 'кг', 0.5, 1350),
    I('Угорь копчёный', 'кг', 1, 2600), I('Соус унаги', 'л', 1, 560), I('Японский майонез', 'кг', 1, 420),
    I('Кунжут', 'кг', 1, 390)
  ];
  const by = n => ing.find(i => i.name === n).id;
  const base = (rice = 45) => [['Нори', .5], ['Рис для суши', rice], ['Рисовый уксус', rice / 9]];
  const D = (name, category, price, parts, pack = 20) => ({ id: uid(), name, category, price, pack, sub: [],
    parts: parts.map(([n, q]) => ({ ing: by(n), qty: Math.round(q * 10) / 10 })) });
  const dishes = [
    D('Филадельфия', 'Классические роллы', 560, [...base(), ['Лосось охлаждённый', 65], ['Сыр сливочный', 50], ['Огурец', 15]]),
    D('Калифорния', 'Классические роллы', 390, [...base(), ['Снежный краб', 40], ['Икра тобико', 15], ['Огурец', 15], ['Авокадо', 15], ['Японский майонез', 10]]),
    D('Каппа-маки', 'Классические роллы', 160, [...base(40), ['Огурец', 35], ['Кунжут', 2]], 15),
    D('Сяке-маки', 'Классические роллы', 320, [...base(40), ['Лосось охлаждённый', 30]], 15),
    D('Унаги-маки', 'Классические роллы', 290, [...base(40), ['Угорь копчёный', 30], ['Соус унаги', 5], ['Кунжут', 2]], 15),
    D('Запечённый с крабом', 'Запечённые роллы', 380, [...base(), ['Снежный краб', 50], ['Огурец', 15], ['Сыр сливочный', 20], ['Японский майонез', 25], ['Икра тобико', 5], ['Соус унаги', 5]])
  ];
  const n = name => dishes.find(d => d.name === name).id;
  dishes.push({ id: uid(), name: 'Сет «Классика»', category: 'Сеты', price: 990, pack: 35, parts: [],
    sub: [{ dish: n('Филадельфия'), n: 1 }, { dish: n('Калифорния'), n: 1 }, { dish: n('Каппа-маки'), n: 1 }] });
  const sold = { 'Филадельфия': 240, 'Калифорния': 180, 'Каппа-маки': 60, 'Сяке-маки': 90, 'Унаги-маки': 35, 'Запечённый с крабом': 150, 'Сет «Классика»': 70 };
  const qty = {}; for (const k in sold) qty[n(k)] = sold[k];
  const stock = { [by('Лосось охлаждённый')]: { start: 6, in: 30, end: 4.3 }, [by('Сыр сливочный')]: { start: 4, in: 16, end: 1.6 } };
  return migrate({ target: 35, ing, dishes, demo: true, sales: { days: 30, qty }, stock,
    fixed: [{ name: 'Аренда', sum: 45000 }, { name: 'Зарплата повара и курьера', sum: 120000 }, { name: 'Реклама ВКонтакте', sum: 10000 }, { name: 'Свет, вода, интернет', sum: 8000 }],
    channel: { share: 30, fee: 25 } });
}

// старые сохранения без новых полей не ломаются
function migrate(d) {
  d.target = d.target || 35;
  d.round = d.round || '10';
  d.sales = d.sales || { days: 30, qty: {} };
  d.sales.qty = d.sales.qty || {};
  d.stock = d.stock || {};
  d.fixed = d.fixed || [];
  d.channel = d.channel || { share: 0, fee: 0 };
  d.plan = d.plan || { days: 7, reserve: 10 };
  d.ing.forEach(i => { i.hist = i.hist || []; });
  return d;
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)); db = db ? migrate(db) : demo(); } catch (e) { db = demo(); }
let saveFail = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); saveFail = false; }
  catch (e) { if (!saveFail) note('Браузер не даёт сохранять данные. Всё работает, но после закрытия вкладки пропадёт: сохраните файл во вкладке «Файлы».'); saveFail = true; }
}

/* ---------- расчёт ---------- */
const ingById = id => db.ing.find(i => i.id === id);
const dishById = id => db.dishes.find(d => d.id === id);
// цена за грамм / мл / штуку с учётом отхода
function unitPrice(i) {
  const k = UNITS[i.unit].k, w = Math.min(95, Math.max(0, +i.waste || 0));
  if (!(+i.qty > 0)) return 0;
  return (+i.price || 0) / (+i.qty * k) / (1 - w / 100);
}
// себестоимость блюда; упаковка считается только у того, что продаётся, а не у роллов внутри сета
function cost(d, withPack = true, seen = new Set()) {
  if (seen.has(d.id)) return NaN; // сет внутри самого себя
  seen.add(d.id);
  let s = 0;
  for (const p of d.parts) { const i = ingById(p.ing); if (i) s += unitPrice(i) * (+p.qty || 0); }
  for (const x of d.sub || []) { const sd = dishById(x.dish); if (sd) s += cost(sd, false, new Set(seen)) * (+x.n || 0); }
  return s + (withPack ? +d.pack || 0 : 0);
}
const hasRecipe = d => d.parts.length > 0 || (d.sub || []).length > 0;
// блюда внутри набора, у которых ещё нет состава: пока они пустые, себестоимость набора занижена
function missingIn(d, seen = new Set(), out = new Set()) {
  if (seen.has(d.id)) return out; seen.add(d.id);
  for (const x of d.sub || []) {
    const sd = dishById(x.dish); if (!sd) continue;
    if (!hasRecipe(sd)) out.add(sd); else missingIn(sd, seen, out);
  }
  return out;
}
function stats(d) {
  const c = cost(d), price = +d.price || 0, miss = [...missingIn(d)];
  return { c, price, fc: price ? c / price * 100 : NaN, margin: price - c, empty: !hasRecipe(d), miss,
    blank: !hasRecipe(d) || miss.length > 0, // считать фудкост пока нельзя
    rec: roundPrice(c / (db.target / 100)),
    // средняя маржа с учётом заказов через агрегатор
    eff: price - c - price * db.channel.share / 100 * db.channel.fee / 100,
    agg: price * (1 - db.channel.fee / 100) - c };
}
// 10: до десятков вверх; 90: 490, 590; 50: до полтинника вверх
function roundPrice(p) {
  if (!isFinite(p) || p <= 0) return 0;
  if (db.round === '90') return Math.ceil((p + 10) / 100) * 100 - 10;
  if (db.round === '50') return Math.ceil(p / 50) * 50;
  return Math.ceil(p / 10) * 10;
}
// сколько продукта уходит на порцию до обработки (с отходом), в г / мл / шт
function usage(d, mult = 1, out = new Map(), seen = new Set()) {
  if (seen.has(d.id)) return out;
  const s2 = new Set(seen); s2.add(d.id);
  for (const p of d.parts) {
    const i = ingById(p.ing); if (!i) continue;
    const w = Math.min(95, Math.max(0, +i.waste || 0));
    out.set(i.id, (out.get(i.id) || 0) + (+p.qty || 0) / (1 - w / 100) * mult);
  }
  for (const x of d.sub || []) { const sd = dishById(x.dish); if (sd) usage(sd, mult * (+x.n || 0), out, s2); }
  return out;
}
// расход продуктов на все продажи периода, в г / мл / шт
function salesUsage(scale = 1) {
  const out = new Map();
  for (const d of db.dishes) { const q = +db.sales.qty[d.id] || 0; if (q) usage(d, q * scale, out); }
  return out;
}
const packOf = i => +i.qty > 0 ? +i.price / +i.qty : 0; // цена за кг / л / шт в накладной
const toUnit = (v, i) => v / UNITS[i.unit].k;           // из граммов в килограммы и т.п.
// какие блюда зависят от продукта (в том числе через сеты)
function usesIng(d, id, seen = new Set()) {
  if (seen.has(d.id)) return false; seen.add(d.id);
  return d.parts.some(p => p.ing === id) || (d.sub || []).some(x => { const sd = dishById(x.dish); return sd && usesIng(sd, id, seen); });
}
function usesDish(d, id) { return (d.sub || []).some(x => x.dish === id); }

/* ---------- формат ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rub = (n, d = 0) => isFinite(n) ? n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ₽' : '—';
const pct = n => isFinite(n) ? Math.round(n) + '%' : '—';
const num = n => isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '';
const parseNum = s => +String(s).replace(',', '.').replace(/\s/g, '') || 0;

/* ---------- уведомление сверху ---------- */
function note(html, acts = []) {
  const n = $('#notice');
  n.innerHTML = `<div>${html}</div>` + (acts.length ? `<div class="acts">${acts.map((a, i) => `<button data-i="${i}" class="${i ? '' : 'main'}">${esc(a[0])}</button>`).join('')}</div>` : `<div class="acts"><button data-i="x" class="link">закрыть</button></div>`);
  n.hidden = false;
  n.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i !== 'x') acts[+b.dataset.i][1]();
    n.hidden = true;
  };
}

/* ---------- Меню ---------- */
let menuState = { q: '', cat: '', sort: 'cat' };
function renderMenu() {
  const cats = [...new Set(db.dishes.map(d => d.category || 'Без категории'))];
  const all = db.dishes.map(d => ({ d, s: stats(d) }));
  const over = all.filter(x => !x.s.blank && x.s.fc > db.target).length;
  const empty = all.filter(x => x.s.empty).length;
  const partial = all.filter(x => !x.s.empty && x.s.miss.length).length;
  const q = menuState.q.toLowerCase();
  let list = all.filter(x => (!q || x.d.name.toLowerCase().includes(q)) && (!menuState.cat || (x.d.category || 'Без категории') === menuState.cat));
  const sorts = {
    cat: (a, b) => cats.indexOf(a.d.category || 'Без категории') - cats.indexOf(b.d.category || 'Без категории') || a.d.name.localeCompare(b.d.name, 'ru'),
    fc: (a, b) => (b.s.blank ? -1 : b.s.fc || 0) - (a.s.blank ? -1 : a.s.fc || 0),
    margin: (a, b) => (a.s.blank ? 1e9 : a.s.margin) - (b.s.blank ? 1e9 : b.s.margin),
    name: (a, b) => a.d.name.localeCompare(b.d.name, 'ru')
  };
  list.sort(sorts[menuState.sort]);

  let rows = '', lastCat = null;
  for (const { d, s } of list) {
    const cat = d.category || 'Без категории';
    if (menuState.sort === 'cat' && cat !== lastCat) { rows += `<tr class="cat"><td colspan="5">${esc(cat)}</td></tr>`; lastCat = cat; }
    const isOver = !s.blank && s.fc > db.target;
    rows += `<tr class="row${isOver ? ' over' : ''}" data-id="${d.id}">
      <td>${esc(d.name)}${d.sub && d.sub.length ? ` <span class="muted">(сет из ${d.sub.reduce((a, x) => a + (+x.n || 0), 0)})</span>` : ''}</td>
      <td class="r">${s.price ? rub(s.price) : '<span class="muted">нет цены</span>'}</td>
      <td class="r">${s.empty ? '<span class="muted">нет состава</span>' : s.miss.length ? `<span class="muted">нет состава у ${s.miss.length}</span>` : rub(s.c)}</td>
      <td class="r fc">${s.blank ? '' : pct(s.fc)}</td>
      <td class="r hide-m">${s.blank || !s.price ? '' : rub(s.margin)}</td></tr>`;
  }

  view.innerHTML = `
    <h1>Меню</h1>
    <p class="muted">${db.dishes.length} позиций. ${over ? `<b class="bad">${over}</b> дороже цели ${db.target}% по фудкосту` : `Все посчитанные блюда укладываются в ${db.target}%`}${empty ? `, у ${empty} не заполнен состав` : ''}${partial ? `, ${partial} ${plural(partial, 'набор посчитан', 'набора посчитаны', 'наборов посчитаны')} не полностью` : ''}.
    ${db.demo ? ' Сейчас открыт пример с условными ценами: замените на свои или загрузите меню сайта.' : ''}</p>
    <div class="bar">
      <input type="search" id="q" placeholder="Найти блюдо" value="${esc(menuState.q)}">
      <select id="cat"><option value="">Все категории</option>${cats.map(c => `<option${c === menuState.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="sort">
        <option value="cat">по категориям</option><option value="fc">сначала дорогие по фудкосту</option>
        <option value="margin">сначала с маленькой маржой</option><option value="name">по алфавиту</option>
      </select>
      <span class="grow"></span>
      <button class="main" id="add">Добавить блюдо</button>
    </div>
    <div class="tw"><table>
      <thead><tr><th>Блюдо</th><th class="r">Цена</th><th class="r"><span class="hide-m">Себестоимость</span><span class="show-m">Себест.</span></th><th class="r">Фудкост</th><th class="r hide-m">Маржа</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Ничего не нашлось.</td></tr>'}</tbody>
    </table></div>`;
  $('#sort').value = menuState.sort;
  $('#q').oninput = e => { menuState.q = e.target.value; renderMenu(); const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $('#cat').onchange = e => { menuState.cat = e.target.value; renderMenu(); };
  $('#sort').onchange = e => { menuState.sort = e.target.value; renderMenu(); };
  $('#add').onclick = () => {
    const d = { id: uid(), name: 'Новое блюдо', category: menuState.cat || '', price: 0, pack: 20, parts: [], sub: [] };
    db.dishes.push(d); save(); location.hash = '#dish/' + d.id;
  };
  view.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr.row'); if (tr) location.hash = '#dish/' + tr.dataset.id; };
}

/* ---------- Блюдо ---------- */
function renderDish(id) {
  const d = dishById(id);
  if (!d) { location.hash = '#menu'; return; }
  const cats = [...new Set(db.dishes.map(x => x.category).filter(Boolean))];
  const ingOpts = sel => db.ing.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(i => `<option value="${i.id}"${i.id === sel ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
  const dishOpts = sel => db.dishes.filter(x => x.id !== d.id).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  const usedIn = db.dishes.filter(x => usesDish(x, d.id));

  view.innerHTML = `
    <a class="back" href="#menu">К меню</a>
    <p class="print-only muted">Технологическая карта, ${new Date().toLocaleDateString('ru-RU')}</p>
    <div class="dish-head">
      <label>Название <input id="dn" value="${esc(d.name)}"></label>
      <label>Категория <input id="dc" list="cats" value="${esc(d.category)}"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label>Цена, ₽ <input id="dp" type="number" min="0" step="10" value="${+d.price || ''}"></label>
      <label>Упаковка, ₽ <input id="dk" type="number" min="0" step="1" value="${+d.pack || 0}"></label>
    </div>

    <dl class="sum" id="sum"></dl>
    <p class="advice" id="advice"></p>
    <p class="muted" id="sold"></p>

    <h2 class="${d.parts.length ? '' : 'no-print'}">Состав</h2>
    <div class="tw ${d.parts.length ? '' : 'no-print'}"><table class="edit">
      <thead><tr><th>Продукт</th><th class="r">Количество</th><th class="r">Цена единицы</th><th class="r">Стоимость</th><th class="no-print"></th></tr></thead>
      <tbody id="parts">${d.parts.map((p, k) => `<tr data-k="${k}">
        <td><select data-f="ing">${ingOpts(p.ing)}</select></td>
        <td class="r"><input class="n" data-f="qty" inputmode="decimal" value="${num(p.qty)}"><span class="unit" data-u></span></td>
        <td class="r muted" data-up></td><td class="r" data-c></td>
        <td class="no-print"><button class="del" data-del="part" title="Убрать">убрать</button></td></tr>`).join('')}
      </tbody>
    </table></div>
    <div class="bar no-print">
      ${db.ing.length ? '<button id="addPart">Добавить продукт</button>' : '<span class="muted">Сначала заведите продукты во вкладке «Продукты».</span>'}
      ${db.dishes.length > 1 ? '<button id="addSub">Добавить блюдо в набор</button>' : ''}
    </div>

    ${(d.sub || []).length ? `<h2>Входит в набор</h2>
    <div class="tw"><table class="edit">
      <thead><tr><th>Блюдо</th><th class="r">Сколько</th><th class="r">Себестоимость без упаковки</th><th class="r">Стоимость</th><th class="no-print"></th></tr></thead>
      <tbody id="subs">${d.sub.map((x, k) => `<tr data-k="${k}">
        <td><select data-f="dish">${dishOpts(x.dish)}</select></td>
        <td class="r"><input class="n" data-f="n" inputmode="decimal" value="${num(x.n)}"></td>
        <td class="r muted" data-up></td><td class="r" data-c></td>
        <td class="no-print"><button class="del" data-del="sub">убрать</button></td></tr>`).join('')}
      </tbody>
    </table></div>` : ''}

    ${usedIn.length ? `<p class="muted" style="margin-top:18px">Это блюдо входит в: ${usedIn.map(x => `<a href="#dish/${x.id}">${esc(x.name)}</a>`).join(', ')}.</p>` : ''}

    <div class="bar no-print" style="margin-top:28px">
      <button id="print">Распечатать техкарту</button>
      <button id="dup">Сделать копию</button>
      <span class="grow"></span>
      <button class="link" id="delDish">удалить блюдо</button>
    </div>`;

  function refresh() {
    const s = stats(d);
    view.querySelectorAll('#parts tr').forEach(tr => {
      const p = d.parts[+tr.dataset.k], i = ingById(p.ing);
      const per = i ? UNITS[i.unit].per : '';
      tr.querySelector('[data-u]').textContent = per;
      tr.querySelector('[data-up]').textContent = i ? rub(unitPrice(i) * (per === 'шт' ? 1 : 1000), 0) + (per === 'шт' ? '/шт' : per === 'г' ? '/кг' : '/л') : '';
      tr.querySelector('[data-c]').textContent = i ? rub(unitPrice(i) * (+p.qty || 0), 2) : '';
    });
    view.querySelectorAll('#subs tr').forEach(tr => {
      const x = d.sub[+tr.dataset.k], sd = dishById(x.dish);
      const c = sd ? cost(sd, false) : NaN;
      tr.querySelector('[data-up]').textContent = rub(c, 2);
      tr.querySelector('[data-c]').textContent = rub(c * (+x.n || 0), 2);
    });
    const loop = !isFinite(s.c);
    $('#sum').innerHTML = `
      <dt>Себестоимость</dt><dt>Фудкост</dt><dt>Маржа</dt><dt>${db.channel.share ? 'Через агрегатор' : 'Наценка'}</dt>
      <dd>${loop ? '—' : rub(s.c, 2)}</dd>
      <dd class="${s.fc > db.target && !s.blank ? 'bad' : ''}">${s.price && !s.blank ? pct(s.fc) : '—'}</dd>
      <dd>${s.price && !s.blank ? rub(s.margin) : '—'}</dd>
      <dd>${!s.price || !s.c || s.blank ? '—' : db.channel.share ? `<span class="${s.agg < 0 ? 'bad' : ''}">${rub(s.agg)}</span>` : pct((s.price - s.c) / s.c * 100)}</dd>`;
    const q = qtyOf(d);
    $('#sold').innerHTML = q && !s.blank && s.price ? `За ${db.sales.days} дн. продано ${q} шт, это ${rub(q * s.eff)} маржи${db.channel.share ? ' с учётом комиссии' : ''}.` : '';
    const adv = $('#advice');
    if (loop) adv.innerHTML = '<span class="bad">Набор ссылается сам на себя. Уберите лишнее блюдо из набора.</span>';
    else if (s.empty) adv.innerHTML = '<span class="muted">Добавьте продукты, и здесь появится себестоимость.</span>';
    else if (s.miss.length) adv.innerHTML = `<span class="bad">Себестоимость пока занижена:</span> не заполнен состав у ${s.miss.map(x => `<a href="#dish/${x.id}">${esc(x.name)}</a>`).join(', ')}.`;
    else if (!s.price) adv.innerHTML = `При цели ${db.target}% цена должна быть от <b>${rub(s.rec)}</b>. <button class="link" id="setRec">поставить</button>`;
    else if (s.fc > db.target) adv.innerHTML = `<span class="bad">Дороже цели на ${Math.round(s.fc - db.target)} п.п.</span> Чтобы уложиться в ${db.target}%, нужна цена ${rub(s.rec)} или себестоимость до ${rub(s.price * db.target / 100, 2)}. <button class="link" id="setRec">поставить ${rub(s.rec)}</button>`;
    else adv.innerHTML = `<span class="good">Укладывается в цель.</span> <span class="muted">Минимальная цена при ${db.target}%: ${rub(s.rec)}.</span>`;
    const sr = $('#setRec'); if (sr) sr.onclick = () => { d.price = s.rec; $('#dp').value = s.rec; save(); refresh(); };
  }
  refresh();

  const bind = (sel, f) => { $(sel).oninput = e => { f(e.target.value); save(); refresh(); }; };
  bind('#dn', v => d.name = v.trim() || 'Без названия');
  bind('#dc', v => d.category = v.trim());
  bind('#dp', v => d.price = parseNum(v));
  bind('#dk', v => d.pack = parseNum(v));

  const onRow = (tbodySel, arr) => {
    const tb = $(tbodySel); if (!tb) return;
    tb.oninput = tb.onchange = e => {
      const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
      const item = arr()[+tr.dataset.k];
      item[f] = (f === 'ing' || f === 'dish') ? e.target.value : parseNum(e.target.value);
      save(); refresh();
    };
    tb.onclick = e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      arr().splice(+b.closest('tr').dataset.k, 1); save(); renderDish(id);
    };
  };
  onRow('#parts', () => d.parts);
  onRow('#subs', () => d.sub);

  const ap = $('#addPart');
  if (ap) ap.onclick = () => {
    const used = new Set(d.parts.map(p => p.ing));
    const next = db.ing.find(i => !used.has(i.id)) || db.ing[0];
    d.parts.push({ ing: next.id, qty: next.unit === 'шт' ? 1 : 10 }); save(); renderDish(id);
    const rows = view.querySelectorAll('#parts select'); rows[rows.length - 1].focus();
  };
  const as = $('#addSub');
  if (as) as.onclick = () => {
    d.sub = d.sub || [];
    const other = db.dishes.find(x => x.id !== d.id && !d.sub.some(s => s.dish === x.id)) || db.dishes.find(x => x.id !== d.id);
    d.sub.push({ dish: other.id, n: 1 }); save(); renderDish(id);
  };
  $('#print').onclick = () => print();
  $('#dup').onclick = () => {
    const c = JSON.parse(JSON.stringify(d)); c.id = uid(); c.name = d.name + ' (копия)';
    db.dishes.push(c); save(); location.hash = '#dish/' + c.id;
  };
  $('#delDish').onclick = () => {
    if (usedIn.length) { note(`Нельзя удалить: «${esc(d.name)}» входит в ${usedIn.map(x => '«' + esc(x.name) + '»').join(', ')}. Сначала уберите его оттуда.`); return; }
    const snapshot = JSON.stringify(db);
    db.dishes = db.dishes.filter(x => x.id !== d.id); save(); location.hash = '#menu';
    note(`Блюдо «${esc(d.name)}» удалено.`, [['Вернуть', () => { db = JSON.parse(snapshot); save(); route(); }], ['Ок', () => {}]]);
  };
}

/* ---------- Продукты ---------- */
function renderProducts() {
  const sorted = db.ing.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  view.innerHTML = `
    <h1>Продукты</h1>
    <p class="muted">Пишите цену так, как она стоит в накладной: за упаковку. Отход — сколько процентов уходит при разделке и чистке: у лосося обычно 15–20%, у авокадо около 30%.</p>
    <div class="tw"><table class="edit">
      <thead><tr><th>Продукт</th><th class="r">Упаковка</th><th></th><th class="r">Цена упаковки, ₽</th><th class="r">Отход, %</th><th class="r">Чистая цена</th><th class="r hide-m">За полгода</th><th class="r hide-m">В блюдах</th><th></th></tr></thead>
      <tbody id="ings">${sorted.map(i => {
        const n = db.dishes.filter(d => usesIng(d, i.id)).length;
        return `<tr data-id="${i.id}">
          <td><input data-f="name" value="${esc(i.name)}"></td>
          <td class="r"><input class="n" data-f="qty" inputmode="decimal" value="${num(i.qty)}"></td>
          <td><select data-f="unit">${Object.keys(UNITS).map(u => `<option${u === i.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
          <td class="r"><input class="n" data-f="price" inputmode="decimal" value="${num(i.price)}"></td>
          <td class="r"><input class="n" data-f="waste" inputmode="decimal" value="${num(i.waste || 0)}" style="width:64px"></td>
          <td class="r" data-net></td>
          <td class="r hide-m" data-hist>${histCell(i)}</td>
          <td class="r muted hide-m">${n || ''}</td>
          <td><button class="del" data-del>убрать</button></td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="bar"><button class="main" id="addIng">Добавить продукт</button></div>`;

  const net = i => i.unit === 'шт' ? rub(unitPrice(i), 2) + '/шт' : rub(unitPrice(i) * 1000) + (i.unit === 'кг' ? '/кг' : '/л');
  view.querySelectorAll('#ings tr').forEach(tr => tr.querySelector('[data-net]').textContent = net(ingById(tr.dataset.id)));

  const tb = $('#ings');
  let before = null; // фудкост до правки цены, чтобы показать, что изменилось
  tb.addEventListener('focusin', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const id = tr.dataset.id;
    before = { id, snap: JSON.stringify(ingById(id)), fc: Object.fromEntries(db.dishes.filter(d => usesIng(d, id)).map(d => [d.id, stats(d).fc])) };
  });
  tb.oninput = tb.onchange = e => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    const i = ingById(tr.dataset.id);
    i[f] = (f === 'name') ? e.target.value : f === 'unit' ? e.target.value : parseNum(e.target.value);
    tr.querySelector('[data-net]').textContent = net(i);
    save();
  };
  tb.addEventListener('focusout', e => {
    const tr = e.target.closest('tr'); if (!tr || !before || before.id !== tr.dataset.id) return;
    if (tr.contains(e.relatedTarget)) return; // перешли в соседнее поле той же строки
    const i = ingById(before.id), b = before; before = null;
    if (!i || JSON.stringify(i) === b.snap) return;
    const old = JSON.parse(b.snap);
    if (+old.qty > 0 && packOf(old) !== packOf(i)) { i.hist.push({ t: Date.now(), v: packOf(old) }); save(); tr.querySelector('[data-hist]').innerHTML = histCell(i); }
    impact(i, b);
  });
  tb.onclick = e => {
    const btn = e.target.closest('[data-del]'); if (!btn) return;
    const id = btn.closest('tr').dataset.id, i = ingById(id);
    const users = db.dishes.filter(d => d.parts.some(p => p.ing === id));
    if (users.length) { note(`«${esc(i.name)}» есть в составе: ${users.map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}. Уберите его оттуда, потом удалите.`); return; }
    db.ing = db.ing.filter(x => x.id !== id); save(); renderProducts();
  };
  $('#addIng').onclick = () => {
    db.ing.push({ id: uid(), name: '', unit: 'кг', qty: 1, price: 0, waste: 0 }); save(); renderProducts();
    view.querySelector(`#ings tr[data-id="${db.ing[db.ing.length - 1].id}"] input`).focus();
  };
}

// изменение цены за полгода по истории правок
function histCell(i) {
  const since = Date.now() - 183 * 864e5, h = (i.hist || []).filter(x => x.t >= since);
  if (!h.length || !(h[0].v > 0)) return '';
  const ch = (packOf(i) - h[0].v) / h[0].v * 100;
  if (Math.abs(ch) < .5) return '';
  const when = new Date(h[0].t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `<span class="${ch > 0 ? 'bad' : 'good'}" title="было ${rub(h[0].v)} за ${i.unit}">${ch > 0 ? '+' : ''}${pct(ch)}</span> <span class="muted">с ${when}</span>`;
}

// после смены цены продукта: что подорожало и что ушло за цель
function impact(i, b) {
  const rows = Object.entries(b.fc).map(([id, fc0]) => {
    const d = dishById(id), s = stats(d);
    return { d, fc0, fc1: s.fc, crossed: fc0 <= db.target && s.fc > db.target };
  }).filter(r => isFinite(r.fc0) && isFinite(r.fc1) && Math.abs(r.fc1 - r.fc0) >= .5)
    .sort((a, c) => (c.fc1 - c.fc0) - (a.fc1 - a.fc0));
  if (!rows.length) return;
  const crossed = rows.filter(r => r.crossed);
  const list = rows.slice(0, 8).map(r => `<li><a href="#dish/${r.d.id}">${esc(r.d.name)}</a>: было ${pct(r.fc0)}, стало <b class="${r.fc1 > db.target ? 'bad' : ''}">${pct(r.fc1)}</b></li>`).join('');
  const old = JSON.parse(b.snap);
  note(`Цена «${esc(i.name)}» изменилась, это задело ${rows.length} ${plural(rows.length, 'блюдо', 'блюда', 'блюд')}${crossed.length ? `, из них <b class="bad">${crossed.length}</b> теперь дороже цели ${db.target}%` : ''}.<ul>${list}</ul>${rows.length > 8 ? `<span class="muted">и ещё ${rows.length - 8}</span>` : ''}`,
    [['Понятно', () => {}], ['Вернуть старую цену', () => { Object.assign(ingById(i.id), old); save(); route(); }]]);
}
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };

/* ---------- Импорт и файлы ---------- */
const CAT_NAMES = { sety: 'Сеты', klassicheskie_rolly: 'Классические роллы', zapechennye_rolly: 'Запечённые роллы', zharenye_rolly: 'Жареные роллы',
  zakuski_fastfud: 'Закуски', pizza: 'Пицца', pasta: 'Паста', wok: 'Вок', salaty: 'Салаты', deserty: 'Десерты', napitki: 'Напитки' };
const catName = c => CAT_NAMES[c] || (c ? String(c).replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase()) : '');
const key = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();

// menu.json с сайта: [{name, category, price, description}]. Сеты узнаём по строкам описания, совпадающим с названиями блюд.
function importMenu(items, opt = {}) {
  if (!Array.isArray(items)) throw new Error('В файле нет списка блюд.');
  let added = 0, updated = 0;
  const byName = new Map(db.dishes.map(d => [key(d.name), d]));
  const touched = [];
  for (const it of items) {
    if (!it || !it.name) continue;
    const price = +it.price || (Array.isArray(it.sizes) && it.sizes[0] ? +it.sizes[0].price || 0 : 0);
    let d = byName.get(key(it.name));
    if (d) { d.price = price || d.price; if (!d.category) d.category = catName(it.category); updated++; }
    else { d = { id: uid(), name: String(it.name).trim(), category: catName(it.category), price, pack: 20, parts: [], sub: [] }; db.dishes.push(d); byName.set(key(d.name), d); added++; }
    touched.push([d, it]);
  }
  let sets = 0, found = 0; const missing = new Map();
  for (const [d, it] of touched) {
    if (hasRecipe(d) || !it.description) continue;
    const lines = String(it.description).split('\n').map(s => s.trim()).filter(s => s && !/^вес\s*:/i.test(s));
    if (lines.length < 2) continue;
    const clean = l => key(l.replace(/\s*[x×х]\s*\d+$/i, ''));
    const hits = lines.map(l => byName.get(clean(l))).filter(x => x && x !== d);
    if (hits.length < 2 && !(opt.createMissing && /^сет/i.test(d.category || ''))) continue;
    sets++;
    for (const l of lines) {
      let sd = byName.get(clean(l));
      if (!sd && opt.createMissing) {
        sd = { id: uid(), name: l.replace(/\s*[x×х]\s*\d+$/i, ''), category: 'Роллы только в сетах', price: 0, pack: 0, parts: [], sub: [] };
        db.dishes.push(sd); byName.set(clean(l), sd); added++;
      }
      if (sd && sd !== d) { const ex = d.sub.find(x => x.dish === sd.id); ex ? ex.n++ : d.sub.push({ dish: sd.id, n: 1 }); found++; }
      else missing.set(l, (missing.get(l) || 0) + 1);
    }
  }
  db.demo = false;
  save();
  return { added, updated, sets, found, missing: [...missing.keys()] };
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function renderData(report) {
  view.innerHTML = `
    <h1>Файлы</h1>
    <h2>Меню с сайта</h2>
    <p>Загрузите <code>menu.json</code> сайта доставки. Цены и категории подтянутся, а сеты, в описании которых по строкам перечислены роллы, соберутся из этих роллов сами. Состав роллов останется заполнить во вкладке блюда.</p>
    <div class="drop" id="drop"><input type="file" id="menuFile" accept=".json,application/json"> <span class="muted">или перетащите файл сюда</span></div>
    ${report || ''}

    <h2>Передать ссылкой</h2>
    <p class="muted">Все данные упакуются прямо в ссылку. Отправьте её себе на телефон или владельцу в WhatsApp: по ней откроется та же база. На сервер ничего не уходит.</p>
    <div class="bar"><button class="main" id="mkLink">Сделать ссылку</button><span id="linkInfo" class="muted"></span></div>

    <h2>Свои данные</h2>
    <p class="muted">Всё хранится только в этом браузере. Чтобы перенести на другой компьютер или не потерять, сохраните файл.</p>
    <div class="bar">
      <button class="main" id="exp">Сохранить файл</button>
      <label class="btn">Открыть файл <input type="file" id="impFile" accept=".json,application/json" hidden></label>
      <span class="grow"></span>
      <button class="link" id="reset">начать с чистого листа</button>
      <button class="link" id="demo">вернуть пример</button>
    </div>`;

  const readFile = (file, cb) => {
    const r = new FileReader();
    r.onload = () => { try { cb(JSON.parse(r.result)); } catch (err) { note('Не получилось прочитать файл: ' + esc(err.message)); } };
    r.readAsText(file);
  };
  const doImport = (file, opt) => readFile(file, items => run(items, opt));
  const run = (items, opt = {}, snap = JSON.stringify(db)) => {
    const r = importMenu(items, opt);
    renderData(`<div class="report"><b>Готово.</b> Новых позиций: ${r.added}, обновлено цен: ${r.updated}. Сетов собрано: ${r.sets}, роллов в них узнано: ${r.found}.
      ${r.missing.length ? `<br>В сетах есть роллы, которых нет в меню. Обычно это роллы только для сетов или опечатка в названии: <ul>${r.missing.slice(0, 15).map(m => `<li>${esc(m)}</li>`).join('')}</ul>${r.missing.length > 15 ? `<span class="muted">и ещё ${r.missing.length - 15}</span>` : ''}` : ''}
      <div class="bar"><a class="btn" href="#menu">К меню</a>${r.missing.length ? `<button id="mkMissing">Завести их как блюда (${r.missing.length})</button>` : ''}<button class="link" id="undoImp">отменить импорт</button></div></div>`);
    $('#undoImp').onclick = () => { db = JSON.parse(snap); save(); renderData(); };
    const mk = $('#mkMissing');
    if (mk) mk.onclick = () => { db = JSON.parse(snap); run(items, { createMissing: true }, snap); };
  };
  $('#menuFile').onchange = e => e.target.files[0] && doImport(e.target.files[0]);
  const drop = $('#drop');
  drop.ondragover = e => { e.preventDefault(); drop.style.borderColor = 'var(--ink)'; };
  drop.ondragleave = () => drop.style.borderColor = '';
  drop.ondrop = e => { e.preventDefault(); drop.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) doImport(f); };

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
      if (!data || !Array.isArray(data.ing) || !Array.isArray(data.dishes)) { note('Это не файл Фудкоста. Для меню сайта используйте загрузку выше.'); return; }
      const snap = JSON.stringify(db);
      db = migrate(data); save(); route();
      note(`Открыт файл «${esc(f.name)}»: ${db.dishes.length} блюд, ${db.ing.length} продуктов.`, [['Ок', () => {}], ['Вернуть как было', () => { db = JSON.parse(snap); save(); route(); }]]);
    });
  };
  const replace = (fresh, msg) => {
    const snap = JSON.stringify(db); db = fresh; save(); location.hash = '#menu'; route();
    note(msg, [['Ок', () => {}], ['Отменить', () => { db = JSON.parse(snap); save(); route(); }]]);
  };
  $('#reset').onclick = () => replace({ target: db.target, ing: [], dishes: [] }, 'Данные очищены.');
  $('#demo').onclick = () => replace(demo(), 'Загружен пример.');
}

/* ---------- общее для новых вкладок ---------- */
const qtyOf = d => +db.sales.qty[d.id] || 0;
const fmtQ = (v, i) => {
  if (!isFinite(v)) return '—';
  const u = i.unit, x = Math.round(v * (u === 'шт' ? 10 : 100)) / (u === 'шт' ? 10 : 100);
  return x.toLocaleString('ru-RU') + ' ' + u;
};
const noSales = () => `<p>Пока нет продаж. Внесите, сколько чего продали за период, во вкладке <a href="#sales">«Продажи»</a>: отсюда считаются анализ, сверка и закупка.</p>`;
function copyText(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = t, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('Скопируйте текст:', text));
  else prompt('Скопируйте текст:', text);
}

/* ---------- Продажи ---------- */
let salesQ = '';
function renderSales(report) {
  const cats = [...new Set(db.dishes.map(d => d.category || 'Без категории'))];
  const q = salesQ.toLowerCase();
  const list = db.dishes.filter(d => d.category !== 'Роллы только в сетах' && (!q || d.name.toLowerCase().includes(q)))
    .sort((a, b) => cats.indexOf(a.category || 'Без категории') - cats.indexOf(b.category || 'Без категории') || a.name.localeCompare(b.name, 'ru'));
  let total = 0, revenue = 0;
  for (const d of db.dishes) { total += qtyOf(d); revenue += qtyOf(d) * (+d.price || 0); }
  let rows = '', last = null;
  for (const d of list) {
    const c = d.category || 'Без категории';
    if (c !== last && !q) { rows += `<tr class="cat"><td colspan="3">${esc(c)}</td></tr>`; last = c; }
    rows += `<tr data-id="${d.id}"><td>${esc(d.name)}</td>
      <td class="r"><input class="n" inputmode="numeric" value="${qtyOf(d) || ''}" placeholder="0"></td>
      <td class="r muted hide-m">${qtyOf(d) && d.price ? rub(qtyOf(d) * d.price) : ''}</td></tr>`;
  }
  view.innerHTML = `
    <h1>Продажи</h1>
    <p class="muted">Сколько порций продано за период. По этим цифрам считается всё в «Анализе», «Сверке» и «Закупке».</p>
    <div class="bar"><label>Период, дней <input id="days" type="number" min="1" max="366" value="${db.sales.days}" style="width:70px"></label>
      <span class="muted">Итого: <b id="tot">${total}</b> порций на <b id="rev">${rub(revenue)}</b></span></div>

    <h2>Вставить из кассы или Excel</h2>
    <p class="muted">По строке на блюдо: название и количество через табуляцию, точку с запятой или пробел. Строки, где нет числа в конце, пропускаются.</p>
    <textarea id="paste" rows="5" style="width:100%" placeholder="Филадельфия	240&#10;Калифорния; 180"></textarea>
    <div class="bar"><button class="main" id="parse">Разобрать</button><label class="check"><input type="checkbox" id="add2"> прибавить к текущим, а не заменить</label></div>
    ${report || ''}

    <h2>По блюдам</h2>
    <div class="bar"><input type="search" id="sq" placeholder="Найти блюдо" value="${esc(salesQ)}"><span class="grow"></span><button class="link" id="clr">обнулить все продажи</button></div>
    <div class="tw"><table class="edit"><thead><tr><th>Блюдо</th><th class="r">Продано</th><th class="r hide-m">Выручка</th></tr></thead>
    <tbody id="srows">${rows}</tbody></table></div>`;

  $('#days').oninput = e => { const v = Math.round(parseNum(e.target.value)); if (v >= 1) { db.sales.days = v; save(); } };
  $('#sq').oninput = e => { salesQ = e.target.value; renderSales(); const i = $('#sq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $('#srows').oninput = e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const v = Math.max(0, Math.round(parseNum(e.target.value)));
    if (v) db.sales.qty[tr.dataset.id] = v; else delete db.sales.qty[tr.dataset.id];
    save();
    let t = 0, r = 0; for (const d of db.dishes) { t += qtyOf(d); r += qtyOf(d) * (+d.price || 0); }
    $('#tot').textContent = t; $('#rev').textContent = rub(r);
    const d = dishById(tr.dataset.id); tr.lastElementChild.textContent = v && d.price ? rub(v * d.price) : '';
  };
  $('#clr').onclick = () => {
    const snap = JSON.stringify(db.sales.qty); db.sales.qty = {}; save(); renderSales();
    note('Продажи обнулены.', [['Ок', () => {}], ['Вернуть', () => { db.sales.qty = JSON.parse(snap); save(); renderSales(); }]]);
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
    const snap = JSON.stringify(db.sales.qty);
    if (!add) db.sales.qty = {};
    for (const [id, v] of got) db.sales.qty[id] = (add ? qtyOf(dishById(id)) : 0) + v;
    save();
    renderSales(`<div class="report"><b>Готово.</b> Узнано блюд: ${got.size}.
      ${miss.length ? `<br>Нет в меню: <ul>${miss.slice(0, 12).map(m => `<li>${esc(m)}</li>`).join('')}</ul>${miss.length > 12 ? `<span class="muted">и ещё ${miss.length - 12}</span>` : ''}` : ''}
      <div class="bar"><a class="btn" href="#analysis">К анализу</a><button class="link" id="undoS">отменить</button></div></div>`);
    $('#undoS').onclick = () => { db.sales.qty = JSON.parse(snap); save(); renderSales(); };
  };
}

/* ---------- Анализ ---------- */
// Матрица меню-инжиниринга (Kasavana и Smith, 1982): популярность против маржи.
const QUAD = {
  star: { name: 'Звёзды', hint: 'Продаются хорошо и приносят много. Не трогайте рецепт и цену, держите их на виду: первыми в меню, на обложке, в рассылке.' },
  horse: { name: 'Рабочие лошадки', hint: 'Берут часто, но зарабатываете на них мало. Их легче всего улучшить: поднять цену немного, проверить вес порции, заменить дорогой продукт или продавать в наборе с выгодным блюдом.' },
  puzzle: { name: 'Загадки', hint: 'Выгодные, но их мало берут. Переименуйте, сделайте хорошее фото, поднимите выше в меню, пусть оператор предлагает при заказе.' },
  dog: { name: 'Собаки', hint: 'Мало берут и мало приносят. Попробуйте месяц переделать или переименовать. Не помогло — уберите: меню станет короче, закупка проще.' }
};
let anaCat = '', whatIf = { ing: '', pct: 20 };
function analysisRows(cat) {
  return db.dishes.map(d => ({ d, s: stats(d), q: qtyOf(d) }))
    .filter(x => x.q > 0 && !x.s.blank && x.s.price && (!cat || (x.d.category || 'Без категории') === cat));
}
function renderAnalysis() {
  if (!db.dishes.some(d => qtyOf(d))) { view.innerHTML = '<h1>Анализ</h1>' + noSales(); return; }
  const days = db.sales.days, ch = db.channel;
  const all = analysisRows('');
  const skipped = db.dishes.filter(d => qtyOf(d) && stats(d).blank);
  let qty = 0, rev = 0, cst = 0, fee = 0;
  for (const x of all) { qty += x.q; rev += x.q * x.s.price; cst += x.q * x.s.c; fee += x.q * x.s.price * ch.share / 100 * ch.fee / 100; }
  const gross = rev - cst - fee, fixed = db.fixed.reduce((a, f) => a + (+f.sum || 0), 0) * days / 30;
  const net = gross - fixed, avg = qty ? gross / qty : 0, be = avg > 0 ? Math.ceil(fixed / avg) : NaN;

  // матрица
  const cats = [...new Set(all.map(x => x.d.category || 'Без категории'))];
  const rows = analysisRows(anaCat);
  const tq = rows.reduce((a, x) => a + x.q, 0);
  const popLine = rows.length ? 0.7 * tq / rows.length : 0;        // правило 70%
  const mLine = tq ? rows.reduce((a, x) => a + x.q * x.s.eff, 0) / tq : 0; // средневзвешенная маржа
  for (const x of rows) x.k = x.q >= popLine ? (x.s.eff >= mLine ? 'star' : 'horse') : (x.s.eff >= mLine ? 'puzzle' : 'dog');

  const groups = Object.keys(QUAD).map(k => {
    const list = rows.filter(x => x.k === k).sort((a, b) => b.q * b.s.eff - a.q * a.s.eff);
    if (!list.length) return '';
    const items = list.map(x => {
      let tip = '';
      if (k === 'horse') { const up = db.round === '90' ? 50 : 30; tip = ` <span class="muted">Цена +${up} ₽ даст ${rub(x.q * up * (1 - ch.share / 100 * ch.fee / 100))} за период, если продажи не упадут.</span>`; }
      if (k === 'dog') tip = ` <span class="muted">${pct(x.q * x.s.price / rev * 100)} выручки.</span>`;
      return `<li><a href="#dish/${x.d.id}">${esc(x.d.name)}</a>: ${x.q} шт, маржа ${rub(x.s.eff)} с порции, всего ${rub(x.q * x.s.eff)}.${tip}</li>`;
    }).join('');
    return `<h3>${QUAD[k].name} <span class="muted">${list.length}</span></h3><p class="muted">${QUAD[k].hint}</p><ul class="qlist">${items}</ul>`;
  }).join('');

  // что если
  const usedIngs = db.ing.filter(i => all.some(x => usesIng(x.d, i.id))).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!usedIngs.some(i => i.id === whatIf.ing)) {
    // по умолчанию самый дорогой по доле в себестоимости продаж
    const u = salesUsage(); let best = null, bv = -1;
    for (const i of usedIngs) { const v = (u.get(i.id) || 0) * unitPrice(i) * (1 - Math.min(95, +i.waste || 0) / 100); if (v > bv) { bv = v; best = i; } }
    whatIf.ing = best ? best.id : '';
  }

  view.innerHTML = `
    <h1>Анализ</h1>
    <p class="muted">За ${days} ${plural(days, 'день', 'дня', 'дней')} по данным вкладки «Продажи».${skipped.length ? ` Не учтены ${skipped.length} ${plural(skipped.length, 'блюдо', 'блюда', 'блюд')} без состава: ${skipped.slice(0, 5).map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}${skipped.length > 5 ? '…' : ''}` : ''}</p>

    <table class="money">
      <tr><td>Выручка</td><td class="r">${rub(rev)}</td><td class="muted">${qty} порций</td></tr>
      <tr><td>Продукты и упаковка</td><td class="r">−${rub(cst)}</td><td class="muted">${pct(cst / rev * 100)} от выручки</td></tr>
      ${fee ? `<tr><td>Комиссия агрегатора</td><td class="r">−${rub(fee)}</td><td class="muted">${ch.share}% заказов, комиссия ${ch.fee}%</td></tr>` : ''}
      <tr class="sub"><td>Остаётся с блюд</td><td class="r">${rub(gross)}</td><td class="muted">${rub(avg)} в среднем с порции</td></tr>
      <tr><td>Постоянные расходы</td><td class="r">−${rub(fixed)}</td><td class="muted">${db.fixed.length ? `${days === 30 ? 'за месяц' : `пересчитано на ${days} дн.`}` : '<a href="#analysis" id="toFixed">не заполнены</a>'}</td></tr>
      <tr class="total"><td>Прибыль</td><td class="r ${net < 0 ? 'bad' : 'good'}">${rub(net)}</td><td class="muted">${rub(net / days)} в день</td></tr>
    </table>
    ${fixed && isFinite(be) ? `<p>Точка безубыточности: <b>${be}</b> ${plural(be, 'порция', 'порции', 'порций')} за период, это ${Math.ceil(be / days)} в день. Сейчас продаётся ${Math.round(qty / days)} в день${qty >= be ? `, запас ${pct((qty - be) / qty * 100)}` : `, не хватает ${Math.ceil((be - qty) / days)} в день`}.</p>` : ''}

    <h2>Меню-инжиниринг</h2>
    <p class="muted">Каждое блюдо сравнивается с остальными по двум вещам: как часто его берут и сколько рублей оно оставляет с порции (с учётом комиссии). Сравнивать честнее внутри одной категории: сеты всегда приносят больше одного ролла.</p>
    <div class="bar"><select id="acat"><option value="">Все категории</option>${cats.map(c => `<option${c === anaCat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    ${rows.length >= 3 ? matrixSvg(rows, popLine, mLine) + groups : '<p class="muted">Нужно хотя бы три блюда с продажами и составом.</p>'}

    <h2>Что если подорожает</h2>
    ${usedIngs.length ? `<div class="bar">
      <select id="wiIng">${usedIngs.map(i => `<option value="${i.id}"${i.id === whatIf.ing ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
      <label>на <input id="wiPct" type="number" step="5" value="${whatIf.pct}" style="width:70px"> %</label></div>
      <div id="wiOut"></div>` : '<p class="muted">Нет продуктов в проданных блюдах.</p>'}

    <h2 id="fixedH">Постоянные расходы в месяц</h2>
    <div class="tw"><table class="edit"><tbody id="fixed">${db.fixed.map((f, k) => `<tr data-k="${k}">
      <td><input data-f="name" value="${esc(f.name)}"></td><td class="r"><input class="n" data-f="sum" inputmode="numeric" value="${+f.sum || ''}"> <span class="unit">₽</span></td>
      <td><button class="del" data-del>убрать</button></td></tr>`).join('')}</tbody></table></div>
    <div class="bar"><button id="addFixed">Добавить расход</button></div>

    <h2>Заказы через агрегатор</h2>
    <p class="muted">Если часть заказов идёт через Яндекс Еду или похожий сервис, впишите долю таких заказов и комиссию из своего договора. Комиссия вычитается из маржи во всех расчётах.</p>
    <div class="bar"><label>Доля заказов <input id="chShare" type="number" min="0" max="100" value="${ch.share}" style="width:70px"> %</label>
      <label>Комиссия <input id="chFee" type="number" min="0" max="100" value="${ch.fee}" style="width:70px"> %</label></div>`;

  const acat = $('#acat'); if (acat) acat.onchange = e => { anaCat = e.target.value; renderAnalysis(); };
  const tf = $('#toFixed'); if (tf) tf.onclick = e => { e.preventDefault(); $('#fixedH').scrollIntoView(); };

  function drawWhatIf() {
    const out = $('#wiOut'); if (!out) return;
    const i = ingById(whatIf.ing), k = whatIf.pct / 100;
    if (!i || !k) { out.innerHTML = ''; return; }
    const before = new Map(all.map(x => [x.d.id, x.s]));
    const old = i.price; i.price = old * (1 + k);
    const after = all.map(x => ({ x, s: stats(x.d) }));
    i.price = old;
    let loss = 0; const crossed = [], raise = [];
    for (const { x, s } of after) {
      const dc = s.c - before.get(x.d.id).c; if (Math.abs(dc) < .01) continue;
      loss += dc * x.q;
      if (before.get(x.d.id).fc <= db.target && s.fc > db.target) crossed.push(x.d);
      const need = roundPrice(x.s.price + dc / (1 - ch.share / 100 * ch.fee / 100)) - x.s.price;
      if (need > 0) raise.push([x.d, need, x.q]);
    }
    raise.sort((a, b) => b[1] * b[2] - a[1] * a[2]);
    out.innerHTML = `<p>${k > 0 ? 'Если' : 'Если подешевеет:'} «${esc(i.name)}» ${k > 0 ? 'подорожает' : 'станет дешевле'} на ${Math.abs(whatIf.pct)}%, прибыль за период ${loss > 0 ? 'упадёт' : 'вырастет'} на <b class="${loss > 0 ? 'bad' : 'good'}">${rub(Math.abs(loss))}</b>${fixed ? `, это ${pct(Math.abs(loss) / Math.max(1, Math.abs(net)) * 100)} от текущей прибыли` : ''}.</p>
      ${crossed.length ? `<p>Станут дороже цели ${db.target}%: ${crossed.map(d => `<a href="#dish/${d.id}">${esc(d.name)}</a>`).join(', ')}.</p>` : ''}
      ${k > 0 && raise.length ? `<p class="muted">Чтобы не потерять в деньгах, хватит поднять цены:</p><ul class="qlist">${raise.slice(0, 8).map(([d, n]) => `<li>${esc(d.name)}: на ${rub(n)}, до ${rub(d.price + n)}</li>`).join('')}</ul>` : ''}`;
  }
  drawWhatIf();
  const wi = $('#wiIng'); if (wi) wi.onchange = e => { whatIf.ing = e.target.value; drawWhatIf(); };
  const wp = $('#wiPct'); if (wp) wp.oninput = e => { whatIf.pct = parseNum(e.target.value); drawWhatIf(); };

  const fx = $('#fixed');
  fx.onchange = e => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    db.fixed[+tr.dataset.k][f] = f === 'sum' ? parseNum(e.target.value) : e.target.value; save(); renderAnalysis(); $('#fixedH').scrollIntoView();
  };
  fx.onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; db.fixed.splice(+b.closest('tr').dataset.k, 1); save(); renderAnalysis(); $('#fixedH').scrollIntoView(); };
  $('#addFixed').onclick = () => { db.fixed.push({ name: '', sum: 0 }); save(); renderAnalysis(); $('#fixedH').scrollIntoView(); const ins = view.querySelectorAll('#fixed input[data-f="name"]'); ins[ins.length - 1].focus(); };
  const chg = () => { db.channel.share = Math.min(100, Math.max(0, parseNum($('#chShare').value))); db.channel.fee = Math.min(100, Math.max(0, parseNum($('#chFee').value))); save(); const y = scrollY; renderAnalysis(); scrollTo(0, y); };
  $('#chShare').onchange = chg; $('#chFee').onchange = chg;
}

function matrixSvg(rows, popLine, mLine) {
  const W = 680, H = 380, L = 56, R = 16, T = 18, B = 40;
  const maxQ = Math.max(...rows.map(x => x.q), popLine) * 1.08;
  const ms = rows.map(x => x.s.eff), minM = Math.min(0, ...ms), maxM = Math.max(...ms, mLine) * 1.1;
  const sx = q => L + Math.sqrt(q / maxQ) * (W - L - R);          // корень: мелкие продажи не слипаются у нуля
  const sy = m => T + (1 - (m - minM) / (maxM - minM || 1)) * (H - T - B);
  const px = sx(popLine), py = sy(mLine);
  // подписи: сначала самые денежные блюда, без наложений; кому не хватило места, видно при наведении
  const boxes = [], labels = new Map();
  const hit = b => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const x of rows.slice().sort((a, b) => b.q * b.s.eff - a.q * a.s.eff)) {
    const cx = sx(x.q), cy = sy(x.s.eff);
    boxes.push({ x: cx - 6, y: cy - 6, w: 12, h: 12 });
  }
  for (const x of rows.slice().sort((a, b) => b.q * b.s.eff - a.q * a.s.eff)) {
    const cx = sx(x.q), cy = sy(x.s.eff);
    const t = x.d.name.length > 22 ? x.d.name.slice(0, 21) + '…' : x.d.name, w = t.length * 6.3 + 4;
    const mid = Math.min(Math.max(cx - w / 2, L + 2), W - R - w); // над и под точкой прижимаем к краю поля
    const spots = [[cx + 8, cy - 7], [cx - 8 - w, cy - 7], [mid, cy - 22], [mid, cy + 8]];
    for (const [bx, by] of spots) {
      const b = { x: bx, y: by, w, h: 14 };
      if (bx < L || bx + w > W - R || by < T || by + 14 > H - B || hit(b)) continue;
      boxes.push(b);
      labels.set(x.d.id, { t, x: bx + 2, y: by + 11, anchor: 'start' });
      break;
    }
  }
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const ticks = [0];
  for (const v of nice) if (v <= maxQ / 1.08 && sx(v) - sx(ticks[ticks.length - 1]) >= 44) ticks.push(v);
  const dots = rows.map(x => {
    const cx = sx(x.q), cy = sy(x.s.eff), lb = labels.get(x.d.id);
    return `<a href="#dish/${x.d.id}"><circle class="dot ${x.k}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5"><title>${esc(x.d.name)}: ${x.q} шт, ${rub(x.s.eff)} с порции</title></circle>
      ${lb ? `<text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" text-anchor="${lb.anchor}" class="lbl">${esc(lb.t)}</text>` : ''}</a>`;
  }).join('');
  return `<div class="tw"><svg class="matrix" viewBox="0 0 ${W} ${H}" role="img" aria-label="Матрица меню: продажи по горизонтали, маржа по вертикали">
    <rect x="${px}" y="${T}" width="${W - R - px}" height="${py - T}" class="q-star"/>
    <text x="${W - R - 6}" y="${T + 16}" text-anchor="end" class="qname">звёзды</text>
    <text x="${L + 6}" y="${T + 16}" class="qname">загадки</text>
    <text x="${W - R - 6}" y="${H - B - 8}" text-anchor="end" class="qname">лошадки</text>
    <text x="${L + 6}" y="${H - B - 8}" class="qname">собаки</text>
    <line x1="${px}" x2="${px}" y1="${T}" y2="${H - B}" class="th"/><line x1="${L}" x2="${W - R}" y1="${py}" y2="${py}" class="th"/>
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ax"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="ax"/>
    ${ticks.map(v => `<text x="${sx(v)}" y="${H - B + 16}" text-anchor="middle" class="tick">${v}</text>`).join('')}
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="tick">продано, шт</text>
    <text x="${L - 8}" y="${py + 4}" text-anchor="end" class="tick">${Math.round(mLine)} ₽</text>
    <text x="${L - 8}" y="${T + 10}" text-anchor="end" class="tick">${Math.round(maxM / 1.1)} ₽</text>
    <text x="14" y="${(T + H - B) / 2}" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle" class="tick">маржа с порции</text>
    ${dots}</svg></div>`;
}

/* ---------- Сверка: по техкартам и по факту ---------- */
function renderCheck() {
  if (!db.dishes.some(d => qtyOf(d))) { view.innerHTML = '<h1>Сверка</h1>' + noSales(); return; }
  const u = salesUsage();
  const ings = db.ing.filter(i => u.get(i.id) > 0 || db.stock[i.id]).sort((a, b) => (u.get(b.id) || 0) * packOf(b) / UNITS[b.unit].k - (u.get(a.id) || 0) * packOf(a) / UNITS[a.unit].k);
  const st = id => db.stock[id] || {};
  const calc = i => {
    const s = st(i.id), theory = toUnit(u.get(i.id) || 0, i);
    const filled = ['start', 'in', 'end'].some(k => s[k] !== undefined && s[k] !== '');
    const fact = filled ? (+s.start || 0) + (+s.in || 0) - (+s.end || 0) : NaN;
    const diff = fact - theory;
    return { theory, fact, diff, money: diff * packOf(i), filled };
  };
  let rev = 0, cst = 0;
  for (const d of db.dishes) { const q = qtyOf(d); if (q && !stats(d).blank) { rev += q * d.price; cst += q * cost(d); } }

  view.innerHTML = `
    <h1>Сверка</h1>
    <p class="muted">Сколько продуктов должно было уйти по техкартам на продажи за ${db.sales.days} ${plural(db.sales.days, 'день', 'дня', 'дней')}, и сколько ушло на самом деле по остаткам. Разница — это перевес порций, списания, испорченное или то, что ушло мимо кассы.</p>
    <p class="muted">По факту = остаток на начало + пришло − остаток на конец. Заполните хотя бы те продукты, что дороже всего: они сверху.</p>
    <div id="chSum"></div>
    <div class="tw"><table class="edit"><thead><tr><th>Продукт</th><th class="r">На начало</th><th class="r">Пришло</th><th class="r">На конец</th>
      <th class="r">По факту</th><th class="r">По техкартам</th><th class="r">Разница</th></tr></thead>
    <tbody id="chk">${ings.map(i => {
      const s = st(i.id);
      return `<tr data-id="${i.id}"><td>${esc(i.name)}</td>
        ${['start', 'in', 'end'].map(k => `<td class="r"><input class="n" data-f="${k}" inputmode="decimal" value="${s[k] !== undefined ? num(s[k]) : ''}" style="width:72px"><span class="unit">${i.unit}</span></td>`).join('')}
        <td class="r" data-fact></td><td class="r muted" data-th></td><td class="r" data-diff></td></tr>`;
    }).join('')}</tbody></table></div>`;

  function refresh() {
    let lost = 0, worst = null;
    view.querySelectorAll('#chk tr').forEach(tr => {
      const i = ingById(tr.dataset.id), r = calc(i);
      tr.querySelector('[data-fact]').textContent = r.filled ? fmtQ(r.fact, i) : '—';
      tr.querySelector('[data-th]').textContent = fmtQ(r.theory, i);
      const cell = tr.querySelector('[data-diff]');
      if (!r.filled) { cell.textContent = ''; return; }
      const rel = r.theory ? r.diff / r.theory * 100 : 0;
      cell.innerHTML = `${r.diff > 0 ? '+' : ''}${fmtQ(r.diff, i)}<br><span class="${r.diff > 0 && rel > 3 ? 'bad' : 'muted'}">${r.diff > 0 ? '+' : ''}${rub(r.money)}</span>`;
      if (r.diff > 0) { lost += r.money; if (!worst || r.money > worst[1]) worst = [i, r.money, rel]; }
    });
    $('#chSum').innerHTML = lost > 0
      ? `<p class="report">Перерасход за период: <b class="bad">${rub(lost)}</b>. Фудкост по техкартам ${pct(cst / rev * 100)}, по факту около ${pct((cst + lost) / rev * 100)}. Больше всего уходит «${esc(worst[0].name)}»: на ${pct(worst[2])} больше нормы, ${rub(worst[1])}. Начните с проверки веса порций по этому продукту.</p>`
      : view.querySelector('#chk [data-f]') && [...view.querySelectorAll('#chk tr')].some(tr => calc(ingById(tr.dataset.id)).filled)
        ? '<p class="report good">Расхождений больше нормы нет.</p>' : '';
  }
  refresh();
  $('#chk').oninput = e => {
    const tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
    const s = db.stock[tr.dataset.id] = db.stock[tr.dataset.id] || {};
    if (e.target.value.trim() === '') delete s[f]; else s[f] = parseNum(e.target.value);
    save(); refresh();
  };
}

/* ---------- Закупка ---------- */
function renderBuy() {
  if (!db.dishes.some(d => qtyOf(d))) { view.innerHTML = '<h1>Закупка</h1>' + noSales(); return; }
  const P = db.plan;
  view.innerHTML = `
    <h1>Закупка</h1>
    <p class="muted">Сколько купить, если продажи пойдут как в последнем периоде. Остатки подставляются из «Сверки» (остаток на конец), их можно поправить.</p>
    <div class="bar"><label>На сколько дней <input id="pDays" type="number" min="1" max="60" value="${P.days}" style="width:70px"></label>
      <label>Запас <input id="pRes" type="number" min="0" max="100" value="${P.reserve}" style="width:70px"> %</label>
      <span class="grow"></span><button class="main" id="copyBuy">Скопировать для поставщика</button></div>
    <div class="tw"><table class="edit"><thead><tr><th>Продукт</th><th class="r">Нужно</th><th class="r">Есть</th><th class="r">Купить</th><th class="r hide-m">Упаковок</th><th class="r">Сумма</th></tr></thead>
    <tbody id="buy"></tbody><tfoot><tr class="total"><td colspan="5">Итого</td><td class="r" id="buyTot"></td></tr></tfoot></table></div>`;

  const rows = () => {
    const u = salesUsage(P.days / db.sales.days * (1 + P.reserve / 100));
    return db.ing.filter(i => u.get(i.id) > 0).map(i => {
      const need = toUnit(u.get(i.id), i), s = db.stock[i.id] || {};
      const have = s.now !== undefined ? +s.now : s.end !== undefined ? +s.end : 0;
      const buy = Math.max(0, need - have), packs = +i.qty > 0 ? Math.ceil(buy / +i.qty - 1e-9) : 0;
      return { i, need, have, buy, packs, sum: packs * (+i.price || 0) };
    }).sort((a, b) => b.sum - a.sum);
  };
  const draw = () => {
    const r = rows();
    $('#buy').innerHTML = r.map(x => `<tr data-id="${x.i.id}"><td>${esc(x.i.name)}</td><td class="r muted">${fmtQ(x.need, x.i)}</td>
      <td class="r"><input class="n" inputmode="decimal" value="${num(x.have)}" style="width:72px"><span class="unit">${x.i.unit}</span></td>
      <td class="r"><b>${x.buy > 0 ? fmtQ(x.packs * x.i.qty, x.i) : '—'}</b></td><td class="r muted hide-m">${x.packs ? x.packs + ' по ' + num(x.i.qty) + ' ' + x.i.unit : ''}</td>
      <td class="r">${x.sum ? rub(x.sum) : ''}</td></tr>`).join('');
    $('#buyTot').textContent = rub(r.reduce((a, x) => a + x.sum, 0));
  };
  draw();
  $('#pDays').oninput = e => { const v = parseNum(e.target.value); if (v >= 1) { P.days = v; save(); draw(); } };
  $('#pRes').oninput = e => { P.reserve = Math.max(0, parseNum(e.target.value)); save(); draw(); };
  $('#buy').onchange = e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const s = db.stock[tr.dataset.id] = db.stock[tr.dataset.id] || {};
    s.now = parseNum(e.target.value); save(); draw();
  };
  $('#copyBuy').onclick = e => {
    const r = rows().filter(x => x.packs);
    const text = `Заказ на ${P.days} ${plural(P.days, 'день', 'дня', 'дней')}:\n` + r.map(x => `${x.i.name}: ${num(x.packs * x.i.qty)} ${x.i.unit}`).join('\n');
    copyText(text, e.target);
  };
}

/* ---------- передача ссылкой ---------- */
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function packLink() {
  const json = JSON.stringify(db);
  const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  let bin = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  return location.href.split('#')[0] + '#share=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackLink(s) {
  const stream = new Blob([unb64u(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

/* ---------- навигация ---------- */
function route(keepScroll) {
  const h = location.hash.slice(1) || 'menu';
  const [tab, id] = h.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === (tab === 'dish' ? 'menu' : tab)));
  if (tab === 'dish') renderDish(id);
  else if (tab === 'products') renderProducts();
  else if (tab === 'data') renderData();
  else if (tab === 'sales') renderSales();
  else if (tab === 'analysis') renderAnalysis();
  else if (tab === 'check') renderCheck();
  else if (tab === 'buy') renderBuy();
  else renderMenu();
  if (keepScroll !== true) scrollTo(0, 0);
}
addEventListener('hashchange', () => location.hash.startsWith('#share=') ? takeShare() : route());
const rs = $('#round');
rs.value = db.round;
rs.onchange = () => { db.round = rs.value; save(); route(true); };
const t = $('#target');
t.value = db.target;
t.oninput = () => { const v = parseNum(t.value); if (v >= 5 && v <= 90) { db.target = v; save(); route(true); t.focus(); } };
function takeShare() {
  const code = location.hash.slice(7);
  history.replaceState(null, '', location.pathname + location.search + '#menu');
  route();
  if (!('DecompressionStream' in window)) note('Этот браузер слишком старый, чтобы открыть ссылку с данными. Попробуйте свежий Chrome, Яндекс Браузер или Safari.');
  else unpackLink(code).then(data => {
    if (!data || !Array.isArray(data.dishes)) throw new Error('пусто');
    note(`По ссылке пришли данные: ${data.dishes.length} блюд, ${data.ing.length} продуктов. Открыть их вместо ваших?`, [
      ['Открыть', () => { const snap = JSON.stringify(db); db = migrate(data); db.demo = false; save(); rs.value = db.round; t.value = db.target; route();
        note('Открыто. Ваши прежние данные можно вернуть.', [['Ок', () => {}], ['Вернуть мои', () => { db = JSON.parse(snap); save(); rs.value = db.round; t.value = db.target; route(); }]]); }],
      ['Не надо', () => {}]]);
  }).catch(() => note('Ссылка повреждена: скорее всего, она обрезалась при пересылке.'));
}
if (location.hash.startsWith('#share=')) takeShare(); else route();

})();
