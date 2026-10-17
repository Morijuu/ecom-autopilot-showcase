#!/usr/bin/env node
// shopify-tienda.mjs — lanza el Shopify CLI CON las credenciales de una tienda (sin exponer el token).
// Uso:  node scripts/shopify-tienda.mjs <tienda> theme list
//       node scripts/shopify-tienda.mjs <tienda> theme pull --path stores/<tienda>/theme
// Carga stores/<tienda>/.env (SHOPIFY_CLI_THEME_TOKEN + SHOPIFY_FLAG_STORE) y ejecuta `shopify <args>`
// con ese entorno. Sin esto, el CLI a pelo no ve el token y pide login interactivo.
//
// Raíles: `theme push` va SIEMPRE por scripts/safe-push.mjs (backup + --nodelete + unpublished) y
// `theme delete` no se hace desde el kit. `theme publish` = SOLO con OK explícito del operador.

import { execFileSync } from "node:child_process";
import { loadStoreEnv } from "./_lib.mjs";

const [store, ...args] = process.argv.slice(2);
if (!store || args.length === 0) {
  console.error("Uso: node scripts/shopify-tienda.mjs <tienda> <comando shopify...>   (ej.: mitienda theme list)");
  process.exit(1);
}
if (args.includes("push")) {
  console.error("⛔ BLOQUEADO: para subir usa `node scripts/safe-push.mjs <tienda> --theme <id>` (fuerza --nodelete y tema unpublished).");
  process.exit(1);
}
if (args.includes("delete")) {
  console.error("⛔ BLOQUEADO: borrar temas no se hace desde el kit. Si de verdad toca, a mano en el admin de Shopify.");
  process.exit(1);
}
if (args.includes("publish")) {
  console.error("⚠️  `publish` cambia la tienda EN VIVO: solo con OK explícito del operador y con backup hecho.");
}

const env = loadStoreEnv(store); // valida token + store; sale con error claro si faltan
console.error(`(tienda: ${env.SHOPIFY_FLAG_STORE})`);
try {
  execFileSync("shopify", args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32", // en Windows el binario es shopify.cmd
  });
} catch (e) {
  process.exit(typeof e.status === "number" ? e.status : 1);
}
