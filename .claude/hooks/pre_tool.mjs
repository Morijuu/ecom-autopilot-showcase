#!/usr/bin/env node
// Hook PreToolUse (Bash | mcp__mcp-image__generate_image): GATES que BLOQUEAN (exit 2) acciones que
// el operador corrigió repetidas veces. Cada chequeo se apoya en evidencia no fabricable: prompts reales
// del operador en el transcript, herramientas realmente usadas, mtimes de backups/capturas/informes.
// Dry-run de los mismos chequeos: node scripts/gate.mjs estado <tienda>
import { join } from "node:path";
import { leerHookInput, stateOInicial, guardarState, tiendaDeComando, RE_APROBACION, RE_INTENCION_IMAGEN, leerTranscript, promptsHumanos } from "./_gate-lib.mjs";
import { chequeosPublish, chequeosSafePush, chequeosAdminGraphql, formatear } from "./_gate-checks.mjs";

const hook = leerHookInput();
const tool = hook.tool_name || "";
const input = hook.tool_input || {};
const st = stateOInicial(hook);
guardarState(hook.session_id, st);

function bloquear(titulo, fallos) {
  process.stderr.write(`⛔ GATE BLOQUEADO — ${titulo}\n${formatear(fallos)}\n(Autochequeo: node scripts/gate.mjs estado <tienda>)\n`);
  process.exit(2);
}

// ---------- generación de imágenes (dinero del operador; ficha 2026-09-05-generar-imagen-sin-preguntar) ----------
const cmd = tool === "Bash" ? String(input.command || "") : "";
const esImagen = tool === "mcp__mcp-image__generate_image" || /\b(nano-gen|gen-image)\.mjs\b/.test(cmd);
if (esImagen) {
  const prompts = promptsHumanos(leerTranscript(st.transcript || hook.transcript_path));
  const pidio = prompts.some(p => RE_INTENCION_IMAGEN.test(p.text));
  const ultimoOk = prompts.length && RE_APROBACION.test(prompts[prompts.length - 1].text);
  if (!pidio && !ultimoOk) {
    bloquear("generar imágenes cuesta dinero", [
      "Ningún prompt del operador en esta sesión pide imágenes ni da un OK. Norma dura (2026-09-05): NUNCA generar una imagen (ni cualquier API de pago) sin SÍ explícito.",
      "Propón qué imagen (prompt + referencia adjunta del objeto real) y espera su OK en el chat; luego reintenta.",
    ]);
  }
  process.exit(0);
}

if (tool !== "Bash") process.exit(0);

// ---------- publish / push-live ----------
if (/\btheme\s+publish\b/.test(cmd) || /\bpush-live\.mjs\b/.test(cmd)) {
  const tienda = tiendaDeComando(cmd);
  if (!tienda) bloquear("publish sin tienda identificable", ["Usa `node scripts/shopify-tienda.mjs <tienda> theme publish --theme <id>` o `node scripts/push-live.mjs <tienda> ...`."]);
  const fallos = await chequeosPublish(tienda, st, { esPushLive: /push-live\.mjs/.test(cmd) });
  if (fallos.length) bloquear(`publicar en ${tienda}`, fallos);
  process.exit(0);
}

// ---------- safe-push (tema unpublished) ----------
if (/\bsafe-push\.mjs\b/.test(cmd)) {
  const tienda = tiendaDeComando(cmd);
  const fallos = tienda ? chequeosSafePush(tienda, st, cmd) : ["safe-push sin tienda identificable."];
  if (fallos.length) bloquear(`safe-push a ${tienda}`, fallos);
  process.exit(0);
}

// ---------- push directo del CLI (por si alguien esquiva el wrapper) ----------
if (/\bshopify\s+theme\s+push\b/.test(cmd) && !/safe-push|push-live/.test(cmd)) {
  bloquear("push directo del CLI", ["Todo push va por `node scripts/safe-push.mjs <tienda> --theme <id>` (unpublished, --nodelete) o, en modo iterar-en-directo pedido por el operador, `scripts/push-live.mjs` con --only."]);
}

// ---------- admin-graphql (catálogo / descuentos) ----------
if (/\badmin-graphql\.mjs\b/.test(cmd)) {
  const fallos = chequeosAdminGraphql(cmd);
  if (fallos.length) bloquear("mutación de catálogo/descuentos", fallos);
}

process.exit(0);
