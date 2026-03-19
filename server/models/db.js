const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

async function initializeDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                api_key VARCHAR(255) UNIQUE NOT NULL,
                notify_email BOOLEAN DEFAULT false,
                temp_high REAL,
                temp_low REAL,
                hum_high REAL,
                hum_low REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS readings (
                id SERIAL PRIMARY KEY,
                device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                temperature REAL NOT NULL,
                humidity REAL NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                value REAL NOT NULL,
                message TEXT NOT NULL,
                acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                acknowledged_at TIMESTAMP,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('PostgreSQL Database schema initialized.');
        await seedDatabase();
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

async function seedDatabase() {
    try {
        const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@example.com']);
        if (rows.length === 0) {
            console.log("Seeding Postgres database...");
            const adminPass = await bcrypt.hash('Admin123!', 10);
            const userPass = await bcrypt.hash('User123!', 10);

            const adminRes = await pool.query(
                `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id`,
                ['Admin', 'admin@example.com', adminPass, 'admin']
            );
            const adminId = adminRes.rows[0].id;

            const userRes = await pool.query(
                `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id`,
                ['User', 'user@example.com', userPass, 'user']
            );
            const userId = userRes.rows[0].id;

            const apiKey = uuidv4();
            const devRes = await pool.query(
                `INSERT INTO devices (name, description, owner_user_id, api_key, temp_high, temp_low, hum_high, hum_low) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                ['Office Sensor', 'ESP32 located in the main office', userId, apiKey, 30, 15, 80, 20]
            );
            const deviceId = devRes.rows[0].id;
            console.log(`[SEED] Dummy device created. API_KEY: ${apiKey}`);

            const now = new Date();
            for (let i = 30; i >= 1; i--) {
                const pastTime = new Date(now.getTime() - i * 60000);
                const temp = 20 + Math.random() * 5;
                const hum = 40 + Math.random() * 20;
                await pool.query(
                    `INSERT INTO readings (device_id, temperature, humidity, timestamp) VALUES ($1, $2, $3, $4)`,
                    [deviceId, temp.toFixed(1), hum.toFixed(1), pastTime.toISOString()]
                );
            }
            console.log("Database seeded successfully!");
        }
    } catch (err) {
        console.error('Seeding error:', err);
    }
}

initializeDb();

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
