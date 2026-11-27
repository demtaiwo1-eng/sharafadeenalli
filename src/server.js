const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { Pool } = require("pg");
const { getIntegrationCatalog } = require("./integrations/catalog");
const { MONITORING_SCOPE } = require("./config/monitoring-scope");
const { aggregatePosts, buildReport } = require("./analytics/engine");
const { runAdapter } = require("./monitoring/adapters");

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

app.disable("x-powered-by");
app.set("trust proxy", 1);
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


const exactSarafadeenTag = /(^|[^\p{L}\p{N}_])(?:#sarafadeen(?:alli)?|sarafadeen(?:\s+alli)?)(?![\p{L}\p{N}_])/iu;
let sourceSyncBusy = false;
const KEYWORD_STOPWORDS = new Set(("a an the and or but if then of to in on at for from by with as is are was were be been being it its this that these those i we you they he she them our your their my me us not no yes do does did have has had can could would should will may might about into over under after before than too very just also so such there here what when where why how who which while per via de la el en ni ati fun si ko mo o".split(/\s+/)));
function extractTextTerms(value) {
  const text = String(value || "");
  const hashtags = [...text.matchAll(/(^|[^\p{L}\p{N}_])(#[\p{L}\p{N}_]{2,100})/gu)].map(m => m[2]);
  const words = (text.toLocaleLowerCase("en-NG").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,48}/gu) || [])
    .map(word => word.replace(/^['’-]+|['’-]+$/g, ""))
    .filter(word => word.length > 2 && !KEYWORD_STOPWORDS.has(word) && !/^\d+$/.test(word));
  const counts = new Map();
  for (const word of words) counts.set("word:" + word, (counts.get("word:" + word) || 0) + 1);
  for (let i = 0; i < words.length - 1; i++) {
    if (KEYWORD_STOPWORDS.has(words[i]) || KEYWORD_STOPWORDS.has(words[i + 1])) continue;
    const phrase = words[i] + " " + words[i + 1];
    counts.set("phrase:" + phrase, (counts.get("phrase:" + phrase) || 0) + 1);
  }
  for (const tag of hashtags) counts.set("hashtag:" + tag.toLowerCase(), (counts.get("hashtag:" + tag.toLowerCase()) || 0) + 1);
  return [...counts.entries()].map(([key, occurrences]) => {
    const split = key.indexOf(":");
    return { termType: key.slice(0, split), normalized: key.slice(split + 1), occurrences };
  });
}
async function indexPostTerms(postId, platform, text) {
  const terms = extractTextTerms(text);
  for (const term of terms) {
    const keyword = term.normalized.slice(0, 160);
    await pool.query(
      "INSERT INTO post_keywords (source_post_id, platform, keyword, normalized_keyword, term_type, occurrences) VALUES ($1,$2,$3,$3,$4,$5) ON CONFLICT (source_post_id, normalized_keyword, term_type) WHERE source_post_id IS NOT NULL DO UPDATE SET occurrences=EXCLUDED.occurrences, extracted_at=NOW()",
      [postId, platform, keyword, term.termType, term.occurrences]
    );
    if (term.termType === "hashtag") {
      const label = "#" + keyword.replace(/^#/, "");
      await pool.query(
        "INSERT INTO discovered_hashtags (platform, hashtag, normalized_hashtag, source_post_id, occurrence_count) VALUES ($1,$2,$3,$4,$5)",
        [platform, label, term.normalized.replace(/^#/, ""), postId, term.occurrences]
      );
    }
  }
}
async function storeSocialPost({ platform, externalId, postUrl, authorHandle, postText, publishedAt }) {
  if (!exactSarafadeenTag.test(postText || "") || !postUrl || !publishedAt) return null;
  const matchedHashtags = [...String(postText).matchAll(/(^|[^\p{L}\p{N}_])(#[\p{L}\p{N}_]{2,100})/gu)].map(match => match[2].toLowerCase());
  const result = await pool.query(
    "INSERT INTO social_posts (platform, external_id, post_url, author_handle, post_text, published_at, matched_hashtags) VALUES ($1,$2,$3,$4,$5,$6,$7::TEXT[]) ON CONFLICT DO NOTHING RETURNING id",
    [platform, externalId, postUrl, String(authorHandle || "").slice(0,160), postText, publishedAt, matchedHashtags]
  );
  if (result.rowCount === 1) await indexPostTerms(result.rows[0].id, platform, postText);
  return result.rows[0]?.id || null;
}
let keywordBackfillBusy = false;
async function backfillUnindexedPostTerms() {
  if (!pool || keywordBackfillBusy) return;
  keywordBackfillBusy = true;
  try {
    const result = await pool.query(
      "SELECT p.id, p.platform, p.post_text FROM social_posts p WHERE NOT EXISTS (SELECT 1 FROM post_keywords k WHERE k.source_post_id=p.id) ORDER BY p.published_at DESC LIMIT 10"
    );
    for (const post of result.rows) await indexPostTerms(post.id, post.platform, post.post_text);
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", source: "keyword_backfill", message: error.message }));
  } finally {
    keywordBackfillBusy = false;
  }
}
async function storeBlueskyThreadNode(node, rootPostId, parentExternalId, depth) {
  if (!node?.post?.uri || depth > 6) return 0;
  const post = node.post;
  const text = post.record?.text || "";
  const externalId = post.uri;
  const rkey = externalId.split("/").pop();
  const author = post.author?.handle || post.author?.did || "";
  const url = "https://bsky.app/profile/" + encodeURIComponent(author) + "/post/" + encodeURIComponent(rkey);
  const inserted = await pool.query(
    "INSERT INTO social_threads (platform, external_id, root_post_id, parent_external_id, thread_depth, post_url, author_handle, content, published_at, source_payload) VALUES ('bluesky',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (platform, external_id) DO NOTHING RETURNING id",
    [externalId, rootPostId, parentExternalId, depth, url, String(author).slice(0,160), text, post.record?.createdAt || post.indexedAt || null, JSON.stringify({ replyCount: post.replyCount || 0 })]
  );
  let saved = 0;
  if (inserted.rowCount) {
    saved++;
    const threadId = inserted.rows[0].id;
    for (const term of extractTextTerms(text)) {
      const keyword = term.normalized.slice(0,160);
      await pool.query(
        "INSERT INTO post_keywords (source_thread_id, platform, keyword, normalized_keyword, term_type, occurrences) VALUES ($1,'bluesky',$2,$2,$3,$4) ON CONFLICT (source_thread_id, normalized_keyword, term_type) WHERE source_thread_id IS NOT NULL DO UPDATE SET occurrences=EXCLUDED.occurrences, extracted_at=NOW()",
        [threadId, keyword, term.termType, term.occurrences]
      );
      if (term.termType === "hashtag") {
        await pool.query(
          "INSERT INTO discovered_hashtags (platform, hashtag, normalized_hashtag, source_thread_id, occurrence_count) VALUES ('bluesky',$1,$2,$3,$4)",
          ["#" + keyword.replace(/^#/, ""), term.normalized.replace(/^#/, ""), threadId, term.occurrences]
        );
      }
    }
  }
  for (const child of (node.replies || [])) {
    saved += await storeBlueskyThreadNode(child, rootPostId, externalId, depth + 1);
  }
  return saved;
}
async function syncBlueskyThread(uri, rootPostId) {
  try {
    const url = "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=" + encodeURIComponent(uri) + "&depth=6&parentHeight=0";
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!response.ok) return 0;
    const data = await response.json();
    let saved = 0;
    for (const reply of (data.thread?.replies || [])) saved += await storeBlueskyThreadNode(reply, rootPostId, uri, 1);
    return saved;
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", source: "bluesky_thread", message: error.message }));
    return 0;
  }
}
async function storeExternalReply(reply, rootPostId, platform, parentExternalId) {
  if (!reply?.id || !reply.text) return false;
  const depth = Math.min(Math.max(Number(reply.depth || 1), 1), 100);
  const result = await pool.query(
    "INSERT INTO social_threads (platform, external_id, root_post_id, parent_external_id, thread_depth, post_url, author_handle, content, published_at, source_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (platform, external_id) DO NOTHING RETURNING id",
    [platform, String(reply.id).slice(0,240), rootPostId, String(reply.parentId || parentExternalId || "").slice(0,240), depth, validUrl(reply.url) ? reply.url : null, String(reply.author || "").slice(0,160), String(reply.text).slice(0,12000), reply.publishedAt && !Number.isNaN(Date.parse(reply.publishedAt)) ? reply.publishedAt : null, JSON.stringify({ collectedBy:"official_or_public_api_adapter" })]
  );
  if (!result.rowCount) return false;
  const threadId=result.rows[0].id;
  for (const term of extractTextTerms(reply.text)) {
    const keyword=term.normalized.slice(0,160);
    await pool.query(
      "INSERT INTO post_keywords (source_thread_id, platform, keyword, normalized_keyword, term_type, occurrences) VALUES ($1,$2,$3,$3,$4,$5) ON CONFLICT (source_thread_id, normalized_keyword, term_type) WHERE source_thread_id IS NOT NULL DO UPDATE SET occurrences=EXCLUDED.occurrences, extracted_at=NOW()",
      [threadId, platform, keyword, term.termType, term.occurrences]
    );
    if(term.termType==="hashtag") await pool.query(
      "INSERT INTO discovered_hashtags (platform, hashtag, normalized_hashtag, source_thread_id, occurrence_count) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [platform,"#"+keyword.replace(/^#/,""),term.normalized.replace(/^#/,""),threadId,term.occurrences]
    );
  }
  return true;
}
async function runConfiguredAdapter(name) {
  const started=await pool.query(
    "INSERT INTO collection_runs (platform, collection_type, query_label, status, coverage_note) VALUES ($1,$2,$3,'running','Adapter collection started; coverage is limited to configured provider permissions and API results.') RETURNING id",
    [name, name==="news_rss" ? "rss" : "search", "Sarafadeen / Sarafadeen Alli"]
  );
  const runId=started.rows[0].id;
  let seen=0, replies=0, errors=0, status="succeeded", note="";
  try {
    const result=await runAdapter(name);
    note=result.note || "";
    for(const item of result.posts || []) {
      if(!item.url || !validUrl(item.url) || !item.publishedAt || Number.isNaN(Date.parse(item.publishedAt))) continue;
      const rootId=await storeSocialPost({
        platform:name, externalId:String(item.id || item.url).slice(0,240), postUrl:item.url,
        authorHandle:item.author || "", postText:item.text || "", publishedAt:item.publishedAt
      });
      if(rootId) seen++;
      if(rootId) for(const reply of item.replies || []) {
        if(await storeExternalReply(reply,rootId,name,item.id)) replies++;
      }
    }
    if(!result.configured) status="partial";
  } catch(error) {
    errors++;
    status=error.status===429 ? "rate_limited" : "failed";
    note=error.message;
    console.warn(JSON.stringify({level:"warn",source:name,message:error.message,status:error.status || null}));
  }
  await pool.query(
    "UPDATE collection_runs SET finished_at=NOW(), status=$2, posts_seen=$3, replies_seen=$4, errors_count=$5, error_class=$6, coverage_note=$7 WHERE id=$1",
    [runId,status,seen,replies,errors,errors ? (status==="rate_limited" ? "rate_limit" : "provider_error") : null,note.slice(0,2000)]
  );
  return { platform:name,status,postsSeen:seen,repliesSeen:replies,errors,note };
}
async function syncConfiguredAdapters() {
  const results=[];
  for(const name of ["reddit","youtube","mastodon","news_rss"]) results.push(await runConfiguredAdapter(name));
  return results;
}

async function syncPublicSources() {
  if (!pool || sourceSyncBusy) return;
  sourceSyncBusy = true;
  try {
    const blueskyUrl = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" + encodeURIComponent("Sarafadeen") + "&limit=100";
    const blueskyResponse = await fetch(blueskyUrl, { signal: AbortSignal.timeout(4500), headers: { Accept: "application/json" } });
    if (blueskyResponse.ok) {
      const data = await blueskyResponse.json();
      let threadBudget = 2;
      for (const item of (data.posts || [])) {
        const uri = item.uri || "";
        const rkey = uri.split("/").pop();
        const insertedPostId = await storeSocialPost({
          platform: "bluesky",
          externalId: uri,
          postUrl: "https://bsky.app/profile/" + encodeURIComponent(item.author?.handle || item.author?.did || "") + "/post/" + encodeURIComponent(rkey),
          authorHandle: item.author?.handle || "",
          postText: item.record?.text || "",
          publishedAt: item.record?.createdAt || item.indexedAt
        });
        if (insertedPostId && threadBudget > 0 && Number(item.replyCount || 0) > 0) {
          await syncBlueskyThread(uri, insertedPostId);
          threadBudget--;
        }
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", source: "bluesky", message: error.message }));
  }
  if (process.env.X_BEARER_TOKEN) {
    try {
      const params = new URLSearchParams({ query: "Sarafadeen", max_results: "100", "tweet.fields": "created_at,author_id", expansions: "author_id", "user.fields": "username" });
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
  try { await syncConfiguredAdapters(); } catch (error) { console.warn(JSON.stringify({level:"warn",source:"configured_adapters",message:error.message})); }
  sourceSyncBusy = false;
}

app.get("/v1/monitoring/scope", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ scope: MONITORING_SCOPE, generatedAt: new Date().toISOString() });
});

app.get("/v1/integrations/catalog", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    generatedAt: new Date().toISOString(),
    note: "Configured means required environment variables exist; it does not mean credentials have been validated or that the platform has granted access.",
    integrations: getIntegrationCatalog()
  });
});

app.get("/v1/admin/integrations/status", adminRequired, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    generatedAt: new Date().toISOString(),
    integrations: getIntegrationCatalog()
  });
});

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


const ANALYTICS_TYPES = new Set(["trend","sentiment","issue_map","swot","pestle","risk","evidence_review"]);
async function generateMonitoringReport(type, days) {
  const result = await pool.query(
    "SELECT id, platform, post_url, post_text AS text, published_at, ingested_at FROM social_posts WHERE published_at >= NOW() - ($1::int * INTERVAL '1 day') AND verification_status <> 'excluded' UNION ALL SELECT id, platform, post_url, content AS text, published_at, ingested_at FROM social_threads WHERE published_at >= NOW() - ($1::int * INTERVAL '1 day') ORDER BY published_at DESC NULLS LAST LIMIT 5000",
    [days]
  );
  const aggregate = aggregatePosts(result.rows);
  return buildReport(type, aggregate, days);
}

app.get("/v1/monitoring/analytics", dbRequired, async (req, res, next) => {
  try {
    const type = String(req.query.type || "issue_map").toLowerCase();
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 180);
    if (!ANALYTICS_TYPES.has(type)) return res.status(400).json({ error: "unsupported_report_type", supported: [...ANALYTICS_TYPES] });
    const report = await generateMonitoringReport(type, days);
    res.set("Cache-Control", "no-store");
    res.json({ ...report, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post("/v1/admin/analytics/reports", dbRequired, adminRequired, async (req, res, next) => {
  try {
    const type = String(req.body?.type || "").toLowerCase();
    const days = Math.min(Math.max(Number.parseInt(req.body?.days, 10) || 30, 1), 180);
    if (!ANALYTICS_TYPES.has(type)) return res.status(400).json({ error: "unsupported_report_type", supported: [...ANALYTICS_TYPES] });
    const report = await generateMonitoringReport(type, days);
    const saved = await pool.query(
      "INSERT INTO analytics_reports (report_type, title, scope, period_start, period_end, methodology, findings, limitations) VALUES ($1,$2,$3::jsonb,NOW()-($4::int*INTERVAL '1 day'),NOW(),$5::jsonb,$6::jsonb,$7) RETURNING id, generated_at",
      [type, report.title, JSON.stringify(report.scope), days, JSON.stringify(report.methodology), JSON.stringify(report.findings), report.limitations.join(" ")]
    );
    res.status(201).json({ ...report, saved: saved.rows[0] });
  } catch (error) { next(error); }
});

app.get("/v1/admin/monitoring/collection-runs", dbRequired, adminRequired, async (req,res,next) => {
  try {
    const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||30,1),100);
    const result=await pool.query("SELECT platform, collection_type, query_label, started_at, finished_at, status, posts_seen, replies_seen, errors_count, error_class, coverage_note FROM collection_runs ORDER BY started_at DESC LIMIT $1",[limit]);
    res.set("Cache-Control","no-store");
    res.json({runs:result.rows,generatedAt:new Date().toISOString()});
  } catch(error){next(error);}
});

app.get("/v1/monitoring/keywords", dbRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);
    const [keywords, hashtags, coverage] = await Promise.all([
      pool.query("SELECT normalized_keyword AS keyword, term_type AS term_type, SUM(occurrences)::int AS occurrences, COUNT(DISTINCT COALESCE(source_post_id::text, source_thread_id::text))::int AS records FROM post_keywords GROUP BY normalized_keyword, term_type ORDER BY records DESC, occurrences DESC LIMIT $1", [limit]),
      pool.query("SELECT normalized_hashtag AS hashtag, SUM(occurrence_count)::int AS occurrences, COUNT(DISTINCT COALESCE(source_post_id::text, source_thread_id::text))::int AS records, MAX(last_seen_at) AS last_seen_at FROM discovered_hashtags GROUP BY normalized_hashtag ORDER BY records DESC, occurrences DESC LIMIT $1", [limit]),
      pool.query("SELECT platform, COUNT(DISTINCT COALESCE(source_post_id::text, source_thread_id::text))::int AS indexed_records FROM post_keywords GROUP BY platform ORDER BY indexed_records DESC")
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ keywords: keywords.rows, hashtags: hashtags.rows, indexedPostsByPlatform: coverage.rows, methodology: "Frequency-based extraction of words, adjacent two-word phrases and hashtags from collected public posts. Not semantic understanding or sentiment analysis.", generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.get("/v1/monitoring/hashtag", dbRequired, async (req, res, next) => {
  try {
    const tag = String(req.query.tag || "Sarafadeen").trim().replace(/^#/, "").toLowerCase();
    if (tag !== "sarafadeen") return res.status(400).json({ error: "unsupported_hashtag" });
    const where = "('#sarafadeen' = ANY(matched_hashtags) OR '#sarafadeenalli' = ANY(matched_hashtags) OR post_text ILIKE '%Sarafadeen Alli%') AND verification_status <> 'excluded'";
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
    const exactTag = /(^|[^\p{L}\p{N}_])(?:#sarafadeen(?:alli)?|sarafadeen(?:\s+alli)?)(?![\p{L}\p{N}_])/iu;
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
const server = app.listen(port, () => { console.log(JSON.stringify({ level: "info", message: "CampTech API listening", port })); setTimeout(syncPublicSources, 1000); setInterval(syncPublicSources, Math.max(60000, Number(process.env.COLLECTION_INTERVAL_MS || 900000))); setTimeout(backfillUnindexedPostTerms, 3000); setInterval(backfillUnindexedPostTerms, 300000); });
async function shutdown() {
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
