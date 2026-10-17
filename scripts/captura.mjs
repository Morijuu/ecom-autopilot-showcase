#!/usr/bin/env node
// captura.mjs — CHEQUEO VISUAL AUTÓNOMO: pantallazos del visor (o de cualquier URL) para que el
// asistente VEA lo que está construyendo sin esperar a que el operador pegue capturas.
// Uso:  node scripts/captura.mjs                      → captura http://127.0.0.1:9292 (el visor)
//       node scripts/captura.mjs https://example-store.com   → captura esa URL
//       node scripts/captura.mjs <url> <nombre>       → nombra los ficheros <nombre>-*.png
// Saca SIEMPRE dos vistas: desktop (1440x900) y móvil (iPhone 390x844, full-page) en capturas/
// (gitignored). Después: ábrelas con la herramienta Read y critícalas contra design-taste +
// web-design-guidelines ANTES de enseñar nada.
// Requiere una vez: npm install (trae playwright) + npx playwright install chromium

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { root, ts } from "./_lib.mjs";

const [urlArg, nombreArg] = process.argv.slice(2);
const url = urlArg && urlArg.startsWith("http") ? urlArg : "http://127.0.0.1:9292";
const nombre = nombreArg || (urlArg && !urlArg.startsWith("http") ? urlArg : ts());

const dir = join(root, "capturas");
mkdirSync(dir, { recursive: true });

const shots = [
  { sufijo: "desktop", args: ["--viewport-size=1440,900"] },
  { sufijo: "movil", args: ["--viewport-size=390,844", "--full-page"] },
];

const salidas = [];
for (const s of shots) {
  const out = join(dir, `${nombre}-${s.sufijo}.png`);
  try {
    // node + cli.js local en vez de "npx": en Windows execFileSync no resuelve npx.cmd (ENOENT)
    execFileSync(process.execPath, [join(root, "node_modules", "playwright", "cli.js"), "screenshot", "--wait-for-timeout=3500", ...s.args, url, out], {
      stdio: ["ignore", "ignore", "pipe"],
      cwd: root,
      timeout: 60000,
    });
    salidas.push(out);
  } catch (e) {
    const err = String(e.stderr || e.message || "");
    if (/executable doesn't exist|browser.*not.*install|Please run the following command/i.test(err)) {
      console.error("⛔ Falta el navegador de Playwright (una sola vez): npx playwright install chromium");
    } else if (/ECONNREFUSED|net::ERR_CONNECTION_REFUSED/i.test(err)) {
      console.error(`⛔ No hay nada escuchando en ${url} — ¿está el visor arriba? (/visor <tienda>)`);
    } else {
      console.error(`⛔ Captura ${s.sufijo} falló: ${err.slice(0, 300)}`);
    }
    process.exit(1);
  }
}

console.log("✓ Capturas listas (ábrelas con Read y critícalas ANTES de enseñar nada):");
for (const o of salidas) console.log("  " + o);
