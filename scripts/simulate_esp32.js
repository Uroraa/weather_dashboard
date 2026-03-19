const http = require('http');

// Configuration
const HOST = 'localhost';
const PORT = 3000;
// Note: You must retrieve this key from the database or the web UI after seeding it
const API_KEY = process.argv[2] || 'PLEASE_PROVIDE_API_KEY_AS_ARG';
const INTERVAL_MS = 2000;

console.log(`Starting ESP32 Simulator...`);
console.log(`Targeting: http://${HOST}:${PORT}/api/data`);
console.log(`Using API Key: ${API_KEY}`);
console.log('Sending data every 2 seconds. Press Ctrl+C to stop.\n');

if (API_KEY === 'PLEASE_PROVIDE_API_KEY_AS_ARG') {
    console.error("❌ ERROR: You must provide your device API key as an argument.");
    console.log("Example: node scripts/simulate_esp32.js your-unique-uuid-here");
    process.exit(1);
}

// Global baseline variables to walk values naturally
let currentTemp = 24.0;
let currentHum = 50.0;

setInterval(() => {
    // Random walk simulation
    currentTemp += (Math.random() - 0.5) * 1.5; // Walk between -0.75 and 0.75
    currentHum += (Math.random() - 0.5) * 3; // Walk between -1.5 and 1.5
    
    // Bounds check to force an alert randomly over time
    // If temp goes above 30, limit it there for a bit
    if (currentTemp > 35) currentTemp = 34;
    if (currentTemp < 10) currentTemp = 11;
    if (currentHum > 90) currentHum = 85;
    if (currentHum < 30) currentHum = 35;

    const payload = JSON.stringify({
        temperature: Number(currentTemp.toFixed(1)),
        humidity: Number(currentHum.toFixed(1))
    });

    const options = {
        hostname: HOST,
        port: PORT,
        path: '/api/data',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            'x-device-key': API_KEY
        }
    };

    const req = http.request(options, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
            if (res.statusCode === 201) {
                console.log(`[OK] Temp: ${currentTemp.toFixed(1)}°C, Hum: ${currentHum.toFixed(1)}%`);
            } else {
                console.error(`[ERROR] ${res.statusCode}: ${responseBody}`);
                if (res.statusCode === 401) {
                    console.error('Invalid API key or unauthorized access.');
                    process.exit(1);
                }
            }
        });
    });

    req.on('error', (error) => {
        console.error(`[NETWORK ERROR] Could not connect to server: ${error.message}`);
    });

    req.write(payload);
    req.end();
}, INTERVAL_MS);
