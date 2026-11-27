const ISSUE_TAXONOMY = [
  { key: "governance", label: "Governance and public administration", terms: ["governance","government","administration","policy","ministry","commissioner","council","assembly","senate","legislation","law","bill","budget","procurement","accountability"] },
  { key: "infrastructure", label: "Infrastructure, roads and transport", terms: ["road","bridge","transport","traffic","rail","bus","electricity","power","grid","infrastructure","construction","drainage","streetlight"] },
  { key: "education", label: "Education and skills", terms: ["school","education","student","teacher","university","polytechnic","college","scholarship","classroom","literacy","training","skills"] },
  { key: "health", label: "Health and social services", terms: ["hospital","health","clinic","doctor","nurse","medicine","medical","maternal","vaccination","primary healthcare","social welfare"] },
  { key: "agriculture", label: "Agriculture and food systems", terms: ["farmer","farm","agriculture","food","crop","livestock","market","fertiliser","fertilizer","irrigation","rural"] },
  { key: "jobs_economy", label: "Jobs, business and cost of living", terms: ["job","employment","unemployment","business","entrepreneur","salary","wage","inflation","cost of living","poverty","investment","trade","market"] },
  { key: "security", label: "Security, justice and community safety", terms: ["security","police","crime","kidnap","kidnapping","robbery","court","justice","safety","violence","arrest","protest"] },
  { key: "environment", label: "Environment, water and sanitation", terms: ["environment","water","sanitation","waste","flood","flooding","erosion","climate","pollution","sewage","toilet"] },
  { key: "public_finance", label: "Budgets and public spending", terms: ["budget","spending","expenditure","revenue","tax","debt","allocation","contract","procurement","audit","account"] },
  { key: "representation", label: "Representation and constituency issues", terms: ["constituency","senator","senate","representative","representation","federal","national assembly","constituents","ward","lawmaker"] }
];

const OYO_LOCATIONS = [
  "oyo state","ibadan","ogbomoso","ogbomoso","oyo town","oyo","ibarapa","oke-ogun","oke ogun",
  "oyo south","oyo central","oyo north","afijio","akinyele","atiba","atisbo","egbeda","ibadan north",
  "ibadan north east","ibadan north-west","ibadan south east","ibadan south west","ibarapa central",
  "ibarapa east","ibarapa north","ido","irepo","iseyin","itesiwaju","iwajowa"," kajola","lagelu",
  " ogbomosho north","ogbomosho south"," oluyole","ona ara","orelope","ori ire","oyo east","oyo west",
  "saki east","saki west","surulere"
].map(x => x.trim()).filter(Boolean);

const POSITIVE = new Set(["good","great","excellent","improved","improvement","completed","delivered","success","successful","benefit","beneficial","support","supported","commend","commendable","progress","progressive","working","resolved","peaceful","better","well done"]);
const NEGATIVE = new Set(["bad","poor","failed","failure","delay","delayed","abandoned","corrupt","corruption","crisis","problem","problems","unsafe","insecurity","violence","worse","worsening","unfair","neglect","neglected","suffering","shortage","broken","collapse","disappointed","disappointing"]);

function containsPlace(text, place) {
  const pattern = place.trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + pattern + "(?![\\p{L}\\p{N}])", "u").test(text);
}
function tokenize(text) {");\n  return new RegExp("(^|[^\\\\p{L}\\\\p{N}])" + escaped + "(?![\\\\p{L}\\\\p{N}])", "u").test(text);\n}\nfunction tokenize(text) {
  return (String(text || "").toLocaleLowerCase("en-NG").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,48}/gu) || []);
}
function classifyPost(post) {
  const text = String(post.text || "");
  const lower = text.toLocaleLowerCase("en-NG");
  const tokens = tokenize(text);
  const locations = OYO_LOCATIONS.filter(place => containsPlace(lower, place));
  const issues = ISSUE_TAXONOMY.map(issue => ({
    key: issue.key, label: issue.label,
    hits: issue.terms.filter(term => lower.includes(term)).length
  })).filter(issue => issue.hits > 0).sort((a,b) => b.hits-a.hits);
  const positive = tokens.filter(token => POSITIVE.has(token)).length;
  const negative = tokens.filter(token => NEGATIVE.has(token)).length;
  let sentiment = "mixed_or_unclear";
  if (positive > negative && positive > 0) sentiment = "positive_language";
  if (negative > positive && negative > 0) sentiment = "negative_language";
  return {
    id: post.id, platform: post.platform, publishedAt: post.published_at,
    text: text.slice(0, 1200), url: post.post_url || null,
    geography: locations.length ? "oyo_named" : "oyo_unconfirmed",
    geographicEvidence: locations,
    issues: issues.slice(0, 3),
    sentiment,
    sentimentCounts: { positive, negative },
    evidenceType: /\b(alleged|claims?|reportedly|rumou?r|unconfirmed|according to)\b/i.test(text) ? "claim_or_unverified_report" : "public_statement_or_opinion"
  };
}
function aggregatePosts(posts) {
  const classified = posts.map(classifyPost);
  const issueCounts = new Map();
  const sentimentCounts = { positive_language: 0, negative_language: 0, mixed_or_unclear: 0 };
  const geographyCounts = { oyo_named: 0, oyo_unconfirmed: 0 };
  const platformCounts = {};
  for (const item of classified) {
    sentimentCounts[item.sentiment]++;
    geographyCounts[item.geography]++;
    platformCounts[item.platform] = (platformCounts[item.platform] || 0) + 1;
    for (const issue of item.issues) issueCounts.set(issue.key, (issueCounts.get(issue.key) || 0) + 1);
  }
  const issueMap = [...issueCounts].map(([key, count]) => ({
    key, label: ISSUE_TAXONOMY.find(x => x.key === key)?.label || key, posts: count
  })).sort((a,b) => b.posts-a.posts);
  const daily = new Map();
  for (const item of classified) {
    const day = item.publishedAt ? new Date(item.publishedAt).toISOString().slice(0,10) : "unknown";
    daily.set(day, (daily.get(day) || 0) + 1);
  }
  return {
    sampleSize: posts.length,
    issueMap,
    sentimentLanguageCounts: sentimentCounts,
    geographicEvidenceCounts: geographyCounts,
    platformCounts,
    dailyTrend: [...daily].sort(([a],[b]) => a.localeCompare(b)).map(([date,count]) => ({ date, posts: count })),
    classifiedPosts: classified
  };
}
function buildReport(type, aggregate, days) {
  const topIssues = aggregate.issueMap.slice(0, 5);
  const limitations = [
    "This is a descriptive analysis of the public posts currently collected, not a representative survey of Oyo residents.",
    "Geographic labels require an explicit Oyo place-name match; absence of a place-name does not prove the post is unrelated to Oyo.",
    "Sentiment counts are transparent keyword indicators of language, not validated human sentiment or support for a politician.",
    "Posts can contain duplicate claims, sarcasm, Yoruba/Pidgin nuance, or incomplete context; human evidence review is required."
  ];
  const findings = {
    sampleSize: aggregate.sampleSize,
    periodDays: days,
    issueMap: aggregate.issueMap,
    sentimentLanguageCounts: aggregate.sentimentLanguageCounts,
    geographicEvidenceCounts: aggregate.geographicEvidenceCounts,
    platformCounts: aggregate.platformCounts,
    dailyTrend: aggregate.dailyTrend,
    topIssues,
    evidenceSample: aggregate.classifiedPosts.slice(0, 50)
  };
  if (type === "swot") {
    findings.swot = {
      strengths: ["Potential strengths must be established from corroborated evidence of delivered services, functioning programmes or measurable outcomes."],
      weaknesses: topIssues.map(x => "Review public discussion concerning " + x.label + "; frequency alone does not establish an actual weakness."),
      opportunities: ["Use recurring, geographically evidenced service-delivery issues to identify questions for public agencies and community consultation."],
      threats: ["Unverified claims, misinformation, uneven platform coverage and unrepresentative online participation can distort interpretation."]
    };
  } else if (type === "pestle") {
    findings.pestle = [
      { dimension: "Political", signal: "Governance, representation and institutional discussion", issues: aggregate.issueMap.filter(x => ["governance","representation"].includes(x.key)) },
      { dimension: "Economic", signal: "Jobs, business, food systems and public finance", issues: aggregate.issueMap.filter(x => ["jobs_economy","agriculture","public_finance"].includes(x.key)) },
      { dimension: "Social", signal: "Education, health and community safety", issues: aggregate.issueMap.filter(x => ["education","health","security"].includes(x.key)) },
      { dimension: "Technological", signal: "Technology signals require explicit evidence in source posts", issues: [] },
      { dimension: "Legal", signal: "Legislation, justice and procurement discussion", issues: aggregate.issueMap.filter(x => ["governance","security","public_finance"].includes(x.key)) },
      { dimension: "Environmental", signal: "Water, sanitation, flooding and environmental discussion", issues: aggregate.issueMap.filter(x => x.key === "environment") }
    ];
  } else if (type === "risk") {
    findings.risks = [
      { risk: "Coverage bias", level: "high", basis: "Current collection is limited to configured and accessible platform sources." },
      { risk: "Geographic misclassification", level: "medium", basis: "Place-name matching can miss local references and can misread ambiguous names." },
      { risk: "Unverified claims", level: "high", basis: "Social posts are leads for verification, not proof." },
      { risk: "Language and sarcasm", level: "medium", basis: "Automated keyword rules may miss Yoruba/Pidgin meanings, idioms and sarcasm." }
    ];
  } else if (type === "evidence_review") {
    findings.evidenceReview = aggregate.classifiedPosts.slice(0, 50).map(x => ({
      platform: x.platform, url: x.url, publishedAt: x.publishedAt,
      geography: x.geography, geographicEvidence: x.geographicEvidence,
      evidenceType: x.evidenceType, issueLabels: x.issues.map(i => i.label),
      reviewStatus: "needs_human_verification", excerpt: x.text
    }));
  }
  return {
    reportType: type,
    title: type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) + " — Oyo public discourse",
    scope: { geography: "Oyo State, Nigeria", anchor: "Sarafadeen Alli", periodDays: days },
    methodology: { version: "descriptive-rules-v1", sampleSize: aggregate.sampleSize, aggregateOnly: true },
    findings, limitations
  };
}
module.exports = { ISSUE_TAXONOMY, classifyPost, aggregatePosts, buildReport };
