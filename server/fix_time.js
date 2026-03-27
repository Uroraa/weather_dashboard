require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    user: 'postgres',
    password: '*Hs123456',
    host: 'localhost',
    port: 5432,
    database: 'weather_dashboard',
});

async function fixTime() {
    try {
        await client.connect();
        await client.query(`ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE USING created_at AT TIME ZONE 'UTC'`);
        await client.query(`ALTER TABLE devices ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE USING created_at AT TIME ZONE 'UTC'`);
        await client.query(`ALTER TABLE readings ALTER COLUMN timestamp TYPE TIMESTAMP WITH TIME ZONE USING timestamp AT TIME ZONE 'UTC'`);
        await client.query(`ALTER TABLE alerts ALTER COLUMN timestamp TYPE TIMESTAMP WITH TIME ZONE USING timestamp AT TIME ZONE 'UTC'`);
        await client.query(`ALTER TABLE alerts ALTER COLUMN acknowledged_at TYPE TIMESTAMP WITH TIME ZONE USING acknowledged_at AT TIME ZONE 'UTC'`);
        console.log('Successfully altered columns to TIMESTAMPTZ');
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
fixTime();
