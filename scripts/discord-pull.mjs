#!/usr/bin/env node
// discord-pull.mjs — lee los últimos mensajes de un canal/hilo de Discord (SOLO LECTURA).
// Uso:  node scripts/discord-pull.mjs <id-del-canal> [nº-mensajes]
// Requiere DISCORD_BOT_TOKEN en .env (bot propio con MESSAGE CONTENT INTENT activado
// y permisos View Channels + Read Message History en el servidor del operador).
//
// No escribe nada, no publica nada: solo trae texto para que el asistente lea el ticket.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- cargar .env (sin dependencias) ---
function loadEnv() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const txt = readFileSync(join(root, ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* sin .env: usaremos process.env tal cual */ }
}
loadEnv();

const channelId = process.argv[2];
const limit = Math.min(Number(process.argv[3]) || 30, 100);
const token = process.env.DISCORD_BOT_TOKEN;

if (!channelId) {
  console.error("Falta el id del canal. Uso: node scripts/discord-pull.mjs <id-del-canal> [nº]");
  console.error("Cómo sacar el id: en Discord activa Ajustes → Avanzado → Modo desarrollador, luego clic derecho en el canal → Copiar ID.");
  process.exit(1);
}
if (!token) {
  console.error("Falta DISCORD_BOT_TOKEN en el .env. Monta el bot siguiendo HANDOFF.md.");
  process.exit(1);
}

const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`;

try {
  const res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Discord respondió ${res.status}. ${body}`);
    if (res.status === 401) console.error("→ Token inválido.");
    if (res.status === 403) console.error("→ El bot no está en el servidor o le falta 'Read Message History' / no está añadido al hilo privado.");
    if (res.status === 404) console.error("→ Canal no encontrado (¿id correcto? ¿el bot ve ese canal?).");
    process.exit(1);
  }
  const msgs = await res.json(); // vienen del más nuevo al más viejo
  msgs.reverse();                // los ponemos en orden cronológico
  if (msgs.length === 0) { console.log("(sin mensajes)"); process.exit(0); }
  for (const m of msgs) {
    const who = m.author?.username ?? "?";
    const when = m.timestamp ? m.timestamp.slice(0, 16).replace("T", " ") : "";
    let text = m.content || "";
    if (m.attachments?.length) text += " " + m.attachments.map((a) => `[adjunto: ${a.url}]`).join(" ");
    if (m.embeds?.length && !text.trim()) text = "[embed]";
    console.log(`[${when}] ${who}: ${text}`);
  }
  if (msgs.some((m) => !m.content && (m.attachments?.length || m.embeds?.length))) {
    console.error("\n(aviso: si algún mensaje sale vacío, revisa que MESSAGE CONTENT INTENT esté activado en el bot)");
  }
} catch (e) {
  console.error("Error de red hablando con Discord:", e.message);
  process.exit(1);
}
