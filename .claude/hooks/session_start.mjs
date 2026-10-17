#!/usr/bin/env node
// Hook de arranque (SessionStart): sincroniza git él solo (pull --ff-only si el árbol está limpio),
// avisa del estado real de la rama (contra SU upstream, no contra main) y abre el estado de sesión
// que usan los gates. No falla nunca: si algo va mal, arranca igual.
import { execSync } from "node:child_process";
import { leerHookInput, stateOInicial, guardarState } from "./_gate-lib.mjs";

function git(cmd) {
  try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

const hook = leerHookInput();
const st = stateOInicial(hook);
st.startedAt = st.startedAt || Date.now();
guardarState(hook.session_id, st);

let aviso = "";
try {
  git("fetch --quiet");
  const rama = git("rev-parse --abbrev-ref HEAD");
  const dirty = git("status --porcelain");
  const tieneUpstream = !!git("rev-parse --abbrev-ref @{u}");
  if (rama && rama !== "main") {
    aviso += `\n⚠️ Estás en la rama \`${rama}\`, no en main. El trabajo del kit va SIEMPRE en main (2026-09-05→09 se perdieron 138 commits fuera de main). Si esta rama no es un experimento aparte: \`git checkout main && git merge --ff-only ${rama}\`.`;
  }
  if (tieneUpstream) {
    const [behind, ahead] = (git("rev-list --left-right --count @{u}...HEAD") || "0 0").split(/\s+/).map(Number);
    if (behind > 0 && !dirty) {
      const r = git("pull --ff-only --quiet");
      aviso += r === "" && !git("rev-list --count @{u}..HEAD").startsWith("-")
        ? `\n✅ git pull hecho automáticamente (${behind} commit(s) nuevos de otra máquina/sesión).`
        : `\n⚠️ Vas ${behind} commit(s) por detrás y el pull automático no pudo (¿divergencia?). Resuélvelo antes de tocar nada.`;
    } else if (behind > 0) {
      aviso += `\n⚠️ Vas ${behind} commit(s) por detrás pero hay cambios sin commitear: commit + \`git pull\` ANTES de tocar nada.`;
    }
    if (ahead > 0) aviso += `\n🚨 Tienes ${ahead} commit(s) sin pushear — \`git push\` AHORA, antes de cualquier tarea.`;
  } else {
    aviso += `\n⚠️ La rama no tiene upstream: \`git push -u origin ${rama}\`.`;
  }
  if (dirty) aviso += `\n📝 Tienes cambios sin guardar — destílalos a memoria/ y cierra: add + commit + push (sin que nadie lo pida).`;
} catch { /* sin git remoto o sin conexión: seguimos */ }

// Secretos cifrados (regla del operador 2026-10-09): baja los tokens que otros dispositivos subieron y sube cifrados
// los .env locales nuevos. Sin clave en este dispositivo → aviso para importarla.
try {
  const out = execSync("node scripts/secretos.mjs sync --hook --push", { stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }).toString().trim();
  const r = out ? JSON.parse(out) : {};
  if (r.bajados?.length) aviso += `\n🔑 Tokens bajados de git (otro dispositivo): ${r.bajados.join(", ")}.`;
  if (r.subidos?.length) aviso += `\n🔑 Tokens locales subidos cifrados a git: ${r.subidos.join(", ")}.`;
  if (r.avisos?.length) aviso += `\n⚠️ Secretos: ${r.avisos.join(" · ")}`;
  if (r.error) aviso += `\n⚠️ Secretos: ${r.error}`;
  if (!out) aviso += `\n⚠️ Este dispositivo NO tiene la clave de secretos (~/.ecom-autopilot/secretos.key): sin ella no hay tokens de tiendas. Pídesela al operador → \`node scripts/secretos.mjs importar-clave <fichero>\`.`;
} catch { /* nunca bloquea el arranque */ }

const contexto = [
  "ecom-autopilot — recuerda el arranque:",
  "1) abre memoria/INDEX.md + memoria/gustos.md + memoria/errores/INDEX.md (RECALL: no repitas errores — di cuáles aplican hoy)",
  "2) identifica MODO (edit-fix/clonar/desde cero) y tienda; si es DISEÑO, mira también memoria/referencias/INDEX.md",
  "2b) KICKOFF (reglal operador 2026-08-20): tras el reconocimiento, UN mensaje con TODAS las preguntas + accesos que harán falta + PLAN numerado → luego ejecución sin interrupciones (solo queda el OK de publicar).",
  "3) FUENTE DE VERDAD = el tema VIVO (pull fresco: node scripts/shopify-tienda.mjs <tienda> theme pull --live --force --path stores/<tienda>/theme).",
  "4) GATES CABLEADOS (bloquean, no avisan — `node scripts/gate.mjs estado <tienda>` te dice qué falta ANTES de intentarlo):",
  "   · publish/push-live: OK del operador en un prompt posterior al último push · backup <24h · validate_theme tras la última edición · capturas desktop+móvil posteriores a la última edición · si es CLON: convergencia + informe-diferencias con 0 diferencias + chequeos go-live en vivo (available, handle iniciales, sin marca del rival).",
  "   · safe-push: backup <24h · validate_theme tras la última edición · --only uno por fichero.",
  "   · imágenes (nano-gen / gen-image / mcp-image): solo si el operador las pidió o dio OK en un prompt real.",
  "   · admin-graphql: handle de producto = iniciales (sin guiones) · códigos de descuento sin endsAt · nada de *Delete sin --force.",
  "   · cierre de turno: memoria commiteada+pusheada · ticket del encargo escrito · cada corrección del operador con su ficha en errores/ · publish ⇒ link live en la PRIMERA línea · mutación de producto en tienda del equipo ⇒ productos-en-marcha.md actualizado · sin preguntas del tipo '¿quieres que lo guarde?'.",
  "🥇 NORMA 1 del operador (2026-09-10; solo al cerrar un trabajo que EDITÓ algo, no en preguntas/links): NADA está terminado sin el bloque literal \"CONFIRMACIÓN PUNTO POR PUNTO\" en el mensaje final: 12 puntos (QA visual · Fidelidad · Interacciones · Colores · Imágenes · Memoria y links · Alcance · Go-live · Ofertas/bundles · Ambición de diseño · Scroll igual que la fuente · Botones: TODOS pulsados y responden igual; Scroll/Botones se re-comprueban solo si la edición puede afectarles), cada uno con ✅/N/A + DÓNDE se aplicó en la tienda o POR QUÉ está cubierto. El gate de cierre lo bloquea. UNA sola vez al terminar del todo y PLEGADO en <details><summary>CONFIRMACIÓN PUNTO POR PUNTO</summary>…</details> (el operador 2026-10-14); pedir OK de publicar o turno a medias = \"⏳ EN CURSO\" + pendiente.",
  "Toda corrección del operador → ficha en memoria/errores/ AL MOMENTO (+ su línea en el INDEX). Autonomía: cero preguntas que la memoria ya responde, cero medias entregas.",
  aviso
].join("\n");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: contexto }
}));
