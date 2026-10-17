#!/usr/bin/env node
// convergencia.mjs — EL BUCLE DE CONVERGENCIA EN UN COMANDO (modo CLONAR, regla del operador 2026-08-11).
// Captura la tienda de REFERENCIA y el CLON (desktop + móvil full-page) de una tacada, y deja un
// marcador con timestamp que el hook de cierre verifica: si editas el tema después de la última
// convergencia, NO puedes cerrar el turno. Ejecutarlo ARMA el candado del clon para esa tienda.
//
// Uso:
//   node scripts/convergencia.mjs <tienda> <url-referencia> <url-clon>   → captura ambas + arma/renueva candado
//   node scripts/convergencia.mjs <tienda> --fin                          → desarma el candado (clon aprobado por el operador)
//
// Tras capturar: ABRE los 4 PNG con Read y compara ELEMENTO A ELEMENTO (colores por píxel, no por
// tokens; overlays/cookies fuera). Si hay CUALQUIER incongruencia → corregir → volver a correr esto.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./_lib.mjs";

const [tienda, a, b] = process.argv.slice(2);
if (!tienda) { console.error("Uso: node scripts/convergencia.mjs <tienda> <url-ref> <url-clon> | <tienda> --fin"); process.exit(1); }

const dir = join(root, "capturas");
mkdirSync(dir, { recursive: true });
const marker = join(dir, `.convergencia-${tienda}.json`);
const flag = join(dir, `.clonando-${tienda}`);

if (a === "--fin") {
  for (const f of [marker, flag]) { try { unlinkSync(f); } catch {} }
  console.log(`✓ Candado de convergencia de "${tienda}" desarmado (clon aprobado). Los hooks dejan de exigir el bucle.`);
  process.exit(0);
}

if (!a || !b || !a.startsWith("http") || !b.startsWith("http")) {
  console.error("Faltan las URLs: <url-referencia> <url-clon> (ambas http/https)."); process.exit(1);
}

const shots = [
  { url: a, quien: "ref", sufijo: "desktop", size: ["1440", "900"] },
  { url: a, quien: "ref", sufijo: "movil", size: ["390", "844"] },
  { url: b, quien: "clon", sufijo: "desktop", size: ["1440", "900"] },
  { url: b, quien: "clon", sufijo: "movil", size: ["390", "844"] },
];

const salidas = [];
for (const s of shots) {
  const out = join(dir, `conv-${tienda}-${s.quien}-${s.sufijo}.png`);
  try {
    execFileSync(process.execPath, [join(root, "scripts", "_cap-revealed.mjs"), s.url, out, ...s.size], {
      stdio: ["ignore", "ignore", "pipe"], cwd: root, timeout: 180000,
    });
    salidas.push(out);
  } catch (e) {
    console.error(`⛔ Captura ${s.quien}-${s.sufijo} falló: ${String(e.stderr || e.message || "").slice(0, 250)}`);
    process.exit(1); // sin las 4 capturas NO hay convergencia: el marcador no se renueva
  }
}

writeFileSync(flag, new Date().toISOString());
writeFileSync(marker, JSON.stringify({ ts: Date.now(), tienda, ref: a, clon: b, files: salidas }, null, 1));
console.log(`✓ Convergencia capturada (candado renovado). AHORA: abre los 4 PNG con Read y compara elemento a elemento:
  Y prueba lo FUNCIONAL con clicks reales: carrito desplegable (abre con items/checkout/cierra/scroll libre/qty/quitar), ATC, selectores. cart.js NO basta.`);
for (const o of salidas) console.log("  " + o);
console.log("⚠️ GOTCHA: capturas headless no disparan lazy-load con scroll parcial ni cierran cookies — lo tapado NO cuenta como verificado; en secciones críticas complementa con Chrome real.");
