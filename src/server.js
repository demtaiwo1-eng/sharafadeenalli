const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 8080);
const adminToken = process.env.ADMIN_API_TOKEN;
const origins = (process.env.CORS_ORIGIN || "").split(",").map(v => v.trim()).filter(Boolean);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin(origin, cb) {
  if (!origin || origins.includes(origin)) return cb(null, true);
  return cb(new Error("Origin not allowed"));
}, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "64kb" }));
app.use("/v1", rateLimit({ windowMs: 60000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));

function dbRequired(req, res, next) {
  if (!pool) return res.status(503).json({ error: "database_not_configured" });
  next();
}
function adminRequired(req, res, next) {
  if (!adminToken) return res.status(503).json({ error: "admin_auth_not_configured" });
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(token), b = Buffer.from(adminToken);
  if (a.length !== b.length || !require("node:crypto").timingSafeEqual(a, b)) return res.status(401).json({ error: "unauthorized" });
  next();
}
function validUrl(value) {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol); } catch { return false; }
}

app.get("/health", async (req, res) => {
  if (!pool) return res.status(503).json({ status: "degraded", database: "not_configured" });
  try { await pool.query("SELECT 1"); res.json({ status: "ok", database: "connected" }); }
  catch { res.status(503).json({ status: "degraded", database: "unavailable" }); }
});

app.get("/v1/public/updates", dbRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const q = String(req.query.q || "").trim().slice(0, 120).replace(/[%_]/g, " ");
    const topic = String(req.query.topic || "").trim().slice(0, 80);
    const values = [];
    const where = ["status = 'published'"];
    if (q) {
      values.push("%" + q + "%");
      const n = values.length;
      where.push("(title ILIKE $" + n + " OR summary ILIKE $" + n + " OR topic ILIKE $" + n + " OR source_name ILIKE $" + n + ")");
    }
    if (topic) { values.push(topic); where.push("topic = $" + values.length); }
    values.push(limit);
    const result = await pool.query(
      "SELECT id, title, summary, topic, published_at AS \"publishedAt\", source_name AS \"sourceName\", source_url AS \"sourceUrl\", verification_status AS \"verificationStatus\" FROM public_updates WHERE " + where.join(" AND ") + " ORDER BY published_at DESC LIMIT $" + values.length,
      values
    );
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.get("/v1/monitoring/summary", dbRequired, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
      return res.status(400).json({ error: "valid_from_and_to_required" });
    }
    const result = await pool.query(
      "SELECT COALESCE(topic, 'Uncategorised') AS topic, COALESCE(source_name, 'Unknown') AS source, COUNT(*)::int AS count FROM public_updates WHERE status = 'published' AND published_at >= $1 AND published_at < $2 GROUP BY topic, source_name ORDER BY count DESC",
      [from, to]
    );
    res.json({ generatedAt: new Date().toISOString(), breakdown: result.rows });
  } catch (error) { next(error); }
});

app.get("/v1/operations/projects", dbRequired, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name, description, status, updated_at AS \"updatedAt\" FROM projects WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 100");
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

app.post("/v1/admin/updates", dbRequired, adminRequired, async (req, res, next) => {
  try {
    const { title, summary = "", topic = "General", publishedAt, sourceName, sourceUrl, verificationStatus = "unreviewed", status = "draft" } = req.body || {};
    const statuses = ["unreviewed", "reported", "corroborated", "verified", "corrected"];
    if (typeof title !== "string" || title.trim().length < 3 || title.length > 240 ||
        typeof publishedAt !== "string" || Number.isNaN(Date.parse(publishedAt)) ||
        typeof sourceUrl !== "string" || !validUrl(sourceUrl) || !statuses.includes(verificationStatus) ||
        !["draft", "published"].includes(status) || (status === "published" && !["corroborated", "verified"].includes(verificationStatus))) {
      return res.status(400).json({ error: "invalid_update_payload" });
    }
    const result = await pool.query(
      "INSERT INTO public_updates (title, summary, topic, published_at, source_name, source_url, verification_status, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (source_url) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, topic=EXCLUDED.topic, published_at=EXCLUDED.published_at, source_name=EXCLUDED.source_name, verification_status=EXCLUDED.verification_status, status=EXCLUDED.status, updated_at=NOW() RETURNING id, title, verification_status AS \"verificationStatus\"",
      [title.trim(), String(summary).slice(0, 4000), String(topic).slice(0, 80), publishedAt, String(sourceName || "Unknown").slice(0, 160), sourceUrl, verificationStatus, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).json({ error: "not_found" }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === "Origin not allowed") return res.status(403).json({ error: "origin_not_allowed" });
  console.error(JSON.stringify({ level: "error", message: error.message, path: req.path }));
  res.status(500).json({ error: "internal_server_error" });
});
const server = app.listen(port, () => console.log(JSON.stringify({ level: "info", message: "CampTech API listening", port })));
async function shutdown() {
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
