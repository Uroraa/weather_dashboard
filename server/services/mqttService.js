const { Aedes } = require('aedes')
const net = require('net')
const db  = require('../models/db')
const { v4: uuidv4 } = require('uuid')

let _aedes = null
const pendingDevices = new Map() // mac_address -> { mac_address, firmware_version, chip_model, seen_at }

function publishDeviceConfig(mac, deviceId, apiKey) {
    if (!_aedes) return
    _aedes.publish({
        topic:   `devices/${mac}/config`,
        payload: Buffer.from(JSON.stringify({ device_id: deviceId, api_key: apiKey })),
        qos:     1,
        retain:  true,
    }, () => {})
}

function getPendingDevices() {
    return Array.from(pendingDevices.values())
}

function removePendingDevice(mac) {
    pendingDevices.delete(mac)
}

function addPendingDevice(mac, firmwareVersion, chipModel) {
    if (!pendingDevices.has(mac)) {
        pendingDevices.set(mac, {
            mac_address:      mac,
            firmware_version: firmwareVersion || null,
            chip_model:       chipModel || null,
            seen_at:          new Date().toISOString(),
        })
    }
}

async function initMqtt(io, alertService, PORT = 1883) {
    _aedes = await Aedes.createBroker()
    const aedes = _aedes
    const server = net.createServer(aedes.handle)

    server.listen(PORT, function () {
        console.log(`[MQTT] Aedes broker started on port ${PORT}`)
    })

    // ============================================================
    // AUTHENTICATE — xác thực ESP32 khi kết nối
    // username = device_id, password = api_key
    // Ngoại lệ: client có id bắt đầu bằng "provision-" được connect
    // không cần auth để thực hiện đăng ký lần đầu
    // ============================================================
    aedes.authenticate = async (client, username, password, callback) => {
        // Cho phép provision client kết nối không cần auth
        if (client.id && client.id.startsWith('provision-')) {
            return callback(null, true)
        }

        try {
            const deviceId = parseInt(username)
            const apiKey   = password?.toString()

            if (!deviceId || !apiKey) {
                console.log(`[MQTT Auth] Thiếu credentials: clientId=${client.id}`)
                return callback(null, false)
            }

            const result = await db.query(
                'SELECT id FROM devices WHERE id = $1 AND api_key = $2',
                [deviceId, apiKey]
            )

            if (result.rows.length > 0) {
                client.deviceId = deviceId  // gắn vào client để dùng trong publish
                console.log(`[MQTT Auth] Xác thực thành công: device_id=${deviceId}`)
                return callback(null, true)
            }

            // api_key wrong or device deleted — check if device even exists
            const deviceExist = await db.query('SELECT id FROM devices WHERE id = $1', [deviceId])
            if (deviceExist.rows.length === 0) {
                // Device was deleted — allow connection so ESP32 can subscribe to its
                // config topic and receive new credentials when the user re-registers it
                const macMatch = client.id?.match(/^ESP32-(.+)$/)
                if (macMatch) {
                    client.needsReprovision = true
                    client.reprovisionMac   = macMatch[1]
                    console.log(`[MQTT Auth] Device deleted — allow re-provision: mac=${macMatch[1]}`)
                    return callback(null, true)
                }
            }

            console.log(`[MQTT Auth] Sai credentials: device_id=${deviceId}`)
            callback(null, false)
        } catch (err) {
            console.error('[MQTT Auth] Lỗi:', err)
            callback(err, false)
        }
    }

    // ============================================================
    // PROVISIONING — ESP32 gửi MAC lên devices/register
    // Nếu đã đăng ký: gửi lại config. Nếu mới: thêm vào pending,
    // chờ user xác nhận qua UI trước khi tạo device trong DB.
    // ============================================================
    aedes.subscribe('devices/register', async (packet, cb) => {
        cb()
        try {
            const payload = JSON.parse(packet.payload.toString())
            const { mac_address, firmware_version, chip_model } = payload

            if (!mac_address) return

            const existing = await db.query(
                'SELECT id, api_key FROM devices WHERE mac_address = $1',
                [mac_address]
            )

            if (existing.rows.length > 0) {
                // Already registered — resend config (handles ESP32 reconnect after flash wipe)
                const { id: deviceId, api_key: apiKey } = existing.rows[0]
                console.log(`[Provision] Device đã tồn tại: id=${deviceId} mac=${mac_address}`)
                publishDeviceConfig(mac_address, deviceId, apiKey)
            } else {
                // New device — add to pending, wait for user to register via UI
                pendingDevices.set(mac_address, {
                    mac_address,
                    firmware_version: firmware_version || null,
                    chip_model:       chip_model || null,
                    seen_at:          new Date().toISOString(),
                })
                console.log(`[Provision] Device pending (chờ đăng ký): mac=${mac_address}`)
            }

        } catch (err) {
            console.error('[Provision] Lỗi:', err)
        }
    })

    // ============================================================
    // CLIENT EVENTS
    // ============================================================
    aedes.on('client', (client) => {
        console.log(`[MQTT] Connected: ${client?.id}`)
        if (client.needsReprovision && client.reprovisionMac) {
            addPendingDevice(client.reprovisionMac, null, null)
            console.log(`[MQTT] Re-provision pending: mac=${client.reprovisionMac}`)
        } else if (client.deviceId) {
            // Clear retained config so the firmware callback doesn't fire on future reconnects
            const macMatch = client.id?.match(/^ESP32-(.+)$/)
            if (macMatch) {
                _aedes.publish({
                    topic:   `devices/${macMatch[1]}/config`,
                    payload: Buffer.from(''),
                    qos:     0,
                    retain:  true,
                }, () => {})
                console.log(`[MQTT] Cleared retained config: mac=${macMatch[1]}`)
            }
        }
    })

    aedes.on('clientDisconnect', (client) => {
        console.log(`[MQTT] Disconnected: ${client?.id}`)
    })

    aedes.on('clientError', (client, err) => {
        console.log(`[MQTT] Auth error client=${client?.id}: ${err.message}`)
    })

    // ============================================================
    // PUBLISH — nhận data từ ESP32 đã xác thực
    // Topic: device/{api_key}/data (giữ nguyên format cũ)
    // ============================================================
    aedes.on('publish', async function (packet, client) {
        if (!client) return

        const topic      = packet.topic
        const payloadStr = packet.payload.toString()
        const topicParts = topic.split('/')

        // Bỏ qua topic nội bộ
        if (topic.startsWith('$SYS') || topic === 'devices/register') return

        if (topicParts.length === 3 && topicParts[0] === 'device' && topicParts[2] === 'data') {
            const apiKey = topicParts[1]

            try {
                const deviceRes = await db.query(`
                    SELECT d.*, u.email as owner_email
                    FROM devices d
                    JOIN users u ON d.owner_user_id = u.id
                    WHERE d.api_key = $1
                `, [apiKey])

                const device = deviceRes.rows[0]
                if (!device) {
                    console.log(`[MQTT] Invalid API KEY: ${apiKey}`)
                    return
                }

                let data
                try {
                    data = JSON.parse(payloadStr)
                } catch (e) {
                    console.log(`[MQTT] Invalid JSON from ${apiKey}`)
                    return
                }

                const { temperature, humidity } = data
                if (temperature === undefined || humidity === undefined) return

                const time = new Date().toISOString()

                await db.query(
                    'INSERT INTO readings (device_id, temperature, humidity, timestamp) VALUES ($1, $2, $3, $4)',
                    [device.id, temperature, humidity, time]
                )

                const newReading = {
                    device_id:   device.id,
                    temperature,
                    humidity,
                    timestamp:   time,
                    source:      'sensor'
                }

                if (alertService) await alertService.processReading(device, newReading, io)

                if (io) {
                    io.to(`device_${device.id}`).emit('new_reading', newReading)
                    io.to(`user_${device.owner_user_id}`).emit('new_reading', newReading)
                }

                console.log(`[MQTT] ${device.name}: T=${temperature}, H=${humidity}`)

            } catch (err) {
                console.error('[MQTT] Error processing publish:', err)
            }
        }
    })

    return aedes
}

module.exports = { initMqtt, publishDeviceConfig, getPendingDevices, addPendingDevice, removePendingDevice }