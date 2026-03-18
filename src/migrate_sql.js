require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./db");

async function run() {
  const dir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT NOW()
     )`
  );

  for (const f of files) {
    const exists = await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [f]);
    if (exists.rowCount) continue;

    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`Applying: ${f}`);
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }

  console.log("Migrations complete.");
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
