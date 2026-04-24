const express = require('express');
const router = express.Router();
const db = require('../models/db');

// This route does not use JWT. It uses x-device-key header.
router.post('/', async (req, res) => {
    try {
        const apiKey = req.headers['x-device-key'] || req.query.api_key;
        if (!apiKey) {
            return res.status(401).json({ error: 'Unauthorized: Missing x-device-key' });
        }

        const deviceRes = await db.query(`
            SELECT d.*, u.email as owner_email 
            FROM devices d  
            JOIN users u ON d.owner_user_id = u.id
            WHERE d.api_key = $1
        `, [apiKey]);
        const device = deviceRes.rows[0];
        
        if (!device) {
            return res.status(401).json({ error: 'Unauthorized: Invalid device key' });
        }

        const { temperature, humidity, timestamp } = req.body;
        if (temperature === undefined || humidity === undefined) {
            return res.status(400).json({ error: 'Temperature and humidity required' });
        }

        const time = timestamp || new Date().toISOString();

        // 1. Insert reading into DB
        await db.query(
            'INSERT INTO readings (device_id, temperature, humidity, timestamp) VALUES ($1, $2, $3, $4)',
            [device.id, temperature, humidity, time]
        );

        const newReading = { device_id: device.id, temperature, humidity, timestamp: time, source: 'sensor' };

        // 2. Alert Generation Logic
        const io = req.app.get('io');
        const alertService = req.app.get('alertService');
        if (alertService) {
            await alertService.processReading(device, newReading, io);
        }

        // 3. Emit real-time update via Socket.io
        if (io) {
            // Emit to a room named after the device ID so only owners/admins looking at it get it
            io.to(`device_${device.id}`).emit('new_reading', newReading);
            
            // Also emit a global event for the main dashboard which might just need aggregate updates
            io.to(`user_${device.owner_user_id}`).emit('new_reading', newReading);
        }

        res.status(201).json({ message: 'Data accepted', data: newReading });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
