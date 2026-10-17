#!/usr/bin/env node
// Secretos CIFRADOS en git (regla del operador 2026-10-09: "los tokens tienen que ser accesibles para todos los
// dispositivos… móntalo cifrado, asegúrate de que cada tienda nueva que se conecte se suba al git").
//
//   stores/<t>/.env   (local, gitignored)  ⇄  stores/<t>/.env.enc   (cifrado, VIAJA por git)
//   .env  (raíz: Discord/OpenAI/Gemini)    ⇄  secretos/raiz.env.enc (cifrado, VIAJA por git)
//
// Cifrado AES-256-GCM con una clave de 32 bytes que vive FUERA del repo, una por dispositivo (la misma en todos):
//   ~/.ecom-autopilot/secretos.key   (o la variable ECOM_SECRETOS_KEY en base64)
// La clave NUNCA se imprime, ni va a git, ni por chat. Se pasa a cada persona por un canal seguro (en mano /
// gestor de contraseñas) y se importa una vez con `importar-clave`.
//
// Uso:
//   node scripts/secretos.mjs init                      crea la clave en este dispositivo (solo la primera vez, en UNO)
//   node scripts/secretos.mjs importar-clave <fichero>  instala la clave recibida en este dispositivo
//   node scripts/secretos.mjs sync [tienda] [--push]    sincroniza .env ⇄ .env.enc en las dos direcciones
//                                                      (--push: commit SOLO de los .enc cambiados + push)
//   node scripts/secretos.mjs estado [--json] [--desde <ms>]   qué está sin subir / sin bajar
//   --hook: nunca falla ni ensucia la salida (lo usan los hooks)
//
// Sincronización (por fichero, con el hash del último estado sincronizado en .claude/state/secretos-sync.json):
//   solo local → se cifra · solo .enc → se descifra · iguales → nada
//   cambió solo el local → se cifra · cambió solo el remoto → se descifra
//   cambiaron los dos → gana el MÁS NUEVO (mtime del .env vs fecha del último commit del .enc) y las claves que
//   solo estén en el otro lado se conservan; nunca se pierde una línea sin avisar.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_PATH = process.env.ECOM_SECRETOS_KEY_FILE || join(homedir(), ".ecom-autopilot", "secretos.key");
const STATE_PATH = join(ROOT, ".claude", "state", "secretos-sync.json");
const MAGIC = "ECOMSEC1";

const args = process.argv.slice(2);
const HOOK = args.includes("--hook");
const PUSH = args.includes("--push");
const JSON_OUT = args.includes("--json");
const desdeIdx = args.indexOf("--desde");
const DESDE = desdeIdx >= 0 ? Number(args[desdeIdx + 1]) : 0;
const pos = args.filter((a, i) => !a.startsWith("--") && !(desdeIdx >= 0 && i === desdeIdx + 1));
const cmd = pos[0] || "estado";

const log = (...m) => { if (!HOOK && !JSON_OUT) console.log(...m); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
function git(c) {
  try { return execSync(`git ${c}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); }
  catch (e) { return null; }
}

function cargarClave() {
  if (process.env.ECOM_SECRETOS_KEY) return Buffer.from(process.env.ECOM_SECRETOS_KEY.trim(), "base64");
  if (!existsSync(KEY_PATH)) return null;
  const k = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "base64");
  if (k.length !== 32) throw new Error(`la clave de ${KEY_PATH} no tiene 32 bytes`);
  return k;
}
function cifrar(plano, key) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plano, "utf8"), c.final()]);
  return `${MAGIC}:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}\n`;
}
function descifrar(txt, key) {
  const [m, iv, tag, ct] = txt.trim().split(":");
  if (m !== MAGIC) throw new Error("formato desconocido");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// pares local ⇄ cifrado
function pares(soloTienda) {
  const out = [];
  if (!soloTienda) out.push({ id: "raiz", plain: join(ROOT, ".env"), enc: join(ROOT, "secretos", "raiz.env.enc") });
  const sdir = join(ROOT, "stores");
  for (const t of readdirSync(sdir)) {
    if (soloTienda && t !== soloTienda) continue;
    const d = join(sdir, t);
    try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
    const p = { id: t, plain: join(d, ".env"), enc: join(d, ".env.enc") };
    if (existsSync(p.plain) || existsSync(p.enc)) out.push(p);
  }
  return out;
}

const leerState = () => { try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return {}; } };
const guardarState = (s) => { mkdirSync(dirname(STATE_PATH), { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); };

function parseEnv(txt) {
  const m = new Map();
  for (const l of txt.split(/\r?\n/)) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) m.set(l.slice(0, i), l); }
  return m;
}
function fusionar(ganador, perdedor) {
  // el ganador entero + las líneas KEY= que solo existan en el perdedor
  const g = parseEnv(ganador), p = parseEnv(perdedor);
  const extra = [...p.entries()].filter(([k]) => !g.has(k)).map(([, l]) => l);
  return extra.length ? ganador.replace(/\s*$/, "\n") + extra.join("\n") + "\n" : ganador;
}
function fechaCommitEnc(enc) {
  const t = git(`log -1 --format=%ct -- "${rel(enc)}"`);
  return t ? Number(t) * 1000 : 0;
}

function sync(key, soloTienda) {
  const st = leerState();
  const cambiadosEnc = [], escritosLocal = [], avisos = [];
  for (const p of pares(soloTienda)) {
    const hayL = existsSync(p.plain), hayE = existsSync(p.enc);
    const L = hayL ? readFileSync(p.plain, "utf8") : null;
    let E = null;
    if (hayE) {
      try { E = descifrar(readFileSync(p.enc, "utf8"), key); }
      catch (e) { avisos.push(`${rel(p.enc)}: no se puede descifrar (¿clave distinta?) — no se toca`); continue; }
    }
    const S = st[p.id];
    const escribirEnc = (txt) => { mkdirSync(dirname(p.enc), { recursive: true }); writeFileSync(p.enc, cifrar(txt, key)); cambiadosEnc.push(p.enc); };
    const escribirLocal = (txt) => { writeFileSync(p.plain, txt); escritosLocal.push(p.plain); };
    if (L !== null && E === null) { escribirEnc(L); st[p.id] = sha(L); continue; }
    if (L === null && E !== null) { escribirLocal(E); st[p.id] = sha(E); continue; }
    if (L === E) { st[p.id] = sha(L); continue; }
    const hL = sha(L), hE = sha(E);
    if (S === hL) { escribirLocal(E); st[p.id] = hE; continue; }          // solo cambió el remoto
    if (S === hE) { escribirEnc(L); st[p.id] = hL; continue; }            // solo cambió el local
    // cambiaron los dos (o primera sync en un dispositivo con .env propio): gana el más nuevo + se conservan claves
    const localMasNuevo = statSync(p.plain).mtimeMs >= fechaCommitEnc(p.enc);
    const final = localMasNuevo ? fusionar(L, E) : fusionar(E, L);
    if (final !== L) escribirLocal(final);
    if (final !== E) escribirEnc(final);
    st[p.id] = sha(final);
    avisos.push(`${p.id}: cambios en los dos lados → gana ${localMasNuevo ? "el local" : "el de git"} (+ claves que solo tenía el otro)`);
  }
  guardarState(st);
  return { cambiadosEnc, escritosLocal, avisos };
}

function estado(key) {
  const st = leerState();
  const res = [];
  for (const p of pares()) {
    const hayL = existsSync(p.plain), hayE = existsSync(p.enc);
    let estadoP = "ok";
    if (hayL && !hayE) estadoP = "sin-subir";
    else if (!hayL && hayE) estadoP = "sin-bajar";
    else if (key) {
      try { if (readFileSync(p.plain, "utf8") !== descifrar(readFileSync(p.enc, "utf8"), key)) estadoP = "distinto"; }
      catch { estadoP = "no-descifra"; }
    } else estadoP = "sin-clave";
    const mt = hayL ? statSync(p.plain).mtimeMs : 0;
    if (DESDE && mt < DESDE && estadoP !== "sin-bajar") continue;
    if (estadoP !== "ok") res.push({ id: p.id, estado: estadoP, plain: rel(p.plain), enc: rel(p.enc) });
  }
  return res;
}

function pushEnc(ficheros) {
  if (!ficheros.length) return true;
  const rutas = ficheros.map((f) => `"${rel(f)}"`).join(" ");
  if (git(`add -- ${rutas}`) === null) return false;
  const ids = ficheros.map((f) => rel(f).replace(/^stores\//, "").replace(/\/\.env\.enc$/, "").replace("secretos/raiz.env.enc", "raiz"));
  if (git(`commit -m "secretos: ${ids.join(", ")} (cifrado)" -- ${rutas}`) === null) return false;
  git("pull --rebase --autostash --quiet");
  return git("push --quiet") !== null;
}

try {
  if (cmd === "init") {
    if (existsSync(KEY_PATH)) { console.log(`Ya hay clave en ${KEY_PATH} — no se toca.`); process.exit(0); }
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    writeFileSync(KEY_PATH, randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
    console.log(`✓ Clave creada en ${KEY_PATH}\n  Pásale ESE fichero a cada persona por un canal seguro (en mano / gestor de contraseñas), nunca por git ni chat.\n  En su dispositivo: node scripts/secretos.mjs importar-clave <ruta-del-fichero>`);
    process.exit(0);
  }
  if (cmd === "importar-clave") {
    const src = pos[1];
    if (!src || !existsSync(src)) { console.error("Uso: node scripts/secretos.mjs importar-clave <fichero-clave>"); process.exit(1); }
    const k = Buffer.from(readFileSync(src, "utf8").trim(), "base64");
    if (k.length !== 32) { console.error("Ese fichero no es una clave válida (32 bytes en base64)."); process.exit(1); }
    if (existsSync(KEY_PATH) && readFileSync(KEY_PATH, "utf8").trim() !== readFileSync(src, "utf8").trim()) {
      console.error(`Ya hay OTRA clave en ${KEY_PATH}. Bórrala a mano si de verdad quieres sustituirla.`); process.exit(1);
    }
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    copyFileSync(src, KEY_PATH);
    console.log(`✓ Clave instalada en ${KEY_PATH}. Ahora: node scripts/secretos.mjs sync`);
    process.exit(0);
  }

  const key = cargarClave();
  if (cmd === "estado") {
    const r = estado(key);
    if (JSON_OUT) { process.stdout.write(JSON.stringify({ clave: !!key, pendientes: r })); process.exit(0); }
    if (!key) log(`⚠️ Este dispositivo no tiene la clave (${KEY_PATH}). Pídesela al operador e impórtala: node scripts/secretos.mjs importar-clave <fichero>`);
    if (!r.length) log("✓ Todos los secretos sincronizados.");
    for (const x of r) log(`  ${x.estado.padEnd(11)} ${x.id}`);
    process.exit(0);
  }
  if (cmd === "sync") {
    if (!key) {
      log(`⚠️ Sin clave en este dispositivo (${KEY_PATH}): no se puede sincronizar. Pídesela al operador → node scripts/secretos.mjs importar-clave <fichero>`);
      process.exit(HOOK ? 0 : 1);
    }
    const tienda = pos[1];
    const r = sync(key, tienda);
    for (const f of r.escritosLocal) log(`↓ ${rel(f)} actualizado desde git`);
    for (const f of r.cambiadosEnc) log(`↑ ${rel(f)} cifrado`);
    for (const a of r.avisos) log(`⚠️ ${a}`);
    if (PUSH && r.cambiadosEnc.length) {
      const ok = pushEnc(r.cambiadosEnc);
      log(ok ? `✓ ${r.cambiadosEnc.length} secreto(s) subidos cifrados a git.` : "⚠️ No se pudo hacer commit/push de los .enc — hazlo a mano (git add stores/*/.env.enc secretos/ && commit && push).");
    } else if (r.cambiadosEnc.length) log("→ Falta subirlos: node scripts/secretos.mjs sync --push");
    if (!r.escritosLocal.length && !r.cambiadosEnc.length && !r.avisos.length) log("✓ Nada que sincronizar.");
    if (HOOK) process.stdout.write(JSON.stringify({ bajados: r.escritosLocal.map(rel), subidos: r.cambiadosEnc.map(rel), avisos: r.avisos }));
    process.exit(0);
  }
  console.error(`Comando desconocido: ${cmd}`); process.exit(1);
} catch (e) {
  if (HOOK) { process.stdout.write(JSON.stringify({ error: String(e.message || e) })); process.exit(0); }
  console.error("Error:", e.message || e); process.exit(1);
}
