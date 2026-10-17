#!/usr/bin/env node
// discord-orders.mjs — registro automático de pedidos en STAFF/#orders (agency Discord server).
//
//   node scripts/discord-orders.mjs setup   → crea #orders en STAFF (permisos = #payments) + panel resumen fijado
//   node scripts/discord-orders.mjs         → sync (lo lanza la tarea programada cada 5 min)
//   node scripts/discord-orders.mjs sync --dry   → muestra lo que haría sin escribir nada
//
// Qué hace el sync (solo REST con el bot Ticket Reader, sin proceso 24/7):
//  1. Tickets nuevos de #order-here (paneles Plan 1/2/3, desde 2026-09-17) → una tarjeta por pedido con cliente,
//     plan, precio (−50% si es su primera tienda) y las respuestas del formulario. El bot añade ✅ a la tarjeta.
//  2. Líneas que el operador escribe a mano en #orders con su formato de siempre ("CLIENT: Tshirt", "CLIENT: Tshirt 25")
//     → se convierten en tarjeta y se borra la línea original.
//  3. el operador pulsa ✅ en una tarjeta → pasa a PAGADO (verde, con fecha). Si quita su ✅ vuelve a pendiente.
//  4. Panel resumen (primer mensaje, fijado): pedidos y € del mes, cobrado, pendiente y lista de pendientes.
//  5. Comando /order (rehecho 2026-10-16): el operador lo lanza desde cualquier canal con 4 campos — user, stores (nº de
//     tiendas), price (por tienda) y note (opcional) → tarjeta en #orders con el TOTAL. ✅ = esas tiendas pagadas.
//     El panel cuenta TIENDAS: total, pagadas, sin pagar (y €), del mes y pendientes por usuario.
//     Necesita escuchar Discord en tiempo real: el modo `watch` abre la conexión (gateway) además del sync.
//     `node scripts/discord-orders.mjs register` → (re)registra el comando en el servidor (solo admins lo ven).
// Todo el estado vive en los propios mensajes de #orders (footer "ref …"); no hay ficheros de estado.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const l of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.ORDERS_GUILD_ID;            // Discord server id
const ADMIN = process.env.ORDERS_ADMIN;               // user id allowed to confirm payments / run /order
const TICKET_TOOL = process.env.ORDERS_TICKET_BOT_ID;  // id of the ticket-tool bot that opens order tickets
const STAFF_CAT = process.env.ORDERS_STAFF_CATEGORY;  // category where #orders lives
const PAYMENTS = process.env.ORDERS_PAYMENTS_CHANNEL;  // channel whose permissions #orders copies
const TICKET_CATS = (process.env.ORDERS_TICKET_CATEGORIES || "").split(",").filter(Boolean); // Open / Closed Tickets
const SINCE = Date.parse("2026-09-17T00:00:00Z"); // lanzamiento del panel por planes
const PLANS = {
  1: { name: "Plan 1 · Product Page", emoji: "🔵", price: 25 },
  2: { name: "Plan 2 · One-Product Store", emoji: "🟡", price: 50 },
  3: { name: "Plan 3 · Custom Brand Store", emoji: "🟣", price: 80 },
};
const CHECK = "✅";
const COLOR_PENDING = 0xf5a623, COLOR_PAID = 0x2ecc71, COLOR_DASH = 0x5865f2;
const DRY = process.argv.includes("--dry");
const APP = process.env.DISCORD_APP_ID; // application id of the bot
const cmd = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "sync";

if (!TOKEN || !GUILD || !ADMIN || !APP) { console.error("Faltan DISCORD_BOT_TOKEN / ORDERS_GUILD_ID / ORDERS_ADMIN / DISCORD_APP_ID en .env"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch("https://discord.com/api/v10" + path, {
      method, headers: { Authorization: `Bot ${TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await sleep((j.retry_after || 1) * 1000 + 150); continue; }
    if (r.status === 204) return null;
    const txt = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${txt.slice(0, 600)}`);
    return txt ? JSON.parse(txt) : null;
  }
  throw new Error(`${method} ${path} → rate limited`);
}
const write = async (method, path, body) => { if (DRY) { console.log("[dry]", method, path, body ? JSON.stringify(body).slice(0, 160) : ""); return { id: "dry" }; } return api(method, path, body); };

const snowTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
const madrid = (ms) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" }).format(ms);
const monthKey = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" }).format(ms);
const eur = (n) => (n == null ? "—" : `€${Number.isInteger(n) ? n : n.toFixed(2)}`);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

async function allMessages(channelId, max = 1000) {
  const out = []; let before;
  while (out.length < max) {
    const page = await api("GET", `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    out.push(...page);
    if (page.length < 100) break;
    before = page[page.length - 1].id;
  }
  return out.reverse(); // antiguo → nuevo
}

async function findOrdersChannel() {
  const chans = await api("GET", `/guilds/${GUILD}/channels`);
  return { chans, orders: chans.find((c) => c.parent_id === STAFF_CAT && c.name === "orders") };
}

// ---------- tarjetas ----------
// footer: "ORDER #0007 · ⏳ Pending payment — click ✅ when paid · ref tk:<channelId>|m:<msgId>"
const parseRef = (m) => {
  const f = m.embeds?.[0]?.footer?.text || "";
  const ref = f.match(/ref (\S+)/)?.[1];
  const n = Number(f.match(/ORDER #(\d+)/)?.[1] || 0);
  return ref ? { ref, n } : null;
};

function cardEmbed(o, paidAt) {
  const paid = !!paidAt;
  const fields = [];
  if (o.client) fields.push({ name: o.unit != null ? "User" : "Client", value: o.client, inline: true });
  if (o.ticket) fields.push({ name: "Ticket", value: `<#${o.ticket}>`, inline: true });
  if (o.unit != null) {
    fields.push({ name: "Stores", value: String(o.stores), inline: true });
    fields.push({ name: "Price per store", value: eur(o.unit), inline: true });
    fields.push({ name: "Total", value: eur(o.price), inline: true });
  } else fields.push({ name: "Price", value: o.priceText || eur(o.price), inline: true });
  if (o.note) fields.push({ name: "Note", value: clip(o.note, 1024), inline: false });
  for (const a of o.answers || []) fields.push({ name: clip(a.q, 256), value: clip(a.a || "—", 1024), inline: false });
  return {
    title: `${paid ? "✅ PAID · " : ""}${o.title}`,
    description: `Received ${madrid(o.at)}${paid ? ` · paid ${madrid(paidAt)}` : ""}`,
    color: paid ? COLOR_PAID : COLOR_PENDING,
    fields,
    footer: { text: `ORDER #${String(o.n).padStart(4, "0")} · ${paid ? "Paid ✅" : "⏳ Pending payment — click ✅ when paid"} · ref ${o.ref}` },
    timestamp: new Date(o.at).toISOString(),
  };
}
// Datos del pedido guardados en la propia tarjeta (para rehacerla al marcar pagado).
function orderFromCard(m) {
  const e = m.embeds[0]; const r = parseRef(m);
  const get = (n) => e.fields?.find((f) => f.name === n)?.value;
  const priceText = get("Total") || get("Price") || "—";
  const nums = [...priceText.matchAll(/€(\d+(?:\.\d+)?)/g)].map((x) => Number(x[1]));
  const unit = get("Price per store") ? num(get("Price per store")) : null;
  // nº de tiendas: campo "Stores" (nuevo /order) · "Stores (N)" o "N stores" (formato 2026-10-11) · si no, 1
  const stores = Number(get("Stores")) || Number(e.fields?.find((f) => /^Stores \(\d+\)$/.test(f.name))?.name.match(/\d+/)[0]) ||
    Number(priceText.match(/(\d+) stores?/)?.[1]) || 1;
  return {
    ref: r.ref, n: r.n, title: e.title.replace(/^✅ PAID · /, ""), client: get("User") || get("Client"), ticket: get("Ticket")?.match(/\d+/)?.[0],
    price: nums[0] ?? null, priceText, at: Date.parse(e.timestamp || m.timestamp), stores, unit, note: get("Note"),
    answers: (e.fields || []).filter((f) => !["Client", "User", "Ticket", "Price", "Stores", "Price per store", "Total", "Note"].includes(f.name)).map((f) => ({ q: f.name, a: f.value })),
    paidAt: /Paid ✅/.test(e.footer?.text || "") ? (e.description.match(/paid (\d\d\/\d\d\/\d{4})/)?.[1] ?? "") : null,
  };
}

// ---------- detectar pedidos de tickets ----------
async function ticketOrders(chans, known) {
  const found = [];
  const candidates = chans.filter((c) => c.type === 0 && TICKET_CATS.includes(c.parent_id) && snowTime(c.id) >= SINCE && !known.has(`tk:${c.id}`));
  for (const c of candidates) {
    const first = await api("GET", `/channels/${c.id}/messages?after=0&limit=5`).catch(() => []);
    const msgs = [...first].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const welcome = msgs.find((m) => m.author?.id === TICKET_TOOL && /welcome!/i.test(m.content || ""));
    if (!welcome) continue;
    const plan = Number((welcome.content.match(/Plan (\d)/) || c.name.match(/^plan(\d)-/) || [])[1]);
    if (!PLANS[plan]) continue;
    const userId = welcome.content.match(/<@!?(\d+)>/)?.[1];
    const user = userId ? await api("GET", `/users/${userId}`).catch(() => null) : null;
    // respuestas del formulario: embeds de Ticket Tool (fields, o "**Pregunta**\nRespuesta" en la descripción)
    const answers = [];
    for (const m of msgs.filter((x) => x.author?.id === TICKET_TOOL)) {
      for (const e of m.embeds || []) {
        if (e.fields?.length) for (const f of e.fields) answers.push({ q: f.name.replace(/\*/g, "").trim(), a: f.value.replace(/```/g, "").trim() });
        else if (e.description && !/Thanks for your order/.test(e.description)) {
          // formato real de Ticket Tool (2026-09-19): "**Product link** ```\nrespuesta```\n**Otra** ```\n...```"
          for (const mm of e.description.matchAll(/\*\*(.+?)\*\*\s*```\n?([\s\S]*?)```/g)) answers.push({ q: mm[1].trim(), a: mm[2].trim() || "—" });
        }
      }
    }
    found.push({ ref: `tk:${c.id}`, plan, userId, username: user?.username, ticket: c.id, at: snowTime(c.id), answers });
  }
  return found;
}

// ¿Es su primera tienda? = no tiene pedidos previos en #orders ni mensajes en otros tickets / #payments.
async function isReturning(userId, username, ordersCards, chans) {
  if (!userId) return false;
  if (ordersCards.some((o) => o.client?.includes(userId))) return true;
  const pay = await allMessages(PAYMENTS, 300);
  const nameRe = username ? new RegExp(`^\\s*${username.replace(/[^a-z0-9]/gi, "").slice(0, 4)}`, "i") : null;
  if (nameRe && pay.some((m) => nameRe.test(m.content || ""))) return true;
  for (const c of chans.filter((x) => x.type === 0 && TICKET_CATS.includes(x.parent_id) && snowTime(x.id) < SINCE)) {
    if ((c.permission_overwrites || []).some((p) => p.type === 1 && p.id === userId)) return true;
  }
  return false;
}

// ---------- panel resumen ----------
const who = (o) => (o.client ? clip(o.client.replace(/<@!?\d+>\s*/, ""), 20) || "—" : "—");
const orderLine = (o) => `• [#${String(o.n).padStart(4, "0")}](https://discord.com/channels/${GUILD}/${o.channel}/${o.msg}) ${who(o)} · ${o.unit != null ? `${o.stores} store${o.stores > 1 ? "s" : ""} × ${eur(o.unit)}` : clip(o.title.replace(/^\S+\s/, ""), 40)} · **${eur(o.price)}**${o.note ? ` · _${clip(o.note, 40)}_` : ""}`;

// /stores: resumen + lista de pagadas y de pendientes (opcionalmente de un solo usuario). Respuesta solo paral operador.
function storesEmbeds(cards, user) {
  const sel = user ? cards.filter((o) => who(o).toUpperCase() === user.toUpperCase()) : cards;
  const sum = (arr) => arr.reduce((s, o) => s + (o.price || 0), 0);
  const st = (arr) => arr.reduce((s, o) => s + (o.stores || 1), 0);
  const paid = sel.filter((o) => o.paidAt != null), pending = sel.filter((o) => o.paidAt == null);
  const list = (arr) => {
    const out = []; let len = 0;
    for (const o of [...arr].reverse()) { const l = orderLine(o); if (len + l.length > 3700) break; out.push(l); len += l.length + 1; }
    return (out.length ? out.join("\n") : "—") + (out.length < arr.length ? `\n…and ${arr.length - out.length} older` : "");
  };
  return [
    {
      title: `🏪 Stores${user ? ` · ${user.toUpperCase()}` : ""}`, color: COLOR_DASH,
      description: [
        `**${st(sel)} stores** · ${sel.length} orders · ${eur(sum(sel))} billed`,
        `✅ **Paid:** ${st(paid)} stores · ${eur(sum(paid))}`,
        `⏳ **Unpaid:** ${st(pending)} stores · ${eur(sum(pending))}`,
      ].join("\n"),
    },
    { title: `⏳ Unpaid (${st(pending)} stores)`, color: COLOR_PENDING, description: list(pending) },
    { title: `✅ Paid (${st(paid)} stores)`, color: COLOR_PAID, description: list(paid) },
  ];
}

async function loadCards() {
  const { orders } = await findOrdersChannel();
  const msgs = await allMessages(orders.id);
  const botId = (await api("GET", "/users/@me")).id;
  return msgs.filter((m) => m.author.id === botId && parseRef(m)).map((m) => ({ ...orderFromCard(m), msg: m.id, channel: orders.id })).sort((a, b) => a.n - b.n);
}

function dashboardEmbed(cards) {
  const nowKey = monthKey(Date.now());
  const month = cards.filter((o) => monthKey(o.at) === nowKey);
  const sum = (arr) => arr.reduce((s, o) => s + (o.price || 0), 0);
  const st = (arr) => arr.reduce((s, o) => s + (o.stores || 1), 0);
  const pending = cards.filter((o) => o.paidAt == null), paid = cards.filter((o) => o.paidAt != null);
  const lines = pending.slice(-15).map(orderLine);
  const byUser = {};
  for (const o of pending) { const k = who(o); byUser[k] = byUser[k] || { s: 0, e: 0 }; byUser[k].s += o.stores || 1; byUser[k].e += o.price || 0; }
  const users = Object.entries(byUser).sort((a, b) => b[1].e - a[1].e).map(([k, v]) => `${k}: ${v.s} store${v.s > 1 ? "s" : ""} · ${eur(v.e)}`);
  return {
    title: "📊 Orders dashboard",
    description: [
      `🏪 **Stores (all time):** ${st(cards)} total · ✅ ${st(paid)} paid · ⏳ **${st(pending)} unpaid**`,
      `💶 **Money:** ${eur(sum(cards))} billed · ${eur(sum(paid))} paid · **${eur(sum(pending))} pending**`,
      `📅 **This month** (${nowKey}): ${st(month)} stores · ${eur(sum(month))} billed · ${eur(sum(month.filter((o) => o.paidAt)))} paid`,
      "",
      users.length ? `**Unpaid by user:**\n${users.join("\n")}` : "",
      "",
      lines.length ? `**Unpaid orders:**\n${lines.join("\n")}` : "Nothing pending 🎉",
      "",
      "➕ Add an order: `/order` → user · stores · price per store · note (optional).",
      "✅ Click the ✅ under an order when it's paid (remove it to undo).",
    ].filter((l, i, a) => l || a[i - 1]).join("\n"),
    color: COLOR_DASH,
    footer: { text: `Updated ${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(Date.now())} · auto-sync every 5 min` },
  };
}

// ---------- comandos ----------
async function setup() {
  const { orders } = await findOrdersChannel();
  if (orders) { console.log("#orders ya existe:", orders.id); return; }
  const pay = await api("GET", `/channels/${PAYMENTS}`);
  const ch = await write("POST", `/guilds/${GUILD}/channels`, {
    name: "orders", type: 0, parent_id: STAFF_CAT, permission_overwrites: pay.permission_overwrites,
    topic: "Every order, logged automatically. Click ✅ under an order when it's paid. Type `CLIENT: product [price]` to add one by hand.",
  });
  const dash = await write("POST", `/channels/${ch.id}/messages`, { embeds: [dashboardEmbed([])], flags: 4096 });
  if (!DRY) await api("PUT", `/channels/${ch.id}/pins/${dash.id}`).catch((e) => console.log("pin:", e.message));
  console.log("creado #orders", ch.id, "panel", dash.id);
}

// Todo lo que escribe en #orders pasa por aquí de uno en uno (sync del loop y /order no se pisan los números).
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));
const clientCache = new Set();

async function sync() {
  const { chans, orders } = await findOrdersChannel();
  if (!orders) { console.error("No existe #orders: ejecuta primero `setup`."); process.exit(1); }
  const msgs = await allMessages(orders.id);
  const botId = (await api("GET", "/users/@me")).id;
  let dash = msgs.find((m) => m.author.id === botId && m.embeds?.[0]?.title === "📊 Orders dashboard");
  const cardMsgs = msgs.filter((m) => m.author.id === botId && parseRef(m));
  const known = new Set(cardMsgs.map((m) => parseRef(m).ref));
  let nextN = Math.max(0, ...cardMsgs.map((m) => parseRef(m).n)) + 1;
  const cards = cardMsgs.map((m) => ({ ...orderFromCard(m), msg: m.id, channel: orders.id, raw: m }));
  for (const c of cards) if (c.client && !/^<@/.test(c.client) && c.client !== "—") clientCache.add(c.client);
  const log = [];

  // 1) pedidos de tickets
  for (const t of await ticketOrders(chans, known)) {
    const p = PLANS[t.plan];
    const returning = await isReturning(t.userId, t.username, cards, chans);
    const price = returning ? p.price : p.price / 2;
    const o = {
      ref: t.ref, n: nextN++, at: t.at, ticket: t.ticket, title: `${p.emoji} ${p.name}`,
      client: t.userId ? `<@${t.userId}> ${t.username || ""}`.trim() : "—", price,
      priceText: returning ? eur(price) : `${eur(price)} ~~${eur(p.price)}~~ · 🎁 first store −50%`, answers: t.answers,
    };
    const m = await write("POST", `/channels/${orders.id}/messages`, { embeds: [cardEmbed(o, null)] });
    if (!DRY) await api("PUT", `/channels/${orders.id}/messages/${m.id}/reactions/${encodeURIComponent(CHECK)}/@me`);
    cards.push({ ...o, msg: m.id, channel: orders.id, paidAt: null });
    log.push(`+ ticket ${t.ticket} → #${o.n} ${p.name} ${o.client}`);
  }

  // 2) líneas escritas a mano por el operador: "CLIENTE: producto [precio]"
  for (const m of msgs.filter((x) => x.author.id === ADMIN && x.type === 0)) {
    const mm = (m.content || "").trim().match(/^([^:\n]{2,30})[:.]\s*(.+?)(?:\s+€?(\d+(?:[.,]\d+)?)\s*€?)?$/s);
    if (!mm) continue;
    const o = {
      ref: `m:${m.id}`, n: nextN++, at: snowTime(m.id), title: `🛠️ ${clip(mm[2].trim(), 200)}`,
      client: mm[1].trim().toUpperCase(), price: mm[3] ? Number(mm[3].replace(",", ".")) : null, answers: [],
    };
    const c = await write("POST", `/channels/${orders.id}/messages`, { embeds: [cardEmbed(o, null)], flags: 4096 });
    if (!DRY) { await api("PUT", `/channels/${orders.id}/messages/${c.id}/reactions/${encodeURIComponent(CHECK)}/@me`); await api("DELETE", `/channels/${orders.id}/messages/${m.id}`); }
    cards.push({ ...o, msg: c.id, channel: orders.id, paidAt: null });
    log.push(`+ manual "${m.content}" → #${o.n}`);
  }

  // 3) ✅ del operador = pagado
  for (const c of cards.filter((x) => x.raw)) {
    const users = await api("GET", `/channels/${orders.id}/messages/${c.msg}/reactions/${encodeURIComponent(CHECK)}?limit=100`).catch(() => []);
    const paidNow = users.some((u) => u.id === ADMIN);
    if (paidNow && c.paidAt == null) {
      c.paidAt = Date.now();
      await write("PATCH", `/channels/${orders.id}/messages/${c.msg}`, { embeds: [cardEmbed(c, c.paidAt)] });
      log.push(`✓ #${c.n} pagado`);
    } else if (!paidNow && c.paidAt != null) {
      c.paidAt = null;
      await write("PATCH", `/channels/${orders.id}/messages/${c.msg}`, { embeds: [cardEmbed(c, null)] });
      log.push(`↺ #${c.n} vuelve a pendiente`);
    }
  }

  // 4) panel resumen
  const embed = dashboardEmbed(cards.sort((a, b) => a.n - b.n));
  if (!dash) { dash = await write("POST", `/channels/${orders.id}/messages`, { embeds: [embed], flags: 4096 }); if (!DRY) await api("PUT", `/channels/${orders.id}/pins/${dash.id}`).catch(() => {}); }
  else await write("PATCH", `/channels/${orders.id}/messages/${dash.id}`, { embeds: [embed] });

  console.log(`${new Date().toISOString()} sync ok · cards=${cards.length} · ${log.length ? log.join(" | ") : "sin cambios"}`);
}

// ---------- /order (comando con formulario) ----------
const ORDER_CMD = {
  name: "order", type: 1, description: "Add an order: user, number of stores, price per store, note",
  default_member_permissions: "8", dm_permission: false,
  options: [
    { type: 3, name: "user", description: "User / client (e.g. ACME)", required: true, autocomplete: true, max_length: 100 },
    { type: 4, name: "stores", description: "Number of stores", required: true, min_value: 1, max_value: 1000 },
    { type: 10, name: "price", description: "Price per store (€)", required: true, min_value: 0 },
    { type: 3, name: "note", description: "Note (optional)", required: false, max_length: 1000 },
  ],
};
const STORES_CMD = {
  name: "stores", type: 1, description: "See all stores: paid and unpaid (only you see the answer)",
  default_member_permissions: "8", dm_permission: false,
  options: [{ type: 3, name: "user", description: "Only this user (optional)", required: false, autocomplete: true, max_length: 100 }],
};
async function register() {
  const r = await write("PUT", `/applications/${APP}/guilds/${GUILD}/commands`, [ORDER_CMD, STORES_CMD]);
  console.log("comandos registrados:", Array.isArray(r) ? r.map((c) => `/${c.name} ${c.id}`).join(", ") : r);
}

const num = (s) => { const m = String(s ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

function buildManualOrder({ user, stores, price, note }) {
  const n = Math.round(Number(stores)), unit = num(price);
  if (!(n >= 1)) return { error: "Number of stores must be 1 or more." };
  if (unit == null) return { error: "Missing price per store." };
  const total = Math.round(n * unit * 100) / 100;
  const client = String(user || "").trim().toUpperCase();
  return { title: `🏪 ${client} · ${n} store${n > 1 ? "s" : ""}`, client, stores: n, unit, price: total, note: String(note || "").trim() || null, answers: [] };
}

async function postManualOrder(o0, ref) {
  const r = await serial(async () => {
    const { orders } = await findOrdersChannel();
    const msgs = await allMessages(orders.id);
    const botId = (await api("GET", "/users/@me")).id;
    const nextN = Math.max(0, ...msgs.filter((m) => m.author.id === botId && parseRef(m)).map((m) => parseRef(m).n)) + 1;
    const o = { ...o0, ref, n: nextN, at: Date.now() };
    const c = await write("POST", `/channels/${orders.id}/messages`, { embeds: [cardEmbed(o, null)], flags: 4096 });
    if (!DRY) await api("PUT", `/channels/${orders.id}/messages/${c.id}/reactions/${encodeURIComponent(CHECK)}/@me`);
    clientCache.add(o.client);
    console.log(`${new Date().toISOString()} /order → #${o.n} ${o.client} · ${o.stores} × ${eur(o.unit)} = ${eur(o.price)}`);
    return { ...o, url: `https://discord.com/channels/${GUILD}/${orders.id}/${c.id}` };
  });
  serial(sync).catch((e) => console.error("sync tras /order:", e.message)); // refresca el panel resumen
  return r;
}

const reply = (it, data, type = 4) => api("POST", `/interactions/${it.id}/${it.token}/callback`, { type, data });
const input = (id, label, style, opts = {}) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style, ...opts }] });

async function handleInteraction(it) {
  const uid = it.member?.user?.id || it.user?.id;
  if (it.type === 4) { // autocompletar cliente con los de pedidos anteriores
    const q = String(it.data.options?.find((o) => o.focused)?.value || "").toUpperCase();
    const list = [...clientCache].filter((c) => c.includes(q)).sort();
    if (q && !list.includes(q)) list.unshift(q);
    return reply(it, { choices: list.slice(0, 25).map((c) => ({ name: clip(c, 100), value: clip(c, 100) })) }, 8);
  }
  if (uid !== ADMIN) return reply(it, { content: "Only the admin can use this.", flags: 64 });
  if (it.type === 2 && it.data.name === "stores") {
    const user = String(it.data.options?.find((o) => o.name === "user")?.value || "").trim();
    await reply(it, { flags: 64 }, 5);
    const embeds = storesEmbeds(await loadCards(), user);
    console.log(`${new Date().toISOString()} /stores ${user || "(all)"}`);
    return api("PATCH", `/webhooks/${APP}/${it.token}/messages/@original`, { embeds });
  }
  if (it.type === 2 && it.data.name === "order") {
    const v = Object.fromEntries((it.data.options || []).map((o) => [o.name, o.value]));
    console.log(`${new Date().toISOString()} /order · ${JSON.stringify(v).slice(0, 300)}`);
    const o = buildManualOrder(v);
    if (o.error) return reply(it, { content: `⚠️ ${o.error} Nothing was saved.`, flags: 64 });
    await reply(it, { flags: 64 }, 5); // "pensando…" (Discord exige respuesta en <3 s)
    const r = await postManualOrder(o, `cmd:${it.id}`);
    return api("PATCH", `/webhooks/${APP}/${it.token}/messages/@original`, {
      content: `✅ Order **#${String(r.n).padStart(4, "0")}** added · ${r.client} · ${r.stores} store${r.stores > 1 ? "s" : ""} × ${eur(r.unit)} = **${eur(r.price)}**${r.note ? ` · ${clip(r.note, 200)}` : ""} → ${r.url}`,
    });
  }
}

// Conexión en tiempo real con Discord, solo para recibir /order (intents 0 = no lee mensajes de nadie).
function startGateway() {
  let ws, hb, seq = null, acked = true;
  const connect = () => {
    ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    ws.onmessage = (ev) => {
      const p = JSON.parse(ev.data); if (p.s) seq = p.s;
      if (p.op === 10) {
        clearInterval(hb); acked = true;
        hb = setInterval(() => { if (!acked) return ws.close(4000); acked = false; ws.send(JSON.stringify({ op: 1, d: seq })); }, p.d.heartbeat_interval);
        ws.send(JSON.stringify({ op: 2, d: { token: TOKEN, intents: 0, properties: { os: "windows", browser: "ecom-autopilot", device: "ecom-autopilot" } } }));
      } else if (p.op === 11) acked = true;
      else if (p.op === 1) ws.send(JSON.stringify({ op: 1, d: seq }));
      else if (p.op === 7 || p.op === 9) ws.close(4000);
      else if (p.op === 0 && p.t === "READY") console.log(`${new Date().toISOString()} gateway ready (${p.d.user.username})`);
      else if (p.op === 0 && p.t === "INTERACTION_CREATE") handleInteraction(p.d).catch(async (e) => {
        console.error(`${new Date().toISOString()} /order ERROR ${e.message}`);
        // que Discord nunca se quede en "la aplicación no ha respondido": contestar con el error (o editar el "pensando…")
        const content = `⚠️ Command failed, nothing was saved: ${clip(e.message.replace(/\/interactions\/\S+|\/webhooks\/\S+/g, ""), 300)}`;
        if (p.d.type === 4) return;
        await reply(p.d, { content, flags: 64 }).catch(() => api("PATCH", `/webhooks/${APP}/${p.d.token}/messages/@original`, { content }).catch(() => {}));
      });
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      clearInterval(hb); seq = null;
      console.log(`${new Date().toISOString()} gateway closed ${e.code}`);
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(e.code)) return; // token/intents inválidos: no insistir
      setTimeout(connect, 5000);
    };
  };
  connect();
}

// watch: sync cada 5 min para siempre (lo arranca discord-orders-run.vbs desde la carpeta Inicio de Windows).
// Una sola instancia (pidfile) y log propio en %LOCALAPPDATA%\ecom-autopilot\orders.log.
async function watch() {
  const { writeFileSync, appendFileSync, mkdirSync, existsSync } = await import("node:fs");
  const dir = join(process.env.LOCALAPPDATA || root, "ecom-autopilot"); mkdirSync(dir, { recursive: true });
  const pidf = join(dir, "orders.pid"), logf = join(dir, "orders.log");
  if (existsSync(pidf)) { const pid = Number(readFileSync(pidf, "utf8")); try { process.kill(pid, 0); console.log("ya hay un watch activo, pid", pid); return; } catch {} }
  writeFileSync(pidf, String(process.pid));
  const log = (s) => appendFileSync(logf, s + "\n");
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => log(a.join(" ")); console.error = (...a) => log(a.join(" "));
  log(`${new Date().toISOString()} watch start pid ${process.pid}`);
  startGateway();
  for (;;) {
    try { await serial(sync); } catch (e) { log(`${new Date().toISOString()} ERROR ${e.message}`); }
    await sleep(5 * 60 * 1000);
  }
}

// prueba local: node scripts/discord-orders.mjs parse ACME 4 25 "nota"
const parseTest = async () => console.log(JSON.stringify(buildManualOrder({ user: process.argv[3], stores: process.argv[4], price: process.argv[5], note: process.argv[6] }), null, 2));

(cmd === "setup" ? setup() : cmd === "watch" ? watch() : cmd === "register" ? register() : cmd === "parse" ? parseTest() : cmd === "stores" ? loadCards().then((c) => console.log(JSON.stringify(storesEmbeds(c, process.argv[3]), null, 1))) : sync()).catch((e) => { console.error(new Date().toISOString(), "ERROR", e.message); process.exit(1); });
