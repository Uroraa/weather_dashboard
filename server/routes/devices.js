const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/auth');

// Get all devices (Public read allowed for v1 dashboard)
router.get('/', optionalAuthenticateToken, async (req, res) => {
    try {
        let devicesRes;
        if (req.user && req.user.role === 'admin') {
            devicesRes = await db.query(`
                SELECT d.*, u.name as owner_name, 
                       (SELECT timestamp FROM readings WHERE device_id = d.id ORDER BY timestamp DESC LIMIT 1) as last_reading
                FROM devices d 
                JOIN users u ON d.owner_user_id = u.id 
                ORDER BY d.created_at DESC
            `);
        } else if (req.user) {
            devicesRes = await db.query(`
                SELECT d.*, 
                       (SELECT timestamp FROM readings WHERE device_id = d.id ORDER BY timestamp DESC LIMIT 1) as last_reading
                FROM devices d 
                WHERE owner_user_id = $1 ORDER BY created_at DESC
            `, [req.user.id]);
        } else {
            devicesRes = await db.query(`
                SELECT d.*, 
                       (SELECT timestamp FROM readings WHERE device_id = d.id ORDER BY timestamp DESC LIMIT 1) as last_reading
                FROM devices d ORDER BY created_at DESC
            `);
        }
        res.json(devicesRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a specific device
router.get('/:id', optionalAuthenticateToken, async (req, res) => {
    try {
        const deviceRes = await db.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
        const device = deviceRes.rows[0];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        res.json(device);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a new device
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Device name is required' });

        const apiKey = uuidv4();
        await db.query(
            `INSERT INTO devices (name, description, owner_user_id, api_key) 
             VALUES ($1, $2, $3, $4)`,
            [name, description || '', req.user.id, apiKey]
        );

        res.status(201).json({ message: 'Device created successfully', api_key: apiKey });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update device thresholds & email notify setting
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { temp_high, temp_low, hum_high, hum_low, notify_email } = req.body;
        const deviceRes = await db.query('SELECT owner_user_id FROM devices WHERE id = $1', [req.params.id]);
        const device = deviceRes.rows[0];
        
        if (!device) return res.status(404).json({ error: 'Device not found' });

        if (req.user.role !== 'admin' && device.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.query(
            `UPDATE devices SET temp_high = $1, temp_low = $2, hum_high = $3, hum_low = $4, notify_email = $5 WHERE id = $6`,
            [temp_high, temp_low, hum_high, hum_low, notify_email ? true : false, req.params.id]
        );

        res.json({ message: 'Device updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a device
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const deviceRes = await db.query('SELECT owner_user_id FROM devices WHERE id = $1', [req.params.id]);
        const device = deviceRes.rows[0];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        if (req.user.role !== 'admin' && device.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
        res.json({ message: 'Device deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Data Endpoints for Frontend (Reading data per device) ---

// Get last 30 readings for a device
router.get('/:id/readings', optionalAuthenticateToken, async (req, res) => {
    try {
        const deviceId = req.params.id;
        const limit = parseInt(req.query.limit) || 30;

        const deviceRes = await db.query('SELECT id FROM devices WHERE id = $1', [deviceId]);
        const device = deviceRes.rows[0];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const recentReadingsRes = await db.query(`
            SELECT * FROM (
                SELECT * FROM readings WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2
            ) sub ORDER BY timestamp ASC
        `, [deviceId, limit]);

        res.json(recentReadingsRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get summary/stats for a device (last 24h)
router.get('/:id/summary', optionalAuthenticateToken, async (req, res) => {
    try {
        const deviceId = req.params.id;
        
        const deviceRes = await db.query('SELECT id FROM devices WHERE id = $1', [deviceId]);
        const device = deviceRes.rows[0];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const last24hObj = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        const statsRes = await db.query(`
            SELECT 
                MIN(temperature) as min_temp, MAX(temperature) as max_temp, AVG(temperature) as avg_temp,
                MIN(humidity) as min_hum, MAX(humidity) as max_hum, AVG(humidity) as avg_hum
            FROM readings 
            WHERE device_id = $1 AND timestamp >= $2
        `, [deviceId, last24hObj]);

        const latestRes = await db.query(`
            SELECT temperature, humidity, timestamp 
            FROM readings 
            WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1
        `, [deviceId]);

        res.json({ latest: latestRes.rows[0], stats: statsRes.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
