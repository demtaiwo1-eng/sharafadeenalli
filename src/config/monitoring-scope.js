const MONITORING_SCOPE = Object.freeze({
  id: "oyo-sarafadeen-alli",
  geography: {
    primary: "Oyo State, Nigeria",
    coverage: ["Ibadan", "Ogbomosho", "Oyo", "Ibarapa", "Oke-Ogun", "Oyo South", "Oyo Central", "Oyo North"],
    secondary: "Federal policy and national developments only where they materially affect Oyo State"
  },
  anchor: {
    name: "Sarafadeen Alli",
    roleLabel: "Public-figure monitoring anchor",
    matchingTerms: ["Sarafadeen Alli", "Sarafadeen", "Senator Sarafadeen Alli", "Sen. Sarafadeen Alli", "#Sarafadeen", "#SarafadeenAlli"],
    note: "The anchor is a discovery and context reference, not an assumption of endorsement or a conclusion about any person."
  },
  issueAreas: [
    "Oyo State governance and public administration",
    "State and local government policy and service delivery",
    "Infrastructure, roads, transport and urban development",
    "Education, health and social services",
    "Agriculture, food systems and rural development",
    "Jobs, skills, business and cost of living",
    "Security, justice and community safety",
    "Environment, water and sanitation",
    "Budgets, public spending and procurement",
    "Legislation, representation and constituency issues",
    "Political parties, elections and public institutions"
  ],
  collection: {
    includePublicPosts: true,
    includePublicReplies: true,
    includeNestedRepliesWherePermitted: true,
    discoverHashtagsFromCollectedContent: true,
    extractWordsAndPhrases: true,
    preserveSourceAndTimestamp: true,
    languages: ["English", "Yoruba", "Nigerian Pidgin"],
    geographicEvidenceRequired: true,
    individualPoliticalProfiling: false,
    voterPreferenceInference: false,
    individualTargetedPoliticalPersuasion: false
  },
  analysis: ["trend", "sentiment_with_uncertainty", "issue_map", "public_institution_coverage", "evidence_review", "swot", "pestle", "risk", "service_delivery_gaps"],
  guardrails: [
    "Treat Sarafadeen Alli as the initial monitoring anchor, not as the only subject or presumed beneficiary.",
    "Include criticism, support, neutral reporting and competing perspectives.",
    "Do not assume a post is about Oyo solely because it mentions the anchor; retain a geographic relevance label and evidence.",
    "Separate verified facts, claims, opinions and automated model interpretations.",
    "Use aggregate public-discourse analysis; do not profile individuals' political opinions or infer voter preferences."
  ]
});

module.exports = { MONITORING_SCOPE };
