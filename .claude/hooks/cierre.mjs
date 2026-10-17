#!/usr/bin/env node
// Hook de cierre (Stop): GATE DURO del final de turno. Sustituye a recordar_cierre + convergencia_cierre.
// Solo mira lo que pasó en ESTA sesión (estado + transcript), así una sesión no bloquea a otra.
// Bloquea (exit 2) si:
//   1) hay cambios sin commitear o commits sin pushear (la memoria no está a salvo);
//   2) se tocó una tienda (tema/push/mutación) y no hay ticket escrito en memoria/tickets/ esta sesión;
//   3) el operador corrigió algo y no hay ficha nueva en memoria/errores/ posterior a esa corrección;
//   4) se publicó y el último mensaje no lleva el link live en la PRIMERA línea;
//   5) hubo mutación de producto en tienda del equipo y productos-en-marcha.md no se actualizó después;
//   6) tienda con candado de clon editada en esta sesión sin convergencia + informe de 0 diferencias;
//   7) el último mensaje pregunta lo prohibido ("¿quieres que lo guarde?", "¿hago commit?").
// Anti-bucle: con stop_hook_active (ya bloqueamos una vez) solo avisa.
import { execSync } from "node:child_process";
import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  root, leerHookInput, stateOInicial, guardarState, leerTranscript, promptsHumanos, ultimoTextoAsistente,
  ficherosNuevosDesde, esTiendaEquipo, candadoClon, RE_CORRECCION, RE_PREGUNTA_PROHIBIDA, minutos,
  senalesDeSesion, urlGuardadaEnMemoria, mtimeMasReciente, confirmacionPuntoPorPunto, textosAsistenteAnteriores, PUNTOS_OPERADOR, RE_EN_CURSO,
} from "./_gate-lib.mjs";
import { chequeosClon, formatear } from "./_gate-checks.mjs";

function git(cmd) {
  try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

const hook = leerHookInput();
const st = stateOInicial(hook);
guardarState(hook.session_id, st);
const entries = leerTranscript(st.transcript || hook.transcript_path);
const prompts = promptsHumanos(entries);
const ultimo = ultimoTextoAsistente(entries);
const fallos = [];

// 1) memoria a salvo
const dirty = git("status --porcelain");
const ahead = Number(git("rev-list --count @{u}..HEAD") || git("rev-list --count origin/main..HEAD") || "0");
if (dirty) fallos.push("cambios sin commitear:\n" + dirty.split("\n").slice(0, 12).map(l => "      " + l).join("\n") + "\n    → destila lo hecho en memoria/ (ticket, tienda, aprendido) y `git add -A && git commit -m \"<qué se hizo>\"`.");
if (ahead > 0) fallos.push(`${ahead} commit(s) SOLO en esta máquina → \`git push\` (sin push no existen para nadie).`);

// 1b) tokens subidos CIFRADOS a git (regla del operador 2026-10-09: "cada tienda nueva que se conecte se suba al git")
try {
  const out = execSync(`node scripts/secretos.mjs estado --json --desde ${st.startedAt || 0}`, { stdio: ["ignore", "pipe", "ignore"], timeout: 30000 }).toString();
  const r = JSON.parse(out || "{}");
  const pend = (r.pendientes || []).filter(p => p.estado === "sin-subir" || p.estado === "distinto");
  if (pend.length) fallos.push(r.clave
    ? `tokens tocados en esta sesión SIN subir cifrados a git: ${pend.map(p => p.id).join(", ")} → \`node scripts/secretos.mjs sync --push\`.`
    : `tokens nuevos (${pend.map(p => p.id).join(", ")}) y este dispositivo NO tiene la clave de secretos → importarla (\`node scripts/secretos.mjs importar-clave <fichero>\`) y \`node scripts/secretos.mjs sync --push\`.`);
} catch { /* sin node/script: no bloquea */ }

// 2) ticket del encargo
const tiendasTocadas = new Set([...Object.keys(st.temas), ...Object.keys(st.pushes), ...Object.keys(st.publishes), ...st.mutaciones.map(m => m.tienda)]);
if (tiendasTocadas.size) {
  const tickets = ficherosNuevosDesde(join(root, "memoria", "tickets"), st.startedAt, n => n.endsWith(".md"));
  if (!tickets.length) fallos.push(`se tocó ${[...tiendasTocadas].join(", ")} y NO hay ningún fichero de memoria/tickets/ escrito/actualizado en esta sesión (regla dura: el ticket se crea al llegar el encargo, con el verbatim de lo pedido).`);
}

// 2b) el operador pidió CERRAR EL TURNO → la recogida completa es obligatoria (regla 2026-09-10)
if (st.cierrePedido) {
  const s = senalesDeSesion(prompts);
  for (const u of s.urls) {
    if (!urlGuardadaEnMemoria(u.url)) fallos.push(`cierre de turno: el link que el operador pasó ${u.url} NO está en memoria/ (referencias/<slug>.md si es tienda de referencia/rival, o en el ticket). Ficha 2026-09-05: los links se guardan en el acto.`);
  }
  if (s.gustos.length) {
    const desde = Math.min(...s.gustos.map(g => g.ts)) - 1000;
    const tocado = ["gustos.md", "clientes", "referencias", "aprendido"].some(n => {
      const p = join(root, "memoria", n);
      try { return statSync(p).isDirectory() ? mtimeMasReciente(p) > desde : statSync(p).mtimeMs > desde; } catch { return false; }
    });
    if (!tocado) fallos.push(`cierre de turno: el operador expresó gustos/aprobaciones/rechazos (${s.gustos.length}: «${s.gustos[0].texto.slice(0, 90)}»…) y ni gustos.md, ni clientes/, ni referencias/, ni aprendido/ se han tocado después. Destila QUÉ gustó/no gustó y POR QUÉ.`);
  }
  if (tiendasTocadas.size === 0 && !ficherosNuevosDesde(join(root, "memoria", "tickets"), st.startedAt, n => n.endsWith(".md")).length) {
    fallos.push("cierre de turno: no hay ticket de esta sesión en memoria/tickets/ (cada encargo deja su ticket con verbatim + qué se hizo + bloque 'Feedback del operador').");
  }
  if (ultimo && !/(guardad|fichad|memoria|ticket|commit)/i.test(ultimo)) fallos.push("cierre de turno: el mensaje final debe resumir QUÉ quedó guardado (fichas, gustos, referencias, ticket, commit).");
}

// 3) correcciones del operador → ficha en errores/
const correcciones = prompts.slice(1).filter(p => RE_CORRECCION.test(p.text));
for (const c of correcciones) {
  const hoy = new Date().toISOString().slice(0, 10), ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const fichas = ficherosNuevosDesde(join(root, "memoria", "errores"), c.ts - 1000, n => n.endsWith(".md") && (n.startsWith(hoy) || n.startsWith(ayer)));
  const descartada = st.descartadas.some(d => d.ts > c.ts);
  if (!fichas.length && !descartada) {
    fallos.push(`el operador corrigió algo (hace ${minutos(c.ts)} min): «${c.text.replace(/\s+/g, " ").slice(0, 140)}» y NO hay ficha nueva en memoria/errores/ posterior. Crea la ficha (plantilla _plantillas/error.md: qué hice mal · cómo se detectó · corrección · regla para SIEMPRE, con su frase verbatim) + su línea en errores/INDEX.md. Si de verdad NO es una corrección: node scripts/gate.mjs descartar-correccion "<motivo>" (queda auditado).`);
  }
}

// 4) publish ⇒ link live en la primera línea
if (Object.keys(st.publishes).length && ultimo) {
  const primera = ultimo.split("\n").map(l => l.trim()).find(l => l);
  if (!/https?:\/\/\S+/.test(primera || "")) fallos.push(`se publicó en ${Object.keys(st.publishes).join(", ")} y el link LIVE no está en la PRIMERA línea del mensaje final (ficha 2026-09-08: el operador no vio el link enterrado en el informe). Reescribe la entrega empezando por el link clicable.`);
}

// 5) mutación de producto en tienda del equipo ⇒ productos-en-marcha.md
const mutProd = st.mutaciones.filter(m => /^(product|publishable|inventory)/.test(m.kind) && esTiendaEquipo(m.tienda));
if (mutProd.length) {
  let m = 0;
  try { m = statSync(join(root, "memoria", "productos-en-marcha.md")).mtimeMs; } catch {}
  const ultimaMut = Math.max(...mutProd.map(x => x.ts));
  if (m < ultimaMut) fallos.push(`hubo mutaciones de catálogo en ${[...new Set(mutProd.map(x => x.tienda))].join(", ")} (tienda del equipo) y memoria/productos-en-marcha.md NO se actualizó después (reglal operador 2026-09-03: bloque de la tienda + línea en su Diario; refresca con node scripts/productos-en-marcha.mjs <tienda>).`);
}

// 6) clon: convergencia + informe (solo tiendas editadas en ESTA sesión)
for (const tienda of Object.keys(st.temas)) {
  if (candadoClon(tienda)) fallos.push(...chequeosClon(tienda, st).map(f => `[${tienda}] ${f}`));
}

// 0) NORMA 1 del operador (2026-09-10): trabajo sobre una tienda ⇒ confirmación punto por punto de los 10 puntos
//    en el mensaje final; sin ella la tarea NO está completada. Turno a medias = marcador "⏳ EN CURSO" + pendiente
//    (no vale cuando el operador ha pedido cerrar el turno).
// el operador 2026-09-15: "si no te pido que edites nada no hace falta que hagas la CONFIRMACIÓN PUNTO POR PUNTO" →
// solo se exige si en ESTE turno (tras su último prompt real) hubo edición de tema, push, publish o mutación.
const ultimoPromptTs = prompts.length ? prompts[prompts.length - 1].ts : 0;
const editadoEsteTurno = [...Object.values(st.temas), ...Object.values(st.pushes), ...Object.values(st.publishes), ...st.mutaciones.map(m => m.ts)]
  .some(ts => ts > ultimoPromptTs);
// el operador 2026-10-14: "deja de repetir la confirmacion punto por punto tantas veces, ponlo solo cuando termines del todo"
// → si en esta sesión ya se entregó un bloque completo, los ajustes posteriores no lo repiten (salvo cierre de turno).
// Cuando va, va plegado en <details> ("puedes mandarlo en formato desplegable para que no me ocupe tanta vista?").
const yaConfirmado = textosAsistenteAnteriores(entries).some(t => confirmacionPuntoPorPunto(t).ok);
if ((editadoEsteTurno && !yaConfirmado) || st.cierrePedido) {
  const enCurso = RE_EN_CURSO.test(ultimo) && !st.cierrePedido;
  if (!enCurso) {
    const c = confirmacionPuntoPorPunto(ultimo);
    if (!c.ok) {
      fallos.unshift(
        `NORMA 1 del operador: la tarea NO se puede dar por completada sin la CONFIRMACIÓN PUNTO POR PUNTO en el mensaje final` +
        (c.sinCabecera ? " (falta el bloque entero)" : ` (faltan o están sin justificar: ${c.faltan.join(", ")})`) +
        `. Añade un bloque literal "CONFIRMACIÓN PUNTO POR PUNTO" con los 12 puntos, cada uno en su línea: estado (✅/N/A) + DÓNDE se aplicó en la tienda o POR QUÉ está cubierto (fichero, sección, URL, captura, descuento…; ≥40 caracteres, nunca "ok" a secas; Scroll/Botones ya comprobados y sin edición que les afecte = N/A + cuándo se comprobó): ` +
        PUNTOS_OPERADOR.map(p => `${p.n}. ${p.label}`).join(" · ") +
        `. Si el trabajo sigue a medias (esperando su OK), escribe "⏳ EN CURSO" + qué queda pendiente.`
      );
    }
  }
}

// 7) preguntas prohibidas
// solo cuenta una pregunta REAL: fuera del texto entrecomillado (ejemplos citados) y en el tramo final del mensaje
const cola = ultimo.replace(/["«“][^"»”\n]{0,200}["»”]/g, "").split("\n").filter(l => l.trim()).slice(-4).join("\n");
if (cola && RE_PREGUNTA_PROHIBIDA.test(cola)) {
  fallos.push("el mensaje final pregunta algo que la memoria ya responde (guardar/commit/push/publicar/seguir): PROHIBIDO preguntar \"¿quieres que lo guarde?\" — se hace y se sigue. Reescribe sin la pregunta.");
}

// 8) CEREBRO (2026-10-07, añadido — no bloquea): al cerrar limpio, cada ticket tocado en ESTA sesión manda su estado al Diario
//    (ecom-diario/inbox/eventos.jsonl) vía scripts/diario-evento.mjs. Estado: "⏳ EN CURSO" → EN PROGRESO · "✅ HECHO" o
//    publish en la sesión → HECHO · si no → EN PROGRESO. Idempotente (diario-evento dedupe por ticket+tienda+estado <10 min).
if (!fallos.length) {
  try {
    const { spawnSync } = await import("node:child_process");
    const { readFileSync } = await import("node:fs");
    const evento = join(root, "scripts", "diario-evento.mjs");
    const ticketsSesion = ficherosNuevosDesde(join(root, "memoria", "tickets"), st.startedAt, n => n.endsWith(".md"));
    const publicadas = Object.keys(st.publishes);
    for (const t of ticketsSesion) {
      const nombre = typeof t === "string" ? t : t.name;   // ficherosNuevosDesde devuelve {name, mtime}
      const abs = join(root, "memoria", "tickets", nombre);
      let txt = ""; try { txt = readFileSync(abs, "utf8"); } catch {}
      // tienda = un handle real de la tienda (xxxxxx-xx) del ticket o de las tiendas tocadas; nunca un token suelto ("convergencia")
      const RE_H = /(?<![a-z0-9-])([a-z0-9]{6}-[a-z0-9]{2})(?![a-z0-9-])/i;
      const cab = txt.split("\n").slice(0, 12).join(" ");
      const tiendaTicket = ((cab.match(RE_H) || [])[1] || [...tiendasTocadas].find(x => RE_H.test(x) && txt.includes(x)) || "-").toLowerCase();
      // ETAPA (el operador 2026-10-08: el estado es un DATO escrito, no una inferencia): la ÚLTIMA línea `Etapa: <PENDIENTE | EN PROCESO |
      // PENDIENTE DEL OPERADOR | BLOQUEADO | COMPLETADO> — …` del ticket manda. Compatibilidad: ⏳ EN CURSO al inicio de línea (→ EN PROCESO,
      // o PENDIENTE DEL OPERADOR si el texto espera su OK) · ✅ HECHO (→ COMPLETADO) · publish en la sesión (→ COMPLETADO). Sin nada → no se emite.
      const etapas = [...txt.matchAll(/^\s*(?:-\s*)?(?:\*\*)?Etapa(?:\*\*)?:\s*(?:\*\*)?([A-ZÁÉÍÓÚ ]+?)(?:\*\*)?\s*(?:—|-|\(|$)/gim)].map(m => m[1].toUpperCase().trim());
      const RE_L = (m) => new RegExp(`^\\s*(>\\s*)?(-\\s*)?(\\*\\*)?${m}`, "m");
      const esperaOK = /pendiente de (su |tu )?OK|OK del operador|decid(e|ir|a) el operador|espera(ndo)? (el |su |tu )?OK/i.test(txt);
      const estado = etapas.length ? etapas[etapas.length - 1]
        : RE_L("⏳\\s*EN CURSO").test(txt) ? (esperaOK ? "PENDIENTE DEL OPERADOR" : "EN PROCESO")
        : RE_L("✅\\s*HECHO").test(txt) ? "COMPLETADO"
        : publicadas.includes(tiendaTicket) ? "COMPLETADO" : null;
      if (!estado) continue;
      spawnSync(process.execPath, [evento, "--area", "taller", "--tienda", tiendaTicket, "--estado", estado, "--ticket", `memoria/tickets/${nombre}`, "--fuente", "hook-cierre"], { stdio: "ignore", timeout: 90000 });
    }
  } catch {}
  process.exit(0);
}
const msg = "⛔ NO CIERRES TODAVÍA — gate de cierre:\n" + formatear(fallos) + "\nEl operador NUNCA va a pedir esto: es parte de la tarea.";
if (hook.stop_hook_active) { process.stderr.write(msg.replace("⛔ NO CIERRES TODAVÍA — ", "⚠️ RECORDATORIO (no re-bloqueo) — ") + "\n"); process.exit(0); }
process.stderr.write(msg + "\n");
process.exit(2);
