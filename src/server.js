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
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

app.disable("x-powered-by");\napp.set("trust proxy", 1);
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


const exactSarafadeenTag = /(^|[^\p{L}\p{N}_])#sarafadeen(?![\p{L}\p{N}_])/iu;
let sourceSyncBusy = false;
async function storeSocialPost({ platform, externalId, postUrl, authorHandle, postText, publishedAt }) {
  if (!exactSarafadeenTag.test(postText || "") || !postUrl || !publishedAt) return false;
  const result = await pool.query(
    "INSERT INTO social_posts (platform, external_id, post_url, author_handle, post_text, published_at, matched_hashtags) VALUES ($1,$2,$3,$4,$5,$6,ARRAY['#sarafadeen']::TEXT[]) ON CONFLICT DO NOTHING",
    [platform, externalId, postUrl, String(authorHandle || "").slice(0,160), postText, publishedAt]
  );
  return result.rowCount === 1;
}
async function syncPublicSources() {
  if (!pool || sourceSyncBusy) return;
  sourceSyncBusy = true;
  try {
    const blueskyUrl = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" + encodeURIComponent("#Sarafadeen") + "&limit=100";
    const blueskyResponse = await fetch(blueskyUrl, { signal: AbortSignal.timeout(4500), headers: { Accept: "application/json" } });
    if (blueskyResponse.ok) {
      const data = await blueskyResponse.json();
      for (const item of (data.posts || [])) {
        const uri = item.uri || "";
        const rkey = uri.split("/").pop();
        await storeSocialPost({
          platform: "bluesky",
          externalId: uri,
          postUrl: "https://bsky.app/profile/" + encodeURIComponent(item.author?.handle || item.author?.did || "") + "/post/" + encodeURIComponent(rkey),
          authorHandle: item.author?.handle || "",
          postText: item.record?.text || "",
          publishedAt: item.record?.createdAt || item.indexedAt
        });
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", source: "bluesky", message: error.message }));
  }
  if (process.env.X_BEARER_TOKEN) {
    try {
      const params = new URLSearchParams({ query: "#Sarafadeen", max_results: "100", "tweet.fields": "created_at,author_id", expansions: "author_id", "user.fields": "username" });
      const response = await fetch("https://api.x.com/2/tweets/search/recent?" + params.toString(), {
        signal: AbortSignal.timeout(4500),
        headers: { Authorization: "Bearer " + process.env.X_BEARER_TOKEN, Accept: "application/json" }
      });
      if (response.ok) {
        const data = await response.json();
        const authors = new Map((data.includes?.users || []).map(user => [user.id, user.username]));
        for (const post of (data.data || [])) {
          const handle = authors.get(post.author_id) || "";
          await storeSocialPost({
            platform: "x",
            externalId: post.id,
            postUrl: "https://x.com/" + encodeURIComponent(handle || "i") + "/status/" + encodeURIComponent(post.id),
            authorHandle: handle ? "@" + handle : "",
            postText: post.text || "",
            publishedAt: post.created_at
          });
        }
      } else {
        console.warn(JSON.stringify({ level: "warn", source: "x", status: response.status }));
      }
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", source: "x", message: error.message }));
    }
  }
  sourceSyncBusy = false;
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


app.get("/v1/monitoring/hashtag", dbRequired, async (req, res, next) => {
  try {
    const tag = String(req.query.tag || "Sarafadeen").trim().replace(/^#/, "").toLowerCase();
    if (tag !== "sarafadeen") return res.status(400).json({ error: "unsupported_hashtag" });
    const where = "'#sarafadeen' = ANY(matched_hashtags) AND verification_status <> 'excluded'";
    const [totals, platforms, hourly, posts] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '24 hours')::int AS \"last24h\", COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '1 hour')::int AS \"lastHour\", MAX(ingested_at) AS \"latestAt\" FROM social_posts WHERE " + where),
      pool.query("SELECT platform, COUNT(*)::int AS count FROM social_posts WHERE " + where + " GROUP BY platform ORDER BY count DESC"),
      pool.query("SELECT date_trunc('hour', published_at) AS bucket, COUNT(*)::int AS count FROM social_posts WHERE " + where + " AND published_at >= NOW() - INTERVAL '24 hours' GROUP BY bucket ORDER BY bucket"),
      pool.query("SELECT platform, post_url AS \"postUrl\", author_handle AS \"authorHandle\", post_text AS \"postText\", published_at AS \"publishedAt\" FROM social_posts WHERE " + where + " ORDER BY published_at DESC LIMIT 30")
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ tag: "#Sarafadeen", ...totals.rows[0], platforms: platforms.rows, hourly: hourly.rows, posts: posts.rows, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post("/v1/admin/social-posts", dbRequired, adminRequired, async (req, res, next) => {
  try {
    const { platform, externalId, postUrl, authorHandle = "", postText, publishedAt } = req.body || {};
    const exactTag = /(^|[^\p{L}\p{N}_])#sarafadeen(?![\p{L}\p{N}_])/iu;
    if (typeof platform !== "string" || !/^[a-z0-9_-]{2,40}$/i.test(platform) ||
        typeof externalId !== "string" || externalId.length < 1 || externalId.length > 240 ||
        typeof postUrl !== "string" || !validUrl(postUrl) ||
        typeof postText !== "string" || postText.length < 1 || postText.length > 12000 || !exactTag.test(postText) ||
        typeof publishedAt !== "string" || Number.isNaN(Date.parse(publishedAt))) {
      return res.status(400).json({ error: "post_must_contain_exact_sarafadeen_hashtag_and_valid_public_source_fields" });
    }
    const result = await pool.query(
      "INSERT INTO social_posts (platform, external_id, post_url, author_handle, post_text, published_at, matched_hashtags) VALUES ($1,$2,$3,$4,$5,$6,ARRAY['#sarafadeen']::TEXT[]) ON CONFLICT DO NOTHING RETURNING id",
      [platform.toLowerCase(), externalId, postUrl, String(authorHandle).slice(0,160), postText, publishedAt]
    );
    res.status(result.rowCount ? 201 : 200).json({ accepted: result.rowCount === 1, duplicate: result.rowCount === 0 });
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
const server = app.listen(port, () => { console.log(JSON.stringify({ level: "info", message: "CampTech API listening", port })); setTimeout(syncPublicSources, 1000); setInterval(syncPublicSources, 5000); });
async function shutdown() {
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
