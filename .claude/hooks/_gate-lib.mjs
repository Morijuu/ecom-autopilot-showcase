// _gate-lib.mjs — utilidades compartidas por los GATES del harness (hooks de .claude/hooks/).
// Principio (aprendido/normas-de-proceso-requieren-enforcement): una norma que debe cumplirse SIEMPRE
// no se escribe en prosa, se cablea. Todo lo que aquí se comprueba sale de EVIDENCIA que el modelo
// no puede fabricar: el transcript (lo que el operador escribió de verdad, qué herramientas se usaron),
// mtimes de ficheros y el estado de sesión que escriben los propios hooks.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const stateDir = join(root, ".claude", "state");

// ---------- entrada del hook ----------
export function leerHookInput() {
  try { return JSON.parse(readFileSync(0, "utf8")); } catch { return {}; }
}

// ---------- estado por sesión ----------
export function statePath(sessionId) { return join(stateDir, `${sessionId || "sin-sesion"}.json`); }
export function leerState(sessionId) {
  try { return JSON.parse(readFileSync(statePath(sessionId), "utf8")); } catch { return null; }
}
export function guardarState(sessionId, st) {
  try { mkdirSync(stateDir, { recursive: true }); writeFileSync(statePath(sessionId), JSON.stringify(st, null, 1)); } catch {}
}
export function stateOInicial(hook) {
  const st = leerState(hook.session_id) || { session_id: hook.session_id, startedAt: Date.now() };
  if (hook.transcript_path) st.transcript = hook.transcript_path;
  st.temas ||= {};        // tienda → ts de la última edición de stores/<t>/theme en ESTA sesión
  st.pushes ||= {};       // tienda → ts del último safe-push
  st.publishes ||= {};    // tienda → ts del último publish / push-live
  st.mutaciones ||= [];   // {ts, tienda, kind} de admin-graphql con mutation
  st.descartadas ||= [];  // {ts, motivo} correcciones descartadas explícitamente (auditables)
  return st;
}
// El CLI (scripts/gate.mjs) no conoce el session_id: usa el estado más reciente.
export function stateMasReciente() {
  try {
    const files = readdirSync(stateDir).filter(f => f.endsWith(".json"))
      .map(f => ({ f, m: statSync(join(stateDir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    if (!files.length) return null;
    return JSON.parse(readFileSync(join(stateDir, files[0].f), "utf8"));
  } catch { return null; }
}

// ---------- transcript (evidencia real) ----------
export function leerTranscript(path) {
  if (!path) return [];
  let txt = "";
  try { txt = readFileSync(path, "utf8"); } catch { return []; }
  const out = [];
  for (const line of txt.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}
function textoDe(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    if (content.some(b => b?.type === "tool_result")) return "";
    return content.filter(b => b?.type === "text").map(b => b.text).join("\n");
  }
  return "";
}
// Prompts escritos por EL OPERADOR (humano), en orden. Nunca mensajes inyectados ni tool_results.
export function promptsHumanos(entries) {
  const out = [];
  for (const e of entries) {
    // Mensajes que el operador escribe A MITAD DE TURNO: se guardan como attachment/queued_command (no type:user).
    // Solo cuentan los de origen humano en modo prompt (2026-09-14, pre-autorización de publish no detectada).
    const q = e?.type === "attachment" && !e.isSidechain ? e.attachment : null;
    if (q && q.type === "queued_command" && q.commandMode === "prompt" && q.origin?.kind === "human" && typeof q.prompt === "string" && q.prompt.trim()) {
      out.push({ ts: Date.parse(q.timestamp || e.timestamp) || 0, text: q.prompt.trim() });
      continue;
    }
    if (e?.type !== "user" || e.isMeta || e.isSidechain) continue;
    if (e.origin && e.origin.kind && e.origin.kind !== "human") continue;
    const text = textoDe(e.message?.content).trim();
    if (!text) continue;
    out.push({ ts: Date.parse(e.timestamp) || 0, text });
  }
  return out;
}
export function usosDeHerramienta(entries) {
  const out = [];
  for (const e of entries) {
    if (e?.type !== "assistant" || e.isSidechain) continue;
    for (const b of e.message?.content || []) {
      if (b?.type === "tool_use") out.push({ ts: Date.parse(e.timestamp) || 0, name: b.name, input: b.input || {} });
    }
  }
  return out;
}
// Texto del ÚLTIMO mensaje del asistente (todo lo dicho tras el último prompt humano).
export function ultimoTextoAsistente(entries) {
  let idx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "user" && !e.isMeta && textoDe(e.message?.content).trim() && (!e.origin?.kind || e.origin.kind === "human")) { idx = i; break; }
  }
  const parts = [];
  for (let i = idx + 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.type !== "assistant" || e.isSidechain) continue;
    for (const b of e.message?.content || []) if (b?.type === "text" && b.text) parts.push(b.text);
  }
  return parts.join("\n").trim();
}

// Texto de TODOS los mensajes del asistente ANTERIORES al último prompt humano (para saber si ya se entregó la
// confirmación punto por punto en esta sesión — el operador 2026-10-14: "deja de repetir la confirmacion punto por punto
// tantas veces, ponlo solo cuando termines del todo").
export function textosAsistenteAnteriores(entries) {
  let idx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "user" && !e.isMeta && textoDe(e.message?.content).trim() && (!e.origin?.kind || e.origin.kind === "human")) { idx = i; break; }
  }
  const msgs = [];
  for (let i = 0; i < idx; i++) {
    const e = entries[i];
    if (e?.type !== "assistant" || e.isSidechain) continue;
    const t = (e.message?.content || []).filter(b => b?.type === "text" && b.text).map(b => b.text).join("\n");
    if (t) msgs.push(t);
  }
  return msgs;
}

// ---------- ficheros ----------
export function mtimeMasReciente(dir) {
  let max = 0;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) max = Math.max(max, mtimeMasReciente(p));
    else { try { max = Math.max(max, statSync(p).mtimeMs); } catch {} }
  }
  return max;
}
export function ficherosNuevosDesde(dir, ts, filtro = () => true) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !filtro(e.name)) continue;
    try { const m = statSync(join(dir, e.name)).mtimeMs; if (m > ts) out.push({ name: e.name, mtime: m }); } catch {}
  }
  return out;
}
export function existe(p) { return existsSync(p); }
export function leer(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

// ---------- tienda ----------
export function tiendaDePath(fp) {
  const m = String(fp || "").replace(/\\/g, "/").match(/stores\/([^/]+)\/theme\//);
  return m ? m[1] : null;
}
export function tiendaDeComando(cmd) {
  const m = String(cmd || "").match(/(?:shopify-tienda|safe-push|push-live|backup-theme|admin-graphql|subir-imagen|subir-video|convergencia|productos-en-marcha)\.mjs\s+["']?([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}
export function tipoTienda(tienda) {
  const reg = leer(join(root, "stores", "registry.yml"));
  const m = reg.match(new RegExp(`^${tienda}:\\n([\\s\\S]*?)(?=^\\S|\\Z)`, "m"));
  const bloque = m ? m[1] : "";
  const t = bloque.match(/^\s*tipo:\s*(.+)$/m);
  return t ? t[1].trim() : "";
}
export function esTiendaEquipo(tienda) {
  const t = tipoTienda(tienda).toUpperCase();
  return t.startsWith("EQUIPO") || t.startsWith("COLABORACI");
}
export function candadoClon(tienda) {
  const capdir = join(root, "capturas");
  if (!existsSync(join(capdir, `.clonando-${tienda}`))) return null;
  let conv = {};
  try { conv = JSON.parse(readFileSync(join(capdir, `.convergencia-${tienda}.json`), "utf8")); } catch {}
  return { ts: conv.ts || 0, ref: conv.ref || "", clon: conv.clon || "" };
}

// ---------- léxico (español del operador) ----------
// Pre-autorización en el propio encargo ("cuando acabes publica y me pasas el link"): vale aunque sea ANTERIOR al último push
// (ficha errores/2026-09-11-pedir-ok-de-publicar-cuando-el-operador-ya-lo-dio-al-principio).
// Margen 200: el operador intercala la verificación ("cuando acabes todo eso, asegurate de que cumple… y publicalo sin pedirme confirmacion", 2026-09-14).
// el operador 2026-09-20: "cuando esté todo confirmado, lo publicas y me pasas el link" — la condición no es
// "cuando acabes" sino "cuando esté confirmado/verificado", y el verbo va en presente ("publicas").
// el operador 2026-09-21 (At0, los 3 clones): "hazlo todo publico y pasame los 3 links" — la orden de publicar
// va EN el encargo y el push que la ejecuta es POSTERIOR, así que el OK nunca podría ir "después del push".
// "hacer público" ES publicar; se acepta sin condición temporal (ficha errores/2026-09-21-gate-publish-hazlo-publico).
export const RE_PREAUTORIZACION = /((cuando|en cuanto|una vez|al|si)\s+(acabes|termines|acabar|terminar|est[eé] listo|lo tengas|est[eé]|todo)[^.\n]{0,200}(publ[ií]ca|m[eé]te|s[uú]be|pon(lo)? en vivo|en live))|((publ[ií]ca|m[eé]te|s[uú]be)(lo|la)?[^.\n]{0,30}(cuando|en cuanto|al|una vez)\s+(acabes|termines|acabar|terminar))|((^|[\s,.;:!¡¿?"'(])(h[aá]z|pon)(lo|los|la|las)?\s+(todo(s)?\s+)?(p[uú]blic[oa]s?|en\s+vivo|en\s+live)\b)/i;
export const RE_APROBACION = /(^|[\s,.;:!¡¿?"'(])(publ[ií]ca(s|lo|la|los|las)?|m[eé]te(s|la|lo)?|adelante|dale|ok(ey|ay)?|vale|s[ií]|go|hazlo|s[uú]be(s|lo|la)?|aprobado|perfecto|correcto|venga|procede|confirmo|de acuerdo)(?=$|[\s,.;:!¡¿?"')])/i;
export const RE_INTENCION_IMAGEN = /(gener|cre|haz|hacer|dise[ñn]|mont|saca|prep|reemplaz|edit|retoc|quit|borr|limpi)\w*[^.\n]{0,80}(imagen|im[aá]genes|images?|logo|foto|fotos|portada|hero|banner|render|ilustraci|icono|mockup|packshot)|(imagen|im[aá]genes|foto|fotos|portada|hero|banner|logo)[^.\n]{0,60}(hazl[aoe]s?|gen[eé]ra\w*|cr[eé]a\w*|mont[aá]\w*|dis[eé][ñn]a\w*)|(no me gusta|ninguna|otra|nueva|repite|vuelve)[^.\n]{0,40}(imagen|im[aá]genes|foto|fotos|portada)|(imagen|im[aá]genes|foto|fotos|portada)[^\n]{0,80}(quiero que|que (est[eé]|lleve|salga|aparezca|tenga))|(nano|banana)/i;
export const RE_CORRECCION = /(est[aá] mal|no era as[ií]|no vuelvas|otra vez|te (lo )?(dije|he dicho|ped[ií])|siempre (haces|pones|dejas|te|se te)|nunca m[aá]s|c[aá]mbialo|no me gusta|eso no( es| era)?|mal hecho|no lo (has|hiciste)|por ?qu[eé] (no|has|lo)|te (has )?equivocado|no es (lo que|as[ií])|no (era|es) eso|arr[eé]gla(lo|la)|lo has hecho mal|no has (hecho|puesto|quitado|cambiado|revisado|mirado)|has (dejado|puesto|quitado|borrado) [^.\n]{0,40}(mal|sin)|tienes que|deber[ií]as haber|se te (ha )?olvid|has olvidado|no te lo (he )?pedido|no lo (ped[ií]|quiero))/i;
export const RE_PREGUNTA_PROHIBIDA = /¿\s*(quieres|quieres que|te parece si|hago|lo guardo|guardo|hago commit|hago push|lo subo|lo publico|procedo|sigo|contin[uú]o)\b[^?]{0,60}(guard|commit|push|memoria|subo|public|proced|sigo|contin)[^?]*\?|¿\s*quieres que (lo |te )?(guarde|suba|publique|haga)/i;
export const RE_HANDLE_INICIALES = /^[a-z0-9]{1,10}$/;

export function marcaDeDominio(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const partes = host.split(".");
    return (partes.length >= 2 ? partes[partes.length - 2] : partes[0]).toLowerCase();
  } catch { return ""; }
}

export function minutos(ts) { return Math.max(0, Math.round((Date.now() - ts) / 60000)); }

// ---------- NORMA 1 (el operador 2026-09-10): confirmación punto por punto al terminar ----------
export const PUNTOS_OPERADOR = [
  { n: 1, label: "QA visual", re: /qa visual|revisi[oó]n visual/i },
  { n: 2, label: "Fidelidad", re: /fidelidad/i },
  { n: 3, label: "Interacciones", re: /interaccion/i },
  { n: 4, label: "Colores", re: /colores/i },
  { n: 5, label: "Imágenes", re: /im[aá]genes/i },
  { n: 6, label: "Memoria y links", re: /memoria/i },
  { n: 7, label: "Alcance", re: /alcance/i },
  { n: 8, label: "Go-live", re: /go-?live/i },
  { n: 9, label: "Ofertas / bundles", re: /ofertas|bundles?/i },
  { n: 10, label: "Ambición de diseño", re: /ambici[oó]n/i },
  // el operador 2026-09-16: "revisar que el scroll responde igual en ambas tiendas" + "interactuar con todos los botones de la pagina"
  { n: 11, label: "Scroll", re: /scroll/i },
  { n: 12, label: "Botones", re: /botones/i },
];
export const RE_CABECERA_CONFIRMACION = /CONFIRMACI[OÓ]N PUNTO POR PUNTO/i;
export const RE_EN_CURSO = /⏳\s*EN CURSO/;
const RE_ESTADO = /✅|✔|☑|\bOK\b|\bN\/A\b|no aplica|\bhecho\b|\bcubierto\b/i;
// Devuelve { ok, faltan: [labels] }. Cada punto = una línea con su palabra clave + estado + justificación (≥ 40 chars).
export function confirmacionPuntoPorPunto(texto) {
  if (!texto || !RE_CABECERA_CONFIRMACION.test(texto)) return { ok: false, faltan: PUNTOS_OPERADOR.map(p => `${p.n}. ${p.label}`), sinCabecera: true };
  const desde = texto.search(RE_CABECERA_CONFIRMACION);
  const lineas = texto.slice(desde).split("\n").map(l => l.trim()).filter(Boolean);
  const faltan = [];
  for (const p of PUNTOS_OPERADOR) {
    const ok = lineas.some(l => p.re.test(l) && RE_ESTADO.test(l) && l.replace(/[*_`#>\-\s]/g, "").length >= 40);
    if (!ok) faltan.push(`${p.n}. ${p.label}`);
  }
  return { ok: faltan.length === 0, faltan, sinCabecera: false };
}

// ---------- cierre de turno: lo que el operador dijo en la sesión y hay que RECOGER sin que lo enumere ----------
export const RE_CIERRE_TURNO = /\b(cierr[oa]|cerramos|cerrar|termin[oa]mos|terminar|acabamos|acabar|paramos|parar)\b[^.\n]{0,25}\b(turno|sesi[oó]n|por hoy|aqu[ií]|ya)\b|\b(hasta (mañana|luego|la pr[oó]xima)|por hoy (ya )?(est[aá]|vale|basta)|lo dejamos aqu[ií]|nos vemos)\b|^\s*(cierr[ae]|cierro)\s*(el\s+)?turno/i;
export const RE_GUSTO = /\b(me (encanta|gusta|flipa|mola|convence)|perfecto|as[ií] s[ií]|genial|brutal|bru[tt]al|buen[ií]simo|incre[ií]ble|muy bien|queda (mejor|genial|bien|mal|peor)|prefiero|mejor as[ií]|no me gusta|no me convence|odio|horrible|feo|cutre|premium|elegante)\b/i;
const RE_URL = /https?:\/\/[^\s<>"'`)\]]+/g;

// Inventario de la sesión a partir de los prompts REALES del operador (nunca del modelo).
export function senalesDeSesion(prompts) {
  const limpiar = t => t.replace(/\s+/g, " ").trim();
  const correcciones = prompts.slice(1).filter(p => RE_CORRECCION.test(p.text)).map(p => ({ ts: p.ts, texto: limpiar(p.text).slice(0, 220) }));
  const gustos = prompts.filter(p => RE_GUSTO.test(p.text)).map(p => ({ ts: p.ts, texto: limpiar(p.text).slice(0, 220) }));
  const urls = [];
  for (const p of prompts) for (const u of (p.text.match(RE_URL) || [])) {
    const url = u.replace(/[.,;:!?)]+$/, "");
    if (/localhost|127\.0\.0\.1|discord\.com\/channels/.test(url)) continue;
    if (!urls.some(x => x.url === url)) urls.push({ ts: p.ts, url });
  }
  return { correcciones, gustos, urls };
}
export function urlGuardadaEnMemoria(url) {
  const clave = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").split("?")[0];
  const dir = join(root, "memoria");
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith("_")) pila.push(p); continue; }
      if (!e.name.endsWith(".md")) continue;
      try { if (readFileSync(p, "utf8").includes(clave)) return true; } catch {}
    }
  }
  return false;
}
