#!/usr/bin/env node
// safe-push.mjs — el FRENO MAESTRO. Sube un tema con red de seguridad:
//   · fuerza --nodelete (sin él, un push borra en remoto lo ausente en local → revierte prod)
//   · exige un tema UNPUBLISHED (--theme <id>), nunca el live
//   · BLOQUEA cualquier intento de --live / push directo a producción
// Uso:  node scripts/safe-push.mjs <tienda> --theme <id-unpublished> | --new "<nombre>"  [--only <fichero>]...
//       --only (repetible) = push quirúrgico de SOLO esos ficheros (ej. config/settings_data.json)
//
// Publicar de verdad es un paso aparte y manual: `shopify theme publish` SOLO con OK del operador.

import { spawnSync } from "node:child_process";
import { loadStoreEnv } from "./_lib.mjs";

const argv = process.argv.slice(2);
const store = argv[0];
if (!store) { console.error("Uso: node scripts/safe-push.mjs <tienda> --theme <id-unpublished>"); process.exit(1); }

// --solo-nuevos-live (el operador 2026-10-13: "se edita el live actual... no se edita nada de lo que ya hay,
// solo añades"): ADITIVO sobre el live. Exige --theme <id-live> + al menos un --only, y ABORTA si cualquiera de
// esos ficheros ya existe en el tema remoto (imposible sobrescribir nada). Nunca borra (--nodelete).
const soloNuevosLive = argv.includes("--solo-nuevos-live");

// ⛔ Bloqueo duro: nada de tocar el tema en vivo desde aquí.
if (argv.some((a) => a === "--live" || a === "--allow-live")) {
  console.error("⛔ BLOQUEADO: safe-push nunca publica en vivo. Revisa el preview y usa `shopify theme publish` con OK del operador.");
  process.exit(1);
}

const themeIdx = argv.indexOf("--theme");
const themeId = themeIdx !== -1 ? argv[themeIdx + 1] : null;
const newIdx = argv.indexOf("--new");
const newName = newIdx !== -1 ? argv[newIdx + 1] : null; // crea un tema UNPUBLISHED nuevo con ese nombre
if (!themeId && !newName) {
  console.error("Falta --theme <id> (tema UNPUBLISHED existente) o --new \"<nombre>\" (crea uno nuevo; nunca el live).");
  console.error("Lista los temas: shopify theme list");
  process.exit(1);
}

// passthrough de --only <fichero> (repetible): push quirúrgico de solo lo tocado
const onlys = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--only" && argv[i + 1]) onlys.push(argv[++i]);

// --path <dir> opcional: carpeta local del tema si no es la convención stores/<t>/theme
// (p.ej. la tienda tiene varios temas pulled: theme/ = Shrine live, theme-elixir-clinical/ = Elixir)
const pathIdx = argv.indexOf("--path");
const themePath = pathIdx !== -1 ? argv[pathIdx + 1] : `stores/${store}/theme`;

const env = loadStoreEnv(store);
if (soloNuevosLive) {
  if (!themeId || newName || !onlys.length) {
    console.error("⛔ --solo-nuevos-live exige --theme <id> y al menos un --only <fichero> (nunca push completo).");
    process.exit(1);
  }
  // Comprobación previa: bajamos del remoto SOLO esos ficheros a una carpeta temporal vacía; si llega alguno, existe → abortar.
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "solo-nuevos-"));
  const pullArgs = ["theme", "pull", "--theme", String(themeId), "--path", tmp];
  for (const o of onlys) pullArgs.push("--only", o);
  const p = spawnSync("shopify", pullArgs, { encoding: "utf8", env: { ...process.env, ...env }, shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  if (p.error || p.status !== 0) { console.error("✗ No pude comprobar el remoto (pull falló) → no subo nada.", p.stderr || ""); process.exit(1); }
  // --base <backup-dir> (opcional): permite RE-subir ficheros que añadimos nosotros (existen en remoto pero NO en
  // el backup previo del live). Un fichero que estaba en el backup sigue bloqueado siempre.
  const baseIdx = argv.indexOf("--base");
  const base = baseIdx !== -1 ? argv[baseIdx + 1] : null;
  if (base && !existsSync(join(base, "layout", "theme.liquid"))) { console.error(`⛔ --base ${base} no parece un backup de tema (falta layout/theme.liquid).`); process.exit(1); }
  const enBase = (o) => base && existsSync(join(base, o));
  const yaExisten = onlys.filter((o) => existsSync(join(tmp, o)) && (!base || enBase(o)));
  const preexistentesEnBase = base ? onlys.filter(enBase) : [];
  if (preexistentesEnBase.length && !yaExisten.length) yaExisten.push(...preexistentesEnBase);
  rmSync(tmp, { recursive: true, force: true });
  if (yaExisten.length) {
    console.error("⛔ BLOQUEADO (--solo-nuevos-live): estos ficheros YA EXISTEN en el tema remoto y no se pueden sobrescribir:\n  · " + yaExisten.join("\n  · "));
    process.exit(1);
  }
  console.log(`✓ Comprobado: ${onlys.length} fichero(s) no existen en el tema ${themeId} → subida aditiva.`);
}
const target = newName ? ["--unpublished", "--theme", String(newName)] : ["--theme", String(themeId)];
if (soloNuevosLive) target.push("--allow-live");
const args = ["theme", "push", ...target, "--nodelete", "--path", themePath];
for (const o of onlys) args.push("--only", o);

console.log(`Push seguro a ${env.SHOPIFY_FLAG_STORE}, tema ${newName ? `NUEVO "${newName}"` : themeId} (unpublished), con --nodelete…`);
// El CLI devuelve exit 0 aunque un fichero sea RECHAZADO ("was pushed with errors", p.ej. un
// inline_richtext con <p>): capturamos la salida y fallamos de verdad si aparece la caja de error.
// (Lección 2026-09-11, Reverse: el template no subió y el wrapper dijo "✓ Subido".)
let out = "";
// 2026-09-16 (At0 ramct): la caja de error y el 'pushed with errors' salen por STDERR → hay que leer ambos flujos
// (antes solo se miraba stdout y el wrapper decía '✓ Subido' con la plantilla rechazada).
const r = spawnSync("shopify", args, { encoding: "utf8", env: { ...process.env, ...env }, shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
out = String(r.stdout || "") + String(r.stderr || "");
process.stdout.write(String(r.stdout || ""));
process.stderr.write(String(r.stderr || "").split(/\r?\n/).filter((l) => !/DEP0190|trace-deprecation|claude-code-hint/.test(l)).join("\n") + "\n");
if (r.error || r.status !== 0) {
  console.error("✗ Falló el push:", r.error ? r.error.message : "exit " + r.status);
  process.exit(1);
}
if (/pushed with errors|╭─ error/i.test(out)) {
  console.error("✗ El CLI RECHAZÓ al menos un fichero (mira la caja 'error' de arriba): el tema remoto NO tiene ese cambio. Corrige y repite el push.");
  process.exit(1);
}
console.log("✓ Subido al tema unpublished. Revisa el preview antes de publicar.");
