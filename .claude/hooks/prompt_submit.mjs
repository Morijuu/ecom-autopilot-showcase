#!/usr/bin/env node
// Hook UserPromptSubmit: lee CADA prompt del operador en el momento.
//  · Si es un "cierro el turno" (o similar) → marca el cierre en el estado y entrega al asistente el
//    INVENTARIO de la sesión (correcciones, gustos, links, tiendas tocadas) con la orden de recogerlo todo
//    en memoria sin que el operador lo enumere (regla del operador 2026-09-10). El gate de cierre lo exige después.
//  · Si parece una corrección o un gusto → aviso inmediato para fichar AHORA (no al final).
import { leerHookInput, stateOInicial, guardarState, leerTranscript, promptsHumanos, senalesDeSesion, RE_CIERRE_TURNO, RE_CORRECCION, RE_GUSTO } from "./_gate-lib.mjs";

const hook = leerHookInput();
const prompt = String(hook.prompt || "");
if (!prompt.trim()) process.exit(0);
const st = stateOInicial(hook);
const now = Date.now();
const salida = [];

if (RE_CIERRE_TURNO.test(prompt)) {
  st.cierrePedido = now;
  const prompts = promptsHumanos(leerTranscript(st.transcript || hook.transcript_path));
  if (!prompts.some(p => p.text.trim() === prompt.trim())) prompts.push({ ts: now, text: prompt });
  const s = senalesDeSesion(prompts);
  const tiendas = [...new Set([...Object.keys(st.temas || {}), ...Object.keys(st.pushes || {}), ...Object.keys(st.publishes || {}), ...(st.mutaciones || []).map(m => m.tienda)])];
  const li = (arr, f) => arr.length ? arr.map(x => "   - " + f(x)).join("\n") : "   - (ninguna detectada por patrón — repasa igualmente el chat)";
  salida.push(
    "🔚 CIERRE DE TURNO pedido por el operador. Recoge TODO esto en memoria SIN preguntar y SIN que él lo enumere (regla 2026-09-10). Inventario de la sesión (solo prompts reales del operador):",
    "1) CORRECCIONES → una ficha por cada una en memoria/errores/ (plantilla _plantillas/error.md, verbatim) + línea en errores/INDEX.md; si una RIMA con una ficha existente, actualiza esa:",
    li(s.correcciones, c => `«${c.texto}»`),
    "2) GUSTOS / APROBACIONES / RECHAZOS → memoria/gustos.md (gusto del operador) o clientes/<cliente>.md (gusto del cliente); qué gustó y POR QUÉ:",
    li(s.gustos, g => `«${g.texto}»`),
    "3) LINKS que el operador pasó → referencias/<slug>.md (+ línea en referencias/INDEX.md) si es tienda de referencia/rival, o al ticket si es otra cosa. El gate de cierre comprueba que cada URL aparece en memoria/:",
    li(s.urls, u => u.url),
    "4) TIENDAS tocadas → ticket (tickets/<fecha>-<cliente>.md con verbatim, qué se hizo, delta exacto, bloque 'Feedback del operador': correcciones N + qué gustó) + tiendas/<t>.md + hub del cliente + productos-en-marcha.md si cambió producto:",
    li(tiendas, t => t),
    "5) LECCIONES técnicas de la sesión (cómo SÍ) → aprendido/<tema>.md + línea en su INDEX. Si algo se repitió ≥2 veces, promociónalo (regla de /curar).",
    "6) git add -A && git commit && git push. Termina con un resumen corto de QUÉ quedó guardado (fichas, gustos, referencias, ticket) — no con preguntas.",
    "7) NORMA 1 del operador (solo si el turno EDITÓ algo o pides OK de publicar; preguntas/links sin bloque): el mensaje final lleva el bloque literal \"CONFIRMACIÓN PUNTO POR PUNTO\" con los 12 puntos (QA visual · Fidelidad · Interacciones · Colores · Imágenes · Memoria y links · Alcance · Go-live · Ofertas/bundles · Ambición de diseño · Scroll igual que la fuente · Botones: TODOS pulsados y responden igual; Scroll/Botones se re-comprueban solo si la edición puede afectarles), cada uno con ✅/N/A + DÓNDE se aplicó o POR QUÉ está cubierto. Sin eso el gate no deja cerrar. UNA sola vez al terminar del todo, plegado en <details> (el operador 2026-10-14: no repetirlo en cada turno).",
  );
} else {
  const ess = prompts_slice_check();
  if (ess.correccion) salida.push(`⚠️ Esto parece una CORRECCIÓN del operador («${prompt.replace(/\s+/g, " ").slice(0, 120)}»): crea la ficha en memoria/errores/ AHORA (no al final) + línea en INDEX. El gate de cierre lo exigirá.`);
  if (ess.gusto) salida.push(`💡 Esto parece un GUSTO/APROBACIÓN/RECHAZO: destila QUÉ y POR QUÉ en memoria/gustos.md (o el hub del cliente) AHORA.`);
}

function prompts_slice_check() {
  // la primera petición de la sesión describe el encargo, no corrige nada
  const previos = promptsHumanos(leerTranscript(st.transcript || hook.transcript_path)).filter(p => p.text.trim() !== prompt.trim());
  return { correccion: previos.length > 0 && RE_CORRECCION.test(prompt), gusto: RE_GUSTO.test(prompt) };
}

guardarState(hook.session_id, st);
if (salida.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: salida.join("\n") } }));
process.exit(0);
