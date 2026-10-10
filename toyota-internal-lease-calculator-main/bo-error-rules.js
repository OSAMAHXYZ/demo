const fs = require('fs');
const path = require('path');

const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty', 'in_list', 'not_in_list'];
const NEEDS_VALUE = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'in_list', 'not_in_list']);

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function cellString(value) {
    if (value == null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return String(value);
        const text = String(value);
        return text;
    }
    return String(value).replace(/\u00a0/g, ' ').trim();
}

function fold(value) {
    return cellString(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function headerKey(value) {
    return fold(value);
}

function findHeader(headers, aliases) {
    const list = headers || [];
    const wanted = (aliases || []).map(headerKey);
    const exact = list.find((header) => wanted.includes(headerKey(header)));
    if (exact) return exact;
    return list.find((header) => wanted.some((name) => headerKey(header).includes(name))) || '';
}

function splitValues(raw) {
    if (Array.isArray(raw)) return raw.map(cellString).filter((item) => item !== '');
    return cellString(raw).split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean);
}

function valuesMatch(left, right) {
    return fold(left) === fold(right);
}

function conditionMatches(operator, cell, expected) {
    const text = cellString(cell);
    const folded = fold(text);
    const list = expected || [];
    if (operator === 'empty') return folded === '';
    if (operator === 'not_empty') return folded !== '';
    if (operator === 'equals') return list.some((item) => valuesMatch(text, item));
    if (operator === 'not_equals') return list.length ? list.every((item) => !valuesMatch(text, item)) : false;
    if (operator === 'contains') return list.some((item) => fold(item) && folded.includes(fold(item)));
    if (operator === 'not_contains') return list.length ? list.every((item) => !fold(item) || !folded.includes(fold(item))) : false;
    if (operator === 'in_list') return list.some((item) => valuesMatch(text, item));
    if (operator === 'not_in_list') return folded !== '' && list.length ? list.every((item) => !valuesMatch(text, item)) : false;
    return false;
}

function chosenList(rule, plural, single) {
    if (Array.isArray(rule && rule[plural]) && rule[plural].length) return rule[plural].map(cellString).filter(Boolean);
    return cellString(rule && rule[single]).split(',').map((item) => item.trim()).filter(Boolean);
}

function analyzeTable(table, rule) {
    const headers = table.headers || [];
    const rows = table.rows || [];
    const requestedColumns = chosenList(rule, 'columns', 'column');
    const resolved = requestedColumns.map((name) => ({ name, header: findHeader(headers, [name]) }));
    const present = resolved.filter((item) => item.header);
    const missingColumns = resolved.filter((item) => !item.header).map((item) => item.name);
    const productHeader = findHeader(headers, ['Product', 'Car', 'Vehicle', 'Model']);
    const salesmanIdHeader = findHeader(headers, ['Salesman Id', 'Salesman ID', 'SalesmanID']);
    const salesmanNameHeader = findHeader(headers, ['Salesman Name', 'Salesman']);
    const orderHeader = findHeader(headers, ['Back Order Number', 'BO Number', 'Order Number']);
    const yearHeader = findHeader(headers, ['Model Year']);
    const dateHeader = findHeader(headers, ['Order Date']);
    if (!present.length) {
        return { ok: false, columnMissing: true, missingColumns, employees: [], employeeCount: 0, orderCount: 0, headers };
    }
    const wantedProducts = chosenList(rule, 'products', 'product').map(fold).filter(Boolean);
    const groups = new Map();
    rows.forEach((row) => {
        if (wantedProducts.length && productHeader) {
            const product = fold(row[productHeader]);
            const matchesCar = wantedProducts.some((wanted) => product === wanted || product.includes(wanted) || wanted.includes(product));
            if (!matchesCar) return;
        }
        const hits = present.filter((item) => conditionMatches(rule.operator, row[item.header], rule.incorrectValues));
        if (!hits.length) return;
        const salesmanId = cellString(salesmanIdHeader ? row[salesmanIdHeader] : '') || 'UNASSIGNED';
        const salesmanName = cellString(salesmanNameHeader ? row[salesmanNameHeader] : '') || 'Unassigned';
        const boNumber = cellString(orderHeader ? row[orderHeader] : '') || '—';
        const personKey = `${salesmanId}\u0001${fold(salesmanName)}`;
        if (!groups.has(personKey)) groups.set(personKey, { salesmanId, salesmanName, orders: [] });
        const group = groups.get(personKey);
        if (salesmanName && salesmanName !== 'Unassigned') group.salesmanName = salesmanName;
        let order = group.orders.find((item) => item.boNumber === boNumber);
        if (!order) {
            order = {
                boNumber,
                product: cellString(productHeader ? row[productHeader] : ''),
                modelYear: cellString(yearHeader ? row[yearHeader] : ''),
                orderDate: cellString(dateHeader ? row[dateHeader] : ''),
                column: '',
                currentValue: '',
                correctValue: cellString(rule.correctValue),
                hits: []
            };
            group.orders.push(order);
        }
        hits.forEach((hit) => {
            if (order.hits.some((item) => item.column === hit.header)) return;
            order.hits.push({ column: hit.header, currentValue: cellString(row[hit.header]) });
        });
        order.column = order.hits.map((item) => item.column).join(', ');
        order.currentValue = order.hits.map((item) => `${item.column}: ${item.currentValue}`).join('; ');
    });
    const employees = Array.from(groups.values()).sort((a, b) => b.orders.length - a.orders.length || a.salesmanName.localeCompare(b.salesmanName));
    employees.forEach((person) => person.orders.forEach((order) => { delete order.hits; }));
    return {
        ok: true,
        columnMissing: missingColumns.length > 0,
        missingColumns,
        column: present.map((item) => item.header).join(', '),
        employees,
        employeeCount: employees.filter((item) => item.salesmanId !== 'UNASSIGNED').length,
        orderCount: employees.reduce((sum, item) => sum + item.orders.length, 0),
        headers
    };
}

function fingerprint(employees) {
    return (employees || []).map((item) => `${item.salesmanId}:${fold(item.salesmanName)}:${item.orders.map((order) => order.boNumber).sort().join(',')}`).sort().join('|');
}

function fillMessage(template, bag) {
    return String(template || '').replace(/\{(\w+)\}/g, (all, key) => (bag[key] == null ? all : String(bag[key])));
}

function orderDateLine(orders) {
    const seen = [];
    (orders || []).forEach((order) => {
        const value = cellString(order.orderDate);
        if (value && !seen.includes(value)) seen.push(value);
    });
    return seen.length ? ` Deadline: ${seen.join(', ')}.` : '';
}

function messageBag(rule, person, orders) {
    return {
        employeeName: person.salesmanName || person.name || '',
        product: rule.product || 'all cars',
        columnName: rule.column,
        incorrectValue: (rule.incorrectValues || []).join(', ') || 'blank',
        correctValue: rule.correctValue || '—',
        affectedOrderCount: (orders || []).length,
        orderDateLine: orderDateLine(orders)
    };
}

function attachBoErrorRules(app, deps) {
    const file = path.join(deps.storeDir, 'bo-error-rules.json');
    function loadStore() {
        const data = readJson(file, null);
        if (!data || !Array.isArray(data.rules)) {
            return { rules: [], history: [], publications: [], statuses: {}, whatsapp: [] };
        }
        data.history = Array.isArray(data.history) ? data.history : [];
        data.publications = Array.isArray(data.publications) ? data.publications : [];
        data.statuses = data.statuses && typeof data.statuses === 'object' ? data.statuses : {};
        data.whatsapp = Array.isArray(data.whatsapp) ? data.whatsapp : [];
        return data;
    }
    function saveStore(data) {
        fs.mkdirSync(deps.storeDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    }
    function newId(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    function cleanRule(raw, previous) {
        const operator = OPERATORS.includes(raw.operator) ? raw.operator : 'equals';
        const incorrectValues = NEEDS_VALUE.has(operator) ? splitValues(raw.incorrectValues != null ? raw.incorrectValues : raw.incorrectValue) : [];
        const products = chosenList(raw, 'products', 'product');
        const columns = chosenList(raw, 'columns', 'column');
        const now = new Date().toISOString();
        return {
            id: (previous && previous.id) || cellString(raw.id) || newId('rule'),
            name: cellString(raw.name) || 'BO error',
            product: products.join(', '),
            products,
            column: columns.join(', '),
            columns,
            operator,
            incorrectValues,
            correctValue: cellString(raw.correctValue),
            message: cellString(raw.message),
            whatsappMessage: cellString(raw.whatsappMessage),
            active: raw.active !== false,
            archived: !!(previous && previous.archived),
            createdAt: (previous && previous.createdAt) || now,
            updatedAt: now,
            lastAnalysisAt: (previous && previous.lastAnalysisAt) || '',
            columnMissing: !!(previous && previous.columnMissing),
            missingColumns: (previous && previous.missingColumns) || [],
            affectedEmployees: previous ? previous.affectedEmployees || 0 : 0,
            affectedOrders: previous ? previous.affectedOrders || 0 : 0,
            notificationStatus: (previous && previous.notificationStatus) || 'not_pushed',
            current: previous ? previous.current || null : null
        };
    }
    function validate(rule, headers) {
        if (!rule.name) return 'Enter a rule name.';
        const columns = chosenList(rule, 'columns', 'column');
        if (!columns.length) return 'Choose at least one BO column.';
        if (headers.length) {
            const missing = columns.filter((name) => !findHeader(headers, [name]));
            if (missing.length === columns.length) return `Those columns are not in the latest BO file: ${missing.join(', ')}. The rule can be saved, but it cannot be analyzed until a column is present.`;
        }
        if (NEEDS_VALUE.has(rule.operator) && !rule.incorrectValues.length) return 'Enter the incorrect value.';
        if (!rule.message) return 'Write the message employees will see.';
        return '';
    }
    function publicRule(rule) {
        const copy = { ...rule };
        if (copy.current && Array.isArray(copy.current.employees)) {
            copy.current = {
                analyzedAt: copy.current.analyzedAt,
                fileName: copy.current.fileName,
                fileStamp: copy.current.fileStamp,
                columnMissing: !!copy.current.columnMissing,
                employeeCount: copy.affectedEmployees,
                orderCount: copy.affectedOrders,
                employees: copy.current.employees.map((item) => ({
                    salesmanId: item.salesmanId,
                    salesmanName: item.salesmanName,
                    orderCount: item.orders.length
                }))
            };
        }
        return copy;
    }
    function applyAnalysis(store, rule, reason, req) {
        const table = deps.loadAnalysisTable() || { headers: [], rows: [] };
        const result = analyzeTable(table, rule);
        const now = new Date().toISOString();
        rule.lastAnalysisAt = now;
        rule.columnMissing = !!result.columnMissing;
        rule.missingColumns = result.missingColumns || [];
        rule.affectedEmployees = result.employeeCount || 0;
        rule.affectedOrders = result.orderCount || 0;
        rule.current = {
            analyzedAt: now,
            fileName: table.fileName || '',
            fileStamp: table.updatedAt || '',
            columnMissing: !!result.columnMissing,
            employees: result.employees || []
        };
        store.history.push({
            id: newId('an'),
            ruleId: rule.id,
            analyzedAt: now,
            reason: reason || 'manual',
            fileName: table.fileName || '',
            fileStamp: table.updatedAt || '',
            columnMissing: !!result.columnMissing,
            employeeCount: rule.affectedEmployees,
            orderCount: rule.affectedOrders,
            employees: (result.employees || []).map((item) => ({
                salesmanId: item.salesmanId,
                salesmanName: item.salesmanName,
                orders: item.orders.map((order) => order.boNumber)
            }))
        });
        if (store.history.length > 300) store.history = store.history.slice(-300);
        deps.audit(req, {
            user: 'Admin',
            role: 'admin',
            action: 'BO_RULE_ANALYZED',
            entity: 'bo-rule',
            source: 'admin',
            details: `${rule.name}: ${rule.affectedEmployees} employees, ${rule.affectedOrders} orders${result.columnMissing ? ' (column missing)' : ''}`
        });
        return result;
    }
    function reanalyzeActive(req, reason) {
        const store = loadStore();
        store.rules.filter((rule) => rule.active && !rule.archived).forEach((rule) => applyAnalysis(store, rule, reason || 'BO_FILE_UPDATED', req));
        saveStore(store);
        if (store.rules.some((rule) => rule.active && !rule.archived)) {
            deps.audit(req, { user: 'System', role: 'system', action: 'BO_FILE_UPDATED', entity: 'bo-rule', source: 'import', details: `Re-analyzed ${store.rules.filter((rule) => rule.active && !rule.archived).length} BO error rule(s)` });
        }
    }
    function employeeCanSee(user, item) {
        if (!user || item.salesmanId === 'UNASSIGNED') return false;
        if (String(user.employeeNumber) !== String(item.salesmanId)) return false;
        const twins = deps.loadStaff().filter((person) => String(person.id) === String(user.employeeNumber) && person.active !== false);
        if (twins.length <= 1) return true;
        return fold(user.name) === fold(item.salesmanName);
    }
    function statusKey(ruleId, item) {
        const salesmanId = typeof item === 'string' ? item : item.salesmanId;
        const salesmanName = typeof item === 'string' ? '' : fold(item.salesmanName);
        return `${ruleId}\u0001${salesmanId}\u0001${salesmanName}`;
    }

    app.get('/api/reserved-orders/bo-rules', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const table = deps.loadAnalysisTable() || { headers: [], rows: [] };
        const productHeader = findHeader(table.headers, ['Product', 'Car', 'Vehicle']);
        const products = [];
        (table.rows || []).forEach((row) => {
            const name = cellString(productHeader ? row[productHeader] : '');
            if (name && !products.includes(name) && products.length < 200) products.push(name);
        });
        products.sort((a, b) => a.localeCompare(b));
        const salesmanIdHeader = findHeader(table.headers, ['Salesman Id', 'Salesman ID', 'SalesmanID']);
        const salesmanNameHeader = findHeader(table.headers, ['Salesman Name', 'Salesman']);
        const peopleMap = new Map();
        (table.rows || []).forEach((row) => {
            const salesmanId = cellString(salesmanIdHeader ? row[salesmanIdHeader] : '') || 'UNASSIGNED';
            const salesmanName = cellString(salesmanNameHeader ? row[salesmanNameHeader] : '') || 'Unassigned';
            const product = cellString(productHeader ? row[productHeader] : '');
            const key = `${salesmanId}\u0001${fold(salesmanName)}`;
            if (!peopleMap.has(key)) peopleMap.set(key, { salesmanId, salesmanName, orders: 0, cars: {} });
            const person = peopleMap.get(key);
            person.orders += 1;
            if (product) person.cars[product] = (person.cars[product] || 0) + 1;
        });
        const people = Array.from(peopleMap.values())
            .sort((a, b) => b.orders - a.orders || a.salesmanName.localeCompare(b.salesmanName))
            .slice(0, 80)
            .map((person) => ({
                salesmanId: person.salesmanId,
                salesmanName: person.salesmanName,
                orders: person.orders,
                cars: Object.entries(person.cars).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => `${name} (${count})`).join(', ')
            }));
        res.json({
            file: {
                fileName: table.fileName || '',
                updatedAt: table.updatedAt || '',
                sheetName: table.sheetName || '',
                rowCount: (table.rows || []).length,
                headers: table.headers || []
            },
            people,
            products,
            rules: store.rules.map(publicRule),
            history: store.history.slice(-80).reverse(),
            whatsapp: store.whatsapp.slice(-80).reverse()
        });
    });

    app.get('/api/reserved-orders/bo-rules/:id', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        res.json({
            rule,
            delivery: ((rule.current && rule.current.employees) || []).map((item) => {
                const state = store.statuses[statusKey(rule.id, item)] || {};
                return {
                    salesmanId: item.salesmanId,
                    salesmanName: item.salesmanName,
                    orderCount: (item.orders || []).length,
                    sentAt: state.sentAt || '',
                    status: state.sentAt ? 'sent' : (rule.notificationStatus === 'pushed' ? 'waiting' : 'not_pushed')
                };
            }),
            history: store.history.filter((item) => item.ruleId === rule.id).slice(-30).reverse(),
            publications: store.publications.filter((item) => item.ruleId === rule.id).slice(-20).reverse(),
            whatsapp: store.whatsapp.filter((item) => item.ruleId === rule.id).slice(-40).reverse()
        });
    });

    app.post('/api/reserved-orders/bo-rules', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const table = deps.loadAnalysisTable() || { headers: [], rows: [] };
        const previous = store.rules.find((item) => item.id && item.id === cellString(req.body?.rule?.id));
        const rule = cleanRule(req.body?.rule || {}, previous);
        const problem = validate(rule, table.headers || []);
        const hard = problem && !problem.includes('cannot be analyzed');
        if (hard) return res.status(400).json({ error: problem });
        if (previous) {
            const index = store.rules.findIndex((item) => item.id === previous.id);
            store.rules[index] = rule;
        } else store.rules.push(rule);
        if (req.body?.analyze) applyAnalysis(store, rule, 'save', req);
        saveStore(store);
        deps.audit(req, { user: 'Admin', role: 'admin', action: previous ? 'BO_RULE_EDITED' : 'BO_RULE_CREATED', entity: 'bo-rule', source: 'admin', details: rule.name });
        res.json({ ok: true, warning: rule.columnMissing ? (problem || 'That column is not in the latest BO file. The rule was saved and flagged.') : (problem || ''), rule: publicRule(rule) });
    });

    app.post('/api/reserved-orders/bo-rules/:id/analyze', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        applyAnalysis(store, rule, 'manual', req);
        saveStore(store);
        res.json({ ok: true, rule });
    });

    app.post('/api/reserved-orders/bo-rules/:id/push', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule || !rule.current) return res.status(400).json({ error: 'Analyze the rule before pushing it.' });
        const last = [...store.publications].reverse().find((item) => item.ruleId === rule.id);
        const nextPrint = fingerprint(rule.current.employees);
        if (last && last.fingerprint === nextPrint && !req.body?.confirmRepublish) {
            return res.status(409).json({ error: 'This same result was already pushed. Confirm to publish it again.', needsConfirm: true });
        }
        const publication = {
            id: newId('pub'),
            ruleId: rule.id,
            publishedAt: new Date().toISOString(),
            employeeCount: rule.affectedEmployees,
            orderCount: rule.affectedOrders,
            fingerprint: nextPrint,
            employees: rule.current.employees
        };
        store.publications.push(publication);
        rule.notificationStatus = 'pushed';
        (rule.current.employees || []).forEach((item) => {
            if (item.salesmanId === 'UNASSIGNED') return;
            const key = statusKey(rule.id, item);
            if (!store.statuses[key]) store.statuses[key] = { status: 'new', at: publication.publishedAt, orders: {} };
        });
        saveStore(store);
        deps.audit(req, { user: 'Admin', role: 'admin', action: 'BO_ALERT_PUBLISHED', entity: 'bo-rule', source: 'admin', details: `${rule.name} to ${rule.affectedEmployees} employees` });
        res.json({ ok: true, publicationId: publication.id, rule: publicRule(rule) });
    });

    app.post('/api/reserved-orders/bo-rules/:id/archive', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        rule.archived = req.body?.restore ? false : true;
        rule.active = rule.archived ? false : rule.active;
        rule.updatedAt = new Date().toISOString();
        saveStore(store);
        deps.audit(req, { user: 'Admin', role: 'admin', action: rule.archived ? 'BO_RULE_ARCHIVED' : 'BO_RULE_RESTORED', entity: 'bo-rule', source: 'admin', details: rule.name });
        res.json({ ok: true });
    });

    app.post('/api/reserved-orders/bo-rules/:id/active', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        rule.active = !!req.body?.active;
        rule.updatedAt = new Date().toISOString();
        saveStore(store);
        deps.audit(req, { user: 'Admin', role: 'admin', action: rule.active ? 'BO_RULE_ACTIVATED' : 'BO_RULE_DEACTIVATED', entity: 'bo-rule', source: 'admin', details: rule.name });
        res.json({ ok: true });
    });

    app.post('/api/reserved-orders/bo-rules/:id/whatsapp', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule || !rule.current) return res.status(400).json({ error: 'Analyze the rule first.' });
        const salesmanId = cellString(req.body?.salesmanId);
        const salesmanName = fold(req.body?.salesmanName);
        const employee = (rule.current.employees || []).find((item) => item.salesmanId === salesmanId && (!salesmanName || fold(item.salesmanName) === salesmanName));
        if (!employee) return res.status(404).json({ error: 'That employee is not in the current analysis.' });
        const staff = deps.loadStaff().find((person) => String(person.id) === salesmanId && person.phone);
        const phone = cellString(staff && staff.phone);
        const message = fillMessage(cellString(req.body?.message) || rule.whatsappMessage || rule.message, messageBag(rule, employee, employee.orders));
        const action = ['prepared', 'opened', 'marked_sent'].includes(req.body?.action) ? req.body.action : 'prepared';
        const entry = {
            id: newId('wa'),
            ruleId: rule.id,
            salesmanId,
            salesmanName: employee.salesmanName,
            phone,
            message,
            status: action,
            at: new Date().toISOString()
        };
        store.whatsapp.push(entry);
        saveStore(store);
        deps.audit(req, { user: 'Admin', role: 'admin', action: action === 'marked_sent' ? 'WHATSAPP_MARKED_SENT' : (action === 'opened' ? 'WHATSAPP_OPENED' : 'WHATSAPP_PREPARED'), entity: 'bo-rule', source: 'admin', details: `${rule.name} · ${employee.salesmanName}`, newValue: action });
        const link = `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(message)}`;
        res.json({ ok: true, message, phone, link, status: action, deliveryConfirmed: false });
    });

    app.get('/api/reserved-orders/my-bo-corrections', (req, res) => {
        const user = deps.sessionUser(req.query?.token);
        if (!user) return res.status(401).json({ error: 'Sign in again.' });
        const store = loadStore();
        const cards = [];
        store.publications.forEach((publication) => {
            const rule = store.rules.find((item) => item.id === publication.ruleId);
            if (!rule || rule.archived) return;
            const latest = rule.current && rule.current.employees;
            const mine = (latest || publication.employees || []).find((item) => employeeCanSee(user, item));
            if (!mine) return;
            const key = statusKey(rule.id, mine);
            const state = store.statuses[key] || { status: 'new', at: publication.publishedAt, orders: {} };
            cards.push({
                ruleId: rule.id,
                publicationId: publication.id,
                name: rule.name,
                product: rule.product || 'All cars',
                column: rule.column,
                incorrectValue: (rule.incorrectValues || []).join(', ') || 'blank',
                correctValue: rule.correctValue,
                message: fillMessage(rule.message, messageBag(rule, { name: user.name, salesmanName: user.name }, mine.orders)),
                affectedOrderCount: mine.orders.length,
                status: state.status || 'new',
                sentAt: state.sentAt || '',
                orders: mine.orders.map((order) => ({
                    ...order,
                    status: (state.orders && state.orders[order.boNumber] && state.orders[order.boNumber].status) || 'new'
                }))
            });
        });
        const seen = new Set();
        const unique = [];
        cards.reverse().forEach((card) => {
            if (seen.has(card.ruleId)) return;
            seen.add(card.ruleId);
            unique.push(card);
        });
        res.json({ alerts: unique.reverse() });
    });

    app.post('/api/reserved-orders/my-bo-corrections/status', (req, res) => {
        const user = deps.sessionUser(req.body?.token);
        if (!user) return res.status(401).json({ error: 'Sign in again.' });
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.body?.ruleId);
        if (!rule || !rule.current) return res.status(404).json({ error: 'Alert not found.' });
        const mine = (rule.current.employees || []).find((item) => employeeCanSee(user, item));
        if (!mine) return res.status(403).json({ error: 'This alert is not assigned to you.' });
        const allowed = ['new', 'viewed', 'in_progress', 'completed'];
        const status = allowed.includes(req.body?.status) ? req.body.status : 'viewed';
        const key = statusKey(rule.id, mine);
        const state = store.statuses[key] || { status: 'new', at: '', orders: {} };
        const now = new Date().toISOString();
        if (req.body?.boNumber) {
            if (!mine.orders.some((order) => order.boNumber === req.body.boNumber)) return res.status(403).json({ error: 'That order is not in your list.' });
            state.orders[req.body.boNumber] = { status, at: now };
        } else {
            state.status = status;
            state.at = now;
        }
        store.statuses[key] = state;
        saveStore(store);
        deps.audit(req, { user: user.name, employeeNumber: user.employeeNumber, recordId: user.recordId, role: 'employee', action: status === 'completed' ? 'BO_CORRECTION_COMPLETED' : 'BO_ALERT_OPENED', entity: 'bo-rule', source: 'employee', orderNumber: req.body?.boNumber || '', details: rule.name, newValue: status });
        res.json({ ok: true });
    });

    app.post('/api/reserved-orders/my-bo-corrections/sent', (req, res) => {
        const user = deps.sessionUser(req.body?.token);
        if (!user) return res.status(401).json({ error: 'Sign in again.' });
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.body?.ruleId);
        if (!rule || !rule.current) return res.status(404).json({ error: 'Message not found.' });
        const mine = (rule.current.employees || []).find((item) => employeeCanSee(user, item));
        if (!mine) return res.status(403).json({ error: 'This message is not yours.' });
        const key = statusKey(rule.id, mine);
        const state = store.statuses[key] || { status: 'new', at: '', orders: {} };
        const now = new Date().toISOString();
        state.sentAt = now;
        state.sentMessage = cellString(req.body?.message);
        state.status = 'completed';
        state.at = now;
        store.statuses[key] = state;
        saveStore(store);
        deps.audit(req, { user: user.name, employeeNumber: user.employeeNumber, recordId: user.recordId, role: 'employee', action: 'BO_MESSAGE_SENT', entity: 'bo-rule', source: 'employee', details: `${rule.name} · ${mine.orders.length} orders`, newValue: 'sent' });
        res.json({ ok: true, sentAt: now });
    });

    return { reanalyzeActive, analyzeTable };
}

module.exports = { attachBoErrorRules, analyzeTable, cellString, conditionMatches };
