#!/usr/bin/env node
// Hook PostToolUse (Bash | Edit | Write | MultiEdit): registra en el estado de sesión lo que
// realmente ha pasado (qué tema se editó, qué se pusheó/publicó, qué mutaciones de catálogo se
// lanzaron) — es la evidencia que usan los gates de publish y de cierre. Además, si la tienda tiene
// el candado de clon armado, recuerda el bucle de convergencia en el momento (con throttle).
import { statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { root, leerHookInput, stateOInicial, guardarState, tiendaDePath, tiendaDeComando, candadoClon } from "./_gate-lib.mjs";

const hook = leerHookInput();
const tool = hook.tool_name || "";
const input = hook.tool_input || {};
const st = stateOInicial(hook);
const now = Date.now();
let contexto = "";

if (/^(Edit|Write|MultiEdit)$/.test(tool)) {
  const tienda = tiendaDePath(input.file_path);
  if (tienda) {
    st.temas[tienda] = now;
    if (candadoClon(tienda)) {
      const capdir = join(root, "capturas");
      const throttle = join(capdir, `.conv-remind-${tienda}`);
      let reciente = false;
      try { reciente = (now - statSync(throttle).mtimeMs) < 5 * 60 * 1000; } catch {}
      if (!reciente) {
        try { mkdirSync(capdir, { recursive: true }); writeFileSync(throttle, String(now)); } catch {}
        contexto = `⛔ EDICIÓN DE CLON (${tienda}, candado armado): tras esta tanda → node scripts/convergencia.mjs ${tienda} <url-ref> <url-clon> → Read de los PNG → reescribir capturas/informe-diferencias-${tienda}.md (sección a sección) → corregir y repetir hasta "0 diferencias". El gate de publish y el de cierre lo exigen.`;
      }
    }
  }
}

if (tool === "Bash") {
  const cmd = String(input.command || "");
  const tienda = tiendaDeComando(cmd);
  if (tienda && /\bsafe-push\.mjs\b/.test(cmd)) st.pushes[tienda] = now;
  if (tienda && (/\btheme\s+publish\b/.test(cmd) || /\bpush-live\.mjs\b/.test(cmd))) st.publishes[tienda] = now;
  if (tienda && /\badmin-graphql\.mjs\b/.test(cmd) && /\bmutation\b/i.test(cmd)) {
    const kind = (cmd.match(/\b(product\w+|publishablePublish|discount\w+|menu\w+|page\w+|shopPolicyUpdate|collection\w+|inventory\w+|file\w+)\s*\(/) || [])[1] || "mutation";
    st.mutaciones.push({ ts: now, tienda, kind });
    if (/^(product|publishable|inventory)/.test(kind)) {
      contexto += (contexto ? "\n" : "") + `📒 Mutación de catálogo en ${tienda} (${kind}): si cambia producto/precio/oferta/handle y la tienda es del EQUIPO, actualiza memoria/productos-en-marcha.md en ESTA tanda (el gate de cierre lo exige).`;
    }
  }
}

guardarState(hook.session_id, st);
if (contexto) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: contexto } }));
process.exit(0);
