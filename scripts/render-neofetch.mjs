#!/usr/bin/env node
/**
 * Renders the neofetch-style profile card: assets/neofetch-dark.svg and
 * assets/neofetch-light.svg.
 *
 * Layout follows the neofetch convention that most GitHub profile READMEs
 * copy: a pixel-art avatar on the left, a key/value system readout on the
 * right, everything in a monospace grid.
 *
 * The numbers are fetched from the GitHub API at render time. The static
 * identity strings are the parts that describe the person, so they stay in
 * this file and are reviewed like content.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/render-neofetch.mjs
 *
 * Optional env:
 *   PROFILE_USER   login to read (default: the repository owner)
 *   OUT_DIR        output directory (default: assets)
 *
 * The login is only used to query the API. It is never written into the
 * rendered card.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_OWNER = process.env.GITHUB_REPOSITORY?.split("/")[0];
const USER = process.env.PROFILE_USER || REPO_OWNER;
const OUT_DIR = resolve(process.env.OUT_DIR || "assets");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

if (!USER) {
  console.error("PROFILE_USER is required when GITHUB_REPOSITORY is not set");
  process.exit(1);
}

const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "User-Agent": "winsell-profile-neofetch",
  Accept: "application/vnd.github+json",
};

/* ------------------------------------------------------------------ palette */

const THEMES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    chrome: "#161b22",
    text: "#c9d1d9",
    key: "#ffa657",
    value: "#a5d6ff",
    dim: "#6e7681",
    accent: "#f5a623",
    addition: "#3fb950",
    body: "#f5a623",
    shade: "#c07f10",
    beak: "#ffd08a",
    eye: "#0d1117",
    water: "#30363d",
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    chrome: "#f6f8fa",
    text: "#1f2328",
    key: "#bc4c00",
    value: "#0550ae",
    dim: "#8b949e",
    accent: "#bf6e00",
    addition: "#1a7f37",
    body: "#f2a72b",
    shade: "#c9821a",
    beak: "#f7c66b",
    eye: "#ffffff",
    water: "#d0d7de",
  },
};

/* ------------------------------------------------------------------ avatar */

// 24 x 20 grid. # body, s shade, b beak, e eye, ~ water, . transparent.
const DUCK = [
  "........................",
  "..............####......",
  ".............######.....",
  ".............###e##.....",
  ".............######bbb..",
  ".............######bb...",
  "..............####......",
  "..............####......",
  "............########....",
  ".......#############....",
  ".....################...",
  "...####ssssssss#######..",
  "..####ssssssssss######..",
  "..####ssssssssss######..",
  "..#####ssssssss#######..",
  "...##################...",
  ".....##############.....",
  "........########........",
  "........................",
  "...~~~....~~~~....~~~...",
];

/* ------------------------------------------------------------------- fetch */

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
            weeks { contributionDays { contributionCount date } }
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

async function fetchRepos() {
  const res = await fetch(
    `${API}/users/${USER}/repos?per_page=100&type=owner`,
    { headers: HEADERS },
  );
  if (!res.ok) throw new Error(`users/${USER}/repos -> ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------------- stats */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function accountAge(createdAt) {
  const start = new Date(createdAt);
  const now = new Date();
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let months = now.getUTCMonth() - start.getUTCMonth();
  let days = now.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months--;
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    days += prev.getUTCDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const parts = [];
  if (years) parts.push(plural(years, "year"));
  if (months) parts.push(plural(months, "month"));
  if (!years && days) parts.push(plural(days, "day"));
  return parts.join(", ") || "today";
}

function buildStats(calendar, repos, user) {
  const days = calendar.weeks.flatMap((w) => w.contributionDays);
  const active = days.filter((d) => d.contributionCount > 0).length;

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

  const live = repos.filter((r) => !r.archived && !r.fork);
  return {
    uptime: accountAge(user.created_at),
    commits: calendar.totalContributions.toLocaleString("en-US"),
    active: `${active} / ${days.length} days`,
    streak: `${longest} days`,
    repos: String(live.length),
  };
}

/* ------------------------------------------------------------------ render */

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Every value is anchored to its own x coordinate instead of being padded with
 * spaces. Rendered SVG cannot be relied on to preserve whitespace (GitHub's
 * pipeline, image viewers and rasterisers all differ), so the column is a
 * geometry decision, not a text one.
 */
const VALUE_X = 207; // 23 monospace cells at 9px

function row(y, key, value, t) {
  return (
    `<text x="0" y="${y}" fill="${t.dim}">. <tspan fill="${t.key}" font-weight="600">${esc(key)}</tspan>:</text>` +
    `<text x="${VALUE_X}" y="${y}" fill="${t.value}">${esc(value)}</text>`
  );
}

/**
 * Rules are ASCII hyphens, not U+2500 box drawing. Box-drawing glyphs only line
 * up when the renderer picks a real monospace face; a fallback face gives them a
 * different advance and the rule runs off the card. Hyphens are safe everywhere.
 */
function section(y, label, t) {
  return (
    `<text x="0" y="${y}" fill="${t.dim}">- <tspan fill="${t.key}" font-weight="600">${esc(label)}</tspan> ${"-".repeat(44)}</text>`
  );
}

function prompt(y, t) {
  return (
    `<text x="0" y="${y}" fill="${t.dim}">` +
    `<tspan fill="${t.key}" font-weight="600">smokeyduck</tspan>` +
    `<tspan>@</tspan>` +
    `<tspan fill="${t.key}" font-weight="600">winsell</tspan>` +
    ` ${"-".repeat(30)}` +
    `</text>`
  );
}

function duck(x, y, cell, t) {
  const parts = [];
  for (let r = 0; r < DUCK.length; r++) {
    const line = DUCK[r];
    if (line.length !== 24) {
      throw new Error(`duck row ${r} is ${line.length} cells, expected 24`);
    }
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ".") continue;
      const fill =
        ch === "#" ? t.body
        : ch === "s" ? t.shade
        : ch === "b" ? t.beak
        : ch === "e" ? t.eye
        : t.water;
      parts.push(
        `<rect x="${x + c * cell}" y="${y + r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`,
      );
    }
  }
  return `<g shape-rendering="crispEdges">${parts.join("")}</g>`;
}

function render(stats, t) {
  const W = 985;
  const CELL = 15;
  const ART_X = 34;
  const ART_Y = 82;
  const TEXT_X = ART_X + 24 * CELL + 44; // 438
  const LINE = 20;
  const TOP = 96; // baseline of the first row

  let y = TOP;
  const next = () => {
    const at = y;
    y += LINE;
    return at;
  };

  const body = [];
  // The four codebase figures below are a snapshot of the private WinSell
  // monorepo: GitHub cannot measure a repository it is not allowed to read, so
  // they are content here rather than something the runner can compute.
  body.push(prompt(next(), t));

  body.push(row(next(), "OS", "Director @ WinSell", t));
  body.push(row(next(), "Uptime", stats.uptime, t));
  body.push(row(next(), "Host", "WinSell - Can Tho, Vietnam", t));
  body.push(row(next(), "Kernel", "AI + SEO/GEO/AEO infrastructure", t));
  body.push(row(next(), "Shell", "TypeScript, Rust, Python", t));
  body.push(row(next(), "WM", "NestJS 11, Next.js 16", t));
  body.push(row(next(), "Terminal", "Tauri v2, Docker, Actions", t));
  body.push(row(next(), "CPU", "608 files, 72,898 LOC", t));
  body.push(row(next(), "Memory", "195 endpoints, 31 models", t));

  next();
  body.push(section(next(), "Contact", t));
  body.push(row(next(), "Web", "winsell.vn, wisa.vn", t));
  body.push(row(next(), "Email", "contact@winsell.vn", t));
  body.push(row(next(), "GitHub", "github.com/winsell-vn", t));

  next();
  body.push(section(next(), "Activity", t));
  body.push(row(next(), "Commits", `${stats.commits} / 12 months`, t));
  body.push(row(next(), "Active", stats.active, t));
  body.push(row(next(), "Longest", `${stats.streak} unbroken`, t));
  body.push(row(next(), "Repos", `${stats.repos} public`, t));

  next();
  body.push(section(next(), "Ships", t));
  body.push(row(next(), "social-hive", "SEO/GEO/AEO content engine", t));
  body.push(row(next(), "wisa-connect", "Rust/Tauri gateway client", t));
  body.push(row(next(), "BotCrawlSEO", "Python SEO analyser", t));

  // Shell prompt closing the readout, with a block cursor. The cursor is the
  // only moving part on the card: SMIL animates inside an <img>, so the card
  // keeps one live detail without needing a script.
  next();
  const shell = next();
  const promptText = "smokeyduck@winsell:~$";
  const cursorX = promptText.length * 9 + 6;

  const H = y + 22; // one baseline of breathing room under the last row

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace" font-size="15" role="img" aria-label="smokeyduck at WinSell, terminal system readout">
<rect width="${W}" height="${H}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
<rect x="0" y="0" width="${W}" height="34" rx="14" fill="${t.chrome}"/>
<rect x="0" y="20" width="${W}" height="14" fill="${t.chrome}"/>
<circle cx="22" cy="17" r="5.5" fill="#ff5f57"/>
<circle cx="42" cy="17" r="5.5" fill="#febc2e"/>
<circle cx="62" cy="17" r="5.5" fill="#28c840"/>
<text x="${W / 2}" y="22" text-anchor="middle" font-size="12" fill="${t.dim}">smokeyduck@winsell: ~/profile</text>
${duck(ART_X, ART_Y, CELL, t)}
<g transform="translate(${TEXT_X} 0)">
${body.join("\n")}
<text x="0" y="${shell}" fill="${t.key}" font-weight="600">${promptText}</text>
<rect x="${cursorX}" y="${shell - 12}" width="8" height="15" fill="${t.value}">
<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.45;0.5;0.95;1" dur="1.4s" repeatCount="indefinite"/>
</rect>
</g>
</svg>
`;
}

/* -------------------------------------------------------------------- main */

const user = await fetchUser();
const calendar = await fetchCalendar();
const repos = await fetchRepos();
const stats = buildStats(calendar, repos, user);

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  const file = join(OUT_DIR, `neofetch-${name}.svg`);
  writeFileSync(file, render(stats, t), "utf8");
  console.log(`wrote ${file}`);
}
console.log(
  `commits=${stats.commits} active=${stats.active} repos=${stats.repos} uptime=${stats.uptime}`,
);
