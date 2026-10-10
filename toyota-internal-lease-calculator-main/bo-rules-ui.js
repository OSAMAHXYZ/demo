(function () {
    const root = document.getElementById('boe-rules-root');
    if (!root) return;
    const passKey = 'reserved-orders-admin-pass';
    let pack = { file: {}, products: [], rules: [], history: [], whatsapp: [] };
    let detail = null;
    let editing = null;
    let q = '';
    let notice = '';
    const OPS = [
        ['equals', 'Equals'],
        ['not_equals', 'Does not equal'],
        ['contains', 'Contains'],
        ['not_contains', 'Does not contain'],
        ['empty', 'Is blank'],
        ['not_empty', 'Is not blank'],
        ['in_list', 'In list'],
        ['not_in_list', 'Not in list']
    ];
    const needsValue = (op) => !['empty', 'not_empty'].includes(op);
    const password = () => sessionStorage.getItem(passKey) || '';
    const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    async function api(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error('unauthorized');
        if (res.status === 409) { const err = new Error(data.error || 'Confirm'); err.needsConfirm = true; throw err; }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    function stamp(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }
    async function load(keepId) {
        try {
            pack = await api('/api/reserved-orders/bo-rules?password=' + encodeURIComponent(password()));
            if (keepId) detail = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(keepId) + '?password=' + encodeURIComponent(password()));
            else if (detail && detail.rule) detail = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(detail.rule.id) + '?password=' + encodeURIComponent(password()));
            render();
        } catch (error) {
            render();
            const box = document.getElementById('br-error');
            if (box) box.textContent = error.message === 'unauthorized' ? 'Sign in again to manage BO error rules.' : error.message;
        }
    }
    function checkedValues(boxId) {
        return [...document.querySelectorAll('#' + boxId + ' input:checked')].filter((input) => !input.hasAttribute('data-all-cars')).map((input) => input.value).filter(Boolean);
    }
    function formRule() {
        const products = checkedValues('br-products');
        const columns = checkedValues('br-columns');
        return {
            id: editing && editing.id,
            name: document.getElementById('br-name').value.trim(),
            products,
            product: products.join(', '),
            columns,
            column: columns.join(', '),
            operator: document.getElementById('br-op').value,
            incorrectValues: document.getElementById('br-bad').value,
            correctValue: document.getElementById('br-good').value.trim(),
            message: document.getElementById('br-message').value.trim(),
            whatsappMessage: document.getElementById('br-wa').value.trim(),
            active: document.getElementById('br-active').checked
        };
    }
    function summaryCards() {
        const rules = pack.rules.filter((rule) => !rule.archived);
        const employees = rules.reduce((sum, rule) => sum + (rule.affectedEmployees || 0), 0);
        const orders = rules.reduce((sum, rule) => sum + (rule.affectedOrders || 0), 0);
        const pending = rules.filter((rule) => rule.notificationStatus !== 'pushed' && rule.affectedEmployees).length;
        return `<div class="br-kpis">
            <article><span>Active rules</span><strong>${rules.filter((rule) => rule.active).length}</strong></article>
            <article><span>Affected employees</span><strong>${employees}</strong></article>
            <article><span>Affected orders</span><strong>${orders}</strong></article>
            <article><span>Pending notifications</span><strong>${pending}</strong></article>
        </div>`;
    }
    function ruleRows() {
        const rows = pack.rules.filter((rule) => !q || JSON.stringify(rule).toLowerCase().includes(q));
        if (!rows.length) return '<p class="muted">No rules yet. Save one from the form.</p>';
        return `<table class="br-table"><thead><tr><th>Rule</th><th>Product</th><th>BO column</th><th>Incorrect</th><th>Correct</th><th>Employees</th><th>Orders</th><th>Status</th><th></th></tr></thead><tbody>
            ${rows.map((rule) => `<tr>
                <td><b>${esc(rule.name)}</b>${rule.columnMissing ? '<div class="br-flag">Column missing in latest file</div>' : ''}</td>
                <td>${esc(rule.product || 'All cars')}</td>
                <td>${esc(rule.column)}</td>
                <td>${esc((rule.incorrectValues || []).join(', ') || 'blank')}</td>
                <td>${esc(rule.correctValue || '—')}</td>
                <td>${rule.affectedEmployees || 0}</td>
                <td>${rule.affectedOrders || 0}</td>
                <td>${rule.archived ? 'Archived' : (rule.active ? 'Active' : 'Inactive')}<br>${esc(rule.notificationStatus || 'not_pushed')}</td>
                <td class="br-actions">
                    <button type="button" data-open="${esc(rule.id)}">View</button>
                    <button type="button" data-edit="${esc(rule.id)}">Edit</button>
                    <button type="button" data-run="${esc(rule.id)}">Re-analyze</button>
                    <button type="button" data-push="${esc(rule.id)}">Push to Message Builder</button>
                    <button type="button" data-archive="${esc(rule.id)}">${rule.archived ? 'Restore' : 'Archive'}</button>
                </td>
            </tr>`).join('')}
        </tbody></table>`;
    }
    function detailHtml() {
        if (!detail || !detail.rule) return '';
        const rule = detail.rule;
        const employees = (rule.current && rule.current.employees) || [];
        return `<section class="panel br-detail">
            <h2>${esc(rule.name)}</h2>
            <div class="br-kpis">
                <article><span>Employees</span><strong>${rule.affectedEmployees || 0}</strong></article>
                <article><span>Orders</span><strong>${rule.affectedOrders || 0}</strong></article>
                <article><span>Car</span><strong>${esc(rule.product || 'All')}</strong></article>
                <article><span>Incorrect</span><strong>${esc((rule.incorrectValues || []).join(', ') || 'blank')}</strong></article>
                <article><span>Correct</span><strong>${esc(rule.correctValue || '—')}</strong></article>
                <article><span>Analyzed</span><strong>${esc(stamp(rule.lastAnalysisAt))}</strong></article>
            </div>
            ${rule.columnMissing ? `<p class="err">Some selected columns are not in the latest BO file${(rule.missingColumns || []).length ? ': ' + esc(rule.missingColumns.join(', ')) : ''}. The rule is kept, and the columns that are still there are checked.</p>` : ''}
            <p>The latest BO file has <b>${rule.affectedEmployees || 0}</b> employees and <b>${rule.affectedOrders || 0}</b> matching orders. Push sends each employee only their own count in Message Builder.</p>
            <table class="br-table"><thead><tr><th>Employee</th><th>Employee ID</th><th>Found in BO file</th><th>Message Builder</th><th></th></tr></thead><tbody>
                ${employees.map((item) => `<tr>
                    <td>${esc(item.salesmanName)}</td>
                    <td>${esc(item.salesmanId)}</td>
                    <td>${item.orders.length}</td>
                    <td>${messageState(item)}</td>
                    <td><button type="button" data-orders="${esc(item.salesmanId)}" data-name="${esc(item.salesmanName)}">View orders</button> <button type="button" data-wa="${esc(item.salesmanId)}" data-name="${esc(item.salesmanName)}">WhatsApp</button></td>
                </tr>`).join('') || '<tr><td colspan="5">No matching orders in the latest file.</td></tr>'}
            </tbody></table>
            <div id="br-orders"></div>
            <div class="br-wa">
                <h3>WhatsApp</h3>
                <p>Opening WhatsApp does not mean the message was sent. Mark it sent only after you press Send in WhatsApp.</p>
                <textarea id="br-wa-preview" rows="4">${esc(rule.whatsappMessage || rule.message)}</textarea>
                <div id="br-wa-result"></div>
            </div>
            <h3>History</h3>
            <ul class="br-history">${(detail.history || []).map((item) => `<li>${esc(stamp(item.analyzedAt))} · ${item.employeeCount} employees · ${item.orderCount} orders · ${esc(item.fileName || 'BO file')}</li>`).join('') || '<li>No saved analyses yet.</li>'}</ul>
        </section>`;
    }
    function render() {
        const file = pack.file || {};
        const selected = editing || {};
        const op = selected.operator || 'equals';
        root.innerHTML = `<div class="br-page">
            <section class="panel br-file">
                <div><b>BO file</b><span>${esc(file.fileName || 'No Back Order file yet')}</span></div>
                <div><b>First worksheet</b><span>${esc(file.sheetName || '—')}</span></div>
                <div><b>Rows</b><span>${file.rowCount || 0}</span></div>
                <div><b>Updated</b><span>${esc(stamp(file.updatedAt))}</span></div>
            </section>
            ${summaryCards()}
            <section class="panel">
                <div class="br-head"><h2>Error rules</h2><input id="br-search" placeholder="Search rules" value="${esc(q)}"></div>
                ${ruleRows()}
            </section>
            <section class="panel">
                <h2>${editing && editing.id ? 'Edit rule' : 'New error rule'}</h2>
                <div class="br-form">
                    <label>Rule name<input id="br-name" value="${esc(selected.name || '')}"></label>
                    <div class="wide">
                        <span>Cars / products</span>
                        <input id="br-product-search" class="br-pick-search" placeholder="Search cars in the BO file">
                        <div class="br-picks" id="br-products">
                            <label><input type="checkbox" data-all-cars ${picked(selected, 'products', 'product').length ? '' : 'checked'}> All cars</label>
                            ${(pack.products || []).map((name) => `<label><input type="checkbox" value="${esc(name)}" ${picked(selected, 'products', 'product').includes(name) ? 'checked' : ''}> ${esc(name)}</label>`).join('') || '<p>No products in the BO file yet.</p>'}
                        </div>
                    </div>
                    <div class="wide">
                        <span>BO columns to check</span>
                        <input id="br-column-search" class="br-pick-search" placeholder="Search columns in the BO file">
                        <div class="br-picks" id="br-columns">
                            ${(file.headers || []).map((name) => `<label><input type="checkbox" value="${esc(name)}" ${picked(selected, 'columns', 'column').includes(name) ? 'checked' : ''}> ${esc(name)}</label>`).join('') || '<p>No columns in the BO file yet.</p>'}
                        </div>
                    </div>
                    <label>Condition<select id="br-op">${OPS.map(([id, label]) => `<option value="${id}"${op === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
                    <label id="br-bad-wrap">Incorrect value<input id="br-bad" value="${esc((selected.incorrectValues || []).join(', '))}" placeholder="2025 or Not_Confirmed. Separate several values with commas."></label>
                    <label>Correct value<input id="br-good" value="${esc(selected.correctValue || '')}" placeholder="The value employees should use"></label>
                    <label class="wide">Employee message<textarea id="br-message" rows="3">${esc(selected.message || 'Hello {employeeName}, the BO file shows {affectedOrderCount} {product} orders where {columnName} is {incorrectValue}. Please change it to {correctValue}.')}</textarea></label>
                    <p class="wide" id="br-preview"></p>
                    <label class="wide">WhatsApp message<textarea id="br-wa" rows="3">${esc(selected.whatsappMessage || '')}</textarea></label>
                    <label class="check"><input id="br-active" type="checkbox" ${selected.active === false ? '' : 'checked'}> Active</label>
                </div>
                <div class="br-buttons">
                    <button class="solid" id="br-save" type="button">Save rule</button>
                    <button id="br-run" type="button">Analyze BO file</button>
                    <button class="solid" id="br-save-run" type="button">Save and analyze</button>
                    <button id="br-cancel" type="button">Cancel</button>
                </div>
                <div class="err" id="br-error"></div>
                <p id="br-note"></p>
            </section>
            ${detailHtml()}
            <section class="panel">
                <h2>Alert history</h2>
                <ul class="br-history">${(pack.history || []).slice(0, 12).map((item) => `<li>${esc(stamp(item.analyzedAt))} · ${esc(item.reason)} · ${item.employeeCount} employees · ${item.orderCount} orders</li>`).join('') || '<li>Analyses appear here and stay after the next BO upload.</li>'}</ul>
            </section>
        </div>`;
        const bad = document.getElementById('br-bad-wrap');
        if (bad) bad.hidden = !needsValue(document.getElementById('br-op').value);
        const note = document.getElementById('br-note');
        if (note) note.textContent = notice;
        paintPreview();
        bind();
    }
    function picked(rule, plural, single) {
        if (Array.isArray(rule[plural]) && rule[plural].length) return rule[plural];
        return String(rule[single] || '').split(',').map((item) => item.trim()).filter(Boolean);
    }
    function filterPicks(boxId, query) {
        const needle = query.trim().toLowerCase();
        document.querySelectorAll('#' + boxId + ' label').forEach((label) => {
            if (label.querySelector('[data-all-cars]')) return;
            label.hidden = needle && !label.textContent.toLowerCase().includes(needle);
        });
    }
    function messageState(item) {
        if (item.salesmanId === 'UNASSIGNED') return 'No employee id';
        const row = ((detail && detail.delivery) || []).find((person) => person.salesmanId === item.salesmanId && person.salesmanName === item.salesmanName);
        if (row && row.sentAt) return 'Sent · ' + stamp(row.sentAt);
        if (row && row.status === 'waiting') return 'Waiting in Message Builder';
        return 'Not pushed';
    }
    function paintPreview() {
        const box = document.getElementById('br-preview');
        const field = document.getElementById('br-message');
        if (!box || !field) return;
        const people = (detail && detail.rule && detail.rule.current && detail.rule.current.employees) || [];
        const sample = people.find((item) => item.salesmanId !== 'UNASSIGNED');
        if (!sample) {
            box.textContent = 'Analyze the BO file to see how many orders each employee has. {employeeName} and {affectedOrderCount} are filled separately for each person.';
            return;
        }
        const rule = formRule();
        const text = field.value
            .replaceAll('{employeeName}', sample.salesmanName)
            .replaceAll('{product}', rule.product || 'all cars')
            .replaceAll('{columnName}', rule.column || '')
            .replaceAll('{incorrectValue}', rule.incorrectValues || 'blank')
            .replaceAll('{correctValue}', rule.correctValue || '—')
            .replaceAll('{affectedOrderCount}', String(sample.orders.length));
        box.textContent = `BO file example for ${sample.salesmanName}: ${sample.orders.length} found. ${text}`;
    }
    function bind() {
        document.getElementById('br-op').addEventListener('change', () => { document.getElementById('br-bad-wrap').hidden = !needsValue(document.getElementById('br-op').value); });
        document.getElementById('br-product-search').addEventListener('input', (event) => filterPicks('br-products', event.target.value));
        document.getElementById('br-column-search').addEventListener('input', (event) => filterPicks('br-columns', event.target.value));
        document.getElementById('br-products').addEventListener('change', (event) => {
            const all = document.querySelector('#br-products [data-all-cars]');
            if (event.target === all && all.checked) document.querySelectorAll('#br-products input[value]').forEach((input) => { input.checked = false; });
            if (event.target !== all && event.target.checked && all) all.checked = false;
            if (![...document.querySelectorAll('#br-products input[value]')].some((input) => input.checked) && all) all.checked = true;
            paintPreview();
        });
        document.getElementById('br-columns').addEventListener('change', paintPreview);
        document.getElementById('br-search').addEventListener('input', (event) => { q = event.target.value.trim().toLowerCase(); render(); });
        document.getElementById('br-cancel').addEventListener('click', () => { editing = null; render(); });
        document.getElementById('br-message').addEventListener('input', paintPreview);
        document.getElementById('br-save').addEventListener('click', () => save(false));
        document.getElementById('br-run').addEventListener('click', () => {
            if (editing && editing.id) run(editing.id);
            else save(true);
        });
        document.getElementById('br-save-run').addEventListener('click', () => save(true));
        root.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openRule(button.dataset.open)));
        root.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => { const rule = pack.rules.find((item) => item.id === button.dataset.edit); editing = rule || null; render(); }));
        root.querySelectorAll('[data-run]').forEach((button) => button.addEventListener('click', () => run(button.dataset.run)));
        root.querySelectorAll('[data-push]').forEach((button) => button.addEventListener('click', () => push(button.dataset.push, false)));
        root.querySelectorAll('[data-archive]').forEach((button) => button.addEventListener('click', () => archive(button.dataset.archive)));
        root.querySelectorAll('[data-orders]').forEach((button) => button.addEventListener('click', () => showOrders(button.dataset.orders, button.dataset.name)));
        root.querySelectorAll('[data-wa]').forEach((button) => button.addEventListener('click', () => sendWhatsApp(button.dataset.wa, button.dataset.name, 'prepared')));
    }
    async function save(analyze) {
        const error = document.getElementById('br-error');
        error.textContent = '';
        try {
            const data = await api('/api/reserved-orders/bo-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), rule: formRule(), analyze }) });
            editing = null;
            if (data.warning) error.textContent = data.warning;
            await load(data.rule && data.rule.id);
        } catch (e) { if (e.message !== 'unauthorized') error.textContent = e.message; }
    }
    async function openRule(id) {
        detail = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(id) + '?password=' + encodeURIComponent(password()));
        render();
    }
    async function run(id) {
        await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(id) + '/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password() }) });
        await load(id);
    }
    async function push(id, confirmRepublish) {
        const rule = pack.rules.find((item) => item.id === id) || (detail && detail.rule);
        const ok = window.confirm(`Push "${rule ? rule.name : 'this rule'}" to Message Builder for ${rule ? rule.affectedEmployees : 0} employees (${rule ? rule.affectedOrders : 0} orders in the BO file)?`);
        if (!ok) return;
        try {
            await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(id) + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), confirmRepublish }) });
            notice = 'Pushed to Message Builder. Each employee sees only their own message and count.';
            await load(id);
        } catch (e) {
            if (e.needsConfirm && window.confirm(e.message)) return push(id, true);
            if (e.message !== 'unauthorized') window.alert(e.message);
        }
    }
    async function archive(id) {
        const rule = pack.rules.find((item) => item.id === id);
        await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(id) + '/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), restore: !!(rule && rule.archived) }) });
        await load(id);
    }
    function showOrders(salesmanId, salesmanName) {
        const box = document.getElementById('br-orders');
        const employee = ((detail.rule.current && detail.rule.current.employees) || []).find((item) => item.salesmanId === salesmanId && item.salesmanName === salesmanName);
        if (!box || !employee) return;
        box.innerHTML = `<h3>${esc(employee.salesmanName)} · ${esc(employee.salesmanId)}</h3><table class="br-table"><thead><tr><th>Back Order Number</th><th>Product</th><th>Model Year</th><th>Order Date</th><th>Current value</th><th>Correct value</th></tr></thead><tbody>
            ${employee.orders.map((order) => `<tr><td>${esc(order.boNumber)}</td><td>${esc(order.product)}</td><td>${esc(order.modelYear)}</td><td>${esc(order.orderDate)}</td><td>${esc(order.currentValue)}</td><td>${esc(order.correctValue)}</td></tr>`).join('')}
        </tbody></table>`;
    }
    async function sendWhatsApp(salesmanId, salesmanName, action) {
        const preview = document.getElementById('br-wa-preview');
        const data = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(detail.rule.id) + '/whatsapp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password(), salesmanId, salesmanName, action, message: preview ? preview.value : '' })
        });
        const result = document.getElementById('br-wa-result');
        if (preview) preview.value = data.message;
        if (action === 'prepared') {
            result.innerHTML = `<p>Prepared. ${data.phone ? 'Phone ' + esc(data.phone) : 'No employee phone is stored, so WhatsApp opens without a number.'} This is not marked sent.</p><button type="button" id="br-wa-open">Open WhatsApp</button> <button type="button" id="br-wa-sent">Mark as sent</button>`;
            document.getElementById('br-wa-open').addEventListener('click', async () => {
                window.open(data.link, '_blank', 'noopener');
                await sendWhatsApp(salesmanId, salesmanName, 'opened');
            });
            document.getElementById('br-wa-sent').addEventListener('click', () => sendWhatsApp(salesmanId, salesmanName, 'marked_sent'));
        } else if (result && action === 'marked_sent') {
            result.innerHTML = '<p>Marked as sent by the manager. Delivery is not confirmed by WhatsApp.</p>';
        }
    }
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-panel="alerts"]');
        if (button && password()) load(detail && detail.rule && detail.rule.id).catch(() => {});
    });
    if (password() && document.getElementById('admin-app') && !document.getElementById('admin-app').classList.contains('hidden')) {
        load().catch(() => { root.innerHTML = '<p>Sign in to manage BO error rules.</p>'; });
    }
})();
