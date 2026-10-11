(function () {
    const root = document.getElementById('boe-rules-root');
    if (!root) return;
    const passKey = 'reserved-orders-admin-pass';
    let pack = { file: {}, products: [], rules: [], history: [], whatsapp: [] };
    let detail = null;
    let editing = null;
    let q = '';
    let notice = '';
    let messageTarget = 'br-message';
    const DEFAULT_MESSAGE = 'Hello {employeeName}, you have {affectedOrderCount} {product} back orders under your name where {columnName} is {incorrectValue}. Please change it to {correctValue}.{orderDateLine}';
    const PLACEHOLDERS = ['employeeName', 'affectedOrderCount', 'product', 'columnName', 'incorrectValue', 'correctValue', 'orderDate', 'deadline', 'orderDateLine'];
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
    function selectedCars() {
        const all = document.getElementById('br-all-cars');
        if (!all || all.checked) return [];
        return checkedValues('br-cars');
    }
    function deadlineChoice() {
        const days = Number(document.getElementById('br-deadline') && document.getElementById('br-deadline').value);
        return [0, 1, 2, 5].includes(days) ? days : 0;
    }
    function formRule() {
        const cars = selectedCars();
        const column = document.getElementById('br-column').value;
        const incorrectValues = document.getElementById('br-bad').value;
        const several = incorrectValues.split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean);
        const carLabel = cars.length ? cars.join(', ') : 'All cars';
        return {
            id: editing && editing.id,
            name: document.getElementById('br-name').value.trim() || `${carLabel} · ${column || 'column'}`,
            products: cars,
            product: cars.join(', '),
            columns: column ? [column] : [],
            column,
            operator: several.length > 1 ? 'in_list' : 'equals',
            incorrectValues,
            correctValue: document.getElementById('br-good').value.trim(),
            message: document.getElementById('br-message').value.trim(),
            whatsappMessage: document.getElementById('br-wa').value.trim(),
            deadlineDays: deadlineChoice(),
            active: document.getElementById('br-active').checked
        };
    }
    function fileAnalysis() {
        const people = pack.people || [];
        const file = pack.file || {};
        if (!file.rowCount) return '<section class="panel br-submit"><h2>Submitted BO file</h2><p class="muted">No Back Order file yet. Upload it on Data push, then open this tab again.</p></section>';
        return `<section class="panel br-submit">
            <h2>Submitted BO file</h2>
            <p class="muted">${esc(file.fileName || 'Back Order file')} · ${file.rowCount} rows · ${people.length} names. Upload a replacement on Data push, then return here.</p>
            <div class="br-scroll"><table class="br-table"><thead><tr><th>Employee</th><th>Employee ID</th><th>Rows under this name</th><th>Cars in the file</th></tr></thead><tbody>
                ${people.map((person) => `<tr><td>${esc(person.salesmanName)}</td><td>${esc(person.salesmanId)}</td><td>${person.orders}</td><td>${esc(person.cars || '—')}</td></tr>`).join('') || '<tr><td colspan="4">The file has rows, but no salesman name column was found.</td></tr>'}
            </tbody></table></div>
        </section>`;
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
        return `<div class="br-scroll br-rules-scroll"><table class="br-table"><thead><tr><th>Rule</th><th>Product</th><th>BO column</th><th>Incorrect</th><th>Correct</th><th>Employees</th><th>Orders</th><th>Status</th><th></th></tr></thead><tbody>
            ${rows.map((rule) => `<tr class="${rule.archived ? 'is-archived' : (rule.active ? 'is-active' : 'is-inactive')}">
                <td><b>${esc(rule.name)}</b>${rule.columnMissing ? '<div class="br-flag">Column missing in latest file</div>' : ''}</td>
                <td>${esc(rule.product || 'All cars')}</td>
                <td>${esc(rule.column)}</td>
                <td>${esc((rule.incorrectValues || []).join(', ') || 'blank')}</td>
                <td>${esc(rule.correctValue || '—')}</td>
                <td>${rule.affectedEmployees || 0}</td>
                <td>${rule.affectedOrders || 0}</td>
                <td><span class="br-pill ${rule.archived ? 'arch' : (rule.active ? 'on' : 'off')}">${rule.archived ? 'Archived' : (rule.active ? 'Active' : 'Inactive')}</span><div class="br-sub">${esc(rule.notificationStatus || 'not_pushed')}</div></td>
                <td class="br-actions">
                    <button type="button" data-open="${esc(rule.id)}">View</button>
                    <button type="button" data-edit="${esc(rule.id)}">Edit</button>
                    <button type="button" data-run="${esc(rule.id)}">Re-analyze</button>
                    <button type="button" data-push="${esc(rule.id)}">Push to Message Builder</button>
                    <button type="button" data-archive="${esc(rule.id)}">${rule.archived ? 'Restore' : 'Archive'}</button>
                </td>
            </tr>`).join('')}
        </tbody></table></div>`;
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
        root.innerHTML = `<div class="br-page">
            <section class="panel br-file">
                <div><b>BO file</b><span>${esc(file.fileName || 'No Back Order file yet')}</span></div>
                <div><b>First worksheet</b><span>${esc(file.sheetName || '—')}</span></div>
                <div><b>Rows</b><span>${file.rowCount || 0}</span></div>
                <div><b>Updated</b><span>${esc(stamp(file.updatedAt))}</span></div>
            </section>
            ${fileAnalysis()}
            ${summaryCards()}
            <div class="br-workspace">
            <section class="panel br-rules-panel">
                <div class="br-head"><h2>Error rules</h2><input id="br-search" placeholder="Search rules" value="${esc(q)}"></div>
                ${ruleRows()}
            </section>
            <section class="panel br-editor">
                <h2>${editing && editing.id ? 'Edit error rule' : 'Add error rule'}</h2>
                <p class="muted">Choose the car, the column that has the error, the wrong value or values, and the correction. Push sends the message only to employees who have that error under their name.</p>
                <div class="br-form">
                    <label><span>Rule name</span><input id="br-name" value="${esc(selected.name || '')}" placeholder="Optional"></label>
                    <div class="br-cars">
                        <span>Cars</span>
                        <label class="check"><input id="br-all-cars" type="checkbox" data-all-cars ${picked(selected, 'products', 'product').length ? '' : 'checked'}> All cars</label>
                        <div class="br-picks" id="br-cars">${(pack.products || []).map((name) => `<label><input type="checkbox" value="${esc(name)}"${picked(selected, 'products', 'product').includes(name) ? ' checked' : ''}>${esc(name)}</label>`).join('') || '<p class="muted">Upload a BO file to list the cars.</p>'}</div>
                    </div>
                    <label><span>Column with the error</span><select id="br-column"><option value="">Choose a column</option>${(file.headers || []).map((name) => `<option value="${esc(name)}"${picked(selected, 'columns', 'column')[0] === name ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
                    <label><span>Incorrect value or values</span><input id="br-bad" value="${esc((selected.incorrectValues || []).join(', '))}" placeholder="2027 or Not_Confirmed. Separate several with commas."></label>
                    <label><span>Correct value</span><input id="br-good" value="${esc(selected.correctValue || '')}" placeholder="The value employees should use"></label>
                    <label><span>Deadline from the BO date</span><select id="br-deadline">
                        <option value="0"${Number(selected.deadlineDays) === 0 ? ' selected' : ''}>Same as the BO date</option>
                        <option value="1"${Number(selected.deadlineDays) === 1 ? ' selected' : ''}>BO date + 1 day</option>
                        <option value="2"${Number(selected.deadlineDays) === 2 ? ' selected' : ''}>BO date + 2 days</option>
                        <option value="5"${Number(selected.deadlineDays) === 5 ? ' selected' : ''}>BO date + 5 days</option>
                    </select></label>
                    <label class="check"><input id="br-active" type="checkbox" ${selected.active === false ? '' : 'checked'}> Active</label>
                    <div class="br-msg wide">
                        <h3>Error notification</h3>
                        <label><span>Message template</span><textarea id="br-message" rows="4">${esc(selected.message || DEFAULT_MESSAGE)}</textarea></label>
                        <label><span>WhatsApp message</span><textarea id="br-wa" rows="3" placeholder="Optional. Leave blank to use the message template.">${esc(selected.whatsappMessage || '')}</textarea></label>
                        <label><span>Language</span><select id="br-lang"><option value="en">English</option><option value="ar">Arabic</option></select></label>
                        <p class="muted">Language only sets the preview direction. It is not saved on the rule.</p>
                        <div>
                            <span class="br-label">Available placeholders</span>
                            <div class="br-chips">${PLACEHOLDERS.map((key) => `<button type="button" data-token="{${key}}">{${key}}</button>`).join('')}</div>
                        </div>
                        <div>
                            <span class="br-label" id="br-preview-caption">Message template</span>
                            <div class="br-template" id="br-template"></div>
                        </div>
                        <div class="br-preview-box">
                            <div class="br-bubble" id="br-preview"></div>
                        </div>
                        <p class="muted">{orderDate} is the Order Date from the BO file. {deadline} is that date plus the days selected above. Analyze and Push fill each employee's real name, count, and dates.</p>
                    </div>
                </div>
                <div class="br-buttons">
                    <button class="solid" id="br-push" type="button">Push</button>
                    <button id="br-save-run" type="button">Analyze only</button>
                    <button id="br-show-preview" type="button">Preview message</button>
                    <button id="br-copy" type="button">Copy message template</button>
                    <button id="br-reset" type="button">Reset unsaved edits</button>
                    <button id="br-cancel" type="button">Cancel</button>
                </div>
                <div class="err" id="br-error"></div>
                <p id="br-note"></p>
            </section>
            </div>
            ${detailHtml()}
            <section class="panel">
                <h2>Alert history</h2>
                <ul class="br-history">${(pack.history || []).slice(0, 12).map((item) => `<li>${esc(stamp(item.analyzedAt))} · ${esc(item.reason)} · ${item.employeeCount} employees · ${item.orderCount} orders</li>`).join('') || '<li>Analyses appear here and stay after the next BO upload.</li>'}</ul>
            </section>
        </div>`;
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
    function fillTemplate(template, bag) {
        return String(template || '').replace(/\{(\w+)\}/g, (all, key) => (bag[key] == null ? all : String(bag[key])));
    }
    function previewDate(days) {
        const date = new Date(2026, 9, 1 + (Number(days) || 0));
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${date.getFullYear()}`;
    }
    function exampleBag() {
        const value = (id) => {
            const field = document.getElementById(id);
            return field ? field.value.trim() : '';
        };
        const cars = selectedCars();
        const days = deadlineChoice();
        const deadline = previewDate(days);
        return {
            employeeName: 'Ahmed Al Harbi',
            product: cars.join(', ') || 'Land Cruiser',
            columnName: value('br-column') || 'Model Year',
            incorrectValue: value('br-bad') || '2027',
            correctValue: value('br-good') || '2026',
            affectedOrderCount: '3',
            orderDate: '01.10.2026',
            deadline,
            orderDateLine: ` Deadline: ${deadline}.`
        };
    }
    function paintPreview() {
        const bubble = document.getElementById('br-preview');
        const templateBox = document.getElementById('br-template');
        const message = document.getElementById('br-message');
        const wa = document.getElementById('br-wa');
        const lang = document.getElementById('br-lang');
        const caption = document.getElementById('br-preview-caption');
        if (!bubble || !message) return;
        const usingWhatsApp = !!(wa && wa.value.trim());
        const source = usingWhatsApp ? wa.value : message.value;
        if (caption) caption.textContent = usingWhatsApp ? 'WhatsApp message template' : 'Message template';
        if (templateBox) templateBox.textContent = source;
        bubble.textContent = fillTemplate(source, exampleBag());
        const arabic = !!(lang && lang.value === 'ar');
        bubble.classList.toggle('ar', arabic);
        message.classList.toggle('ar', arabic);
        if (wa) wa.classList.toggle('ar', arabic);
    }
    function insertToken(token) {
        const field = document.getElementById(messageTarget) || document.getElementById('br-message');
        if (!field) return;
        const start = field.selectionStart == null ? field.value.length : field.selectionStart;
        const end = field.selectionEnd == null ? start : field.selectionEnd;
        field.value = field.value.slice(0, start) + token + field.value.slice(end);
        const caret = start + token.length;
        field.focus();
        field.setSelectionRange(caret, caret);
        paintPreview();
    }
    function bind() {
        ['br-column', 'br-bad', 'br-good', 'br-deadline'].forEach((id) => {
            const field = document.getElementById(id);
            if (field) field.addEventListener('input', paintPreview);
            if (field) field.addEventListener('change', paintPreview);
        });
        const allCars = document.getElementById('br-all-cars');
        const carBox = document.getElementById('br-cars');
        if (allCars && carBox) {
            allCars.addEventListener('change', () => {
                if (allCars.checked) carBox.querySelectorAll('input').forEach((input) => { input.checked = false; });
                paintPreview();
            });
            carBox.addEventListener('change', () => {
                const any = [...carBox.querySelectorAll('input')].some((input) => input.checked);
                allCars.checked = !any;
                paintPreview();
            });
        }
        document.getElementById('br-search').addEventListener('input', (event) => { q = event.target.value.trim().toLowerCase(); render(); });
        document.getElementById('br-cancel').addEventListener('click', () => { editing = null; render(); });
        ['br-message', 'br-wa'].forEach((id) => {
            const field = document.getElementById(id);
            if (!field) return;
            field.addEventListener('focus', () => { messageTarget = id; });
            field.addEventListener('input', paintPreview);
        });
        const lang = document.getElementById('br-lang');
        if (lang) lang.addEventListener('change', paintPreview);
        root.querySelectorAll('[data-token]').forEach((button) => button.addEventListener('click', () => insertToken(button.dataset.token)));
        document.getElementById('br-show-preview').addEventListener('click', () => {
            paintPreview();
            const box = root.querySelector('.br-preview-box');
            if (box) box.scrollIntoView({ block: 'nearest' });
        });
        document.getElementById('br-copy').addEventListener('click', async () => {
            const field = document.getElementById('br-message');
            const text = field ? field.value : '';
            const noteBox = document.getElementById('br-note');
            try {
                await navigator.clipboard.writeText(text);
                if (noteBox) noteBox.textContent = 'Message template copied.';
            } catch (e) {
                if (field) { field.focus(); field.select(); }
                if (noteBox) noteBox.textContent = 'Select the template and copy it manually.';
            }
        });
        document.getElementById('br-reset').addEventListener('click', () => { notice = ''; render(); });
        document.getElementById('br-push').addEventListener('click', () => pushDraft(false));
        document.getElementById('br-save-run').addEventListener('click', () => save(true));
        root.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openRule(button.dataset.open)));
        root.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => { const rule = pack.rules.find((item) => item.id === button.dataset.edit); editing = rule || null; render(); }));
        root.querySelectorAll('[data-run]').forEach((button) => button.addEventListener('click', () => run(button.dataset.run)));
        root.querySelectorAll('[data-push]').forEach((button) => button.addEventListener('click', () => push(button.dataset.push, false)));
        root.querySelectorAll('[data-archive]').forEach((button) => button.addEventListener('click', () => archive(button.dataset.archive)));
        root.querySelectorAll('[data-orders]').forEach((button) => button.addEventListener('click', () => showOrders(button.dataset.orders, button.dataset.name)));
        root.querySelectorAll('[data-wa]').forEach((button) => button.addEventListener('click', () => sendWhatsApp(button.dataset.wa, button.dataset.name, 'prepared')));
    }
    async function pushDraft(confirmRepublish) {
        const error = document.getElementById('br-error');
        error.textContent = '';
        try {
            const saved = await api('/api/reserved-orders/bo-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), rule: formRule(), analyze: true }) });
            const rule = saved.rule || {};
            if (!rule.affectedEmployees) {
                error.textContent = saved.warning || 'No employee in the BO file has this error under their name.';
                editing = null;
                await load(rule.id);
                return;
            }
            if (!confirmRepublish) {
                const ok = window.confirm(`Push to Message Builder for ${rule.affectedEmployees} employees (${rule.affectedOrders} orders under their names)?`);
                if (!ok) { await load(rule.id); return; }
            }
            await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(rule.id) + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), confirmRepublish }) });
            notice = 'Pushed. Each employee sees this in Message Builder only when the BO row is under their name.';
            editing = null;
            await load(rule.id);
        } catch (e) {
            if (e.needsConfirm && window.confirm(e.message)) return pushDraft(true);
            if (e.message !== 'unauthorized') error.textContent = e.message;
        }
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
