const fetch = require('node-fetch')

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000'

async function getForecast(deviceId = null, horizon = '6min') {
  let url = `${FASTAPI_URL}/forecast?horizon=${horizon}`
  if (deviceId) url += `&device_id=${deviceId}`

  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || 'FastAPI error')
  }
  return res.json()
}

module.exports = { getForecast }