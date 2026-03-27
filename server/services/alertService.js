const db = require('../models/db');
const emailService = require('./email');

// Keep track of recent alerts to throttle them (avoid spamming DB/Email every second)
const THROTTLE_MS = 60 * 1000; // 60 seconds
const recentAlertsCache = new Map(); // Key: `${device_id}_${type}` -> Value: timestamp

class AlertService {
    
    async processReading(device, reading, io) {
        const { id: device_id, name: deviceName, notify_email, owner_email } = device;
        const { temperature, humidity } = reading;

        // Check Temperature High limits
        if (device.temp_high !== null && temperature > device.temp_high) {
            await this.triggerAlert(device, 'temp_high', temperature, device.temp_high, io);
        }
        // Check Temperature Low
        if (device.temp_low !== null && temperature < device.temp_low) {
            await this.triggerAlert(device, 'temp_low', temperature, device.temp_low, io);
        }
        // Check Humidity High
        if (device.hum_high !== null && humidity > device.hum_high) {
            await this.triggerAlert(device, 'hum_high', humidity, device.hum_high, io);
        }
        // Check Humidity Low
        if (device.hum_low !== null && humidity < device.hum_low) {
            await this.triggerAlert(device, 'hum_low', humidity, device.hum_low, io);
        }
    }

    async triggerAlert(device, type, value, threshold, io) {
        const cacheKey = `${device.id}_${type}`;
        const lastAlertTime = recentAlertsCache.get(cacheKey);
        const now = Date.now();

        if (lastAlertTime && (now - lastAlertTime < THROTTLE_MS)) {
            // Throttled
            return;
        }

        recentAlertsCache.set(cacheKey, now);

        let message = '';
        if (type === 'temp_high') message = `Temperature High: ${value}°C (Threshold > ${threshold}°C)`;
        if (type === 'temp_low') message = `Temperature Low: ${value}°C (Threshold < ${threshold}°C)`;
        if (type === 'hum_high') message = `Humidity High: ${value}% (Threshold > ${threshold}%)`;
        if (type === 'hum_low') message = `Humidity Low: ${value}% (Threshold < ${threshold}%)`;

        const timestamp = new Date().toISOString();

        // Save to DB
        await db.query(
            'INSERT INTO alerts (device_id, type, value, message, timestamp) VALUES ($1, $2, $3, $4, $5)',
            [device.id, type, value, message, timestamp]
        );

        const newAlert = {
            device_id: device.id,
            device_name: device.name,
            type,
            value,
            message,
            timestamp
        };

        // Emit Socket.io Realtime Alert
        if (io) {
            io.to(`user_${device.owner_user_id}`).emit('new_alert', newAlert);
            io.to('admins').emit('new_alert', newAlert); // Send to all admins
        }

        // Send Email to Device Owner AND Admins
        const recipients = [];
        if (device.notify_email && device.owner_email) {
            recipients.push(device.owner_email);
        }

        try {
            
            for (const email of recipients) {
                await emailService.sendAlertEmail(email, device.name, type, value, threshold);
            }
        } catch(err) {
            console.error("Failed to send alert emails", err);
        }
    }
}

module.exports = new AlertService();
