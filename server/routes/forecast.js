const express  = require('express')
const router   = express.Router()
const fetch    = require('node-fetch')
const { getForecast } = require('../services/forecastService')
const { authenticateToken: authMiddleware } = require('../middleware/auth')

const SPATIAL_URL = process.env.SPATIAL_URL || 'http://localhost:8001'

// GET /api/forecast?device_id=1
router.get('/', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.query.device_id || null
    const horizon  = req.query.horizon || '6min'
    const data     = await getForecast(deviceId, horizon)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/forecast/spatial — proxy to FastAPI spatial forecast service
router.get('/spatial', authMiddleware, async (req, res) => {
  try {
    const r = await fetch(`${SPATIAL_URL}/spatial-forecast`)
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json(data)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'Spatial forecast service unavailable' })
  }
})

module.exports = router