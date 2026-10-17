#!/usr/bin/env node
// record-demo.mjs — renders a terminal replay of the REAL outputs of the gate scripts and records it to docs/demo.gif.
//   node docs/record-demo.mjs          (needs: playwright with chromium, ffmpeg on PATH)
// 1) runs the commands for real and captures their stdout/stderr
// 2) replays them in a fake terminal page (typing animation) under Playwright with video recording
// 3) converts the webm to a palette-optimised GIF with ffmpeg
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rec = join(root, "docs", "_rec");
rmSync(rec, { recursive: true, force: true });
mkdirSync(rec, { recursive: true });

function run(cmd, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
}
const selftest = run("node", ["scripts/gate-selftest.mjs"]).trim().split("\n").slice(-3).join("\n");
const demo = run("node", ["scripts/demo-gates.mjs"]).trim();
const estado = run("node", ["scripts/gate.mjs", "estado", "demo-store"]).trim();
const blocks = demo.split(/\n(?=\[\d\/5\])/);

const steps = [
  ["node scripts/gate-selftest.mjs | tail -3", selftest],
  ...blocks.map((b, i) => [i === 0 ? "node scripts/demo-gates.mjs" : "", b]),
  ["node scripts/gate.mjs estado demo-store", estado],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const color = (s) => esc(s)
  .replace(/(⛔[^\n]*)/g, '<span class="red">$1</span>')
  .replace(/(→ BLOCKED[^\n]*)/g, '<span class="red b">$1</span>')
  .replace(/(✓[^\n]*)/g, '<span class="green">$1</span>')
  .replace(/(43\/43 verdes)/g, '<span class="green b">$1</span>')
  .replace(/(\[\d\/5\][^\n]*)/g, '<span class="yellow b">$1</span>')
  .replace(/(⛔ BLOQUEARÍA|✅ pasaría)/g, '<span class="b">$1</span>');

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#0b0f14;color:#d7dde5;font:15px/1.45 "Cascadia Mono","JetBrains Mono",Consolas,monospace}
#t{padding:22px 26px;white-space:pre-wrap;word-break:break-word;min-height:100vh;box-sizing:border-box}
.p{color:#7aa2f7}.cmd{color:#fff}.red{color:#ff6b6b}.green{color:#7ee787}.yellow{color:#ffd866}.b{font-weight:700}
.cur{display:inline-block;width:9px;height:17px;background:#d7dde5;vertical-align:-3px;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}
.title{color:#8b949e;margin-bottom:14px}
</style><div id="t"><div class="title"># ecom-autopilot — the harness gates, replayed locally (no store credentials)</div></div>
<script>
const steps=${JSON.stringify(steps.map(([c, o]) => [c, color(o)]))};
const t=document.getElementById("t");const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function type(cmd){const line=document.createElement("div");line.innerHTML='<span class="p">$ </span><span class="cmd"></span><span class="cur"></span>';t.appendChild(line);const c=line.querySelector(".cmd");for(const ch of cmd){c.textContent+=ch;await sleep(28);}await sleep(350);line.querySelector(".cur").remove();}
async function out(h){const d=document.createElement("div");d.innerHTML=h;t.appendChild(d);d.scrollIntoView({block:"end"});window.scrollTo(0,document.body.scrollHeight);}
(async()=>{await sleep(800);for(const [c,o] of steps){if(c)await type(c);await out(o);await sleep(c?6000:7500);window.scrollTo(0,document.body.scrollHeight);}await sleep(2500);document.title="DONE";})();
</script>`;
writeFileSync(join(rec, "term.html"), html);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: rec, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto("file:///" + join(rec, "term.html").replace(/\\/g, "/"));
await page.waitForFunction(() => document.title === "DONE", null, { timeout: 180000 });
await ctx.close(); await browser.close();
const webm = readdirSync(rec).find((f) => f.endsWith(".webm"));
renameSync(join(rec, webm), join(rec, "demo.webm"));
execFileSync("ffmpeg", ["-y", "-i", join(rec, "demo.webm"), "-vf", "fps=8,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5", "-loop", "0", join(root, "docs", "demo.gif")], { stdio: "inherit" });
console.log("docs/demo.gif written");
