const fs = require('fs');
const path = require('path');
const { BoOrderLookup } = require('./scripts/bo-order-lookup');

function boBrand(value) {
    return String(value || '').toLowerCase() === 'lexus' ? 'lexus' : 'toyota';
}

function sanitizeHeaderName(value, index) {
    const cleaned = String(value ?? '').trim();
    return cleaned || `Column_${index + 1}`;
}

function detectHeaderRowIndex(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return 0;
    const keywordPatterns = [/order/i, /back\s*order/i, /date/i, /product/i, /suffix/i, /dealer/i, /customer/i];
    let bestIdx = 0;
    let bestScore = -1;
    const scanLimit = Math.min(grid.length, 40);
    for (let i = 0; i < scanLimit; i++) {
        const row = Array.isArray(grid[i]) ? grid[i] : [];
        const cells = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
        if (!cells.length) continue;
        const keywordHits = cells.reduce((acc, cell) => acc + (keywordPatterns.some((pattern) => pattern.test(cell)) ? 1 : 0), 0);
        const score = keywordHits * 10 + cells.length;
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function parseSheetWithDetectedHeader(XLSX, worksheet) {
    const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!grid.length) return { headers: [], rows: [] };
    const headerRowIndex = detectHeaderRowIndex(grid);
    const rawHeaders = (grid[headerRowIndex] || []).map((header, idx) => sanitizeHeaderName(header, idx));
    const includedIndexes = rawHeaders
        .map((header, idx) => ({ header, idx }))
        .filter(({ header, idx }) => {
            if (!header || /^Column_\d+$/i.test(header)) return false;
            for (let r = headerRowIndex + 1; r < grid.length; r++) {
                if (String((grid[r] || [])[idx] ?? '').trim()) return true;
            }
            return false;
        })
        .map(({ idx }) => idx);
    const headers = includedIndexes.map((idx) => rawHeaders[idx]);
    const rows = [];
    for (let r = headerRowIndex + 1; r < grid.length; r++) {
        const rowArray = grid[r] || [];
        const rowObj = {};
        let hasValue = false;
        includedIndexes.forEach((colIdx, pos) => {
            const value = rowArray[colIdx] ?? '';
            rowObj[headers[pos]] = value;
            if (String(value).trim() !== '') hasValue = true;
        });
        if (hasValue) rows.push(rowObj);
    }
    return { headers, rows };
}

function payloadFromWorkbook(XLSX, workbook, filename, fallbackName) {
    if (!workbook.SheetNames || !workbook.SheetNames.length) {
        const error = new Error('Excel file has no sheets');
        error.status = 400;
        throw error;
    }
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
        const error = new Error('First sheet is empty or unreadable');
        error.status = 400;
        throw error;
    }
    const parsedSheet = parseSheetWithDetectedHeader(XLSX, worksheet);
    const rows = (parsedSheet.rows || []).map((row) => ({ ...row, __sourceSheet: sheetName }));
    const headersSet = new Set();
    rows.forEach((row) => Object.keys(row).forEach((key) => headersSet.add(key)));
    return {
        payload: {
            uploadedAt: new Date().toISOString(),
            filename: filename || fallbackName,
            sheetName,
            sheets: [{ sheetName, rowCount: rows.length }],
            headers: Array.from(headersSet),
            rowCount: rows.length,
            rows
        },
        skippedSheets: workbook.SheetNames.slice(1)
    };
}

function attachBoDataApi(app, options) {
    const XLSX = options.XLSX;
    const express = options.express;
    const dir = options.dir;
    fs.mkdirSync(dir, { recursive: true });
    const password = String(options.password || '1234');
    const toyotaFile = path.join(dir, 'bo-data.json');
    const lexusFile = path.join(dir, 'bo-data-lexus.json');
    const statsFile = path.join(dir, 'bo-lookup-stats.json');

    function dataPath(brand) {
        return boBrand(brand) === 'lexus' ? lexusFile : toyotaFile;
    }
    function readData(brand) {
        const file = dataPath(brand);
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    function accepted(req) {
        const given = req.body?.password || req.query?.password || req.get('x-bo-password') || '';
        return String(given) === password;
    }
    function localDateKey() {
        return new Date().toLocaleDateString('en-CA');
    }
    function recordSearch(orderNumber) {
        const key = String(orderNumber ?? '').trim();
        if (!key) return;
        const today = localDateKey();
        let stats = { date: today, orderCounts: {} };
        try {
            if (fs.existsSync(statsFile)) {
                const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                if (raw && raw.date === today && raw.orderCounts && typeof raw.orderCounts === 'object') {
                    stats = { date: today, orderCounts: { ...raw.orderCounts } };
                }
            }
        } catch { /* start fresh */ }
        if (stats.date !== today) stats = { date: today, orderCounts: {} };
        stats.orderCounts[key] = (stats.orderCounts[key] || 0) + 1;
        try { fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2), 'utf8'); } catch (error) {
            console.error('Failed to write BO lookup stats:', error);
        }
    }

    app.post('/api/bo-data/upload', express.raw({ limit: '80mb', type: ['application/octet-stream', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] }), (req, res) => {
        try {
            if (!accepted(req)) return res.status(401).json({ error: 'Unauthorized: Invalid password' });
            const brand = boBrand(req.query?.brand || req.body?.brand);
            const headerName = req.get('x-filename');
            let filename = '';
            try { filename = decodeURIComponent(String(headerName || req.body?.filename || '')); } catch { filename = String(req.body?.filename || ''); }
            let buffer = null;
            if (Buffer.isBuffer(req.body) && req.body.length) buffer = req.body;
            else if (req.body && req.body.fileData) {
                const raw = String(req.body.fileData);
                buffer = Buffer.from(raw.startsWith('data:') ? raw.split(',')[1] : raw, 'base64');
            }
            if (!buffer || !buffer.length) return res.status(400).json({ error: 'BO Excel file is required' });
            const parsed = payloadFromWorkbook(XLSX, XLSX.read(buffer, { type: 'buffer' }), filename, brand === 'lexus' ? 'lexus-bo.xlsx' : 'bo-data.xlsx');
            fs.writeFileSync(dataPath(brand), JSON.stringify(parsed.payload, null, 2), 'utf8');
            if (brand !== 'lexus' && typeof options.onToyotaUploaded === 'function') {
                try { options.onToyotaUploaded(req); } catch (error) {
                    console.error('BO error rules were not re-analyzed:', error.message);
                }
            }
            const label = brand === 'lexus' ? 'Lexus BO' : 'BO';
            res.json({
                success: true,
                brand,
                message: `${label} data uploaded: first sheet "${parsed.payload.sheetName}", ${parsed.payload.rowCount} rows.`,
                meta: {
                    filename: parsed.payload.filename,
                    sheetName: parsed.payload.sheetName,
                    sheets: parsed.payload.sheets,
                    rowCount: parsed.payload.rowCount,
                    uploadedAt: parsed.payload.uploadedAt,
                    mergedSheets: [parsed.payload.sheetName],
                    skippedSheets: parsed.skippedSheets
                }
            });
        } catch (error) {
            console.error('Error uploading BO data Excel:', error);
            res.status(error.status || 500).json({ error: 'Failed to upload BO data: ' + error.message });
        }
    });

    app.get('/api/bo-data/meta', (req, res) => {
        try {
            const data = readData(req.query?.brand);
            if (!data) return res.json({ exists: false, brand: boBrand(req.query?.brand) });
            res.json({
                exists: true,
                filename: data.filename || '',
                sheetName: data.sheetName || '',
                sheets: data.sheets || [],
                rowCount: data.rowCount || 0,
                uploadedAt: data.uploadedAt || ''
            });
        } catch (error) {
            console.error('Error reading BO data meta:', error);
            res.status(500).json({ error: 'Failed to read BO data meta' });
        }
    });

    app.get('/api/bo-data/preview', (req, res) => {
        try {
            const data = readData(req.query?.brand);
            if (!data) return res.status(404).json({ error: boBrand(req.query?.brand) === 'lexus' ? 'No Lexus BO data uploaded yet' : 'No BO data uploaded yet' });
            const rows = Array.isArray(data.rows) ? data.rows : [];
            const headers = Array.isArray(data.headers) ? data.headers : [];
            const requestedLimit = parseInt(req.query.limit, 10);
            const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 200;
            const previewRows = rows.slice(0, limit);
            res.json({
                filename: data.filename || '',
                sheetName: data.sheetName || '',
                rowCount: rows.length,
                headers,
                previewCount: previewRows.length,
                rows: previewRows
            });
        } catch (error) {
            console.error('Error reading BO data preview:', error);
            res.status(500).json({ error: 'Failed to read BO data preview' });
        }
    });

    app.get('/api/bo-data/taxonomy', (req, res) => {
        try {
            const data = readData('toyota');
            if (!data) return res.status(404).json({ error: 'No BO data uploaded yet' });
            res.json(BoOrderLookup.fromBoData(data).buildTaxonomy({
                uploadedAt: data.uploadedAt,
                filename: data.filename,
                sheetName: data.sheetName
            }));
        } catch (error) {
            console.error('Error building BO taxonomy:', error);
            res.status(500).json({ error: 'Failed to build BO taxonomy: ' + error.message });
        }
    });

    app.get('/api/bo-data/order/:orderNumber', (req, res) => {
        try {
            const data = readData('toyota');
            if (!data) return res.status(404).json({ error: 'No BO data uploaded yet' });
            const orderNumber = String(req.params.orderNumber || '').trim();
            if (!orderNumber) return res.status(400).json({ error: 'Order number is required' });
            const result = BoOrderLookup.fromBoData(data).lookupOrder(orderNumber);
            if (!result) return res.status(404).json({ error: 'Order number not found' });
            recordSearch(orderNumber);
            res.json({
                ...result,
                source: {
                    filename: data.filename || '',
                    sheetName: data.sheetName || '',
                    sheets: data.sheets || [],
                    uploadedAt: data.uploadedAt || ''
                }
            });
        } catch (error) {
            console.error('Error looking up BO order:', error);
            res.status(500).json({ error: 'Failed to lookup order: ' + error.message });
        }
    });

    app.get('/api/bo-data/admin-stats', (req, res) => {
        try {
            if (!accepted(req)) return res.status(401).json({ error: 'Unauthorized: Invalid password' });
            const today = localDateKey();
            let searchesToday = [];
            try {
                if (fs.existsSync(statsFile)) {
                    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                    if (stats && stats.date === today && stats.orderCounts && typeof stats.orderCounts === 'object') {
                        searchesToday = Object.entries(stats.orderCounts)
                            .map(([orderNumber, count]) => ({ orderNumber, count: Number(count) || 0 }))
                            .filter((item) => item.count > 0)
                            .sort((a, b) => b.count - a.count || String(a.orderNumber).localeCompare(String(b.orderNumber), undefined, { numeric: true }));
                    }
                }
            } catch (error) {
                console.error('Error reading BO lookup stats:', error);
            }
            let productTotals = [];
            let totalRows = 0;
            const data = readData('toyota');
            if (data) {
                const rows = Array.isArray(data.rows) ? data.rows : [];
                const headers = Array.isArray(data.headers) ? data.headers : [];
                totalRows = rows.length;
                productTotals = BoOrderLookup.fromBoData({ rows, headers }).aggregateBoProductCounts(rows, headers);
            }
            res.json({ date: today, searchesToday, productTotals, totalRows });
        } catch (error) {
            console.error('Error building BO admin stats:', error);
            res.status(500).json({ error: 'Failed to load admin stats: ' + error.message });
        }
    });

    app.get('/api/bo-data/queue-combinations', (req, res) => {
        try {
            const data = readData(req.query?.brand);
            if (!data) return res.status(404).json({ error: boBrand(req.query?.brand) === 'lexus' ? 'No Lexus BO data uploaded yet' : 'No BO data uploaded yet' });
            res.json({
                ...BoOrderLookup.fromBoData(data).buildAllQueueCombinations(),
                source: {
                    filename: data.filename || '',
                    sheetName: data.sheetName || '',
                    uploadedAt: data.uploadedAt || ''
                }
            });
        } catch (error) {
            console.error('Error building queue combinations:', error);
            res.status(500).json({ error: 'Failed to build queue combinations: ' + error.message });
        }
    });

    app.get('/api/bo-data/new-customer-queue', (req, res) => {
        try {
            const data = readData(req.query?.brand);
            if (!data) return res.status(404).json({ error: boBrand(req.query?.brand) === 'lexus' ? 'No Lexus BO data uploaded yet' : 'No BO data uploaded yet' });
            const product = String(req.query?.product || '').trim();
            const suffix = String(req.query?.suffix || '').trim();
            const exteriorColor = String(req.query?.exteriorColor || '').trim();
            const interiorColor = String(req.query?.interiorColor || '').trim();
            if (!product || !suffix || !exteriorColor || !interiorColor) {
                return res.status(400).json({ error: 'product, suffix, exteriorColor, and interiorColor are required' });
            }
            res.json(BoOrderLookup.fromBoData(data).computeNewCustomerQueue({
                product,
                suffix,
                exteriorColor,
                interiorColor,
                orderDate: String(req.query?.orderDate || '').trim()
            }));
        } catch (error) {
            console.error('Error computing new customer queue:', error);
            res.status(500).json({ error: 'Failed to compute new customer queue: ' + error.message });
        }
    });
}

module.exports = { attachBoDataApi };
