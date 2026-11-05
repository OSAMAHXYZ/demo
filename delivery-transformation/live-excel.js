/* Delivery Transformation — Excel-style Live Sheet (admin VIN tools).
   Formatting, sort, filters, freeze and zoom are personal view settings kept in this browser;
   they never change the delivery data. */
(function (global) {
  const STORE = 'dtx-live-excel-v1';
  const FONTS = ['Manrope', 'Calibri', 'Arial', 'Segoe UI', 'Tahoma', 'Verdana', 'Times New Roman', 'Courier New', 'IBM Plex Sans Arabic', 'Tajawal'];
  const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28];
  const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const letter = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
      return {
        formats: s.formats && typeof s.formats === 'object' ? s.formats : {},
        sort: s.sort || null,
        filters: s.filters && typeof s.filters === 'object' ? s.filters : {},
        freezeCols: Number.isInteger(s.freezeCols) ? s.freezeCols : 2,
        zoom: Number(s.zoom) || 100,
        gridlines: s.gridlines !== false,
      };
    } catch (_) {
      return { formats: {}, sort: null, filters: {}, freezeCols: 2, zoom: 100, gridlines: true };
    }
  }
  const state = load();
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { /* storage full */ }
  }

  let table = null;
  let wrap = null;
  let ui = null;
  let anchor = null;
  let focus = null;
  let dragging = false;
  let engaged = false;
  let found = [];
  let foundAt = -1;

  // ---------- table model ----------
  const labels = () => Array.from(table.tHead.rows[table.tHead.rows.length - 1].cells).map((th) => th.dataset.label || th.textContent.trim());
  const allRows = () => Array.from(table.tBodies[0] ? table.tBodies[0].rows : []).filter((tr) => tr.cells.length > 1);
  const visibleRows = () => allRows().filter((tr) => !tr.classList.contains('xl-hidden'));
  const rowKey = (tr) => { const b = tr.querySelector('.vin-btn'); return b ? b.dataset.vin : ''; };
  const colCount = () => labels().length;

  function cellText(td) {
    if (!td) return '';
    const sel = td.querySelector('select');
    if (sel) return sel.value ? (sel.options[sel.selectedIndex] || {}).text || sel.value : '';
    const inp = td.querySelector('input');
    if (inp) return inp.value;
    return td.innerText.replace(/\s+/g, ' ').trim();
  }
  const cellAt = (r, c) => { const tr = visibleRows()[r]; return tr ? tr.cells[c] : null; };

  // ---------- chrome ----------
  function buildChrome() {
    wrap = table.closest('.table-wrap');
    const card = wrap.parentElement;
    card.classList.add('xl-sheet');
    const box = document.createElement('div');
    box.className = 'xl-chrome';
    box.innerHTML = `
      <div class="xl-ribbon" role="toolbar" aria-label="Sheet formatting">
        <div class="xl-group">
          <div class="xl-row">
            <button type="button" class="xl-btn xl-big" data-act="copy" title="Copy (Ctrl+C)"><i>&#10697;</i><span>Copy</span></button>
            <button type="button" class="xl-btn" data-act="select-all" title="Select all (Ctrl+A)"><i>&#9638;</i><span>Select all</span></button>
          </div>
          <small>Clipboard</small>
        </div>
        <div class="xl-group">
          <div class="xl-row">
            <select class="xl-font" data-fmt="ff" title="Font">${FONTS.map((f) => `<option value="${esc(f)}" style="font-family:'${esc(f)}'">${esc(f)}</option>`).join('')}</select>
            <select class="xl-size" data-fmt="fs" title="Font size">${SIZES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
            <button type="button" class="xl-btn xl-sq" data-act="grow" title="Increase font size">A<sup>+</sup></button>
            <button type="button" class="xl-btn xl-sq" data-act="shrink" title="Decrease font size">A<sup>-</sup></button>
          </div>
          <div class="xl-row">
            <button type="button" class="xl-btn xl-sq" data-toggle="b" title="Bold (Ctrl+B)"><b>B</b></button>
            <button type="button" class="xl-btn xl-sq" data-toggle="i" title="Italic (Ctrl+I)"><i style="font-style:italic">I</i></button>
            <button type="button" class="xl-btn xl-sq" data-toggle="u" title="Underline (Ctrl+U)"><u>U</u></button>
            <button type="button" class="xl-btn xl-sq" data-toggle="s" title="Strikethrough"><s>S</s></button>
            <label class="xl-color" title="Font colour"><span class="xl-swatch-a">A</span><input type="color" data-fmt="color" value="#c00000" /></label>
            <label class="xl-color" title="Fill colour"><span class="xl-swatch-fill">&#9641;</span><input type="color" data-fmt="fill" value="#fff2cc" /></label>
            <button type="button" class="xl-btn xl-sq" data-act="no-fill" title="No fill">&#8856;</button>
          </div>
          <small>Font</small>
        </div>
        <div class="xl-group">
          <div class="xl-row">
            <button type="button" class="xl-btn xl-sq" data-align="left" title="Align left">&#8676;</button>
            <button type="button" class="xl-btn xl-sq" data-align="center" title="Center">&#8596;</button>
            <button type="button" class="xl-btn xl-sq" data-align="right" title="Align right">&#8677;</button>
          </div>
          <div class="xl-row">
            <button type="button" class="xl-btn" data-toggle="wrap" title="Wrap text"><i>&#8629;</i><span>Wrap text</span></button>
            <button type="button" class="xl-btn" data-toggle="border" title="Borders"><i>&#9633;</i><span>Borders</span></button>
          </div>
          <small>Alignment</small>
        </div>
        <div class="xl-group">
          <div class="xl-row">
            <button type="button" class="xl-btn" data-act="sort-asc" title="Sort A to Z by the selected column"><i>&#8593;</i><span>Sort A&#8594;Z</span></button>
            <button type="button" class="xl-btn" data-act="sort-desc" title="Sort Z to A by the selected column"><i>&#8595;</i><span>Sort Z&#8594;A</span></button>
          </div>
          <div class="xl-row">
            <button type="button" class="xl-btn" data-act="filter" title="Filter the selected column"><i>&#9663;</i><span>Filter</span></button>
            <button type="button" class="xl-btn" data-act="clear-filters" title="Clear every sort and filter"><i>&#10005;</i><span>Clear</span></button>
          </div>
          <small>Sort &amp; Filter</small>
        </div>
        <div class="xl-group">
          <div class="xl-row">
            <button type="button" class="xl-btn" data-act="freeze" title="Freeze the columns left of the selected cell"><i>&#10052;</i><span class="xl-freeze-label">Freeze panes</span></button>
            <button type="button" class="xl-btn" data-act="gridlines" title="Show or hide gridlines"><i>&#9638;</i><span>Gridlines</span></button>
          </div>
          <div class="xl-row">
            <button type="button" class="xl-btn" data-act="find" title="Find (Ctrl+F)"><i>&#9906;</i><span>Find</span></button>
            <button type="button" class="xl-btn" data-act="clear-format" title="Clear formats of the selected cells"><i>&#9003;</i><span>Clear formats</span></button>
          </div>
          <small>View</small>
        </div>
        <div class="xl-group">
          <div class="xl-row">
            <button type="button" class="xl-btn xl-big xl-green" data-act="download" title="Download the visible rows as an Excel file"><i>&#8681;</i><span>Download .xlsx</span></button>
          </div>
          <small>Export</small>
        </div>
      </div>
      <div class="xl-fbar">
        <input class="xl-name" readonly aria-label="Selected cell" />
        <span class="xl-fx">fx</span>
        <input class="xl-formula" readonly aria-label="Cell value" />
      </div>
      <div class="xl-find" hidden>
        <input type="search" class="xl-find-input" placeholder="Find in sheet…" aria-label="Find in sheet" />
        <span class="xl-find-count">0 of 0</span>
        <button type="button" class="xl-btn xl-sq" data-act="find-prev" title="Previous (Shift+Enter)">&#8593;</button>
        <button type="button" class="xl-btn xl-sq" data-act="find-next" title="Next (Enter)">&#8595;</button>
        <button type="button" class="xl-btn xl-sq" data-act="find-close" title="Close (Esc)">&#10005;</button>
      </div>`;
    card.insertBefore(box, wrap);
    const status = document.createElement('div');
    status.className = 'xl-status';
    status.innerHTML = `<span class="xl-st-left">Ready</span><span class="xl-st-calc"></span>
      <label class="xl-zoom">Zoom <input type="range" min="50" max="160" step="10" /> <b></b></label>`;
    wrap.after(status);
    const menu = document.createElement('div');
    menu.className = 'xl-menu';
    menu.hidden = true;
    document.body.appendChild(menu);
    ui = {
      card, box, status, menu,
      name: box.querySelector('.xl-name'),
      formula: box.querySelector('.xl-formula'),
      font: box.querySelector('.xl-font'),
      size: box.querySelector('.xl-size'),
      find: box.querySelector('.xl-find'),
      findInput: box.querySelector('.xl-find-input'),
      findCount: box.querySelector('.xl-find-count'),
      stLeft: status.querySelector('.xl-st-left'),
      stCalc: status.querySelector('.xl-st-calc'),
      zoom: status.querySelector('.xl-zoom input'),
      zoomLabel: status.querySelector('.xl-zoom b'),
    };
    wireChrome();
    wireGrid();
  }

  // ---------- decorate after every render ----------
  function decorate() {
    const head = table.tHead;
    if (!head) return;
    if (!head.querySelector('.xl-letters')) {
      const ths = Array.from(head.rows[0].cells);
      ths.forEach((th, c) => {
        const label = th.textContent.trim();
        th.dataset.label = label;
        th.dataset.col = c;
        if (c > 0) th.innerHTML = `<span class="xl-th-label">${esc(label)}</span><button type="button" class="xl-fbtn" data-col="${c}" title="Sort and filter ${esc(label)}" aria-label="Sort and filter ${esc(label)}">&#9662;</button>`;
      });
      const tr = document.createElement('tr');
      tr.className = 'xl-letters';
      tr.innerHTML = ths.map((_, c) => (c === 0
        ? '<th class="xl-corner" title="Select all"></th>'
        : `<th class="xl-letter" data-col="${c}">${letter(c - 1)}</th>`)).join('');
      head.insertBefore(tr, head.rows[0]);
    }
    allRows().forEach((tr, i) => {
      if (!tr.dataset.xlOrder) tr.dataset.xlOrder = String(i);
      if (tr.cells[0]) tr.cells[0].classList.add('xl-rowhead');
    });
    table.classList.add('xl-grid');
    applySortFilter();
    applyFormats();
    applyView();
    clampSelection();
    paintSelection();
  }

  // ---------- sort & filter ----------
  function compare(a, b) {
    const na = Number(String(a).replace(/,/g, ''));
    const nb = Number(String(b).replace(/,/g, ''));
    const aNum = a !== '' && a !== '—' && Number.isFinite(na);
    const bNum = b !== '' && b !== '—' && Number.isFinite(nb);
    const aBlank = a === '' || a === '—';
    const bBlank = b === '' || b === '—';
    if (aBlank || bBlank) return aBlank === bBlank ? 0 : (aBlank ? 1 : -1);
    if (aNum && bNum) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  function applySortFilter() {
    const body = table.tBodies[0];
    if (!body) return;
    const names = labels();
    const rows = allRows().map((tr) => ({ tr, i: Number(tr.dataset.xlOrder) || 0 }));
    const c = state.sort ? names.indexOf(state.sort.label) : -1;
    const dir = state.sort && state.sort.dir === 'desc' ? -1 : 1;
    rows.forEach((x) => { x.v = c > 0 ? cellText(x.tr.cells[c]) : ''; });
    rows.sort((x, y) => {
      if (c > 0) {
        const blankX = x.v === '' || x.v === '—';
        const blankY = y.v === '' || y.v === '—';
        if (blankX !== blankY) return blankX ? 1 : -1;
        const d = compare(x.v, y.v) * dir;
        if (d) return d;
      }
      return x.i - y.i;
    }).forEach(({ tr }) => body.appendChild(tr));
    const active = Object.entries(state.filters).map(([label, hide]) => [names.indexOf(label), new Set(hide)]).filter(([c, hide]) => c > 0 && hide.size);
    let n = 0;
    allRows().forEach((tr) => {
      const out = active.some(([c, hide]) => hide.has(cellText(tr.cells[c]) || '(Blanks)'));
      tr.classList.toggle('xl-hidden', out);
      if (!out) { n += 1; if (tr.cells[0]) tr.cells[0].textContent = n; }
    });
    table.querySelectorAll('.xl-fbtn').forEach((b) => {
      const label = names[Number(b.dataset.col)];
      const filtered = (state.filters[label] || []).length > 0;
      const sorted = state.sort && state.sort.label === label;
      b.classList.toggle('is-on', filtered || Boolean(sorted));
      b.innerHTML = filtered ? '&#9663;' : sorted ? (state.sort.dir === 'desc' ? '&#8595;' : '&#8593;') : '&#9662;';
    });
  }
  function sortBy(c, dir) {
    if (c < 1) return;
    state.sort = { label: labels()[c], dir };
    save();
    applySortFilter();
    paintSelection();
    flash(`Sorted by ${labels()[c]} ${dir === 'desc' ? 'Z → A' : 'A → Z'}`);
  }

  function openFilterMenu(c, anchorEl) {
    if (c < 1) return;
    const label = labels()[c];
    const hidden = new Set(state.filters[label] || []);
    const values = Array.from(new Set(allRows().map((tr) => cellText(tr.cells[c]) || '(Blanks)')))
      .sort((a, b) => (a === '(Blanks)') - (b === '(Blanks)') || compare(a, b));
    const m = ui.menu;
    m.innerHTML = `
      <button type="button" class="xl-mi" data-m="asc">&#8593; Sort A to Z</button>
      <button type="button" class="xl-mi" data-m="desc">&#8595; Sort Z to A</button>
      <hr />
      <input type="search" class="xl-mi-search" placeholder="Search" />
      <div class="xl-mi-list">
        <label class="xl-mi-all"><input type="checkbox" data-all /> (Select all)</label>
        ${values.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${hidden.has(v) ? '' : 'checked'} /> <span dir="auto">${esc(v)}</span></label>`).join('')}
      </div>
      <div class="xl-mi-actions">
        <button type="button" class="xl-btn" data-m="clear">Clear filter</button>
        <button type="button" class="xl-btn xl-green" data-m="ok">OK</button>
        <button type="button" class="xl-btn" data-m="cancel">Cancel</button>
      </div>`;
    const boxes = () => Array.from(m.querySelectorAll('.xl-mi-list input[value]'));
    const all = m.querySelector('[data-all]');
    const syncAll = () => { const b = boxes().filter((x) => !x.closest('label').hidden); all.checked = b.every((x) => x.checked); all.indeterminate = !all.checked && b.some((x) => x.checked); };
    syncAll();
    all.addEventListener('change', () => { boxes().filter((x) => !x.closest('label').hidden).forEach((x) => { x.checked = all.checked; }); });
    m.querySelector('.xl-mi-list').addEventListener('change', (e) => { if (e.target.value) syncAll(); });
    m.querySelector('.xl-mi-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      boxes().forEach((x) => { x.closest('label').hidden = q && !x.value.toLowerCase().includes(q); });
      syncAll();
    });
    m.onclick = (e) => {
      const act = e.target.closest('[data-m]');
      if (!act) return;
      const k = act.dataset.m;
      if (k === 'asc' || k === 'desc') sortBy(c, k);
      if (k === 'clear') { delete state.filters[label]; save(); applySortFilter(); clampSelection(); paintSelection(); }
      if (k === 'ok') {
        const off = boxes().filter((x) => !x.checked).map((x) => x.value);
        if (off.length) state.filters[label] = off; else delete state.filters[label];
        save();
        applySortFilter();
        clampSelection();
        paintSelection();
      }
      closeMenu();
    };
    const r = anchorEl.getBoundingClientRect();
    m.hidden = false;
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
    m.querySelector('.xl-mi-search').focus();
  }
  function closeMenu() { if (ui) { ui.menu.hidden = true; ui.menu.onclick = null; } }

  // ---------- formats ----------
  const fmtKey = (tr, c) => { const k = rowKey(tr); return k ? `${k}|${labels()[c]}` : ''; };
  function styleFor(f) {
    const s = [];
    if (f.ff) s.push(`font-family:'${f.ff}'`);
    if (f.fs) s.push(`font-size:${f.fs}px`);
    if (f.b) s.push('font-weight:800');
    if (f.i) s.push('font-style:italic');
    const deco = [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ');
    if (deco) s.push(`text-decoration:${deco}`);
    if (f.color) s.push(`color:${f.color}`);
    if (f.fill) s.push(`background-color:${f.fill}`);
    if (f.align) s.push(`text-align:${f.align}`);
    if (f.wrap) s.push('white-space:normal', 'min-width:160px');
    if (f.border) s.push('box-shadow:inset 0 0 0 1.5px #1f2937');
    return s.join(';');
  }
  function applyFormats() {
    allRows().forEach((tr) => {
      Array.from(tr.cells).forEach((td, c) => {
        if (c === 0) return;
        const f = state.formats[fmtKey(tr, c)];
        td.setAttribute('style', f ? styleFor(f) : '');
        td.classList.toggle('xl-fmt', Boolean(f));
      });
    });
  }
  function eachSelected(fn) {
    const r = range();
    if (!r) return;
    const rows = visibleRows();
    for (let i = r.r1; i <= r.r2; i += 1) {
      for (let c = Math.max(1, r.c1); c <= r.c2; c += 1) {
        if (rows[i]) fn(rows[i], c);
      }
    }
  }
  function setFormat(prop, value) {
    if (!range()) { flash('Select cells first'); return; }
    eachSelected((tr, c) => {
      const k = fmtKey(tr, c);
      if (!k) return;
      const f = Object.assign({}, state.formats[k]);
      if (value === null || value === false || value === '') delete f[prop]; else f[prop] = value;
      if (Object.keys(f).length) state.formats[k] = f; else delete state.formats[k];
    });
    save();
    applyFormats();
    applyView();
    paintRibbon();
  }
  const activeFormat = () => {
    if (!focus) return {};
    const tr = visibleRows()[focus.r];
    return (tr && state.formats[fmtKey(tr, focus.c)]) || {};
  };
  function toggle(prop) { setFormat(prop, !activeFormat()[prop]); }

  // ---------- view: freeze, zoom, gridlines ----------
  function applyView() {
    table.classList.toggle('xl-nogrid', !state.gridlines);
    table.style.zoom = String(state.zoom / 100);
    ui.zoom.value = state.zoom;
    ui.zoomLabel.textContent = `${state.zoom}%`;
    ui.box.querySelector('.xl-freeze-label').textContent = state.freezeCols > 1 ? 'Unfreeze panes' : 'Freeze panes';
    applyFreeze();
  }
  function applyFreeze() {
    const head = table.tHead;
    if (!head || !table.offsetWidth) return;
    const letters = head.querySelector('.xl-letters');
    const top = letters ? letters.offsetHeight : 0;
    Array.from(head.rows).forEach((tr) => {
      if (tr === letters) return;
      Array.from(tr.cells).forEach((th) => { th.style.top = `${top}px`; });
    });
    table.querySelectorAll('.xl-frozen').forEach((el) => { el.classList.remove('xl-frozen', 'xl-frozen-last'); el.style.left = ''; });
    const n = Math.max(1, state.freezeCols);
    const firstRow = head.rows[head.rows.length - 1];
    const lefts = [];
    let x = 0;
    for (let c = 0; c < n && c < firstRow.cells.length; c += 1) { lefts.push(x); x += firstRow.cells[c].offsetWidth; }
    Array.from(table.rows).forEach((tr) => {
      lefts.forEach((left, c) => {
        const cell = tr.cells[c];
        if (!cell || cell.colSpan > 1) return;
        cell.classList.add('xl-frozen');
        if (c === lefts.length - 1) cell.classList.add('xl-frozen-last');
        cell.style.left = `${left}px`;
      });
    });
  }

  // ---------- selection ----------
  function range() {
    if (!anchor || !focus) return null;
    return { r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c) };
  }
  function clampSelection() {
    const rows = visibleRows().length;
    const cols = colCount();
    if (!rows || !anchor) { anchor = null; focus = null; return; }
    const fix = (p) => ({ r: Math.min(Math.max(0, p.r), rows - 1), c: Math.min(Math.max(1, p.c), cols - 1) });
    anchor = fix(anchor);
    focus = fix(focus);
  }
  function select(a, f) {
    anchor = a;
    focus = f || a;
    clampSelection();
    paintSelection();
  }
  function paintSelection() {
    table.querySelectorAll('.xl-sel, .xl-active, .xl-hl').forEach((el) => el.classList.remove('xl-sel', 'xl-active', 'xl-hl', 'xl-st', 'xl-sb', 'xl-sl', 'xl-sr'));
    const r = range();
    const rows = visibleRows();
    if (r) {
      for (let i = r.r1; i <= r.r2; i += 1) {
        const tr = rows[i];
        if (!tr) continue;
        if (tr.cells[0]) tr.cells[0].classList.add('xl-hl');
        for (let c = r.c1; c <= r.c2; c += 1) {
          const td = tr.cells[c];
          if (!td) continue;
          td.classList.add('xl-sel');
          if (i === r.r1) td.classList.add('xl-st');
          if (i === r.r2) td.classList.add('xl-sb');
          if (c === r.c1) td.classList.add('xl-sl');
          if (c === r.c2) td.classList.add('xl-sr');
        }
      }
      table.querySelectorAll('.xl-letter').forEach((th) => { const c = Number(th.dataset.col); if (c >= r.c1 && c <= r.c2) th.classList.add('xl-hl'); });
      const act = cellAt(focus.r, focus.c);
      if (act) act.classList.add('xl-active');
    }
    paintFormulaBar();
    paintRibbon();
    paintStatus();
  }
  function paintFormulaBar() {
    if (!focus) { ui.name.value = ''; ui.formula.value = ''; return; }
    const r = range();
    const ref = (p) => `${letter(p.c - 1)}${p.r + 1}`;
    ui.name.value = r && (r.r1 !== r.r2 || r.c1 !== r.c2) ? `${ref({ r: r.r1, c: r.c1 })}:${ref({ r: r.r2, c: r.c2 })}` : ref(focus);
    ui.formula.value = cellText(cellAt(focus.r, focus.c));
  }
  function paintRibbon() {
    const f = activeFormat();
    ui.font.value = f.ff || 'Manrope';
    ui.size.value = String(f.fs || 13);
    ui.box.querySelectorAll('[data-toggle]').forEach((b) => b.classList.toggle('is-on', Boolean(f[b.dataset.toggle])));
    ui.box.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('is-on', f.align === b.dataset.align));
    ui.box.querySelector('[data-act="gridlines"]').classList.toggle('is-on', state.gridlines);
  }
  function paintStatus() {
    const shown = visibleRows().length;
    const total = allRows().length;
    const filters = Object.values(state.filters).filter((v) => v && v.length).length;
    ui.stLeft.textContent = `${shown} of ${total} rows${filters ? ` · ${filters} filter${filters > 1 ? 's' : ''} on` : ''}${state.sort ? ` · sorted by ${state.sort.label}` : ''}`;
    const r = range();
    if (!r || (r.r1 === r.r2 && r.c1 === r.c2)) { ui.stCalc.textContent = ''; return; }
    let count = 0; let nums = 0; let sum = 0;
    eachSelected((tr, c) => {
      const v = cellText(tr.cells[c]);
      if (v === '' || v === '—') return;
      count += 1;
      const n = Number(v.replace(/,/g, ''));
      if (Number.isFinite(n)) { nums += 1; sum += n; }
    });
    ui.stCalc.textContent = nums ? `Average: ${+(sum / nums).toFixed(2)}   Count: ${count}   Sum: ${+sum.toFixed(2)}` : `Count: ${count}`;
  }
  function scrollToCell(td) {
    if (!td) return;
    const w = wrap.getBoundingClientRect();
    const r = td.getBoundingClientRect();
    const head = table.tHead.getBoundingClientRect().height;
    const frozen = table.querySelector('tbody .xl-frozen-last');
    const left = frozen ? frozen.getBoundingClientRect().right - w.left : 0;
    if (r.top < w.top + head) wrap.scrollTop -= (w.top + head - r.top);
    else if (r.bottom > w.bottom - 12) wrap.scrollTop += r.bottom - w.bottom + 12;
    if (!td.classList.contains('xl-frozen')) {
      if (r.left < w.left + left) wrap.scrollLeft -= (w.left + left - r.left);
      else if (r.right > w.right - 12) wrap.scrollLeft += r.right - w.right + 12;
    }
  }

  // ---------- copy ----------
  function selectionData() {
    const r = range();
    if (!r) return null;
    const rows = visibleRows();
    const text = [];
    const html = [];
    for (let i = r.r1; i <= r.r2; i += 1) {
      const tr = rows[i];
      if (!tr) continue;
      const t = [];
      const h = [];
      for (let c = r.c1; c <= r.c2; c += 1) {
        const v = cellText(tr.cells[c]);
        t.push(v.replace(/[\t\n]/g, ' '));
        const f = state.formats[fmtKey(tr, c)];
        h.push(`<td${f ? ` style="${esc(styleFor(f))}"` : ''}>${esc(v)}</td>`);
      }
      text.push(t.join('\t'));
      html.push(`<tr>${h.join('')}</tr>`);
    }
    return { text: text.join('\r\n'), html: `<table>${html.join('')}</table>`, cells: (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) };
  }
  async function copySelection() {
    const d = selectionData();
    if (!d) { flash('Select cells first'); return; }
    try {
      if (global.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([d.text], { type: 'text/plain' }),
          'text/html': new Blob([d.html], { type: 'text/html' }),
        })]);
      } else {
        await navigator.clipboard.writeText(d.text);
      }
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = d.text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    markCopied();
    flash(`Copied ${d.cells} cell${d.cells === 1 ? '' : 's'} — paste into Excel`);
  }
  function markCopied() {
    table.querySelectorAll('.xl-copied').forEach((el) => el.classList.remove('xl-copied'));
    eachSelected((tr, c) => tr.cells[c] && tr.cells[c].classList.add('xl-copied'));
  }

  // ---------- find ----------
  function runFind(step) {
    const q = ui.findInput.value.trim().toLowerCase();
    table.querySelectorAll('.xl-found').forEach((el) => el.classList.remove('xl-found'));
    found = [];
    if (q) {
      visibleRows().forEach((tr, r) => {
        Array.from(tr.cells).forEach((td, c) => {
          if (c > 0 && cellText(td).toLowerCase().includes(q)) { found.push({ r, c }); td.classList.add('xl-found'); }
        });
      });
    }
    if (!found.length) { foundAt = -1; ui.findCount.textContent = q ? 'No match' : '0 of 0'; return; }
    foundAt = step === 0 ? 0 : (foundAt + step + found.length) % found.length;
    const hit = found[foundAt];
    select(hit);
    scrollToCell(cellAt(hit.r, hit.c));
    ui.findCount.textContent = `${foundAt + 1} of ${found.length}`;
  }
  function openFind() {
    ui.find.hidden = false;
    ui.findInput.focus();
    ui.findInput.select();
  }
  function closeFind() {
    ui.find.hidden = true;
    table.querySelectorAll('.xl-found').forEach((el) => el.classList.remove('xl-found'));
  }

  // ---------- export ----------
  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_SRC;
      s.onload = () => resolve(global.XLSX);
      s.onerror = () => reject(new Error('Could not load the Excel writer. Check the internet connection.'));
      document.head.appendChild(s);
    });
  }
  async function download() {
    try {
      flash('Preparing Excel file…');
      const XLSX = await loadXlsx();
      const names = labels();
      const cols = names.map((_, c) => c).filter((c) => c > 0);
      const aoa = [cols.map((c) => names[c])];
      visibleRows().forEach((tr) => aoa.push(cols.map((c) => {
        const v = cellText(tr.cells[c]);
        if (v === '—') return '';
        const n = Number(v);
        return v !== '' && Number.isFinite(n) && !/^0\d/.test(v) && v.length < 15 ? n : v;
      })));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = cols.map((c, i) => ({ wch: Math.min(40, Math.max(8, ...aoa.map((row) => String(row[i] == null ? '' : row[i]).length + 2))) }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
      ws['!freeze'] = { xSplit: Math.max(0, state.freezeCols - 1), ySplit: 1 };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Live Sheet');
      XLSX.writeFile(wb, `Live-Sheet-${new Date().toISOString().slice(0, 10)}.xlsx`);
      flash(`Downloaded ${aoa.length - 1} rows`);
    } catch (e) {
      flash(e.message || 'Download failed');
    }
  }

  let flashTimer = null;
  function flash(msg) {
    if (!ui) return;
    ui.stLeft.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(paintStatus, 2600);
  }

  // ---------- events ----------
  function wireChrome() {
    ui.box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.toggle) { toggle(b.dataset.toggle); return; }
      if (b.dataset.align) { setFormat('align', activeFormat().align === b.dataset.align ? null : b.dataset.align); return; }
      const act = b.dataset.act;
      const c = focus ? focus.c : -1;
      if (act === 'copy') copySelection();
      else if (act === 'select-all') selectAll();
      else if (act === 'grow' || act === 'shrink') {
        const cur = Number(activeFormat().fs || 13);
        const i = SIZES.findIndex((s) => s >= cur);
        const next = act === 'grow' ? SIZES[Math.min(SIZES.length - 1, (SIZES[i] === cur ? i + 1 : i))] : SIZES[Math.max(0, (i < 0 ? SIZES.length : i) - 1)];
        setFormat('fs', next === 13 ? null : next);
      } else if (act === 'no-fill') setFormat('fill', null);
      else if (act === 'sort-asc' || act === 'sort-desc') { if (c > 0) sortBy(c, act === 'sort-asc' ? 'asc' : 'desc'); else flash('Click a cell in the column to sort'); }
      else if (act === 'filter') { if (c > 0) openFilterMenu(c, table.querySelector(`.xl-fbtn[data-col="${c}"]`) || b); else flash('Click a cell in the column to filter'); }
      else if (act === 'clear-filters') { state.sort = null; state.filters = {}; save(); engaged = true; applySortFilter(); clampSelection(); paintSelection(); flash('Sort and filters cleared'); }
      else if (act === 'freeze') {
        state.freezeCols = state.freezeCols > 1 ? 1 : (c > 1 ? c : 2);
        save();
        applyView();
        flash(state.freezeCols > 1 ? `Frozen up to column ${letter(state.freezeCols - 2)}` : 'Panes unfrozen');
      } else if (act === 'gridlines') { state.gridlines = !state.gridlines; save(); applyView(); paintRibbon(); }
      else if (act === 'find') openFind();
      else if (act === 'find-next') runFind(1);
      else if (act === 'find-prev') runFind(-1);
      else if (act === 'find-close') closeFind();
      else if (act === 'clear-format') {
        eachSelected((tr, col) => { delete state.formats[fmtKey(tr, col)]; });
        save();
        applyFormats();
        applyView();
        paintRibbon();
      } else if (act === 'download') download();
    });
    ui.font.addEventListener('change', () => setFormat('ff', ui.font.value === 'Manrope' ? null : ui.font.value));
    ui.size.addEventListener('change', () => setFormat('fs', Number(ui.size.value) === 13 ? null : Number(ui.size.value)));
    ui.box.querySelectorAll('input[type="color"]').forEach((inp) => {
      inp.addEventListener('input', () => setFormat(inp.dataset.fmt, inp.value));
    });
    ui.findInput.addEventListener('input', () => runFind(0));
    ui.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') closeFind();
    });
    ui.zoom.addEventListener('input', () => { state.zoom = Number(ui.zoom.value); save(); applyView(); });
  }

  function selectAll() {
    const rows = visibleRows().length;
    if (!rows) return;
    engaged = true;
    select({ r: 0, c: 1 }, { r: rows - 1, c: colCount() - 1 });
  }

  function posOf(td) {
    const tr = td.parentElement;
    if (!tr || tr.parentElement !== table.tBodies[0]) return null;
    const r = visibleRows().indexOf(tr);
    return r < 0 ? null : { r, c: td.cellIndex };
  }

  function wireGrid() {
    table.addEventListener('mousedown', (e) => {
      engaged = true;
      const fbtn = e.target.closest('.xl-fbtn');
      if (fbtn) { e.preventDefault(); openFilterMenu(Number(fbtn.dataset.col), fbtn); return; }
      if (e.target.closest('.xl-corner')) { e.preventDefault(); selectAll(); return; }
      const letterTh = e.target.closest('.xl-letter');
      if (letterTh) {
        e.preventDefault();
        const c = Number(letterTh.dataset.col);
        const last = visibleRows().length - 1;
        if (last < 0) return;
        if (e.shiftKey && anchor) select({ r: 0, c: anchor.c }, { r: last, c });
        else select({ r: 0, c }, { r: last, c });
        dragging = 'col';
        return;
      }
      const td = e.target.closest('td');
      if (!td) return;
      const p = posOf(td);
      if (!p) return;
      const control = e.target.closest('select, input, textarea, button, a');
      if (p.c === 0) {
        if (!control) e.preventDefault();
        const lastCol = colCount() - 1;
        if (e.shiftKey && anchor) select({ r: anchor.r, c: 1 }, { r: p.r, c: lastCol });
        else select({ r: p.r, c: 1 }, { r: p.r, c: lastCol });
        dragging = 'row';
        return;
      }
      if (!control) e.preventDefault();
      if (e.shiftKey && anchor) select(anchor, p);
      else select(p);
      dragging = control ? false : 'cell';
    });
    table.addEventListener('mouseover', (e) => {
      if (!dragging || !anchor) return;
      if (dragging === 'col') {
        const th = e.target.closest('.xl-letter');
        if (th) { focus = { r: focus.r, c: Number(th.dataset.col) }; paintSelection(); }
        return;
      }
      const td = e.target.closest('td');
      const p = td && posOf(td);
      if (!p) return;
      focus = dragging === 'row' ? { r: p.r, c: focus.c } : { r: p.r, c: Math.max(1, p.c) };
      paintSelection();
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    document.addEventListener('mousedown', (e) => {
      if (ui.menu.contains(e.target) || e.target.closest('.xl-fbtn')) return;
      closeMenu();
      if (!ui.card.contains(e.target)) engaged = false;
    });
    table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      const ctl = td.querySelector('select, input');
      if (ctl) ctl.focus();
    });
    document.addEventListener('copy', (e) => {
      if (!engaged || isTyping(document.activeElement)) return;
      const d = selectionData();
      if (!d) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', d.text);
      e.clipboardData.setData('text/html', d.html);
      markCopied();
      flash(`Copied ${d.cells} cell${d.cells === 1 ? '' : 's'} — paste into Excel`);
    });
    document.addEventListener('keydown', onKey);
    if (global.ResizeObserver) new ResizeObserver(() => applyFreeze()).observe(table);
    else global.addEventListener('resize', () => applyFreeze());
  }

  function isTyping(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !(el.type === 'range');
  }

  function onKey(e) {
    if (!table || !table.isConnected || !ui.card.offsetParent) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'f' && engaged) { e.preventDefault(); openFind(); return; }
    if (e.key === 'Escape') {
      closeMenu();
      if (!ui.find.hidden) closeFind();
      table.querySelectorAll('.xl-copied').forEach((el) => el.classList.remove('xl-copied'));
      return;
    }
    if (!engaged || isTyping(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
    if (mod && k === 'b') { e.preventDefault(); toggle('b'); return; }
    if (mod && k === 'i') { e.preventDefault(); toggle('i'); return; }
    if (mod && k === 'u') { e.preventDefault(); toggle('u'); return; }
    if (!focus) return;
    const rows = visibleRows().length;
    const cols = colCount();
    let { r, c } = focus;
    const page = Math.max(1, Math.floor(wrap.clientHeight / 34) - 1);
    switch (e.key) {
      case 'ArrowUp': r = mod ? 0 : r - 1; break;
      case 'ArrowDown': r = mod ? rows - 1 : r + 1; break;
      case 'ArrowLeft': c = mod ? 1 : c - 1; break;
      case 'ArrowRight': c = mod ? cols - 1 : c + 1; break;
      case 'Tab': c = e.shiftKey ? c - 1 : c + 1; break;
      case 'Enter': {
        const ctl = cellAt(r, c) && cellAt(r, c).querySelector('select, input, .vin-btn');
        if (ctl && !e.shiftKey) { e.preventDefault(); ctl.focus(); if (ctl.classList.contains('vin-btn')) ctl.click(); return; }
        r = e.shiftKey ? r - 1 : r + 1;
        break;
      }
      case 'Home': c = 1; if (mod) r = 0; break;
      case 'End': c = cols - 1; if (mod) r = rows - 1; break;
      case 'PageUp': r -= page; break;
      case 'PageDown': r += page; break;
      default: return;
    }
    e.preventDefault();
    const next = { r: Math.min(Math.max(0, r), rows - 1), c: Math.min(Math.max(1, c), cols - 1) };
    if (e.shiftKey && e.key.startsWith('Arrow')) { focus = next; paintSelection(); } else select(next);
    scrollToCell(cellAt(focus.r, focus.c));
  }

  // Called after every render of the Live Sheet table.
  function attach(tableEl) {
    if (!tableEl) return;
    if (table !== tableEl) {
      table = tableEl;
      buildChrome();
    }
    decorate();
    if (!ui.find.hidden && ui.findInput.value) runFind(0);
  }

  global.DTXLiveExcel = { attach };
})(window);
