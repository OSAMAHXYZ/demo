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
    let previewKey = '';
    let lastTest = null;
    const DEFAULT_MESSAGE = 'Hello {employeeName},\n\nYou have {affectedOrderCount} {product} back orders under your name where {conditionText}.\n\nPlease update it to {correctValue} for the affected orders below:\n{orderDateLine}\n\nOnly the orders listed above match this condition.';
    const PLACEHOLDERS = ['employeeName', 'affectedOrderCount', 'product', 'columnName', 'incorrectValue', 'correctValue', 'conditionText', 'orderNumber', 'orderDate', 'deadline', 'orderDateLine', 'orderLines'];
    const OPS = [
        ['equals', 'Equals'],
        ['not_equals', 'Does not equal'],
        ['contains', 'Contains'],
        ['not_contains', 'Does not contain'],
        ['empty', 'Is empty'],
        ['not_empty', 'Is not empty'],
        ['gt', 'Greater than'],
        ['lt', 'Less than'],
        ['in_list', 'In list of values'],
        ['not_in_list', 'Not in list']
    ];
    const OP_TEXT = { equals: 'equals', not_equals: 'does not equal', contains: 'contains', not_contains: 'does not contain', empty: 'is empty', not_empty: 'is not empty', gt: 'is greater than', lt: 'is less than', in_list: 'is one of', not_in_list: 'is not one of' };
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
    function dateSource() {
        const field = document.getElementById('br-date-source');
        return field && field.value === 'fixed' ? 'fixed' : 'column';
    }
    function deadlineChoice() {
        const days = Number(document.getElementById('br-deadline') && document.getElementById('br-deadline').value);
        return [0, 1, 2, 5].includes(days) ? days : 0;
    }
    function initialMode(rule) {
        if (rule.matchMode === 'any' || rule.matchMode === 'all') return rule.matchMode;
        return !(rule.conditions && rule.conditions.length) && picked(rule, 'columns', 'column').length > 1 ? 'any' : 'all';
    }
    function savedConditions(rule) {
        if (Array.isArray(rule.conditions) && rule.conditions.length) return rule.conditions;
        const columns = picked(rule, 'columns', 'column');
        if (!columns.length) return [{ column: '', operator: 'equals', values: [] }];
        return columns.map((column) => ({ column, operator: rule.operator || 'equals', values: rule.incorrectValues || [] }));
    }
    function columnOptions(selectedName, blankLabel) {
        const headers = (pack.file && pack.file.headers) || [];
        const names = headers.includes(selectedName) || !selectedName ? headers : headers.concat(selectedName);
        return `<option value="">${esc(blankLabel || 'Choose a column')}</option>${names.map((name) => `<option value="${esc(name)}"${name === selectedName ? ' selected' : ''}>${esc(name)}</option>`).join('')}`;
    }
    function mapValue(rule, key) {
        return rule.fieldMap && rule.fieldMap[key] ? rule.fieldMap[key] : '';
    }
    function conditionRow(cond) {
        const op = cond.operator || 'equals';
        const hide = op === 'empty' || op === 'not_empty';
        const list = op === 'in_list' || op === 'not_in_list';
        return `<div class="br-cond">
            <select class="br-cond-col">${columnOptions(cond.column || '')}</select>
            <select class="br-cond-op">${OPS.map(([id, label]) => `<option value="${id}"${id === op ? ' selected' : ''}>${label}</option>`).join('')}</select>
            <input class="br-cond-val" value="${esc((cond.values || []).join(', '))}" placeholder="${list ? 'Comma-separated values' : 'Value'}"${hide ? ' hidden' : ''}>
            <button type="button" class="br-cond-remove">Remove</button>
        </div>`;
    }
    function readConditions() {
        return [...document.querySelectorAll('#br-conditions .br-cond')].map((row) => ({
            column: row.querySelector('.br-cond-col').value,
            operator: row.querySelector('.br-cond-op').value,
            values: row.querySelector('.br-cond-val').value
        })).filter((item) => item.column);
    }
    function describeConditions(list, mode) {
        const text = (list || []).map((item) => {
            const label = OP_TEXT[item.operator] || 'equals';
            if (item.operator === 'empty' || item.operator === 'not_empty') return `${item.column} ${label}`;
            const values = Array.isArray(item.values) ? item.values.join(', ') : String(item.values || '').trim();
            return `${item.column} ${label} ${values || 'blank'}`;
        });
        return text.join(mode === 'any' ? ' or ' : ' and ') || 'no condition is set';
    }
    function formRule() {
        const cars = selectedCars();
        const conditions = readConditions();
        const first = conditions[0] || { column: '', operator: 'equals', values: '' };
        const carLabel = cars.length ? cars.join(', ') : 'All cars';
        const modeField = document.getElementById('br-match');
        return {
            id: editing && editing.id,
            name: document.getElementById('br-name').value.trim() || `${carLabel} · ${first.column || 'column'}`,
            products: cars,
            product: cars.join(', '),
            columns: conditions.map((item) => item.column),
            column: first.column || '',
            operator: first.operator || 'equals',
            incorrectValues: first.values || '',
            conditions,
            matchMode: modeField && modeField.value === 'any' ? 'any' : 'all',
            correctValue: document.getElementById('br-good').value.trim(),
            message: document.getElementById('br-message').value.trim(),
            whatsappMessage: document.getElementById('br-wa').value.trim(),
            deadlineDays: deadlineChoice(),
            deadlineSource: dateSource(),
            deadlineColumn: dateSource() === 'column' ? (document.getElementById('br-date-column') ? document.getElementById('br-date-column').value : '') : '',
            deadlineDate: dateSource() === 'fixed' ? (document.getElementById('br-date-fixed') ? document.getElementById('br-date-fixed').value : '') : '',
            fieldMap: {
                orderNumber: document.getElementById('br-map-order') ? document.getElementById('br-map-order').value : '',
                orderDate: document.getElementById('br-map-date') ? document.getElementById('br-map-date').value : '',
                product: document.getElementById('br-map-product') ? document.getElementById('br-map-product').value : ''
            },
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
        const pendingOrders = rules.reduce((sum, rule) => sum + Math.max(0, (rule.affectedOrders || 0) - (rule.sentOrders || 0)), 0);
        const sent = rules.reduce((sum, rule) => sum + (rule.sentOrders || 0), 0);
        return `<div class="br-kpis">
            <article><span>Messages generated</span><strong>${employees}</strong></article>
            <article><span>Employees affected</span><strong>${employees}</strong></article>
            <article><span>Orders affected</span><strong>${orders}</strong></article>
            <article><span>Messages sent</span><strong>${sent}</strong></article>
            <article><span>Messages pending</span><strong>${pendingOrders}</strong></article>
        </div>`;
    }
    function ruleRows() {
        const rows = pack.rules.filter((rule) => !q || JSON.stringify(rule).toLowerCase().includes(q));
        if (!rows.length) return '<p class="muted">No rules yet. Create one on the right.</p>';
        const activeId = (editing && editing.id) || (detail && detail.rule && detail.rule.id) || '';
        return `<div class="br-rule-list">${rows.map((rule) => `<div class="br-rule-row ${rule.id === activeId ? 'is-selected' : ''} ${rule.archived ? 'is-archived' : ''}">
            <button type="button" class="br-rule" data-open="${esc(rule.id)}">
                <b>${esc(rule.name)}</b>
                <span>${esc(rule.product || 'All cars')} · ${esc(rule.column || 'No column')}</span>
                <span>${esc((rule.incorrectValues || []).join(', ') || 'blank')} → ${esc(rule.correctValue || '—')}</span>
                <span>${rule.affectedEmployees || 0} employees · ${rule.affectedOrders || 0} orders</span>
                ${sentLabel(rule)}
            </button>
            <button type="button" data-archive="${esc(rule.id)}">${rule.archived ? 'Restore' : 'Archive'}</button>
        </div>`).join('')}</div>`;
    }
    function employeeKey(item) {
        return item ? `${item.salesmanId}\u0001${item.salesmanName}` : '';
    }
    function currentEmployee() {
        const employees = (detail && detail.rule && detail.rule.current && detail.rule.current.employees) || [];
        return employees.find((item) => employeeKey(item) === previewKey) || employees[0] || null;
    }
    function reviewHtml() {
        const employees = (detail && detail.rule && detail.rule.current && detail.rule.current.employees) || [];
        if (!employees.length) {
            const tested = detail && detail.rule && detail.rule.lastAnalysisAt;
            return `<section class="br-review"><h3>Review before sending</h3><p class="${tested ? 'err' : 'muted'}">${tested ? 'No rows match these conditions. Send stays off until a test finds at least one order.' : 'Generate messages or test the conditions against the current Back Order file.'}</p></section>`;
        }
        const chosen = currentEmployee();
        if (chosen) previewKey = employeeKey(chosen);
        return `<section class="br-review">
            <h3>Review before sending</h3>
            <p class="muted">${employees.length} employees · ${employees.reduce((sum, item) => sum + item.orders.length, 0)} orders from the current BO file. Opening WhatsApp does not mark a message sent.</p>
            ${detail.rule.columnMissing ? `<p class="err">Some selected columns are not in the latest BO file${(detail.rule.missingColumns || []).length ? ': ' + esc(detail.rule.missingColumns.join(', ')) : ''}.</p>` : ''}
            <label><span>Employee</span><select id="br-employee">${employees.map((item) => `<option value="${esc(employeeKey(item))}"${employeeKey(item) === previewKey ? ' selected' : ''}>${esc(item.salesmanName)} · ${esc(item.salesmanId)} · ${item.orders.length} order${item.orders.length === 1 ? '' : 's'}</option>`).join('')}</select></label>
            <p id="br-person-status"></p>
            <div class="br-preview-box is-live"><div class="br-bubble" id="br-live"></div></div>
            <div class="br-buttons">
                <button type="button" id="br-copy-live">Copy this message</button>
                <button type="button" id="br-wa-person">Prepare WhatsApp</button>
            </div>
            <div id="br-wa-result"></div>
            <div id="br-orders"></div>
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
            <p class="muted br-file-note">Upload the Back Order file on Data push. This page reads that file. It does not use the upload time as an order date.</p>
            ${summaryCards()}
            <div class="br-workspace">
            <section class="panel br-rules-panel">
                <div class="br-head"><h2>Message rules</h2><button type="button" id="br-new">New</button></div>
                <input id="br-search" placeholder="Search rules" value="${esc(q)}">
                ${ruleRows()}
            </section>
            <section class="panel br-editor">
                <h2>${editing && editing.id ? 'Message builder' : 'New message rule'}</h2>
                <p class="muted">Generate reads the current BO file. Send uses the existing push, and each employee only receives their own orders.</p>
                <div class="br-form">
                    <label><span>Rule name</span><input id="br-name" value="${esc(selected.name || '')}" placeholder="Optional"></label>
                    <div class="br-cars">
                        <span>Cars</span>
                        <label class="check"><input id="br-all-cars" type="checkbox" data-all-cars ${picked(selected, 'products', 'product').length ? '' : 'checked'}> All cars</label>
                        <div class="br-picks" id="br-cars">${(pack.products || []).map((name) => `<label><input type="checkbox" value="${esc(name)}"${picked(selected, 'products', 'product').includes(name) ? ' checked' : ''}>${esc(name)}</label>`).join('') || '<p class="muted">Upload a BO file to list the cars.</p>'}</div>
                    </div>
                    <label class="wide"><span>Match</span><select id="br-match"><option value="all"${initialMode(selected) === 'all' ? ' selected' : ''}>Match ALL conditions</option><option value="any"${initialMode(selected) === 'any' ? ' selected' : ''}>Match ANY condition</option></select></label>
                    <div class="br-conditions wide" id="br-conditions">${savedConditions(selected).map(conditionRow).join('')}</div>
                    <div class="wide"><button type="button" id="br-add-cond">Add condition</button> <button type="button" id="br-test">Test conditions</button></div>
                    <div class="br-apply wide" id="br-apply"></div>
                    <div class="br-test-out wide" id="br-test-out"></div>
                    <label><span>Correction value</span><input id="br-good" value="${esc(selected.correctValue || '')}" placeholder="The value employees should use"></label>
                    <label><span>Deadline date</span><select id="br-date-source">
                        <option value="column"${selected.deadlineSource === 'fixed' ? '' : ' selected'}>From a column in the BO file</option>
                        <option value="fixed"${selected.deadlineSource === 'fixed' ? ' selected' : ''}>A specific date</option>
                    </select></label>
                    <label id="br-date-column-wrap"${selected.deadlineSource === 'fixed' ? ' hidden' : ''}><span>BO date column</span><select id="br-date-column"><option value="">Order Date</option>${(file.headers || []).map((name) => `<option value="${esc(name)}"${selected.deadlineColumn === name ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
                    <label id="br-date-fixed-wrap"${selected.deadlineSource === 'fixed' ? '' : ' hidden'}><span>Specific date</span><input id="br-date-fixed" type="date" value="${esc(selected.deadlineDate || '')}"></label>
                    <label><span>Days to add</span><select id="br-deadline">
                        <option value="0"${Number(selected.deadlineDays) === 0 ? ' selected' : ''}>Same day</option>
                        <option value="1"${Number(selected.deadlineDays) === 1 ? ' selected' : ''}>+ 1 day</option>
                        <option value="2"${Number(selected.deadlineDays) === 2 ? ' selected' : ''}>+ 2 days</option>
                        <option value="5"${Number(selected.deadlineDays) === 5 ? ' selected' : ''}>+ 5 days</option>
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
                        <div class="br-maps">
                            <label><span>Order number column</span><select id="br-map-order">${columnOptions(mapValue(selected, 'orderNumber'), 'Usual order column')}</select></label>
                            <label><span>Order date column</span><select id="br-map-date">${columnOptions(mapValue(selected, 'orderDate'), 'Usual date column')}</select></label>
                            <label><span>Product column</span><select id="br-map-product">${columnOptions(mapValue(selected, 'product'), 'Usual product column')}</select></label>
                        </div>
                        <p class="muted">Incorrect value uses the error column. Correction uses the correction value. Employee name uses the salesman on the row. Deadline uses the deadline settings. Each order number stays with the date from that same row.</p>
                        <div>
                            <span class="br-label" id="br-preview-caption">Message template</span>
                            <div class="br-template" id="br-template"></div>
                        </div>
                        <div class="br-preview-box is-example">
                            <div class="br-bubble" id="br-preview"></div>
                        </div>
                        <p class="muted">The example above is not a real employee. Generate messages to fill names, order numbers, and dates from the BO file. A missing date stays labeled instead of being invented.</p>
                    </div>
                </div>
                ${reviewHtml()}
                <div class="br-buttons">
                    <button class="solid" id="br-push" type="button"${(lastTest && lastTest.orderCount === 0) || (!lastTest && detail && detail.rule && detail.rule.lastAnalysisAt && !detail.rule.affectedOrders) ? ' disabled' : ''}>Send to employees</button>
                    <button id="br-save-run" type="button">Generate messages</button>
                    <button id="br-copy" type="button">Copy template</button>
                    <button id="br-reset" type="button">Reset unsaved edits</button>
                </div>
                <div class="err" id="br-error"></div>
                <p id="br-note"></p>
            </section>
            </div>
        </div>`;
        const note = document.getElementById('br-note');
        if (note) note.textContent = notice;
        paintPreview();
        if (lastTest) paintTest(lastTest);
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
    function sentLabel(rule) {
        const total = rule.affectedOrders || 0;
        const sent = rule.sentOrders || 0;
        if (rule.notificationStatus !== 'pushed') return '<span class="br-pill off">Not pushed</span>';
        if (!total) return '<span class="br-pill off">No orders</span>';
        if (sent >= total) return `<span class="br-pill sent">Sent</span><div class="br-sub">${sent} of ${total}</div>`;
        if (sent > 0) return `<span class="br-pill part">${sent} of ${total} sent</span>`;
        return `<span class="br-pill wait">Not sent</span><div class="br-sub">0 of ${total}</div>`;
    }
    function messageState(item) {
        if (item.salesmanId === 'UNASSIGNED') return '<span class="br-pill off">No employee id</span>';
        const row = ((detail && detail.delivery) || []).find((person) => person.salesmanId === item.salesmanId && person.salesmanName === item.salesmanName);
        if (!row || row.status === 'not_pushed') return '<span class="br-pill off">Not pushed</span>';
        if (row.status === 'sent') return `<span class="br-pill sent">Sent</span><div class="br-sub">${esc(stamp(row.sentAt))}</div>`;
        if (row.status === 'partial') return `<span class="br-pill part">Sent ${row.sentOrders} of ${row.orderCount}</span><div class="br-sub">${esc(stamp(row.sentAt))}</div>`;
        return `<span class="br-pill wait">Not sent</span><div class="br-sub">${row.orderCount || 0} order${row.orderCount === 1 ? '' : 's'}</div>`;
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
    function previewFromIso(value, days) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return previewDate(days);
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (Number(days) || 0));
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${date.getFullYear()}`;
    }
    function parseClientDate(value) {
        const text = String(value || '').trim();
        const local = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
        if (local) return new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]));
        const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return null;
    }
    function formatClientDate(date) {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${date.getFullYear()}`;
    }
    function shiftClient(value, days) {
        const date = parseClientDate(value);
        if (!date || Number.isNaN(date.getTime())) return String(value || '').trim();
        const shown = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (Number(days) || 0));
        return formatClientDate(shown);
    }
    function realBag(rule, person, orders) {
        const days = [0, 1, 2, 5].includes(Number(rule.deadlineDays)) ? Number(rule.deadlineDays) : 0;
        const deadlines = [];
        if (rule.deadlineSource === 'fixed') {
            const value = shiftClient(rule.deadlineDate, days);
            if (value) deadlines.push(value);
        } else {
            (orders || []).forEach((order) => {
                const raw = String(order.deadlineRaw || '').trim();
                if (!raw || !parseClientDate(raw)) return;
                const value = shiftClient(raw, days);
                if (value && !deadlines.includes(value)) deadlines.push(value);
            });
        }
        const mode = rule.matchMode === 'any' ? 'any' : 'all';
        const described = describeConditions((rule.conditions && rule.conditions.length ? rule.conditions : [{ column: rule.column, operator: rule.operator || 'equals', values: rule.incorrectValues }]).filter((item) => item.column), mode);
        const column = rule.column || 'Value';
        const correct = rule.correctValue || '—';
        const lines = (orders || []).map((order) => {
            const number = order.boNumber || 'Order number unavailable';
            const date = String(order.orderDate || '').trim() || 'Date unavailable';
            const incorrect = order.incorrectValue || order.currentValue || 'blank';
            return `- Order ${number} — Order Date: ${date} — ${column}: ${incorrect} → ${correct}`;
        }).join('\n');
        const deadlineText = deadlines.length ? `Deadline: ${deadlines.join(', ')}.` : 'No deadline date in the BO file.';
        const several = Array.isArray(rule.incorrectValues) ? rule.incorrectValues : String(rule.incorrectValues || '').split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean);
        return {
            employeeName: person.salesmanName || '',
            product: rule.product || 'all cars',
            columnName: rule.column || '',
            incorrectValue: several.join(', ') || 'blank',
            correctValue: rule.correctValue || '—',
            conditionText: described,
            affectedOrderCount: (orders || []).length,
            orderNumber: (orders || []).map((order) => order.boNumber || 'Order number unavailable').join('\n'),
            orderDate: (orders || []).map((order) => String(order.orderDate || '').trim() || 'Date unavailable').join('\n'),
            deadline: deadlines.join(', ') || 'No deadline date',
            orderLines: lines,
            orderDateLine: lines ? `\n${deadlineText}\n${lines}` : `\n${deadlineText}`
        };
    }
    function liveRule() {
        const base = (detail && detail.rule) || {};
        const field = (id) => {
            const node = document.getElementById(id);
            return node ? node.value.trim() : '';
        };
        const cars = selectedCars();
        return Object.assign({}, base, {
            product: cars.length ? cars.join(', ') : (base.product || 'all cars'),
            column: (readConditions()[0] && readConditions()[0].column) || base.column || '',
            incorrectValues: (readConditions()[0] && readConditions()[0].values) || (base.incorrectValues || []).join(', '),
            conditions: readConditions(),
            matchMode: (document.getElementById('br-match') && document.getElementById('br-match').value) || 'all',
            correctValue: field('br-good') || base.correctValue || '',
            deadlineDays: deadlineChoice(),
            deadlineSource: dateSource(),
            deadlineDate: field('br-date-fixed') || base.deadlineDate || ''
        });
    }
    function exampleBag() {
        const value = (id) => {
            const field = document.getElementById(id);
            return field ? field.value.trim() : '';
        };
        const cars = selectedCars();
        const days = deadlineChoice();
        const fixed = dateSource() === 'fixed';
        const pickedDate = value('br-date-fixed');
        const deadline = fixed ? previewFromIso(pickedDate, days) : previewDate(days);
        const list = readConditions();
        const first = list[0] || {};
        const mode = document.getElementById('br-match') && document.getElementById('br-match').value === 'any' ? 'any' : 'all';
        return {
            employeeName: 'Example employee',
            product: cars.join(', ') || 'the selected car',
            columnName: first.column || 'the selected column',
            incorrectValue: String(first.values || '').trim() || 'the incorrect value',
            conditionText: describeConditions(list, mode),
            correctValue: value('br-good') || 'the correction',
            affectedOrderCount: '3',
            orderNumber: 'Example order',
            orderDate: '01.10.2026',
            deadline,
            orderLines: 'Example order · 01.10.2026',
            orderDateLine: `\nDeadline: ${deadline}.\nExample order · 01.10.2026`
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
        paintApply();
        paintLive();
    }
    function paintApply() {
        const box = document.getElementById('br-apply');
        if (!box) return;
        const cars = selectedCars();
        const mode = document.getElementById('br-match') && document.getElementById('br-match').value === 'any' ? 'any' : 'all';
        box.innerHTML = `<b>This message applies only when</b><ul><li>Car is ${esc(cars.length ? cars.join(', ') : 'all cars')}.</li><li>${mode === 'any' ? 'Any condition matches' : 'Every condition matches'}: ${esc(describeConditions(readConditions(), mode))}.</li><li>Each employee receives only their own matching orders.</li></ul>`;
    }
    function paintTest(data) {
        const box = document.getElementById('br-test-out');
        const send = document.getElementById('br-push');
        if (send) send.disabled = !!(data && data.orderCount === 0);
        if (!box || !data) return;
        const matched = (data.matchedSample || []).map((row) => `<tr><td>${esc(row.salesmanName)}</td><td>${esc(row.boNumber)}</td><td>${esc(row.orderDate || 'Date unavailable')}</td><td>${esc(row.incorrectValue || row.values)}</td><td>${esc(row.product)}</td></tr>`).join('');
        const excluded = (data.excludedSample || []).map((row) => `<tr><td>${esc(row.boNumber)}</td><td>${esc(row.salesmanName)}</td><td>${esc(row.product)}</td><td>${esc(row.reason)}</td></tr>`).join('');
        const previews = (data.previews || []).map((item) => `<article class="br-preview-card"><b>${esc(item.salesmanName)} · ${esc(item.salesmanId)}</b><div class="br-bubble">${esc(item.message)}</div></article>`).join('');
        const warnings = (data.mappingWarnings || []).map((item) => `<p class="err">${esc(item)}</p>`).join('');
        box.innerHTML = `${warnings}<p>${data.orderCount || 0} matching orders · ${data.employeeCount || 0} employees · ${data.excludedCount || 0} rows excluded · ${data.totalRows || 0} rows in the file. This test does not send a message.</p>
            <p>Condition: ${esc(data.conditionText || '')}</p>
            ${data.orderCount ? '' : '<p class="err">No rows match. Send stays off until a test finds at least one order.</p>'}
            <h3>Matching records</h3>
            <table class="br-table"><thead><tr><th>Employee</th><th>Order number</th><th>Order date</th><th>Incorrect value</th><th>Product</th></tr></thead><tbody>${matched || '<tr><td colspan="5">No matching rows.</td></tr>'}</tbody></table>
            <h3>Rendered messages</h3>
            ${previews || '<p class="muted">No employee message to preview.</p>'}
            <h3>Excluded records</h3>
            <table class="br-table"><thead><tr><th>Order</th><th>Employee</th><th>Car</th><th>Why excluded</th></tr></thead><tbody>${excluded || '<tr><td colspan="4">No excluded sample.</td></tr>'}</tbody></table>`;
    }
    function paintLive() {
        const bubble = document.getElementById('br-live');
        const status = document.getElementById('br-person-status');
        const employee = currentEmployee();
        if (!bubble) return;
        if (!employee) {
            bubble.textContent = 'Generate messages to preview a real employee.';
            return;
        }
        const templateField = document.getElementById('br-message');
        const template = templateField ? templateField.value : ((detail.rule && detail.rule.message) || '');
        bubble.textContent = fillTemplate(template, realBag(liveRule(), employee, employee.orders || []));
        const lang = document.getElementById('br-lang');
        bubble.classList.toggle('ar', !!(lang && lang.value === 'ar'));
        if (status) status.innerHTML = messageState(employee);
        paintOrderTable(employee);
    }
    function paintOrderTable(employee) {
        const box = document.getElementById('br-orders');
        if (!box || !employee) return;
        const delivery = ((detail && detail.delivery) || []).find((person) => person.salesmanId === employee.salesmanId && person.salesmanName === employee.salesmanName);
        const sentCell = (order) => {
            const hit = delivery && (delivery.orders || []).find((row) => row.boNumber === order.boNumber);
            if (hit && hit.sent) return `<span class="br-pill sent">Sent</span><div class="br-sub">${esc(stamp(hit.sentAt))}</div>`;
            return '<span class="br-pill wait">Not sent</span>';
        };
        box.innerHTML = `<table class="br-table"><thead><tr><th>Back Order Number</th><th>Product</th><th>Order date</th><th>Incorrect</th><th>Correct</th><th>Message sent</th></tr></thead><tbody>
            ${(employee.orders || []).map((order) => `<tr><td>${esc(order.boNumber)}</td><td>${esc(order.product)}</td><td>${esc(order.orderDate || 'No date in the BO file')}</td><td>${esc(order.currentValue)}</td><td>${esc(order.correctValue)}</td><td>${sentCell(order)}</td></tr>`).join('') || '<tr><td colspan="6">No matching orders.</td></tr>'}
        </tbody></table>`;
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
        ['br-good', 'br-deadline', 'br-date-source', 'br-date-column', 'br-date-fixed', 'br-match', 'br-map-order', 'br-map-date', 'br-map-product'].forEach((id) => {
            const field = document.getElementById(id);
            if (field) field.addEventListener('input', paintPreview);
            if (field) field.addEventListener('change', () => {
                if (id.indexOf('br-map') === 0) lastTest = null;
                paintPreview();
            });
        });
        const dateSourceField = document.getElementById('br-date-source');
        if (dateSourceField) dateSourceField.addEventListener('change', () => {
            const fixed = dateSourceField.value === 'fixed';
            const columnWrap = document.getElementById('br-date-column-wrap');
            const fixedWrap = document.getElementById('br-date-fixed-wrap');
            if (columnWrap) columnWrap.hidden = fixed;
            if (fixedWrap) fixedWrap.hidden = !fixed;
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
        const condBox = document.getElementById('br-conditions');
        if (condBox) {
            condBox.addEventListener('input', () => { lastTest = null; paintPreview(); });
            condBox.addEventListener('change', (event) => {
                const row = event.target.closest('.br-cond');
                if (row && event.target.classList.contains('br-cond-op')) {
                    const value = row.querySelector('.br-cond-val');
                    const op = event.target.value;
                    value.hidden = op === 'empty' || op === 'not_empty';
                    value.placeholder = op === 'in_list' || op === 'not_in_list' ? 'Comma-separated values' : 'Value';
                }
                lastTest = null;
                const send = document.getElementById('br-push');
                if (send) send.disabled = false;
                paintPreview();
            });
            condBox.addEventListener('click', (event) => {
                const button = event.target.closest('.br-cond-remove');
                if (!button) return;
                const rows = condBox.querySelectorAll('.br-cond');
                if (rows.length < 2) return;
                button.closest('.br-cond').remove();
                lastTest = null;
                paintPreview();
            });
        }
        const addCond = document.getElementById('br-add-cond');
        if (addCond) addCond.addEventListener('click', () => {
            const box = document.getElementById('br-conditions');
            if (!box) return;
            box.insertAdjacentHTML('beforeend', conditionRow({ column: '', operator: 'equals', values: [] }));
            lastTest = null;
        });
        const testBtn = document.getElementById('br-test');
        if (testBtn) testBtn.addEventListener('click', () => testConditions());
        const newer = document.getElementById('br-new');
        if (newer) newer.addEventListener('click', () => { editing = null; detail = null; previewKey = ''; lastTest = null; notice = ''; render(); });
        const employeePick = document.getElementById('br-employee');
        if (employeePick) employeePick.addEventListener('change', () => { previewKey = employeePick.value; paintLive(); });
        const copyLive = document.getElementById('br-copy-live');
        if (copyLive) copyLive.addEventListener('click', async () => {
            const bubble = document.getElementById('br-live');
            const noteBox = document.getElementById('br-note');
            const text = bubble ? bubble.textContent : '';
            try {
                await navigator.clipboard.writeText(text);
                if (noteBox) noteBox.textContent = 'Employee message copied.';
            } catch (e) {
                if (noteBox) noteBox.textContent = 'Select the message and copy it manually.';
            }
        });
        const waPerson = document.getElementById('br-wa-person');
        if (waPerson) waPerson.addEventListener('click', () => {
            const employee = currentEmployee();
            if (employee) sendWhatsApp(employee.salesmanId, employee.salesmanName, 'prepared');
        });
        ['br-message', 'br-wa'].forEach((id) => {
            const field = document.getElementById(id);
            if (!field) return;
            field.addEventListener('focus', () => { messageTarget = id; });
            field.addEventListener('input', paintPreview);
        });
        const lang = document.getElementById('br-lang');
        if (lang) lang.addEventListener('change', paintPreview);
        root.querySelectorAll('[data-token]').forEach((button) => button.addEventListener('click', () => insertToken(button.dataset.token)));
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
            notice = 'Sent. Each employee sees only their own orders and dates. Opening WhatsApp does not mark a message sent.';
            editing = saved.rule || editing;
            await load(rule.id);
        } catch (e) {
            if (e.needsConfirm && window.confirm(e.message)) return pushDraft(true);
            if (e.message !== 'unauthorized') error.textContent = e.message;
        }
    }
    async function testConditions() {
        const error = document.getElementById('br-error');
        if (error) error.textContent = '';
        try {
            lastTest = await api('/api/reserved-orders/bo-rules/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), rule: formRule() }) });
            paintTest(lastTest);
            if (lastTest.warning && error) error.textContent = lastTest.warning;
        } catch (e) {
            if (e.message !== 'unauthorized' && error) error.textContent = e.message;
        }
    }
    async function save(analyze) {
        const error = document.getElementById('br-error');
        error.textContent = '';
        try {
            const data = await api('/api/reserved-orders/bo-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password(), rule: formRule(), analyze }) });
            editing = data.rule || editing;
            notice = 'Messages generated from the current Back Order file.';
            if (data.warning) error.textContent = data.warning;
            await load(data.rule && data.rule.id);
        } catch (e) { if (e.message !== 'unauthorized') error.textContent = e.message; }
    }
    async function openRule(id) {
        detail = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(id) + '?password=' + encodeURIComponent(password()));
        lastTest = null;
        editing = detail.rule || editing;
        const people = (detail.rule && detail.rule.current && detail.rule.current.employees) || [];
        if (!previewKey || !people.some((item) => employeeKey(item) === previewKey)) previewKey = employeeKey(people[0]);
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
        const delivery = ((detail && detail.delivery) || []).find((person) => person.salesmanId === salesmanId && person.salesmanName === salesmanName);
        const sentCell = (order) => {
            const hit = delivery && (delivery.orders || []).find((row) => row.boNumber === order.boNumber);
            if (hit && hit.sent) return `<span class="br-pill sent">Sent</span><div class="br-sub">${esc(stamp(hit.sentAt))}</div>`;
            return '<span class="br-pill wait">Not sent</span>';
        };
        box.innerHTML = `<h3>${esc(employee.salesmanName)} · ${esc(employee.salesmanId)}</h3><table class="br-table"><thead><tr><th>Back Order Number</th><th>Product</th><th>Model Year</th><th>Order Date</th><th>Current value</th><th>Correct value</th><th>Message sent</th></tr></thead><tbody>
            ${employee.orders.map((order) => `<tr><td>${esc(order.boNumber)}</td><td>${esc(order.product)}</td><td>${esc(order.modelYear)}</td><td>${esc(order.orderDate)}</td><td>${esc(order.currentValue)}</td><td>${esc(order.correctValue)}</td><td>${sentCell(order)}</td></tr>`).join('')}
        </tbody></table>`;
    }
    async function sendWhatsApp(salesmanId, salesmanName, action) {
        const live = document.getElementById('br-live');
        const data = await api('/api/reserved-orders/bo-rules/' + encodeURIComponent(detail.rule.id) + '/whatsapp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password(), salesmanId, salesmanName, action, message: live ? live.textContent : '' })
        });
        const result = document.getElementById('br-wa-result');
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
