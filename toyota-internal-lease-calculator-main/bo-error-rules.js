const fs = require('fs');
const path = require('path');

const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'empty', 'not_empty', 'gt', 'lt', 'in_list', 'not_in_list'];
const NEEDS_VALUE = new Set(['equals', 'not_equals', 'contains', 'not_contains', 'gt', 'lt', 'in_list', 'not_in_list']);
const OPERATOR_TEXT = {
    equals: 'equals',
    not_equals: 'does not equal',
    contains: 'contains',
    not_contains: 'does not contain',
    empty: 'is empty',
    not_empty: 'is not empty',
    gt: 'is greater than',
    lt: 'is less than',
    in_list: 'is one of',
    not_in_list: 'is not one of'
};

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

function whatsappFromRow(row) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, '__whatsapp')) return '';
    return cellString(row.__whatsapp);
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
    if (operator === 'gt' || operator === 'lt') {
        if (!text) return false;
        return list.some((item) => {
            const gap = compareRank(text, item);
            return operator === 'gt' ? gap > 0 : gap < 0;
        });
    }
    return false;
}

function compareRank(left, right) {
    const leftNum = Number(String(left).replace(/,/g, ''));
    const rightNum = Number(String(right).replace(/,/g, ''));
    if (String(left).trim() !== '' && Number.isFinite(leftNum) && Number.isFinite(rightNum)) return leftNum - rightNum;
    const leftDate = parseBoDate(left);
    const rightDate = parseBoDate(right);
    if (leftDate && rightDate) return leftDate.getTime() - rightDate.getTime();
    return fold(left).localeCompare(fold(right));
}

function ruleConditions(rule) {
    if (Array.isArray(rule && rule.conditions) && rule.conditions.length) {
        return rule.conditions.map((item) => {
            const operator = OPERATORS.includes(item.operator) ? item.operator : 'equals';
            return {
                column: cellString(item.column),
                operator,
                values: NEEDS_VALUE.has(operator) ? splitValues(item.values != null ? item.values : item.value) : []
            };
        }).filter((item) => item.column);
    }
    const operator = OPERATORS.includes(rule && rule.operator) ? rule.operator : 'equals';
    const values = NEEDS_VALUE.has(operator) ? splitValues(rule && rule.incorrectValues) : [];
    return chosenList(rule, 'columns', 'column').map((column) => ({ column, operator, values }));
}

function ruleMatchMode(rule) {
    if (rule && (rule.matchMode === 'any' || rule.matchMode === 'all')) return rule.matchMode;
    return chosenList(rule, 'columns', 'column').length > 1 && !(rule && Array.isArray(rule.conditions) && rule.conditions.length) ? 'any' : 'all';
}

function describeCondition(cond) {
    const column = cellString(cond && cond.column) || 'column';
    const operator = OPERATOR_TEXT[cond && cond.operator] || 'equals';
    if (cond && (cond.operator === 'empty' || cond.operator === 'not_empty')) return `${column} ${operator}`;
    const values = splitValues(cond && cond.values).join(', ') || 'blank';
    return `${column} ${operator} ${values}`;
}

function describeRule(rule) {
    const list = ruleConditions(rule);
    if (!list.length) return 'no condition is set';
    return list.map(describeCondition).join(ruleMatchMode(rule) === 'any' ? ' or ' : ' and ');
}

function cleanFieldMap(raw) {
    const map = raw && raw.fieldMap && typeof raw.fieldMap === 'object' ? raw.fieldMap : {};
    return {
        orderNumber: cellString(map.orderNumber),
        orderDate: cellString(map.orderDate),
        product: cellString(map.product)
    };
}

function mappedHeader(headers, chosen, aliases) {
    const named = cellString(chosen);
    if (named) return findHeader(headers, [named]) || '';
    return findHeader(headers, aliases);
}

function displayOrderDate(value) {
    const text = cellString(value);
    if (!text) return 'Date unavailable';
    const date = parseBoDate(text);
    if (!date || Number.isNaN(date.getTime())) return 'Date unavailable';
    return formatBoDate(date);
}

function chosenList(rule, plural, single) {
    if (Array.isArray(rule && rule[plural]) && rule[plural].length) return rule[plural].map(cellString).filter(Boolean);
    return cellString(rule && rule[single]).split(',').map((item) => item.trim()).filter(Boolean);
}

function analyzeTable(table, rule) {
    const headers = table.headers || [];
    const rows = table.rows || [];
    const conditions = ruleConditions(rule).map((item) => ({ ...item, header: findHeader(headers, [item.column]) }));
    const missingColumns = conditions.filter((item) => !item.header).map((item) => item.column);
    const mode = ruleMatchMode(rule);
    const fieldMap = cleanFieldMap(rule);
    const productHeader = mappedHeader(headers, fieldMap.product, ['Product', 'Car', 'Vehicle', 'Model']);
    const salesmanIdHeader = findHeader(headers, ['Salesman Id', 'Salesman ID', 'SalesmanID']);
    const salesmanNameHeader = findHeader(headers, ['Salesman Name', 'Salesman']);
    const orderHeader = mappedHeader(headers, fieldMap.orderNumber, ['Back Order Number', 'BO Number', 'Order Number']);
    const yearHeader = findHeader(headers, ['Model Year']);
    const orderDateHeader = mappedHeader(headers, fieldMap.orderDate, ['Order Date']);
    const deadlineHeader = deadlineDateHeader(headers, rule);
    const mappingWarnings = [];
    if (fieldMap.orderNumber && !orderHeader) mappingWarnings.push(`Order number column "${fieldMap.orderNumber}" is not in the BO file.`);
    if (fieldMap.orderDate && !orderDateHeader) mappingWarnings.push(`Order date column "${fieldMap.orderDate}" is not in the BO file.`);
    if (fieldMap.product && !productHeader) mappingWarnings.push(`Product column "${fieldMap.product}" is not in the BO file.`);
    const empty = {
        ok: false,
        columnMissing: true,
        missingColumns,
        employees: [],
        employeeCount: 0,
        orderCount: 0,
        headers,
        totalRows: rows.length,
        excludedCount: rows.length,
        matchedSample: [],
        excludedSample: [],
        conditionText: describeRule(rule),
        mappingWarnings
    };
    if (!conditions.length || missingColumns.length === conditions.length) return empty;
    const wantedProducts = chosenList(rule, 'products', 'product').map(fold).filter(Boolean);
    const groups = new Map();
    const matchedSample = [];
    const excludedSample = [];
    const seenExcluded = new Set();
    let excludedCount = 0;
    rows.forEach((row) => {
        const product = cellString(productHeader ? row[productHeader] : '');
        const salesmanId = cellString(salesmanIdHeader ? row[salesmanIdHeader] : '') || 'UNASSIGNED';
        const salesmanName = cellString(salesmanNameHeader ? row[salesmanNameHeader] : '') || 'Unassigned';
        const boNumber = cellString(orderHeader ? row[orderHeader] : '') || 'Order number unavailable';
        const rowOrderDate = displayOrderDate(orderDateHeader ? row[orderDateHeader] : '');
        const rowDeadline = deadlineHeader ? cellString(row[deadlineHeader]) : '';
        let carFail = '';
        if (wantedProducts.length && productHeader) {
            const foldedProduct = fold(product);
            const matchesCar = wantedProducts.some((wanted) => foldedProduct === wanted || foldedProduct.includes(wanted) || wanted.includes(foldedProduct));
            if (!matchesCar) carFail = `Car is ${product || 'blank'}; needed ${chosenList(rule, 'products', 'product').join(' or ')}`;
        }
        const checks = conditions.map((item) => {
            if (!item.header) return { pass: false, header: '', value: '', reason: `Column ${item.column} is not in the BO file` };
            const value = cellString(row[item.header]);
            const pass = conditionMatches(item.operator, row[item.header], item.values);
            return {
                pass,
                header: item.header,
                value,
                reason: pass ? '' : `${item.column} is ${value || 'blank'}; needed ${describeCondition(item)}`
            };
        });
        const pass = !carFail && (mode === 'any' ? checks.some((item) => item.pass) : checks.every((item) => item.pass));
        if (!pass) {
            excludedCount += 1;
            if (excludedSample.length < 8 && !seenExcluded.has(boNumber)) {
                seenExcluded.add(boNumber);
                const failed = checks.find((item) => !item.pass);
                const reason = carFail || (mode === 'any'
                    ? `None of the conditions matched. ${checks.map((item) => item.reason).filter(Boolean).join(' ')}`
                    : (failed && failed.reason) || 'Condition did not match');
                excludedSample.push({ boNumber, product, salesmanName, reason });
            }
            return;
        }
        const hits = checks.filter((item) => item.pass && item.header);
        if (matchedSample.length < 8 && !matchedSample.some((item) => item.boNumber === boNumber)) {
            matchedSample.push({
                boNumber,
                orderDate: rowOrderDate,
                product,
                salesmanName,
                incorrectValue: hits.map((item) => item.value || 'blank').join(', '),
                values: hits.map((item) => `${item.header}: ${item.value || 'blank'}`).join('; ')
            });
        }
        const personKey = `${salesmanId}\u0001${fold(salesmanName)}`;
        if (!groups.has(personKey)) groups.set(personKey, { salesmanId, salesmanName, orders: [] });
        const group = groups.get(personKey);
        if (salesmanName && salesmanName !== 'Unassigned') group.salesmanName = salesmanName;
        let order = group.orders.find((item) => item.boNumber === boNumber);
        if (!order) {
            order = {
                boNumber,
                product,
                modelYear: cellString(yearHeader ? row[yearHeader] : ''),
                orderDate: rowOrderDate,
                deadlineRaw: rowDeadline,
                incorrectValue: '',
                phone: whatsappFromRow(row),
                column: '',
                currentValue: '',
                correctValue: cellString(rule.correctValue),
                hits: []
            };
            group.orders.push(order);
        } else if (!order.phone) {
            const nextPhone = whatsappFromRow(row);
            if (nextPhone) order.phone = nextPhone;
        }
        hits.forEach((hit) => {
            if (order.hits.some((item) => item.column === hit.header)) return;
            order.hits.push({ column: hit.header, currentValue: hit.value });
        });
        order.column = order.hits.map((item) => item.column).join(', ');
        order.currentValue = order.hits.map((item) => `${item.column}: ${item.currentValue}`).join('; ');
        order.incorrectValue = order.hits.map((item) => item.currentValue || 'blank').join(', ');
    });
    const employees = Array.from(groups.values()).sort((a, b) => b.orders.length - a.orders.length || a.salesmanName.localeCompare(b.salesmanName));
    employees.forEach((person) => person.orders.forEach((order) => { delete order.hits; }));
    return {
        ok: true,
        columnMissing: missingColumns.length > 0,
        missingColumns,
        column: conditions.map((item) => item.header || item.column).join(', '),
        employees,
        employeeCount: employees.filter((item) => item.salesmanId !== 'UNASSIGNED').length,
        orderCount: employees.reduce((sum, item) => sum + item.orders.length, 0),
        headers,
        totalRows: rows.length,
        excludedCount,
        matchedSample,
        excludedSample,
        conditionText: describeRule(rule),
        mappingWarnings
    };
}

function fingerprint(employees) {
    return (employees || []).map((item) => `${item.salesmanId}:${fold(item.salesmanName)}:${item.orders.map((order) => order.boNumber).sort().join(',')}`).sort().join('|');
}

function fillMessage(template, bag) {
    return String(template || '').replace(/\{(\w+)\}/g, (all, key) => (bag[key] == null ? all : String(bag[key])));
}

function parseBoDate(value) {
    const text = cellString(value);
    const local = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (local) return new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]));
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const serial = Number(text);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
        const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
        return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    return null;
}

function formatBoDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

function shiftDateText(value, days) {
    const date = parseBoDate(value);
    if (!date || Number.isNaN(date.getTime())) return cellString(value);
    const shown = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (Number(days) || 0));
    return formatBoDate(shown);
}

function deadlineDays(rule) {
    const days = Number(rule && rule.deadlineDays);
    return [0, 1, 2, 5].includes(days) ? days : 0;
}

function deadlineDateHeader(headers, rule) {
    if (rule && rule.deadlineSource === 'fixed') return findHeader(headers, ['Order Date']);
    const named = cellString(rule && rule.deadlineColumn);
    if (named) {
        const exact = findHeader(headers, [named]);
        if (exact) return exact;
    }
    return findHeader(headers, ['Order Date']);
}

function uniqueDates(orders, days) {
    const seen = [];
    (orders || []).forEach((order) => {
        const raw = cellString(order.deadlineRaw != null ? order.deadlineRaw : '');
        if (!raw || !parseBoDate(raw)) return;
        const value = shiftDateText(raw, days);
        if (value && !seen.includes(value)) seen.push(value);
    });
    return seen;
}

function orderRecordLines(orders, rule) {
    const column = cellString(rule && rule.column) || 'Value';
    const correct = cellString(rule && rule.correctValue) || '—';
    return (orders || []).map((order) => {
        const number = cellString(order.boNumber) || 'Order number unavailable';
        const date = cellString(order.orderDate) || 'Date unavailable';
        const incorrect = cellString(order.incorrectValue) || cellString(order.currentValue) || 'blank';
        return `- Order ${number} — Order Date: ${date} — ${column}: ${incorrect} → ${correct}`;
    }).join('\n');
}

function fixedDeadline(rule, days) {
    const raw = cellString(rule && rule.deadlineDate);
    if (!raw) return [];
    const value = shiftDateText(raw, days);
    return value ? [value] : [];
}

function messageBag(rule, person, orders) {
    const days = deadlineDays(rule);
    const deadlines = rule && rule.deadlineSource === 'fixed' ? fixedDeadline(rule, days) : uniqueDates(orders, days);
    const lines = orderRecordLines(orders, rule);
    const deadlineText = deadlines.length ? `Deadline: ${deadlines.join(', ')}.` : 'No deadline date in the BO file.';
    const products = [];
    const incorrects = [];
    (orders || []).forEach((order) => {
        const name = cellString(order.product);
        const wrong = cellString(order.incorrectValue);
        if (name && !products.includes(name)) products.push(name);
        if (wrong && !incorrects.includes(wrong)) incorrects.push(wrong);
    });
    return {
        employeeName: person.salesmanName || person.name || '',
        product: products.join(', ') || rule.product || 'all cars',
        columnName: rule.column,
        incorrectValue: incorrects.join(', ') || (rule.incorrectValues || []).join(', ') || 'blank',
        correctValue: rule.correctValue || '—',
        conditionText: describeRule(rule),
        affectedOrderCount: (orders || []).length,
        orderNumber: (orders || []).map((order) => cellString(order.boNumber) || 'Order number unavailable').join('\n'),
        orderDate: (orders || []).map((order) => cellString(order.orderDate) || 'Date unavailable').join('\n'),
        deadline: deadlines.join(', ') || 'No deadline date',
        orderLines: lines,
        orderDateLine: lines ? `\n${deadlineText}\n${lines}` : `\n${deadlineText}`
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
        const conditions = ruleConditions(raw);
        const first = conditions[0] || { column: '', operator: 'equals', values: [] };
        const operator = first.operator;
        const incorrectValues = first.values || [];
        const products = chosenList(raw, 'products', 'product');
        const columns = conditions.map((item) => item.column);
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
            conditions,
            matchMode: raw.matchMode === 'any' ? 'any' : (raw.matchMode === 'all' ? 'all' : ruleMatchMode(raw)),
            correctValue: cellString(raw.correctValue),
            message: cellString(raw.message),
            whatsappMessage: cellString(raw.whatsappMessage),
            deadlineDays: deadlineDays(raw),
            deadlineSource: raw.deadlineSource === 'fixed' ? 'fixed' : 'column',
            deadlineColumn: raw.deadlineSource === 'fixed' ? '' : cellString(raw.deadlineColumn),
            deadlineDate: /^\d{4}-\d{2}-\d{2}$/.test(cellString(raw.deadlineDate)) ? cellString(raw.deadlineDate) : '',
            fieldMap: cleanFieldMap(raw),
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
        const conditions = ruleConditions(rule);
        if (!conditions.length) return 'Choose at least one BO column.';
        if (headers.length) {
            const missing = conditions.filter((item) => !findHeader(headers, [item.column]));
            if (missing.length === conditions.length) return `Those columns are not in the latest BO file: ${missing.map((item) => item.column).join(', ')}. The rule can be saved, but it cannot be analyzed until a column is present.`;
        }
        const missingValue = conditions.find((item) => NEEDS_VALUE.has(item.operator) && !(item.values || []).length);
        if (missingValue) return `Enter the value for ${missingValue.column}.`;
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
            employees: result.employees || [],
            matchedSample: result.matchedSample || [],
            excludedSample: result.excludedSample || [],
            excludedCount: result.excludedCount || 0,
            conditionText: result.conditionText || '',
            totalRows: result.totalRows || 0
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
    function orderSendState(state, order) {
        const cell = state && state.orders && state.orders[order.boNumber];
        if (cell && cell.status === 'completed') return { sent: true, sentAt: cell.at || state.sentAt || '' };
        const tracked = state && state.orders && Object.keys(state.orders).length;
        if (!tracked && state && state.sentAt && state.status === 'completed') return { sent: true, sentAt: state.sentAt };
        return { sent: false, sentAt: '' };
    }
    function employeeSendState(store, rule, item) {
        const state = (store.statuses && store.statuses[statusKey(rule.id, item)]) || {};
        const orders = (item.orders || []).map((order) => ({
            boNumber: order.boNumber,
            ...orderSendState(state, order)
        }));
        const sentOrders = orders.filter((order) => order.sent).length;
        let status = 'not_pushed';
        if (item.salesmanId === 'UNASSIGNED') status = 'unassigned';
        else if (orders.length && sentOrders === orders.length) status = 'sent';
        else if (sentOrders) status = 'partial';
        else if (rule.notificationStatus === 'pushed') status = 'not_sent';
        return {
            salesmanId: item.salesmanId,
            salesmanName: item.salesmanName,
            orderCount: orders.length,
            sentOrders,
            sentAt: sentOrders ? (state.sentAt || (orders.find((order) => order.sentAt) || {}).sentAt || '') : '',
            status,
            orders
        };
    }
    function sentTotals(store, rule) {
        const employees = ((rule.current && rule.current.employees) || []).filter((item) => item.salesmanId !== 'UNASSIGNED');
        let sentOrders = 0;
        let sentEmployees = 0;
        employees.forEach((item) => {
            const row = employeeSendState(store, rule, item);
            sentOrders += row.sentOrders;
            if (row.status === 'sent') sentEmployees += 1;
        });
        return { sentOrders, sentEmployees, trackedEmployees: employees.length };
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
            rules: store.rules.map((rule) => Object.assign(publicRule(rule), sentTotals(store, rule))),
            history: store.history.slice(-80).reverse(),
            whatsapp: store.whatsapp.slice(-80).reverse()
        });
    });

    app.post('/api/reserved-orders/bo-rules/test', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const table = deps.loadAnalysisTable() || { headers: [], rows: [] };
        const rule = cleanRule(req.body?.rule || {}, null);
        const problem = validate(rule, table.headers || []);
        const hard = problem && !problem.includes('cannot be analyzed');
        if (hard) return res.status(400).json({ error: problem });
        const result = analyzeTable(table, rule);
        res.json({
            ok: true,
            warning: problem || '',
            conditionText: result.conditionText,
            employeeCount: result.employeeCount,
            orderCount: result.orderCount,
            totalRows: result.totalRows,
            excludedCount: result.excludedCount,
            matchedSample: result.matchedSample,
            excludedSample: result.excludedSample,
            columnMissing: result.columnMissing,
            missingColumns: result.missingColumns,
            mappingWarnings: result.mappingWarnings || [],
            previews: (result.employees || []).filter((item) => item.salesmanId !== 'UNASSIGNED').slice(0, 8).map((person) => ({
                salesmanId: person.salesmanId,
                salesmanName: person.salesmanName,
                orders: (person.orders || []).map((order) => ({
                    boNumber: order.boNumber,
                    orderDate: order.orderDate,
                    product: order.product,
                    incorrectValue: order.incorrectValue,
                    correctValue: order.correctValue
                })),
                message: fillMessage(rule.message, messageBag(rule, person, person.orders))
            }))
        });
    });

    app.get('/api/reserved-orders/bo-rules/:id', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        res.json({
            rule,
            delivery: ((rule.current && rule.current.employees) || []).map((item) => employeeSendState(store, rule, item)),
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

    // Push a condition to chosen employees (or all) from the Report Sheet Admin
    // Notifications panel. The publication carries its audience, and the employee
    // side (my-bo-corrections) only shows the latest publication to that audience.
    app.post('/api/reserved-orders/bo-rules/:id/push-targeted', (req, res) => {
        if (!deps.requireAdmin(req, res)) return;
        const store = loadStore();
        const rule = store.rules.find((item) => item.id === req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found.' });
        if (!rule.current) applyAnalysis(store, rule, 'targeted-push', req);
        const wanted = Array.isArray(req.body?.recordIds)
            ? [...new Set(req.body.recordIds.map((id) => cellString(id)).filter(Boolean))]
            : [];
        const staff = (deps.loadStaff() || []).filter((person) => person && person.active !== false);
        const chosen = wanted.length ? staff.filter((person) => wanted.includes(person.recordId)) : [];
        const targeted = wanted.length > 0;
        if (targeted && !chosen.length) return res.status(400).json({ error: 'None of the selected employees could be found.' });
        const employees = ((rule.current && rule.current.employees) || []).filter((item) => {
            if (!item || item.salesmanId === 'UNASSIGNED') return false;
            if (!targeted) return true;
            return chosen.some((person) => String(person.id) === String(item.salesmanId) || fold(person.name) === fold(item.salesmanName));
        });
        if (!employees.length) {
            return res.status(400).json({ error: targeted
                ? 'None of the selected employees have orders matching this condition in the current Back Order file.'
                : 'No employee has orders matching this condition in the current Back Order file. Test the condition first.' });
        }
        const orderCount = employees.reduce((sum, item) => sum + (item.orders || []).length, 0);
        const audienceKey = targeted ? chosen.map((person) => person.recordId).sort().join(',') : 'all';
        const nextPrint = `${fingerprint(employees)}#${audienceKey}`;
        const last = [...store.publications].reverse().find((item) => item.ruleId === rule.id);
        if (last && last.fingerprint === nextPrint && !req.body?.confirmRepublish) {
            return res.status(409).json({ error: 'This same result was already pushed to the same employees. Confirm to publish it again.', needsConfirm: true });
        }
        const publication = {
            id: newId('pub'),
            ruleId: rule.id,
            publishedAt: new Date().toISOString(),
            employeeCount: employees.length,
            orderCount,
            fingerprint: nextPrint,
            employees,
            audience: targeted
                ? { mode: 'selected', recordIds: chosen.map((person) => person.recordId) }
                : { mode: 'all', recordIds: [] }
        };
        store.publications.push(publication);
        rule.notificationStatus = 'pushed';
        employees.forEach((item) => {
            const key = statusKey(rule.id, item);
            if (!store.statuses[key]) store.statuses[key] = { status: 'new', at: publication.publishedAt, orders: {} };
        });
        saveStore(store);
        const audienceText = targeted ? chosen.map((person) => person.name).join(', ') : 'all employees';
        deps.audit(req, { user: 'Admin', role: 'admin', action: 'BO_ALERT_PUBLISHED', entity: 'bo-rule', source: 'notifications', details: `${rule.name} to ${employees.length} employee(s) / ${orderCount} order(s) · ${audienceText}` });
        res.json({ ok: true, publicationId: publication.id, employeeCount: employees.length, orderCount, audience: audienceText, rule: publicRule(rule) });
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
        const table = typeof deps.loadAnalysisTable === 'function' ? (deps.loadAnalysisTable() || {}) : {};
        const phoneMaps = new Map();
        function phonesFor(orderHeader) {
            if (!orderHeader) return new Map();
            if (phoneMaps.has(orderHeader)) return phoneMaps.get(orderHeader);
            const map = new Map();
            (table.rows || []).forEach((row) => {
                const number = cellString(row[orderHeader]);
                const value = whatsappFromRow(row);
                if (number && value && !map.has(number)) map.set(number, value);
            });
            phoneMaps.set(orderHeader, map);
            return map;
        }
        const latestByRule = new Map();
        store.publications.forEach((publication) => { latestByRule.set(publication.ruleId, publication); });
        const cards = [];
        store.publications.forEach((publication) => {
            if (latestByRule.get(publication.ruleId) !== publication) return;
            const rule = store.rules.find((item) => item.id === publication.ruleId);
            if (!rule || rule.archived) return;
            const targeted = publication.audience && publication.audience.mode === 'selected';
            if (targeted && !(publication.audience.recordIds || []).includes(user.recordId)) return;
            const latest = rule.current && rule.current.employees;
            const mine = targeted
                ? ((publication.employees || []).find((item) => employeeCanSee(user, item)) || (latest || []).find((item) => employeeCanSee(user, item)))
                : (latest || publication.employees || []).find((item) => employeeCanSee(user, item));
            if (!mine) return;
            const orderHeader = mappedHeader(table.headers, rule.fieldMap && rule.fieldMap.orderNumber, ['Back Order Number', 'BO Number', 'Order Number']);
            const phones = phonesFor(orderHeader);
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
                    status: (state.orders && state.orders[order.boNumber] && state.orders[order.boNumber].status) || 'new',
                    at: (state.orders && state.orders[order.boNumber] && state.orders[order.boNumber].at) || '',
                    phone: phones.get(cellString(order.boNumber)) || order.phone || ''
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
        if (!state.orders) state.orders = {};
        const now = new Date().toISOString();
        const boNumber = cellString(req.body?.boNumber);
        if (boNumber) {
            if (!mine.orders.some((order) => order.boNumber === boNumber)) return res.status(403).json({ error: 'That order is not in your list.' });
            state.orders[boNumber] = { status: 'completed', at: now };
        } else {
            mine.orders.forEach((order) => {
                state.orders[order.boNumber] = { status: 'completed', at: now };
            });
        }
        const allDone = mine.orders.every((order) => state.orders[order.boNumber] && state.orders[order.boNumber].status === 'completed');
        state.sentAt = now;
        state.sentMessage = cellString(req.body?.message);
        state.status = allDone ? 'completed' : 'in_progress';
        state.at = now;
        store.statuses[key] = state;
        saveStore(store);
        deps.audit(req, { user: user.name, employeeNumber: user.employeeNumber, recordId: user.recordId, role: 'employee', action: 'BO_MESSAGE_SENT', entity: 'bo-rule', source: 'employee', details: `${rule.name} · ${mine.orders.length} orders`, newValue: 'sent' });
        res.json({ ok: true, sentAt: now });
    });

    return { reanalyzeActive, analyzeTable };
}

module.exports = { attachBoErrorRules, analyzeTable, cellString, conditionMatches, messageBag, fillMessage };
