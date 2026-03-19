const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const requireRole = require('../middleware/role');

// Get all users (Admin only)
router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const usersRes = await db.query('SELECT id, name, email, role, created_at FROM users ORDER BY id ASC');
        res.json(usersRes.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Change user role (Admin only)
router.put('/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { role } = req.body;
        if (role !== 'admin' && role !== 'user') {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        const targetRes = await db.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
        if (!targetRes.rows[0]) return res.status(404).json({ error: 'User not found' });
        if (targetRes.rows[0].role === 'admin') {
            return res.status(403).json({ error: 'Admin accounts cannot be modified' });
        }

        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
        res.json({ message: 'User role updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete user (Admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        if (Number(req.params.id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
