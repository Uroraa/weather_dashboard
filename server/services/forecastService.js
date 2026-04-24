const fetch = require('node-fetch')

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000'

async function getForecast(deviceId = null) {
  const url = deviceId
    ? `${FASTAPI_URL}/forecast?device_id=${deviceId}`
    : `${FASTAPI_URL}/forecast`

  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || 'FastAPI error')
  }
  return res.json()
}

module.exports = { getForecast }