/**
 * Rasterise the brand SVGs to PNG (X does not accept SVG uploads).
 * Run from the repo root:  node brand/rasterize.mjs
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

const jobs = [
  { svg: "x-avatar.svg", png: "x-avatar.png", width: 400 },
  { svg: "x-banner.svg", png: "x-banner.png", width: 1500 },
  { svg: "og-image.svg", png: "og-image.png", width: 1200 },
  { svg: "x-avatar-agent.svg", png: "x-avatar-agent.png", width: 400 },
  { svg: "x-banner-agent.svg", png: "x-banner-agent.png", width: 1500 },
];

for (const job of jobs) {
  const svg = readFileSync(join(dir, job.svg), "utf8");
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: job.width } });
  const png = resvg.render().asPng();
  writeFileSync(join(dir, job.png), png);
  console.log(`${job.png}  —  ${(png.length / 1024).toFixed(0)} KB`);
}
