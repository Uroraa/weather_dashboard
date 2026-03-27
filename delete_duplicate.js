const { Client } = require('pg');
const client = new Client({
    user: 'postgres',
    password: '*Hs123456',
    host: 'localhost',
    port: 5432,
    database: 'weather_dashboard',
});
async function fix() {
    try {
        await client.connect();
        const res = await client.query("DELETE FROM users WHERE email = 'admin@example.com' AND role = 'admin' RETURNING id");
        console.log('Successfully deleted rogue admin IDs:', res.rows.map(r => r.id));
        await client.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fix();
