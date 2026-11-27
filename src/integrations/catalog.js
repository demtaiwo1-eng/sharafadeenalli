const INTEGRATIONS = [
  { id: "x", name: "X", kind: "social", auth: "bearer", env: ["X_BEARER_TOKEN"], capabilities: ["keyword_search", "hashtag_search", "posts", "replies", "conversation_threads"], access: "Developer app and an access tier with the required search and conversation endpoints", docs: "https://docs.x.com/" },
  { id: "bluesky", name: "Bluesky", kind: "social", auth: "public_or_app_password", env: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"], capabilities: ["keyword_search", "hashtag_search", "posts", "threads", "replies"], access: "Public read endpoints are available; authenticated operations use an account/app password or OAuth", docs: "https://docs.bsky.app/" },
  { id: "reddit", name: "Reddit", kind: "social", auth: "oauth", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT", "REDDIT_REFRESH_TOKEN"], capabilities: ["keyword_search", "subreddit_search", "posts", "comments", "nested_comment_trees"], access: "Registered OAuth application; commercial and research use must follow Reddit Data API terms", docs: "https://www.reddit.com/dev/api/" },
  { id: "youtube", name: "YouTube", kind: "social", auth: "api_key_or_oauth", env: ["YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"], capabilities: ["video_search", "channels", "videos", "comments", "comment_replies"], access: "Google Cloud project, enabled YouTube Data API and quota; OAuth for user-authorised operations", docs: "https://developers.google.com/youtube/v3" },
  { id: "facebook", name: "Facebook", kind: "social", auth: "oauth", env: ["META_APP_ID", "META_APP_SECRET", "FACEBOOK_ACCESS_TOKEN"], capabilities: ["eligible_page_posts", "page_comments", "page_replies"], access: "Meta app, Page access and permissions; App Review/business verification may be required", docs: "https://developers.facebook.com/docs/graph-api/" },
  { id: "instagram", name: "Instagram", kind: "social", auth: "oauth", env: ["META_APP_ID", "META_APP_SECRET", "INSTAGRAM_ACCESS_TOKEN"], capabilities: ["eligible_professional_media", "hashtags_where_supported", "comments", "comment_replies"], access: "Eligible professional account, Meta app and approved permissions; not unrestricted search of all personal accounts", docs: "https://developers.facebook.com/docs/instagram-platform/" },
  { id: "threads", name: "Threads", kind: "social", auth: "oauth", env: ["THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_ACCESS_TOKEN"], capabilities: ["supported_public_post_search", "posts", "replies"], access: "Meta developer app and supported Threads permissions/endpoints", docs: "https://developers.facebook.com/docs/threads/" },
  { id: "tiktok", name: "TikTok", kind: "social", auth: "oauth_or_research_approval", env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"], capabilities: ["authorised_video_search", "videos", "comments_where_permitted"], access: "Product-specific approval; Research API eligibility is restricted and is not general-purpose public firehose access", docs: "https://developers.tiktok.com/" },
  { id: "linkedin", name: "LinkedIn", kind: "social", auth: "oauth", env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_ACCESS_TOKEN"], capabilities: ["authorised_member_content", "organisation_posts", "eligible_comments"], access: "Approved LinkedIn products and scopes; access to member/organisation content is permission-limited", docs: "https://learn.microsoft.com/linkedin/" },
  { id: "mastodon", name: "Mastodon", kind: "social", auth: "instance_oauth", env: ["MASTODON_INSTANCE_URL", "MASTODON_ACCESS_TOKEN"], capabilities: ["public_tag_search", "public_posts", "statuses", "replies"], access: "Register an app with the selected instance; search availability and limits vary by instance", docs: "https://docs.joinmastodon.org/" },
  { id: "telegram", name: "Telegram", kind: "social", auth: "bot_or_client", env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_API_ID", "TELEGRAM_API_HASH"], capabilities: ["authorised_channel_posts", "channel_discussions"], access: "Bot must be added with suitable permissions, or use an authorised Telegram client; private content is not in scope", docs: "https://core.telegram.org/" },
  { id: "discord", name: "Discord", kind: "community", auth: "bot", env: ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"], capabilities: ["authorised_server_messages", "threads", "replies"], access: "Bot installation and explicit server/channel permissions required", docs: "https://discord.com/developers/docs/intro" },
  { id: "news_rss", name: "News and RSS feeds", kind: "publisher", auth: "feed_urls", env: ["NEWS_RSS_FEEDS"], capabilities: ["articles", "headlines", "publisher_feeds"], access: "Public RSS/Atom feeds and publisher terms", docs: "https://www.rssboard.org/rss-specification" },
  { id: "government_open_data", name: "Government and election open data", kind: "public_data", auth: "optional_api_key", env: ["GOVERNMENT_DATA_API_KEY", "INEC_API_BASE_URL"], capabilities: ["official_releases", "legislation", "election_data", "public_datasets"], access: "Use official public APIs, open datasets and published feeds; verify provenance and update cadence", docs: "https://data.gov.ng/" },
  { id: "twitch", name: "Twitch", kind: "video", auth: "oauth", env: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_ACCESS_TOKEN"], capabilities: ["channels", "streams", "videos", "clips", "chat_where_authorised"], access: "Helix API with registered app and OAuth; chat access and retention are separately governed", docs: "https://dev.twitch.tv/docs/api/" },
  { id: "tumblr", name: "Tumblr", kind: "social", auth: "oauth", env: ["TUMBLR_CONSUMER_KEY", "TUMBLR_CONSUMER_SECRET", "TUMBLR_OAUTH_TOKEN", "TUMBLR_OAUTH_SECRET"], capabilities: ["blogs", "posts", "tagged_posts_where_supported"], access: "Register an application and follow Tumblr API rate limits and content access rules", docs: "https://www.tumblr.com/docs/en/api/v2" },
  { id: "hacker_news", name: "Hacker News", kind: "community", auth: "public_api", env: [], capabilities: ["stories", "comments", "nested_item_trees"], access: "Public Firebase API; collection is limited to Hacker News content and its public item tree", docs: "https://github.com/HackerNews/API" },
];

function isConfigured(id, env) {
  const item = INTEGRATIONS.find(entry => entry.id === id);
  if (!item) return false;
  if (id === "bluesky") return Boolean(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
  if (id === "youtube") return Boolean(env.YOUTUBE_API_KEY || (env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN));
  if (id === "telegram") return Boolean(env.TELEGRAM_BOT_TOKEN || (env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH));
  if (id === "government_open_data") return Boolean(env.GOVERNMENT_DATA_API_KEY || env.INEC_API_BASE_URL);
  if (item.auth === "public_api" || item.auth === "unavailable_without_official_api") return false;
  if (item.auth === "rss") return item.env.some(key => Boolean(env[key]));
  return item.env.length > 0 && item.env.every(key => Boolean(env[key]));
}

function getIntegrationCatalog(env = process.env) {
  return INTEGRATIONS.map(({ env: requiredEnv, ...item }) => ({
    ...item,
    configured: isConfigured(item.id, env),
    requiredEnvironment: requiredEnv,
    connectionStatus: item.auth === "public_api" ? "public_access_unverified" : (isConfigured(item.id, env) ? "configured_not_tested" : "not_configured")
  }));
}

module.exports = { getIntegrationCatalog };
