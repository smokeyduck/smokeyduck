#!/usr/bin/env node
/**
 * Renders assets/metrics.svg — a self-hosted "contribution telemetry" card.
 *
 * Everything is fetched from the GitHub API at render time, so the card can
 * never drift from the real numbers. No third-party card service involved.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/render-metrics.mjs
 *
 * Optional env:
 *   PROFILE_USER     login to render (default: hungtqce180632)
 *   OUT_FILE         output path (default: assets/metrics.svg)
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USER = process.env.PROFILE_USER || "hungtqce180632";
const OUT = resolve(process.env.OUT_FILE || "assets/metrics.svg");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "User-Agent": "winsell-profile-metrics",
  Accept: "application/vnd.github+json",
};

/* ------------------------------------------------------------------ palette */

const COLORS = {
  bg: "#0b0f14",
  chrome: "#121a22",
  border: "#1f2933",
  grid0: "#12181e",
  grid1: "#1b3a2a",
  grid2: "#2f7d4f",
  grid3: "#58c47c",
  grid4: "#f5a623",
  amber: "#f5a623",
  green: "#3ddc84",
  grey: "#8b949e",
  dim: "#5a6572",
};

/* -------------------------------------------------------------------- fetch */

async function fetchUser() {
  const res = await fetch(`${API}/users/${USER}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`users/${USER} -> ${res.status}`);
  return res.json();
}

async function fetchCalendar() {
  const query = `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                contributionLevel
                weekday
              }
            }
          }
        }
      }
    }`;
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.user.contributionsCollection.contributionCalendar;
}

/* ------------------------------------------------------------------- stats */

function buildStats(days) {
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else break;
  }

  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  const active = days.filter((d) => d.contributionCount > 0).length;

  return { current, longest, active, days: days.length };
}

const LEVEL_OF = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

/* ------------------------------------------------------------------ render */

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 30;
const TOP = 60;

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(calendar, user) {
  const weeks = calendar.weeks;
  const days = weeks.flatMap((w) => w.contributionDays);
  const stats = buildStats(days);

  const cols = weeks.length;
  const width = PAD_X + cols * STEP + 20;
  const gridHeight = 7 * STEP;
  const height = TOP + gridHeight + 62;

  // month labels
  const months = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const first = week.contributionDays[0];
    if (!first) return;
    const month = new Date(`${first.date}T00:00:00Z`).getUTCMonth();
    if (month !== lastMonth) {
      months.push({ x: PAD_X + i * STEP, label: first.date.slice(0, 7) });
      lastMonth = month;
    }
  });

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthLabel = (iso) => {
    const [y, m] = iso.split("-").map(Number);
    return `${monthNames[m - 1]} '${String(y).slice(2)}`;
  };

  const cells = [];
  weeks.forEach((week, i) => {
    week.contributionDays.forEach((day) => {
      const level = LEVEL_OF[day.contributionLevel] ?? 0;
      const x = PAD_X + i * STEP;
      const y = TOP + day.weekday * STEP;
      const fill = COLORS[`grid${level}`];
      const tip = `${day.date} · ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`;
      cells.push(
        `    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}"><title>${esc(tip)}</title></rect>`
      );
    });
  });

  const weekdayLabels = [1, 3, 5].map((d) => {
    const y = TOP + d * STEP + CELL - 2;
    return `    <text x="${PAD_X - 8}" y="${y}" text-anchor="end" class="mono dim" font-size="9">${
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]
    }</text>`;
  });

  const monthLabels = months.map((m) => {
    return `    <text x="${m.x}" y="${TOP - 10}" class="mono dim" font-size="10">${monthLabel(m.label)}</text>`;
  });

  const total = calendar.totalContributions;
  const summary = [
    { k: "CONTRIBUTIONS", v: total.toLocaleString("en-US") },
    { k: "CURRENT STREAK", v: `${stats.current}d` },
    { k: "LONGEST STREAK", v: `${stats.longest}d` },
    { k: "ACTIVE DAYS", v: `${stats.active}/${stats.days}` },
    { k: "PUBLIC REPOS", v: String(user.public_repos) },
    { k: "FOLLOWERS", v: String(user.followers) },
  ];

  let x = PAD_X;
  const summaryWidth = width - PAD_X * 2;
  const colWidth = summaryWidth / summary.length;
  const summarySvg = summary.map((s, i) => {
    const cx = x + i * colWidth;
    return [
      `    <text x="${cx}" y="${TOP + gridHeight + 26}" class="mono dim" font-size="9.5" letter-spacing="1">${s.k}</text>`,
      `    <text x="${cx}" y="${TOP + gridHeight + 46}" class="mono amber" font-size="17" font-weight="700">${esc(s.v)}</text>`,
    ].join("\n");
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Contribution telemetry for ${USER}">
  <style>
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace; }
    .dim { fill: ${COLORS.dim}; }
  </style>

  <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="${COLORS.bg}" />
  <rect x="0" y="0" width="${width}" height="32" fill="${COLORS.chrome}" />
  <rect x="0" y="31" width="${width}" height="1" fill="${COLORS.border}" />
  <circle cx="20" cy="16" r="4.5" fill="#ff5f56" />
  <circle cx="36" cy="16" r="4.5" fill="#ffbd2e" />
  <circle cx="52" cy="16" r="4.5" fill="#27c93f" />
  <text x="72" y="20" class="mono" fill="${COLORS.grey}" font-size="11.5">contributions — ${USER}</text>
  <text x="${width - 16}" y="20" text-anchor="end" class="mono" fill="${COLORS.green}" font-size="11.5">live</text>

${monthLabels.join("\n")}
${weekdayLabels.join("\n")}
${cells.join("\n")}

${summarySvg.join("\n")}

  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="${COLORS.border}" />
</svg>
`;
}

/* --------------------------------------------------------------------- run */

const [user, calendar] = await Promise.all([fetchUser(), fetchCalendar()]);
const svg = render(calendar, user);
writeFileSync(OUT, svg, "utf8");
console.log(`wrote ${OUT}`);
console.log(
  `contributions=${calendar.totalContributions} active=${calendar.weeks.flatMap((w) => w.contributionDays).filter((d) => d.contributionCount > 0).length}`
);
