const { Pool } = require("pg");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } });
(async () => {
  try {
    const result = await pool.query(
      "SELECT to_regclass('public.public_updates') AS updates_table, to_regclass('public.projects') AS projects_table"
    );
    if (result.rows[0].updates_table && result.rows[0].projects_table) {
      console.log("CampTech database schema is already provisioned");
      return;
    }
    throw new Error("Initial schema is not provisioned. Apply migrations/001_initial.sql using the database owner before starting the API.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
