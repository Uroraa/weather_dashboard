const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { authenticateToken } = require('../middleware/auth');

// Get all alerts for current user's devices
router.get('/', authenticateToken, async (req, res) => {
    try {
        let alertsRes;
        if (req.user.role === 'admin') {
            alertsRes = await db.query(`
                SELECT a.*, d.name as device_name 
                FROM alerts a 
                JOIN devices d ON a.device_id = d.id 
                ORDER BY a.timestamp DESC LIMIT 100
            `);
        } else {
            alertsRes = await db.query(`
                SELECT a.*, d.name as device_name 
                FROM alerts a 
                JOIN devices d ON a.device_id = d.id 
                WHERE d.owner_user_id = $1 
                ORDER BY a.timestamp DESC LIMIT 50
            `, [req.user.id]);
        }
        res.json(alertsRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get alerts for a specific device
router.get('/device/:id', authenticateToken, async (req, res) => {
    try {
        const deviceRes = await db.query('SELECT owner_user_id FROM devices WHERE id = $1', [req.params.id]);
        const device = deviceRes.rows[0];
        if (!device) return res.status(404).json({ error: 'Device not found' });
        
        if (req.user.role !== 'admin' && device.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const alertsRes = await db.query('SELECT * FROM alerts WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 50', [req.params.id]);
        res.json(alertsRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Acknowledge an alert
router.put('/:id/acknowledge', authenticateToken, async (req, res) => {
    try {
        const alertRes = await db.query(`
            SELECT a.id, d.owner_user_id 
            FROM alerts a 
            JOIN devices d ON a.device_id = d.id 
            WHERE a.id = $1
        `, [req.params.id]);

        const alert = alertRes.rows[0];
        if (!alert) return res.status(404).json({ error: 'Alert not found' });
        
        if (req.user.role !== 'admin' && alert.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.query(
            'UPDATE alerts SET acknowledged_by = $1, acknowledged_at = $2 WHERE id = $3',
            [req.user.id, new Date().toISOString(), req.params.id]
        );

        res.json({ message: 'Alert acknowledged' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
