/**
 * Sheet tools for Delivery Team tables:
 *  - Excel-style cell selection (click, drag, Shift+click) · Ctrl+C copies as cells (TSV + bordered HTML table)
 *  - A filter box above every column · filters live only in this browser (per user), never on the server
 * Tables are re-rendered by app.js via innerHTML; a MutationObserver re-attaches after every render.
 */
(function (global) {
  'use strict';

  const CONTROL_SEL = 'input, select, textarea';
  const FILTER_HINT = 'contains · =exact · !not · "empty" for blank cells';
  const tables = new Map();
  let active = null;
  let copyPayload = null;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const userKey = () => norm((document.getElementById('side-name') || {}).textContent || '') || 'guest';
  const storeKey = (t) => `dt-colfilters:${userKey()}:${t.id}`;

  // ---------- Cell text (controls report their value, not their markup) ----------

  function cellText(td) {
    if (!td) return '';
    const ctl = td.querySelector(CONTROL_SEL);
    if (ctl) {
      if (ctl.type === 'checkbox') return ctl.checked ? 'Yes' : '';
      if (ctl.tagName === 'SELECT') {
        const opt = ctl.options[ctl.selectedIndex];
        return norm(opt && ctl.value !== '' ? opt.text : '');
      }
      return norm(ctl.value);
    }
    const t = norm(td.innerText);
    return t === '—' ? '' : t;
  }

  const headerRow = (t) => t.el.tHead && t.el.tHead.rows[0];
  const headerLabels = (t) => {
    const row = headerRow(t);
    return row ? [...row.cells].map((th) => norm(th.textContent)) : [];
  };
  const dataRows = (t) => (t.el.tBodies[0] ? [...t.el.tBodies[0].rows] : [])
    .filter((tr) => !tr.classList.contains('st-empty') && !(tr.cells.length === 1 && tr.cells[0].colSpan > 1));
  const visibleRows = (t) => dataRows(t).filter((tr) => !tr.classList.contains('st-hide'));

  // ---------- Filters ----------

  function loadFilters(t) {
    try { return JSON.parse(localStorage.getItem(storeKey(t)) || '{}') || {}; } catch { return {}; }
  }
  function saveFilters(t) {
    try {
      const clean = Object.fromEntries(Object.entries(t.filters).filter(([, v]) => v));
      if (Object.keys(clean).length) localStorage.setItem(storeKey(t), JSON.stringify(clean));
      else localStorage.removeItem(storeKey(t));
    } catch { /* storage full or blocked */ }
  }

  function matches(value, rule) {
    const v = value.toLowerCase();
    const r = norm(rule).toLowerCase();
    if (!r) return true;
    if (r === 'empty' || r === '""') return v === '';
    if (r === '!empty' || r === '!""') return v !== '';
    if (r.startsWith('!')) return !v.includes(r.slice(1).trim());
    if (r.startsWith('=')) return v === r.slice(1).trim();
    return r.split(/\s+/).every((part) => v.includes(part));
  }

  function applyFilters(t) {
    const labels = headerLabels(t);
    const rules = labels.map((l) => t.filters[l] || '');
    const any = rules.some(Boolean);
    const rows = dataRows(t);
    let shown = 0;
    rows.forEach((tr) => {
      const ok = !any || rules.every((rule, i) => !rule || matches(cellText(tr.cells[i]), rule));
      tr.classList.toggle('st-hide', !ok);
      if (ok) shown += 1;
    });
    const body = t.el.tBodies[0];
    let empty = body && body.querySelector('tr.st-empty');
    if (body && any && rows.length && !shown) {
      if (!empty) {
        empty = document.createElement('tr');
        empty.className = 'st-empty';
        empty.innerHTML = `<td colspan="${labels.length || 1}">No rows match your column filters.</td>`;
        body.appendChild(empty);
      }
    } else if (empty) empty.remove();
    const row = t.el.tHead && t.el.tHead.querySelector('tr.st-filters');
    if (row) [...row.cells].forEach((th, i) => th.classList.toggle('is-on', !!rules[i]));
    updateBar(t, rows.length, shown, any);
    clearSelection(t);
  }

  function buildFilterRow(t) {
    const head = headerRow(t);
    if (!head || t.el.tHead.querySelector('tr.st-filters')) return;
    const row = document.createElement('tr');
    row.className = 'st-filters';
    row.innerHTML = [...head.cells].map((th) => {
      const label = norm(th.textContent);
      const cls = [...th.classList].filter((c) => c.startsWith('col-')).join(' ');
      if (!label || label === '#') return `<th class="${cls} st-fcell"></th>`;
      const val = t.filters[label] || '';
      return `<th class="${cls} st-fcell${val ? ' is-on' : ''}"><input type="search" class="st-filter" data-col="${esc(label)}" value="${esc(val)}" placeholder="Filter…" title="${esc(`${label}: ${FILTER_HINT}`)}" aria-label="Filter ${esc(label)}" /></th>`;
    }).join('');
    head.after(row);
    t.el.style.setProperty('--st-head-h', `${head.getBoundingClientRect().height || 30}px`);
  }

  // ---------- Toolbar (row count · clear · copy) ----------

  function ensureBar(t) {
    if (t.bar && t.bar.isConnected) return t.bar;
    const wrap = t.el.closest('.table-wrap') || t.el;
    const bar = document.createElement('div');
    bar.className = 'st-bar';
    bar.innerHTML = `<span class="st-count"></span>
      <button type="button" class="st-btn" data-st="clear" hidden>Clear my filters</button>
      <span class="st-sel-info"></span>
      <button type="button" class="st-btn" data-st="copy" disabled title="Ctrl+C">Copy cells</button>
      <button type="button" class="st-btn" data-st="copy-h" disabled>Copy with headers</button>
      <span class="st-hint">Click / drag cells · Shift+click to extend · Ctrl+C to copy · filters are only yours</span>`;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      if (b.dataset.st === 'clear') {
        t.filters = {};
        saveFilters(t);
        t.el.querySelectorAll('input.st-filter').forEach((i) => { i.value = ''; });
        applyFilters(t);
      } else copySelection(t, b.dataset.st === 'copy-h');
    });
    wrap.parentNode.insertBefore(bar, wrap);
    t.bar = bar;
    return bar;
  }

  function updateBar(t, total, shown, any) {
    const bar = ensureBar(t);
    bar.querySelector('.st-count').textContent = any ? `Showing ${shown} of ${total} rows` : `${total} rows`;
    bar.querySelector('[data-st="clear"]').hidden = !any;
    bar.classList.toggle('is-filtered', any);
  }

  function updateSelInfo(t) {
    const bar = ensureBar(t);
    const n = t.sel ? (Math.abs(t.sel.r2 - t.sel.r1) + 1) * (Math.abs(t.sel.c2 - t.sel.c1) + 1) : 0;
    bar.querySelector('.st-sel-info').textContent = n ? `${n} cell${n === 1 ? '' : 's'} selected` : '';
    bar.querySelectorAll('[data-st^="copy"]').forEach((b) => { b.disabled = !n; });
  }

  // ---------- Selection ----------

  function clearSelection(t) {
    if (!t) return;
    t.el.querySelectorAll('td.st-sel').forEach((td) => td.classList.remove('st-sel', 'st-anchor'));
    t.sel = null;
    updateSelInfo(t);
  }

  function paintSelection(t) {
    t.el.querySelectorAll('td.st-sel').forEach((td) => td.classList.remove('st-sel', 'st-anchor'));
    if (!t.sel) { updateSelInfo(t); return; }
    const rows = visibleRows(t);
    const [r1, r2] = [Math.min(t.sel.r1, t.sel.r2), Math.max(t.sel.r1, t.sel.r2)];
    const [c1, c2] = [Math.min(t.sel.c1, t.sel.c2), Math.max(t.sel.c1, t.sel.c2)];
    for (let r = r1; r <= r2; r += 1) {
      const tr = rows[r];
      if (!tr) continue;
      for (let c = c1; c <= c2; c += 1) if (tr.cells[c]) tr.cells[c].classList.add('st-sel');
    }
    const a = rows[t.sel.r1] && rows[t.sel.r1].cells[t.sel.c1];
    if (a) a.classList.add('st-anchor');
    updateSelInfo(t);
  }

  function cellPos(t, td) {
    const tr = td.parentElement;
    const r = visibleRows(t).indexOf(tr);
    return r < 0 ? null : { r, c: td.cellIndex };
  }

  function onMouseDown(t, e) {
    if (e.button !== 0) return;
    const td = e.target.closest('td');
    if (!td || !t.el.tBodies[0] || !t.el.tBodies[0].contains(td)) return;
    const pos = cellPos(t, td);
    if (!pos) return;
    if (active && active !== t) clearSelection(active);
    active = t;
    if (e.shiftKey && t.sel) {
      t.sel.r2 = pos.r;
      t.sel.c2 = pos.c;
      e.preventDefault();
    } else {
      t.sel = { r1: pos.r, c1: pos.c, r2: pos.r, c2: pos.c };
      if (!e.target.closest(CONTROL_SEL)) {
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body && !t.el.contains(document.activeElement)) document.activeElement.blur();
      }
      t.dragging = true;
      t.el.classList.add('st-dragging');
    }
    paintSelection(t);
  }

  function onMouseOver(t, e) {
    if (!t.dragging || !t.sel) return;
    const td = e.target.closest('td');
    if (!td || !t.el.contains(td)) return;
    const pos = cellPos(t, td);
    if (!pos || (pos.r === t.sel.r2 && pos.c === t.sel.c2)) return;
    t.sel.r2 = pos.r;
    t.sel.c2 = pos.c;
    paintSelection(t);
  }

  function endDrag() {
    tables.forEach((t) => { t.dragging = false; t.el.classList.remove('st-dragging'); });
  }

  // ---------- Copy (TSV for plain text · bordered HTML table so Excel / Outlook paste as boxes) ----------

  function tsvCell(v) {
    return /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function buildCopy(t, withHeaders) {
    if (!t.sel) return null;
    const rows = visibleRows(t);
    const [r1, r2] = [Math.min(t.sel.r1, t.sel.r2), Math.max(t.sel.r1, t.sel.r2)];
    const [c1, c2] = [Math.min(t.sel.c1, t.sel.c2), Math.max(t.sel.c1, t.sel.c2)];
    const grid = [];
    if (withHeaders) grid.push(headerLabels(t).slice(c1, c2 + 1));
    for (let r = r1; r <= r2; r += 1) {
      const tr = rows[r];
      if (!tr) continue;
      const line = [];
      for (let c = c1; c <= c2; c += 1) line.push(cellText(tr.cells[c]));
      grid.push(line);
    }
    const text = grid.map((line) => line.map(tsvCell).join('\t')).join('\r\n');
    const td = 'border:1px solid #9aa5b1;padding:4px 8px;white-space:nowrap';
    const th = `${td};background:#e8eef5;font-weight:bold`;
    // Long digit strings / leading zeros (VINs, orders, phones) must stay text in Excel.
    const keepText = (v) => /^\+?0\d|^\d{12,}$/.test(v) ? ";mso-number-format:'\\@'" : '';
    const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">${grid.map((line, i) =>
      `<tr>${line.map((v) => (withHeaders && i === 0 ? `<th style="${th}">${esc(v)}</th>` : `<td style="${td}${keepText(v)}">${esc(v)}</td>`)).join('')}</tr>`
    ).join('')}</table>`;
    return { text, html, cells: grid.length * (c2 - c1 + 1) };
  }

  function flash(t, msg) {
    const bar = ensureBar(t);
    const info = bar.querySelector('.st-sel-info');
    info.textContent = msg;
    info.classList.add('is-flash');
    clearTimeout(t.flashTimer);
    t.flashTimer = setTimeout(() => { info.classList.remove('is-flash'); updateSelInfo(t); }, 1600);
  }

  function copySelection(t, withHeaders) {
    const payload = buildCopy(t, withHeaders);
    if (!payload) return;
    copyPayload = payload;
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    copyPayload = null;
    if (ok) { flash(t, `Copied ${payload.cells} cell${payload.cells === 1 ? '' : 's'} ✓`); return; }
    if (navigator.clipboard && global.ClipboardItem) {
      navigator.clipboard.write([new global.ClipboardItem({
        'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        'text/html': new Blob([payload.html], { type: 'text/html' }),
      })]).then(() => flash(t, `Copied ${payload.cells} cells ✓`), () => flash(t, 'Copy blocked by the browser'));
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(payload.text).then(() => flash(t, `Copied ${payload.cells} cells ✓`), () => flash(t, 'Copy blocked by the browser'));
    }
  }

  document.addEventListener('copy', (e) => {
    if (!copyPayload || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', copyPayload.text);
    e.clipboardData.setData('text/html', copyPayload.html);
    e.preventDefault();
  });

  document.addEventListener('keydown', (e) => {
    if (!active || !active.sel || !active.el.isConnected || !active.el.getClientRects().length) return;
    if (e.key === 'Escape') { clearSelection(active); return; }
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'c' && e.key !== 'C')) return;
    const el = document.activeElement;
    if (el && el.matches && el.matches('input, textarea')) {
      const inCell = !!el.closest('tbody') && active.el.contains(el);
      const hasText = typeof el.selectionStart === 'number' && el.selectionStart !== el.selectionEnd;
      if (!inCell || hasText) return;
    }
    const sel = global.getSelection && global.getSelection();
    if (sel && String(sel).trim() && !active.el.contains(sel.anchorNode)) return;
    e.preventDefault();
    copySelection(active, e.shiftKey);
  });

  document.addEventListener('mouseup', endDrag);
  document.addEventListener('mousedown', (e) => {
    if (!active || active.el.contains(e.target) || (active.bar && active.bar.contains(e.target))) return;
    if (e.target.closest && e.target.closest('.drawer, .modal-back, .guest-modal')) return;
    clearSelection(active);
  });

  // ---------- Attach ----------

  function refresh(t) {
    if (!headerRow(t)) return;
    let restore = null;
    const focused = document.activeElement;
    if (focused && focused.classList && focused.classList.contains('st-filter')) {
      restore = { col: focused.dataset.col, start: focused.selectionStart, end: focused.selectionEnd };
    }
    t.filters = loadFilters(t);
    t.sel = null;
    buildFilterRow(t);
    applyFilters(t);
    if (restore) {
      const input = [...t.el.querySelectorAll('input.st-filter')].find((i) => i.dataset.col === restore.col);
      if (input) { input.focus(); try { input.setSelectionRange(restore.start, restore.end); } catch { /* search inputs */ } }
    }
  }

  function attach(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el || !el.id || tables.has(el.id)) return;
    const t = { id: el.id, el, filters: {}, sel: null, bar: null, dragging: false };
    tables.set(el.id, t);

    let timer = null;
    el.addEventListener('input', (e) => {
      const input = e.target.closest('input.st-filter');
      if (!input) return;
      t.filters[input.dataset.col] = input.value;
      saveFilters(t);
      clearTimeout(timer);
      timer = setTimeout(() => applyFilters(t), 120);
    });
    el.addEventListener('mousedown', (e) => onMouseDown(t, e));
    el.addEventListener('mouseover', (e) => onMouseOver(t, e));
    el.addEventListener('change', (e) => { if (e.target.closest('tbody')) setTimeout(() => applyFilters(t), 0); });

    new MutationObserver(() => refresh(t)).observe(el, { childList: true });
    refresh(t);
  }

  global.SheetTools = { attach };

  ['#live-table', '#my-table', '#today-table'].forEach(attach);
})(window);
