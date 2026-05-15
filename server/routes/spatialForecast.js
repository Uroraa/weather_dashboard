const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { authenticateToken } = require('../middleware/auth');

const SPATIAL_URL = process.env.SPATIAL_URL || 'http://localhost:8001';

router.get('/', authenticateToken, async (req, res) => {
    try {
        const roomId = req.query.room_id;
        if (!roomId) {
            return res.status(400).json({ error: 'room_id is required' });
        }
        const r = await fetch(`${SPATIAL_URL}/spatial-forecast?room_id=${roomId}`);
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json(data);
        res.json(data);
    } catch {
        res.status(503).json({ error: 'Spatial forecast service unavailable' });
    }
});

module.exports = router;
