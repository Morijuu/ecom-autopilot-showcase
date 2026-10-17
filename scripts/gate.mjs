#!/usr/bin/env node
// gate.mjs — el CLI de los GATES cableados al harness (.claude/hooks/).
//   node scripts/gate.mjs estado <tienda>                  → dry-run del gate de publish/safe-push: qué falta ANTES de intentarlo
//   node scripts/gate.mjs cierre                           → dry-run del gate de cierre de turno
//   node scripts/gate.mjs descartar-correccion "<motivo>"  → marca como NO-corrección el último prompt que el gate tomó por
//                                                            corrección (queda auditado en memoria/errores/_descartadas.md)
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { root, stateMasReciente, guardarState } from "../.claude/hooks/_gate-lib.mjs";
import { chequeosPublish, chequeosSafePush, formatear } from "../.claude/hooks/_gate-checks.mjs";

const [accion, ...args] = process.argv.slice(2);
const st = stateMasReciente();

if (accion === "estado") {
  const tienda = args[0];
  if (!tienda) { console.error("Uso: node scripts/gate.mjs estado <tienda>"); process.exit(1); }
  if (!st) console.log("(sin estado de sesión: los chequeos que dependen del transcript saldrán en rojo)");
  const sp = chequeosSafePush(tienda, st, "");
  console.log(`safe-push a ${tienda}: ${sp.length ? "⛔ BLOQUEARÍA\n" + formatear(sp) : "✅ pasaría"}`);
  const pub = await chequeosPublish(tienda, st, {});
  console.log(`publish en ${tienda}: ${pub.length ? "⛔ BLOQUEARÍA\n" + formatear(pub) : "✅ pasaría"}`);
  process.exit(0);
}

if (accion === "cierre") {
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync(process.execPath, [join(root, ".claude", "hooks", "cierre.mjs")], { input: JSON.stringify({ session_id: st?.session_id, transcript_path: st?.transcript, stop_hook_active: true }), stdio: ["pipe", "inherit", "inherit"] });
  } catch {}
  process.exit(0);
}

if (accion === "descartar-correccion") {
  const motivo = args.join(" ").trim();
  if (!motivo || !st) { console.error("Uso: node scripts/gate.mjs descartar-correccion \"<motivo honesto>\""); process.exit(1); }
  st.descartadas.push({ ts: Date.now(), motivo });
  guardarState(st.session_id, st);
  appendFileSync(join(root, "memoria", "errores", "_descartadas.md"), `- ${new Date().toISOString().slice(0, 16)} sesión ${String(st.session_id).slice(0, 8)}: ${motivo}\n`);
  console.log("Descartada y auditada en memoria/errores/_descartadas.md (el operador puede revisarla).");
  process.exit(0);
}

console.error("Uso: node scripts/gate.mjs estado <tienda> | cierre | descartar-correccion \"<motivo>\"");
process.exit(1);
