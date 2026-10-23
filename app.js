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
  return { target: 35, ing, dishes, demo: true };
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)) || demo(); } catch (e) { db = demo(); }
let saveFail = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); saveFail = false; }
  catch (e) { if (!saveFail) note('Браузер не даёт сохранять данные. Всё работает, но после закрытия вкладки пропадёт: сохраните файл в «Импорт и файлы».'); saveFail = true; }
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
    rec: Math.ceil(c / (db.target / 100) / 10) * 10 };
}
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
      <dt>Себестоимость</dt><dt>Фудкост</dt><dt>Маржа</dt><dt>Наценка</dt>
      <dd>${loop ? '—' : rub(s.c, 2)}</dd>
      <dd class="${s.fc > db.target && !s.blank ? 'bad' : ''}">${s.price && !s.blank ? pct(s.fc) : '—'}</dd>
      <dd>${s.price && !s.blank ? rub(s.margin) : '—'}</dd>
      <dd>${s.price && s.c && !s.blank ? pct((s.price - s.c) / s.c * 100) : '—'}</dd>`;
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
      <thead><tr><th>Продукт</th><th class="r">Упаковка</th><th></th><th class="r">Цена упаковки, ₽</th><th class="r">Отход, %</th><th class="r">Чистая цена</th><th class="r hide-m">В блюдах</th><th></th></tr></thead>
      <tbody id="ings">${sorted.map(i => {
        const n = db.dishes.filter(d => usesIng(d, i.id)).length;
        return `<tr data-id="${i.id}">
          <td><input data-f="name" value="${esc(i.name)}"></td>
          <td class="r"><input class="n" data-f="qty" inputmode="decimal" value="${num(i.qty)}"></td>
          <td><select data-f="unit">${Object.keys(UNITS).map(u => `<option${u === i.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
          <td class="r"><input class="n" data-f="price" inputmode="decimal" value="${num(i.price)}"></td>
          <td class="r"><input class="n" data-f="waste" inputmode="decimal" value="${num(i.waste || 0)}" style="width:64px"></td>
          <td class="r" data-net></td>
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
    <h1>Импорт и файлы</h1>
    <h2>Меню с сайта</h2>
    <p>Загрузите <code>menu.json</code> сайта доставки. Цены и категории подтянутся, а сеты, в описании которых по строкам перечислены роллы, соберутся из этих роллов сами. Состав роллов останется заполнить во вкладке блюда.</p>
    <div class="drop" id="drop"><input type="file" id="menuFile" accept=".json,application/json"> <span class="muted">или перетащите файл сюда</span></div>
    ${report || ''}

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

  $('#exp').onclick = () => download(`fudkost-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db, null, 1));
  $('#impFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    readFile(f, data => {
      if (!data || !Array.isArray(data.ing) || !Array.isArray(data.dishes)) { note('Это не файл Фудкоста. Для меню сайта используйте загрузку выше.'); return; }
      const snap = JSON.stringify(db);
      db = data; save(); route();
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

/* ---------- навигация ---------- */
function route(keepScroll) {
  const h = location.hash.slice(1) || 'menu';
  const [tab, id] = h.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === (tab === 'dish' ? 'menu' : tab)));
  if (tab === 'dish') renderDish(id);
  else if (tab === 'products') renderProducts();
  else if (tab === 'data') renderData();
  else renderMenu();
  if (keepScroll !== true) scrollTo(0, 0);
}
addEventListener('hashchange', () => route());
const t = $('#target');
t.value = db.target;
t.oninput = () => { const v = parseNum(t.value); if (v >= 5 && v <= 90) { db.target = v; save(); route(true); t.focus(); } };
route();

})();
