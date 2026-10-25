/**
 * Lease calculator banks/cars API — shared by root server and calculator-admin.
 * Persists to admin-data.json next to this file.
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'admin-data.json');
const BACKEND_PASSWORD = '1234';

function readData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return { banks: [], cars: {} };
        }
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            banks: Array.isArray(data.banks) ? data.banks : [],
            cars: data.cars && typeof data.cars === 'object' ? data.cars : {}
        };
    } catch (e) {
        return { banks: [], cars: {} };
    }
}

function writeData(next) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), 'utf8');
}

function authenticate(req, res, next) {
    const password = req.body?.password || req.query?.password;
    if (password === BACKEND_PASSWORD) return next();
    return res.status(401).json({ error: 'Unauthorized: Invalid password' });
}

function attachLeaseCalculatorApi(app, options = {}) {
    const password = options.password || BACKEND_PASSWORD;
    const auth = (req, res, next) => {
        const value = req.body?.password || req.query?.password;
        if (value === password) return next();
        return res.status(401).json({ error: 'Unauthorized: Invalid password' });
    };

    app.get('/api/banks', (req, res) => {
        try {
            res.json(readData());
        } catch (error) {
            console.error('[lease-calculator-api] GET /api/banks', error);
            res.status(500).json({ error: 'Failed to load banks' });
        }
    });

    app.get('/api/cars', (req, res) => {
        try {
            const data = readData();
            res.json({ cars: data.cars });
        } catch (error) {
            console.error('[lease-calculator-api] GET /api/cars', error);
            res.status(500).json({ error: 'Failed to load cars' });
        }
    });

    app.post('/api/banks', auth, (req, res) => {
        try {
            if (!Array.isArray(req.body?.banks)) {
                return res.status(400).json({ error: 'banks array is required' });
            }
            const existing = readData();
            writeData({ ...existing, banks: req.body.banks });
            if (typeof options.onUpdate === 'function') options.onUpdate('banks');
            res.json({ success: true, message: 'Bank settings updated successfully' });
        } catch (error) {
            console.error('[lease-calculator-api] POST /api/banks', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    });

    app.post('/api/cars', auth, (req, res) => {
        try {
            if (!req.body?.cars || typeof req.body.cars !== 'object') {
                return res.status(400).json({ error: 'cars object is required' });
            }
            const existing = readData();
            writeData({ ...existing, cars: req.body.cars });
            if (typeof options.onUpdate === 'function') options.onUpdate('cars');
            res.json({ success: true, message: 'Car settings updated successfully' });
        } catch (error) {
            console.error('[lease-calculator-api] POST /api/cars', error);
            res.status(500).json({ error: 'Failed to save settings' });
        }
    });

    return { readData, writeData, DATA_FILE };
}

module.exports = {
    attachLeaseCalculatorApi,
    readData,
    writeData,
    DATA_FILE,
    BACKEND_PASSWORD,
    authenticate
};
