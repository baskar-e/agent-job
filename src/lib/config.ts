import type { FeedConfig } from "@/types";

export const FEEDS: FeedConfig[] = [
  {
    name: "RemoteOK",
    url: "https://remoteok.com/remote-frontend-jobs.rss",
  },
  {
    name: "WeWorkRemotely",
    url: "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  },
  {
    name: "Jobicy",
    url: "https://jobicy.com/?feed=job_feed&job_categories=dev-engineering&job_types=full-time",
  },
  {
    name: "HN Who's Hiring",
    url: "https://hnrss.org/whoishiring",
  },
];
 
// JSearch queries — each runs as a separate API call
export const JSEARCH_QUERIES = [
  "frontend developer react india",
];
 

export const YOUR_PROFILE = `
  - 3 years of frontend development experience
  - Strong in React, JavaScript, TypeScript
  - Familiar with HTML, CSS, REST APIs, Next.js
  - Open to remote, hybrid, or on-site roles in India
  - Looking for mid-level frontend positions
`;

export const MIN_SCORE = parseInt(process.env.MIN_SCORE ?? "7", 10);
