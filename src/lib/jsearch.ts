import type { JSearchJob, JSearchResponse, RawJob } from "@/types";

const JSEARCH_BASE = "https://jsearch.p.rapidapi.com/search";
const FEED_NAME = "JSearch (LinkedIn/Indeed/Glassdoor)";

// ─── Fetch jobs from JSearch API ─────────────────────────────────────────────

export async function fetchJSearchJobs(query: string): Promise<RawJob[]> {
  const apiKey = process.env.JSEARCH_API_KEY;

  if (!apiKey) {
    console.warn("  ⚠️  JSEARCH_API_KEY not set — skipping JSearch fetch");
    return [];
  }

  const params = new URLSearchParams({
    query,
    page: "1",
    num_pages: "1",
    date_posted: "today",     // only jobs posted today
    remote_jobs_only: "false", // include all — we score relevance with AI
    employment_types: "FULLTIME,CONTRACTOR",
  });

  const res = await fetch(`${JSEARCH_BASE}?${params}`, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      'Content-Type': 'application/json'
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JSearch API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as JSearchResponse;

  if (data.status !== "OK" || !Array.isArray(data.data)) {
    throw new Error(`JSearch unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data.data.map(normalizeJSearchJob);
}

// ─── Normalize JSearch job → RawJob shape used by the rest of the agent ──────

function normalizeJSearchJob(job: JSearchJob): RawJob {
  const location = [job.job_city, job.job_country].filter(Boolean).join(", ");
  const remote = job.job_is_remote ? " · Remote" : "";
  const salary = buildSalaryString(job);

  const snippet = [
    job.job_description?.slice(0, 300),
    location ? `📍 ${location}${remote}` : remote ? "📍 Remote" : "",
    salary,
    job.job_required_skills?.length
      ? `🛠 Skills: ${job.job_required_skills.slice(0, 5).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    guid: `jsearch-${job.job_id}`,
    title: job.job_title,
    link: job.job_apply_link,
    creator: job.employer_name,
    contentSnippet: snippet,
    isoDate: job.job_posted_at_datetime_utc ?? new Date().toISOString(),
    // Pass feedName via a custom field — agent reads this
    feedName: FEED_NAME,
  } as RawJob & { feedName: string };
}

function buildSalaryString(job: JSearchJob): string {
  if (!job.job_min_salary && !job.job_max_salary) return "";
  const currency = job.job_salary_currency ?? "USD";
  const min = job.job_min_salary ? `${currency} ${job.job_min_salary.toLocaleString()}` : "";
  const max = job.job_max_salary ? `${currency} ${job.job_max_salary.toLocaleString()}` : "";
  if (min && max) return `💰 ${min} – ${max}`;
  return `💰 ${min || max}`;
}

export { FEED_NAME as JSEARCH_FEED_NAME };
