const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { authenticateToken } = require('../middleware/auth');

// Get all rooms for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
    try {
        let roomsRes;
        if (req.user.role === 'admin') {
            roomsRes = await db.query(`
                SELECT r.*, u.name as owner_name 
                FROM rooms r 
                JOIN users u ON r.owner_user_id = u.id 
                ORDER BY r.created_at DESC
            `);
        } else {
            roomsRes = await db.query(`
                SELECT * FROM rooms 
                WHERE owner_user_id = $1 ORDER BY created_at DESC
            `, [req.user.id]);
        }
        res.json(roomsRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a specific room
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const roomRes = await db.query('SELECT * FROM rooms WHERE id = $1', [req.params.id]);
        const room = roomRes.rows[0];
        if (!room) return res.status(404).json({ error: 'Room not found' });

        if (req.user.role !== 'admin' && room.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(room);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a new room
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, description, center_lat, center_lng, width_m, length_m } = req.body;
        
        if (!name || center_lat == null || center_lng == null || width_m == null || length_m == null) {
            return res.status(400).json({ error: 'Name, center_lat, center_lng, width_m, and length_m are required' });
        }

        const result = await db.query(
            `INSERT INTO rooms (name, description, center_lat, center_lng, width_m, length_m, owner_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, description || '', center_lat, center_lng, width_m, length_m, req.user.id]
        );

        res.status(201).json({ message: 'Room created successfully', room: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update a room
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, description, center_lat, center_lng, width_m, length_m } = req.body;
        
        const roomRes = await db.query('SELECT owner_user_id FROM rooms WHERE id = $1', [req.params.id]);
        const room = roomRes.rows[0];

        if (!room) return res.status(404).json({ error: 'Room not found' });

        if (req.user.role !== 'admin' && room.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!name || center_lat == null || center_lng == null || width_m == null || length_m == null) {
            return res.status(400).json({ error: 'Name, center_lat, center_lng, width_m, and length_m are required' });
        }

        const result = await db.query(
            `UPDATE rooms SET name=$1, description=$2, center_lat=$3, center_lng=$4, width_m=$5, length_m=$6 WHERE id=$7 RETURNING *`,
            [name, description || '', center_lat, center_lng, width_m, length_m, req.params.id]
        );

        res.json({ message: 'Room updated successfully', room: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a room
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const roomRes = await db.query('SELECT owner_user_id FROM rooms WHERE id = $1', [req.params.id]);
        const room = roomRes.rows[0];
        
        if (!room) return res.status(404).json({ error: 'Room not found' });

        if (req.user.role !== 'admin' && room.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await db.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
        res.json({ message: 'Room deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
