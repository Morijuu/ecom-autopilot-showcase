#!/usr/bin/env node
// backup-theme.mjs — red de revert: baja el tema VIVO de una tienda a backups/<tienda>/<timestamp>/.
// Uso:  node scripts/backup-theme.mjs <tienda>
// Lee stores/<tienda>/.env (SHOPIFY_CLI_THEME_TOKEN + SHOPIFY_FLAG_STORE).

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { loadStoreEnv, ts, root } from "./_lib.mjs";
import { join } from "node:path";

const store = process.argv[2];
if (!store) { console.error("Uso: node scripts/backup-theme.mjs <tienda>"); process.exit(1); }

const env = loadStoreEnv(store); // valida token + store; sale con error claro si faltan
const dest = join(root, "backups", store, ts());
mkdirSync(dest, { recursive: true });

console.log(`Backup del tema VIVO de ${env.SHOPIFY_FLAG_STORE} → ${dest}`);
try {
  execFileSync("shopify", ["theme", "pull", "--live", "--path", dest], {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32", // en Windows el binario es shopify.cmd
  });
  console.log("✓ Backup hecho.");
} catch (e) {
  console.error("✗ Falló el backup. ¿Shopify CLI instalado y token correcto?", e.message);
  process.exit(1);
}
