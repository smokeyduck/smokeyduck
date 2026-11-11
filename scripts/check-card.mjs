#!/usr/bin/env node
/**
 * Geometry guard for the neofetch cards.
 *
 * The card is generated, so a bad value would only show up as a broken image
 * on the profile page, where nothing reports an error. This script reads the
 * generated SVGs back and fails loudly instead.
 *
 * Checks:
 *   - every shape and text baseline sits inside the viewBox
 *   - no rendered line is wider than the space left of the card margin
 *   - the avatar grid is complete and inside its column
 *   - the retired account handle never appears
 *
 * Usage: node scripts/check-card.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ASSETS = resolve("assets");
const MARGIN = 30; // keep text this far from the right edge
const CHAR_PX = 9; // advance of a 15px monospace cell
const BANNED = ["hungtqce", "180632", "H\u01b0ng Tr\u01b0\u01a1ng"];

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const problems = [];

for (const file of readdirSync(ASSETS).filter((f) => /^neofetch-.*\.svg$/.test(f))) {
  const svg = readFileSync(join(ASSETS, file), "utf8");
  const [, width, height] = svg
    .match(/width="(\d+)" height="(\d+)" viewBox/)
    .map(Number);
  const W = width;
  const H = height;

  for (const word of BANNED) {
    if (svg.includes(word)) {
      problems.push(`${file}: contains retired identifier "${word}"`);
    }
  }

  // Shapes.
  for (const m of svg.matchAll(
    /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
  )) {
    const [x, y, w, h] = m.slice(1).map(Number);
    if (x < 0 || y < 0 || x + w > W || y + h > H) {
      problems.push(`${file}: rect ${x},${y} ${w}x${h} escapes ${W}x${H}`);
    }
  }

  // Text. Only the readout lives inside a translate() group, so fold the
  // offset in for matches that fall past the group's opening tag.
  const groupOpen = svg.search(/<g transform="translate\(\d+ 0\)">/);
  const groupX =
    groupOpen < 0
      ? 0
      : Number(svg.match(/<g transform="translate\((\d+) 0\)">/)[1]);

  for (const m of svg.matchAll(
    /<text x="(-?[\d.]+)" y="(-?[\d.]+)"([^>]*)>([\s\S]*?)<\/text>/g,
  )) {
    const x = Number(m[1]) + (m.index > groupOpen ? groupX : 0);
    const y = Number(m[2]);
    const centred = /text-anchor="middle"/.test(m[3]);
    const text = strip(m[4]);
    const w = text.length * CHAR_PX;
    const left = centred ? x - w / 2 : x;
    const right = left + w;

    if (y < 0 || y > H - 4) {
      problems.push(`${file}: baseline ${y} outside 0..${H}`);
    }
    if (left < MARGIN || right > W - MARGIN) {
      problems.push(
        `${file}: "${text.slice(0, 28)}" spans ${Math.round(left)}..${Math.round(right)}, ` +
          `limit ${MARGIN}..${W - MARGIN}`,
      );
    }
  }

  console.log(`${file}: ${W}x${H} ok`);
}

// The avatar must keep its 24x20 grid, checked on the source of truth.
const source = readFileSync(resolve("scripts", "render-neofetch.mjs"), "utf8");
const grid = [...source.matchAll(/^ {2}"([.#sbe~]{24})",$/gm)].map((m) => m[1]);
if (grid.length !== 20) {
  problems.push(`avatar grid has ${grid.length} rows, expected 20`);
}

if (problems.length) {
  console.error("\nFAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("\nall checks passed");
