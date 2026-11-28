const ANCHOR = /(^|[^\p{L}\p{N}_])(?:#sarafadeen(?:alli)?|sarafadeen(?:\s+alli)?)(?![\p{L}\p{N}_])/iu;
const DEFAULT_QUERY = '"Sarafadeen" OR "Sarafadeen Alli"';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 12000) });
  if (!response.ok) {
    const error = new Error("provider_http_" + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function cleanHtml(value = "") {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g,"&").replace(/&lt;/g,"<")
    .replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g," ").trim();
}
function xmlValue(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
    if (match) return cleanHtml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g,""));
  }
  return "";
}
function exactAnchor(text) { return ANCHOR.test(String(text || "")); }

async function reddit(oauthAccessToken) {
  const { REDDIT_CLIENT_ID:id, REDDIT_CLIENT_SECRET:secret, REDDIT_USER_AGENT:agent, REDDIT_REFRESH_TOKEN:refresh } = process.env;
  if (!oauthAccessToken && (!id || !secret || !agent || !refresh)) return { configured:false, posts:[], note:"Connect Reddit with OAuth or configure its client, user agent and refresh token." };
  let accessToken=oauthAccessToken;
  if(!accessToken){
    const basic = Buffer.from(id + ":" + secret).toString("base64");
    const tokenData = await fetchJson("https://www.reddit.com/api/v1/access_token", {
      method:"POST", headers:{ Authorization:"Basic " + basic, "Content-Type":"application/x-www-form-urlencoded", "User-Agent":agent },
      body:new URLSearchParams({ grant_type:"refresh_token", refresh_token:refresh }).toString()
    });
    accessToken=tokenData.access_token;
  }
  if (!accessToken) throw new Error("reddit_token_not_returned");
  const headers = { Authorization:"Bearer " + accessToken, "User-Agent":agent||"CampTechOyoMonitor/1.0" };
  const search = await fetchJson("https://oauth.reddit.com/search?q=" + encodeURIComponent(DEFAULT_QUERY) + "&sort=new&limit=50&restrict_sr=false", { headers });
  const posts = [];
  for (const child of (search.data?.children || [])) {
    const p = child.data || {};
    const text = [p.title,p.selftext].filter(Boolean).join("\\n");
    if (!exactAnchor(text)) continue;
    const permalink = p.permalink ? "https://www.reddit.com" + p.permalink : "";
    const replies = [];
    if (p.num_comments > 0 && p.permalink) {
      try {
        const tree = await fetchJson("https://oauth.reddit.com" + p.permalink + ".json?limit=30&depth=4&sort=top", { headers });
        const walk = (nodes, depth=1) => {
          for (const node of nodes || []) {
            if (node.kind !== "t1" || !node.data) continue;
            const c=node.data;
            if (c.body && c.id) replies.push({ id:c.id, parentId:c.parent_id, depth, text:c.body, author:c.author, url:"https://www.reddit.com" + (c.permalink || p.permalink), publishedAt:c.created_utc ? new Date(c.created_utc*1000).toISOString() : null });
            if (depth < 4) walk(c.replies?.data?.children, depth+1);
          }
        };
        walk(tree?.[1]?.data?.children);
      } catch {}
    }
    posts.push({ id:p.id, text, url:permalink, author:p.author, publishedAt:p.created_utc ? new Date(p.created_utc*1000).toISOString() : null, replies });
  }
  return { configured:true, posts, note:"Reddit OAuth search; comment trees are limited to provider-returned comments and a four-level traversal." };
}

async function youtube(oauthAccessToken) {
  const key=process.env.YOUTUBE_API_KEY;
  if (!key && !oauthAccessToken) return { configured:false, posts:[], note:"Connect YouTube with Google OAuth or configure YOUTUBE_API_KEY." };
  const headers=oauthAccessToken?{Authorization:"Bearer "+oauthAccessToken}:{};
  const keyParam=oauthAccessToken?"":"&key="+encodeURIComponent(key);
  const search=await fetchJson("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25&q=" + encodeURIComponent("Sarafadeen Alli")+keyParam,{headers});
  const posts=[];
  for (const item of (search.items || [])) {
    const id=item.id?.videoId, s=item.snippet || {};
    if (!id) continue;
    const text=[s.title,s.description].filter(Boolean).join("\\n");
    if (!exactAnchor(text)) continue;
    const replies=[];
    try {
      const comments=await fetchJson("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=" + encodeURIComponent(id) + "&maxResults=30&textFormat=plainText"+keyParam,{headers});
      for (const thread of comments.items || []) {
        const top=thread.snippet?.topLevelComment?.snippet, cid=thread.snippet?.topLevelComment?.id;
        if (top && cid) replies.push({ id:cid, parentId:id, depth:1, text:top.textDisplay || "", author:top.authorDisplayName || "", url:"https://www.youtube.com/watch?v="+id+"&lc="+cid, publishedAt:top.publishedAt || null });
        for (const child of thread.replies?.comments || []) replies.push({ id:child.id, parentId:cid, depth:2, text:child.snippet?.textDisplay || "", author:child.snippet?.authorDisplayName || "", url:"https://www.youtube.com/watch?v="+id+"&lc="+child.id, publishedAt:child.snippet?.publishedAt || null });
      }
    } catch {}
    posts.push({ id, text, url:"https://www.youtube.com/watch?v="+id, author:s.channelTitle || "", publishedAt:s.publishedAt || null, replies });
  }
  return { configured:true, posts, note:"YouTube Data API search and commentThreads; API quota and comment availability apply." };
}

async function mastodon(oauthAccessToken) {
  const instance=String(process.env.MASTODON_INSTANCE_URL || "").replace(/\/$/,"");
  if (!instance) return { configured:false, posts:[], note:"MASTODON_INSTANCE_URL is not configured." };
  const token=oauthAccessToken||process.env.MASTODON_ACCESS_TOKEN;
  const headers=token ? { Authorization:"Bearer "+token } : {};
  const data=await fetchJson(instance+"/api/v1/timelines/tag/Sarafadeen?limit=40", { headers });
  return { configured:true, posts:(data || []).filter(p=>exactAnchor(cleanHtml(p.content))).map(p=>({ id:p.id, text:cleanHtml(p.content), url:p.url, author:p.account?.acct || "", publishedAt:p.created_at, replies:[] })), note:"Public hashtag timeline on the configured Mastodon instance; coverage depends on that instance." };
}

async function rss() {
  const feeds=String(process.env.NEWS_RSS_FEEDS || "").split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
  if (!feeds.length) return { configured:false, posts:[], note:"NEWS_RSS_FEEDS is not configured." };
  const posts=[];
  for (const feed of feeds) {
    try {
      const url=new URL(feed);
      if (!["http:","https:"].includes(url.protocol)) continue;
      const response=await fetch(url, { headers:{ Accept:"application/atom+xml, application/rss+xml, application/xml, text/xml" }, signal:AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const xml=await response.text();
      const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      for (const match of blocks) {
        const block=match[2], title=xmlValue(block,["title"]), description=xmlValue(block,["description","summary","content"]), text=[title,description].filter(Boolean).join("\\n");
        if (!exactAnchor(text)) continue;
        const linkMatch=block.match(/<link(?:\s+[^>]*)?href=["']([^"']+)["'][^>]*\/?\s*>|<link[^>]*>(https?:[^<]+)<\/link>/i);
        const link=linkMatch?.[1] || linkMatch?.[2] || xmlValue(block,["guid","id"]);
        const date=xmlValue(block,["pubDate","published","updated","dc:date"]);
        posts.push({ id:link || title, text, url:link, author:xmlValue(block,["author","dc:creator"]), publishedAt:date ? new Date(date).toISOString() : null, replies:[] });
      }
    } catch {}
  }
  return { configured:true, posts, note:"Only configured public RSS/Atom feed items containing an exact anchor match are included; feed coverage is not comprehensive." };
}

async function gdelt() {
  const params = new URLSearchParams({ query: '"Sarafadeen Alli" OR Sarafadeen', mode: "ArtList", format: "json", maxrecords: "75", timespan: "7d", sort: "DateDesc" });
  const response = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?" + params.toString(), {
    headers: { Accept: "application/json", "User-Agent": "OyoPublicDiscourseMonitor/1.0" },
    signal: AbortSignal.timeout(18000)
  });
  if (!response.ok) { const error = new Error("gdelt_http_" + response.status); error.status = response.status; throw error; }
  if (!(response.headers.get("content-type") || "").includes("json")) throw new Error("gdelt_non_json_response");
  const data = await response.json();
  const posts = (data.articles || []).filter(item => item.url && item.title && item.seendate).map(item => {
    const match = String(item.seendate).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const publishedAt = match ? new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))).toISOString() : null;
    return { id: item.url, text: String(item.title).slice(0,12000), url: item.url, author: item.domain || item.sourcecountry || "GDELT-indexed publisher", publishedAt, replies: [], queryMatched: true };
  }).filter(item => item.publishedAt);
  return { configured: true, posts, note: "Free, keyless GDELT DOC 2.0 news search; rolling seven-day window, up to 75 articles, no comments/replies. Rate limits apply; not exhaustive." };
}

async function runAdapter(name, credentials={}) {
  const adapters={ reddit:()=>reddit(credentials.accessToken), youtube:()=>youtube(credentials.accessToken), mastodon:()=>mastodon(credentials.accessToken), news_rss:rss, gdelt };
  if (!adapters[name]) throw new Error("unknown_adapter");
  return adapters[name]();
}
module.exports={ runAdapter };
