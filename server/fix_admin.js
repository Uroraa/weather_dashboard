const db = require('./models/db.js');

async function fixAdmin() {
    try {
        const res = await db.query("DELETE FROM users WHERE email = 'admin@example.com' AND role = 'admin' RETURNING id");
        console.log('Deleted rogue admin IDs:', res.rows.map(r => r.id));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

fixAdmin();
