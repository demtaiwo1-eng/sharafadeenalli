const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } });
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "001_initial.sql"), "utf8");
    await pool.query(sql);
    console.log("CampTech database migration completed");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();