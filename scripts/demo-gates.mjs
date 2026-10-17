#!/usr/bin/env node
// demo-gates.mjs — replay the harness gates against a throw-away session, with NO store credentials.
// Shows what the PreToolUse / Stop hooks do when the model tries to skip a step of the process.
//   node scripts/demo-gates.mjs
// Everything here runs locally: the hooks only read the (synthetic) transcript, the session state
// and file mtimes. Nothing talks to Shopify.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { root, guardarState } from "../.claude/hooks/_gate-lib.mjs";

const SID = "demo-gates";
const tmp = join(root, ".claude", "state", "demo-tmp");
mkdirSync(tmp, { recursive: true });
const transcript = join(tmp, "transcript.jsonl");
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.now() - 60000;
// A synthetic transcript: the operator asked for an edit, never said "publish".
writeFileSync(transcript, [
  { type: "user", origin: { kind: "human" }, message: { role: "user", content: "cambia el color del botón de la PDP a verde" }, timestamp: iso(T0) },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hecho en el tema de staging." }] }, timestamp: iso(T0 + 5000) },
].map((e) => JSON.stringify(e)).join("\n") + "\n");

function hook(file, payload) {
  try {
    execFileSync(process.execPath, [join(root, ".claude", "hooks", file)], {
      input: JSON.stringify({ session_id: SID, transcript_path: transcript, cwd: root, ...payload }),
      stdio: ["pipe", "pipe", "pipe"], cwd: root, timeout: 30000,
    });
    return { code: 0, err: "" };
  } catch (e) { return { code: e.status, err: String(e.stderr || "") }; }
}
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

const scenarios = [
  ["The model tries to publish a theme without the operator's OK and without a backup",
    () => hook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs demo-store theme publish --theme 123456789"))],
  ["The model tries a raw CLI push (bypassing the safe wrapper)",
    () => hook("pre_tool.mjs", bash("shopify theme push --live --path stores/demo-store/theme"))],
  ["The model tries a catalog mutation with a human-readable product handle (rule: initials only)",
    () => hook("pre_tool.mjs", bash(`node scripts/admin-graphql.mjs demo-store 'mutation { productUpdate(input:{id:"gid://1", handle:"the-blue-lamp-set"}) { product { id } } }'`))],
  ["The model tries to generate a paid image with no request/approval in the transcript",
    () => hook("pre_tool.mjs", { tool_name: "mcp__mcp-image__generate_image", tool_input: { prompt: "hero image" } })],
  ["The model tries to end the turn after editing a store, without the point-by-point confirmation",
    () => {
      // session state as post_tool.mjs would have written it: the theme of demo-store was edited in this session
      guardarState(SID, { session_id: SID, startedAt: T0, transcript, temas: { "demo-store": Date.now() }, pushes: {}, publishes: {}, mutaciones: [], descartadas: [] });
      return hook("cierre.mjs", {});
    }],
];

let i = 0;
for (const [title, run] of scenarios) {
  i++;
  console.log(`\n[${i}/${scenarios.length}] ${title}`);
  const r = run();
  console.log(r.code === 2 ? "→ BLOCKED by the hook (exit 2). What the model sees:" : `→ allowed (exit ${r.code})`);
  if (r.err) console.log(r.err.trim().split("\n").map((l) => "   " + l).join("\n"));
}
rmSync(tmp, { recursive: true, force: true });
try { rmSync(join(root, ".claude", "state", `${SID}.json`)); } catch {}
