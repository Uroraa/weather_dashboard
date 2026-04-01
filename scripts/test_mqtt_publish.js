const mqtt = require('mqtt');

// Connect to the local MQTT broker
const client = mqtt.connect('mqtt://localhost:1883');

// The dummy ESP32 API Key from the database seeder
const deviceApiKey = 'e47c65de-e907-4e86-b6de-7f7266b07943';
const topic = `device/${deviceApiKey}/data`;

client.on('connect', () => {
    console.log('Connected to MQTT broker via test script');
    
    // Create random test data
    const temp = (20 + Math.random() * 5).toFixed(1);
    const hum = (40 + Math.random() * 20).toFixed(1);
    
    const payload = JSON.stringify({ 
        temperature: parseFloat(temp), 
        humidity: parseFloat(hum) 
    });
    
    client.publish(topic, payload, () => {
        console.log(`Published to ${topic}: ${payload}`);
        client.end();
    });
});

client.on('error', (err) => {
    console.error('MQTT error:', err);
});
