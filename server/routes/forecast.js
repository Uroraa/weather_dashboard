const express  = require('express')
const router   = express.Router()
const { getForecast } = require('../services/forecastService')
const { authenticateToken: authMiddleware } = require('../middleware/auth')

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

module.exports = router