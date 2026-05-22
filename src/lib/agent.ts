import RSSParser from "rss-parser";
import type { RawJob, ScoredJob, AgentRunResult } from "@/types";
import { FEEDS, JSEARCH_QUERIES, MIN_SCORE } from "@/lib/config";
import { getSeenIds, saveSeenIds, addSeen } from "@/lib/seen";
import { scoreJob } from "@/lib/scorer";
import { sendTelegramAlert } from "@/lib/telegram";
import { fetchJSearchJobs, JSEARCH_FEED_NAME } from "@/lib/jsearch";

const FRONTEND_KEYWORDS = [
  "frontend", "front-end", "front end",
  "react", "nextjs", "next.js", "vue", "angular",
  "ui developer", "ui engineer", "javascript developer",
  "typescript developer", "web developer", "web engineer",
  "software engineer", "software developer",
];

const EXCLUDED_KEYWORDS = [
  "product manager", "backend", "back-end", "devops",
  "data engineer", "data scientist", "machine learning",
  "qa engineer", "test engineer", "designer", "sales",
  "recruiter", "hr ", "python developer", "java developer",
  "ios", "android", "mobile developer", ".net", "ruby",
];

const parser = new RSSParser({
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; JobAlertBot/1.0)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractId(item: RawJob): string {
  return item.guid ?? item.link ?? item.title ?? Math.random().toString();
}

function extractCompany(item: RawJob, feedName: string): string {
  return item.creator ?? feedName;
}

function isWithinLastDay(dateStr?: string): boolean {
  if (!dateStr) return true;
  const posted = new Date(dateStr).getTime();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return posted >= oneDayAgo;
}

function isFrontendJob(title: string): boolean {
  const lower = title.toLowerCase();

  // Reject if title contains excluded keywords
  if (EXCLUDED_KEYWORDS.some((kw) => lower.includes(kw))) return false;

  // Accept if title contains frontend keywords
  if (FRONTEND_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // Otherwise let AI decide
  return true;
}

// ─── Process a single job item ────────────────────────────────────────────────

async function processJob(
  item: RawJob,
  feedName: string,
  seenIds: string[],
  ranAt: string
): Promise<{
  seenIds: string[];
  scoredJob: ScoredJob | null;
  alerted: boolean;
}> {
  const id = extractId(item);

  if (seenIds.includes(id)) {
    return { seenIds, scoredJob: null, alerted: false };
  }

  const updatedSeen = addSeen(seenIds, id);
  const jobWithFeed = { ...item, feedName };
  const { score, reason } = await scoreJob(jobWithFeed);

  // Hard filter by title before wasting a Groq API call
  if (!isFrontendJob(item.title ?? "")) {
    console.log(`  🚫 Filtered out — ${item.title?.slice(0, 60)}`);
    return { seenIds: updatedSeen, scoredJob: null, alerted: false };
  }

  const indicator = score >= MIN_SCORE ? "✅" : "⬜";
  console.log(`  ${indicator} ${score}/10 — ${(item.title ?? "Untitled").slice(0, 60)}`);

  if (score < MIN_SCORE) {
    return { seenIds: updatedSeen, scoredJob: null, alerted: false };
  }

  const scoredJob: ScoredJob = {
    id,
    title: item.title ?? "Untitled",
    company: extractCompany(item, feedName),
    link: item.link ?? "#",
    feedName,
    snippet: (item.contentSnippet ?? "").slice(0, 200),
    score,
    reason,
    pubDate: item.isoDate ?? item.pubDate ?? ranAt,
    alertedAt: ranAt,
  };

  try {
    await sendTelegramAlert(scoredJob);
    await new Promise((r) => setTimeout(r, 500)); // avoid Telegram rate limits
    return { seenIds: updatedSeen, scoredJob, alerted: true };
  } catch (err) {
    console.error("  ❌ Telegram send failed:", (err as Error).message);
    return { seenIds: updatedSeen, scoredJob, alerted: false };
  }
}

// ─── RSS Feed Fetcher ─────────────────────────────────────────────────────────

async function runRSSFeeds(
  seenIds: string[],
  ranAt: string
): Promise<{ seenIds: string[]; fetched: number; alertsSent: number; jobs: ScoredJob[] }> {
  let currentSeen = seenIds;
  let fetched = 0;
  let alertsSent = 0;
  const jobs: ScoredJob[] = [];

  for (const feed of FEEDS) {
    console.log(`\n  📡 Fetching RSS: ${feed.name}`);
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items as RawJob[]).slice(0, 15);
      fetched += items.length;

      for (const item of items) {
        if (!isWithinLastDay(item.isoDate ?? item.pubDate)) {
          console.log(`  ⏭️  Skipping old — ${item.title?.slice(0, 50)}`);
          continue;
        }

        const result = await processJob(item, feed.name, currentSeen, ranAt);
        currentSeen = result.seenIds;
        if (result.scoredJob) jobs.push(result.scoredJob);
        if (result.alerted) alertsSent++;
      }
    } catch (err) {
      console.error(`  ❌ RSS error (${feed.name}):`, (err as Error).message);
    }
  }

  return { seenIds: currentSeen, fetched, alertsSent, jobs };
}

// ─── JSearch Fetcher ──────────────────────────────────────────────────────────

async function runJSearch(
  seenIds: string[],
  ranAt: string
): Promise<{ seenIds: string[]; fetched: number; alertsSent: number; jobs: ScoredJob[] }> {
  let currentSeen = seenIds;
  let fetched = 0;
  let alertsSent = 0;
  const jobs: ScoredJob[] = [];

  for (const query of JSEARCH_QUERIES) {
    console.log(`\n  🔎 JSearch query: "${query}"`);
    try {
      const items = await fetchJSearchJobs(query);
      fetched += items.length;
      console.log(`     Found ${items.length} jobs`);

      for (const item of items) {
        const result = await processJob(item, JSEARCH_FEED_NAME, currentSeen, ranAt);
        currentSeen = result.seenIds;
        if (result.scoredJob) jobs.push(result.scoredJob);
        if (result.alerted) alertsSent++;
      }

      // Small delay between JSearch queries to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  ❌ JSearch error ("${query}"):`, (err as Error).message);
    }
  }

  return { seenIds: currentSeen, fetched, alertsSent, jobs };
}

// ─── Main Agent ───────────────────────────────────────────────────────────────

export async function runAgent(): Promise<AgentRunResult> {
  const ranAt = new Date().toISOString();
  console.log(`\n[${ranAt}] 🔍 Running job agent...`);
  console.log(`  Sources: ${FEEDS.length} RSS feeds + ${JSEARCH_QUERIES.length} JSearch queries`);

  let seenIds = getSeenIds();
  let totalFetched = 0;
  let totalAlerts = 0;
  const allJobs: ScoredJob[] = [];

  // ── Step 1: RSS Feeds ──────────────────────────────────────────────
  console.log("\n── RSS Feeds ──────────────────────────────────────────");
  const rss = await runRSSFeeds(seenIds, ranAt);
  seenIds = rss.seenIds;
  totalFetched += rss.fetched;
  totalAlerts += rss.alertsSent;
  allJobs.push(...rss.jobs);

  // ── Step 2: JSearch (LinkedIn + Indeed + Glassdoor) ────────────────
  console.log("\n── JSearch ────────────────────────────────────────────");
  const jsearch = await runJSearch(seenIds, ranAt);
  seenIds = jsearch.seenIds;
  totalFetched += jsearch.fetched;
  totalAlerts += jsearch.alertsSent;
  allJobs.push(...jsearch.jobs);

  // ── Save & summarize ───────────────────────────────────────────────
  saveSeenIds(seenIds);
  console.log(`\n✅ Done. Fetched ${totalFetched} jobs. Sent ${totalAlerts} alerts.`);

  return {
    ranAt,
    totalFetched,
    alertsSent: totalAlerts,
    jobs: allJobs,
  };
}

