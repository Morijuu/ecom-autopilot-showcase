#!/usr/bin/env node
// SessionStart (AÑADIDO 2026-10-08, no sustituye a session_start.mjs): el orquestador arranca leyendo el DASHBOARD del Diario,
// así un chat nuevo sigue por donde iba el anterior (el operador: "cuando llegue al 60 % y lo reabras, no pierdes nada"). Nunca bloquea.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DIARIO = process.env.CEREBRO_DIARIO_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "ecom-diario");
try {
  const dash = path.join(DIARIO, "scripts", "dashboard.mjs");
  if (fs.existsSync(dash)) spawnSync(process.execPath, [dash], { cwd: DIARIO, stdio: "ignore", timeout: 60000 });
  const md = fs.readFileSync(path.join(DIARIO, "dashboard.md"), "utf8");
  const sec = (n) => (md.split(/^## /m).find(s => s.startsWith(n)) || "").split("\n").slice(1).join("\n").trim();
  const abiertos = sec("2.").split(/^### /m).slice(1).map(b => b.split("\n")[0].trim()).slice(0, 25);
  const decisiones = sec("3.").split("\n").filter(l => l.startsWith("- ")).slice(0, 12);
  let out = "🧠 CEREBRO — eres el ORQUESTADOR. Trabaja DELGADO: reparte cada encargo a un subagente (tema · clonador · qa-visual · catalogo · imagenes · archivero; email/analista en evolve-brain; ventas-discord en ecom-diario) y quédate con ruta + ≤10 líneas; no hagas tú el trabajo de fondo. ";
  out += "El estado de cada trabajo es un DATO: línea `Etapa: <PENDIENTE | EN PROCESO | PENDIENTE DEL OPERADOR | BLOQUEADO | COMPLETADO> — <qué> (fecha)` en su ticket, que actualizas (o el archivero) en CADA cambio de etapa; el dashboard la lee. ";
  out += `Dashboard: ${path.join(DIARIO, "dashboard.md")} (regenerado ahora).\n`;
  out += abiertos.length ? `TRABAJOS ABIERTOS (${abiertos.length}):\n` + abiertos.map(a => "  · " + a).join("\n") + "\n" : "TRABAJOS ABIERTOS: ninguno con Etapa escrita.\n";
  if (decisiones.length) out += "DECISIONES PENDIENTES DEL OPERADOR:\n" + decisiones.map(d => "  " + d).join("\n") + "\n";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: out } }));
} catch {}
process.exit(0);
