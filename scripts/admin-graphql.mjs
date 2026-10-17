#!/usr/bin/env node
// admin-graphql.mjs — MÓDULO B: consulta/mutación genérica a la Admin API de una tienda (GraphQL).
// Uso:  node scripts/admin-graphql.mjs <tienda> '<query-graphql>' ['<variables-json>']
// Requiere SHOPIFY_ADMIN_TOKEN en stores/<tienda>/.env (scripts/conectar-admin.mjs).
// Es la herramienta del asistente para CATÁLOGO (productos, precios, fotos de producto, inventario).
// Raíles: solo lo que el operador pidió explícito; nada de *Delete sin --force (y ese --force = OK humano).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./_lib.mjs";

const API_VERSION = "2026-07";

function parseEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no existe */ }
  return out;
}

const force = process.argv.includes("--force"); // puede ir en cualquier posición; no es el JSON de variables
const [store, query, varsJson] = process.argv.slice(2).filter((a) => a !== "--force");
if (!store || !query) {
  console.error("Uso: node scripts/admin-graphql.mjs <tienda> '<query>' ['<variables-json>'] [--force]");
  process.exit(1);
}
if (/delete/i.test(query) && !force) {
  console.error("⛔ BLOQUEADO: mutación con 'Delete'. Si de verdad toca (con OK explícito del operador), añade --force.");
  process.exit(1);
}

const env = parseEnv(join(root, "stores", store, ".env"));
if (!env.SHOPIFY_ADMIN_TOKEN || !env.SHOPIFY_FLAG_STORE) {
  console.error(`Falta SHOPIFY_ADMIN_TOKEN en stores/${store}/.env → conéctalo: node scripts/conectar-admin.mjs ${store}`);
  process.exit(1);
}

let variables;
try { variables = varsJson ? JSON.parse(varsJson) : undefined; }
catch { console.error("El tercer argumento no es JSON válido."); process.exit(1); }

const r = await fetch(`https://${env.SHOPIFY_FLAG_STORE}/admin/api/${API_VERSION}/graphql.json`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN },
  body: JSON.stringify({ query, variables }),
}).catch((e) => { console.error(`No se pudo hablar con la Admin API (¿red?): ${e.message}`); process.exit(1); });
const d = await r.json().catch(() => null);
if (!r.ok || !d) { console.error(`Admin API respondió ${r.status}.`); process.exit(1); }
console.log(JSON.stringify(d, null, 2));
if (d.errors) process.exit(1);
