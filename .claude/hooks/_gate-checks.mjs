// _gate-checks.mjs — los chequeos concretos de cada gate (compartidos por pre_tool.mjs, cierre.mjs
// y scripts/gate.mjs). Cada función devuelve una lista de FALLOS (strings); lista vacía = pasa.
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  root, leerTranscript, promptsHumanos, usosDeHerramienta, mtimeMasReciente, ficherosNuevosDesde,
  existe, leer, candadoClon, RE_APROBACION, RE_PREAUTORIZACION, RE_HANDLE_INICIALES, marcaDeDominio, minutos,
} from "./_gate-lib.mjs";

const DIA = 24 * 3600 * 1000;
const UA = { "User-Agent": "Mozilla/5.0 (gate-golive ecom-autopilot)" };

export function formatear(fallos) { return fallos.map(f => "  · " + f).join("\n"); }
function mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }

function ultimaEdicionTema(tienda, st) {
  return st?.temas?.[tienda] || mtimeMasReciente(join(root, "stores", tienda, "theme"));
}

function backupReciente(tienda) {
  const m = mtimeMasReciente(join(root, "backups", tienda));
  return m && (Date.now() - m) < DIA ? m : 0;
}

function validateTrasEdicion(st, tsEdicion) {
  if (!tsEdicion) return true;
  const usos = usosDeHerramienta(leerTranscript(st?.transcript));
  return usos.some(u => /validate_theme/.test(u.name) && u.ts >= tsEdicion - 2000);
}

function capturasTras(ts) {
  const pngs = ficherosNuevosDesde(join(root, "capturas"), ts, n => /\.png$/i.test(n));
  return { total: pngs.length, movil: pngs.some(p => /movil|mobile|seg\d|[-_]m\b/i.test(p.name)) };
}

function okDelOperadorTras(st, ts) {
  const prompts = promptsHumanos(leerTranscript(st?.transcript));
  if (!prompts.length) return { ok: false, motivo: "no hay prompts del operador en el transcript de esta sesión" };
  const pre = prompts.find(p => RE_PREAUTORIZACION.test(p.text));
  if (pre) return { ok: true, texto: "pre-autorizado en el encargo: " + pre.text.slice(0, 80) };
  const posteriores = ts ? prompts.filter(p => p.ts > ts) : [];
  const candidatos = posteriores.length ? posteriores : [prompts[prompts.length - 1]];
  if (ts && !posteriores.length) return { ok: false, motivo: `el operador no ha escrito nada DESPUÉS del último push (hace ${minutos(ts)} min): enséñale el preview y espera su OK` };
  const hit = candidatos.find(p => RE_APROBACION.test(p.text));
  if (hit) return { ok: true, texto: hit.text.slice(0, 80) };
  return { ok: false, motivo: ts ? "ningún prompt del operador posterior al último push contiene un OK" : "el último prompt del operador no contiene un OK de publicar" };
}

async function chequeosGoLiveEnVivo(candado, tienda) {
  const fallos = [], avisos = [];
  if (!candado?.clon) return { fallos: ["el candado de clon no tiene URL del clon (vuelve a correr convergencia.mjs con las 2 URLs)"], avisos };
  let u;
  try { u = new URL(candado.clon); } catch { return { fallos: ["URL del clon inválida en capturas/.convergencia-<t>.json"], avisos }; }
  const mHandle = u.pathname.match(/\/products\/([^/]+)/);
  if (mHandle) {
    const handle = decodeURIComponent(mHandle[1]);
    if (!RE_HANDLE_INICIALES.test(handle)) fallos.push(`handle del producto "${handle}" no es de INICIALES (regla dura 2026-08-24: "The Blue Lamp Set" → tbls). Fíjalo con productUpdate(handle) y actualiza los links del tema.`);
  }
  let marca = marcaDeDominio(candado.ref);
  // Excepción auditada: la tienda adopta POR ORDEN DEL OPERADOR la misma marca que la fuente (p.ej. <marca> en <tienda>,
  // "publica" 2026-10-08). Se declara en memoria/tiendas/<t>.md con la línea "MARCA PROPIA AUTORIZADA: <marca>".
  const fichaT = leer(join(root, "memoria", "tiendas", `${tienda || candado.tienda}.md`)) || "";
  const mProp = fichaT.match(/MARCA PROPIA AUTORIZADA:\s*([a-z0-9-]+)/i);
  if (marca && mProp && mProp[1].toLowerCase() === marca.toLowerCase()) marca = "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(u.toString(), { signal: ctrl.signal, headers: UA, redirect: "follow" });
    const html = await r.text();
    if (/\/password(\?|$)/.test(r.url) || /storefront-password|password_page|id="password"/i.test(html)) {
      avisos.push("la tienda tiene password page: no pude leer el producto en vivo (chequeos go-live parciales; usa la URL con ?preview_theme_id o quita la password)");
    } else {
      // palabra completa (sin esto "levance" casaba dentro de "sort_relevance")
      const marcaEsc = marca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reMarca = marca && marca.length >= 4 ? new RegExp("(^|[^a-z0-9])" + marcaEsc + "(?![a-z0-9])", "i") : null;
      if (reMarca && reMarca.test(html)) {
        fallos.push(`la página del clon contiene la MARCA DEL RIVAL "${marca}" (norma dura 2026-09-05/08: un clon no lleva la marca del rival ni del proveedor — texto, alt, imágenes, watermark).`);
      }
      if (mHandle) {
        const js = new URL(u.toString());
        js.pathname = js.pathname.replace(/\/products\/([^/]+)/, "/products/$1.js");
        try {
          const p = await (await fetch(js.toString(), { signal: ctrl.signal, headers: UA })).json();
          if (p && p.available === false) fallos.push("el producto del clon está `available:false` en el storefront (si pasa en TODOS los productos = gating de Markets, ficha aprendido/markets-disponibilidad-storefront).");
        } catch { avisos.push("no pude leer <producto>.js del clon"); }
      }
    }
  } catch (e) {
    avisos.push(`no pude verificar el clon en vivo (${String(e.message || e).slice(0, 60)}) — verifica tú: available, sin marca del rival, moneda de la tienda`);
  } finally { clearTimeout(timer); }
  return { fallos, avisos };
}

// Clon con candado: convergencia posterior a la última edición + informe de diferencias reciente que
// declare CERO diferencias (regla del operador 2026-08-13: "imagínate que tras cada edición tuvieras que
// decirme qué diferencias hay entre las dos páginas").
export function chequeosClon(tienda, st) {
  const fallos = [];
  const candado = candadoClon(tienda);
  if (!candado) return fallos;
  const ed = ultimaEdicionTema(tienda, st);
  if (ed && ed > candado.ts + 30000) {
    fallos.push(`CLON con candado: hay ediciones del tema (hace ${minutos(ed)} min) POSTERIORES a la última convergencia → node scripts/convergencia.mjs ${tienda} <url-ref> <url-clon> y comparar elemento a elemento.`);
  }
  const informe = join(root, "capturas", `informe-diferencias-${tienda}.md`);
  if (!existe(informe)) {
    fallos.push(`falta capturas/informe-diferencias-${tienda}.md (regla 2026-08-13: tras cada edición se ESCRIBE el informe sección a sección; "convergido" = el informe dice CERO diferencias).`);
    return fallos;
  }
  const m = mtime(informe);
  if (ed && m < ed) fallos.push(`el informe de diferencias es ANTERIOR a la última edición del tema (informe hace ${minutos(m)} min, edición hace ${minutos(ed)} min): re-captura ambas y reescríbelo.`);
  const txt = leer(informe);
  const ceroDif = /(\b0\b|cero|ninguna|sin)\s+(diferencias?|incongruencias?)/i.test(txt) || /diferencias?[^.\n]{0,20}:\s*(0|cero|ninguna)\b/i.test(txt);
  if (!ceroDif) fallos.push("el informe de diferencias NO declara cero diferencias. Corrige lo que lista, re-captura y repite hasta que diga \"0 diferencias\".");
  return fallos;
}

export async function chequeosPublish(tienda, st, { esPushLive = false } = {}) {
  const fallos = [];
  const ed = ultimaEdicionTema(tienda, st);

  // 1) OK explícito del operador, POSTERIOR al último push de esta tienda
  const ok = okDelOperadorTras(st, st?.pushes?.[tienda] || 0);
  if (!ok.ok) fallos.push(`falta el OK del operador: ${ok.motivo}. (Se acepta "métela", "publica", "ok", "adelante"… en un prompt real posterior al push.)`);

  // 2) Backup del tema vivo <24h
  if (!backupReciente(tienda)) fallos.push(`sin backup reciente (<24h) en backups/${tienda}/ → node scripts/backup-theme.mjs ${tienda}`);

  // 3) validate_theme tras la última edición de esta sesión
  if (!validateTrasEdicion(st, st?.temas?.[tienda] || 0)) fallos.push("validate_theme (Dev MCP) no se ha ejecutado DESPUÉS de la última edición del tema en esta sesión.");

  // 4) QA visual: capturas desktop+móvil posteriores a la última edición
  if (ed) {
    const c = capturasTras(ed);
    if (!c.total) fallos.push(`sin capturas en capturas/ posteriores a la última edición (hace ${minutos(ed)} min) → node scripts/captura.mjs <url> ${tienda}-<qué> y Read de los PNG (regla 2026-08-18: NUNCA publicar sin chequeo visual).`);
    else if (!c.movil) fallos.push(`hay capturas pero ninguna MÓVIL posterior a la edición → node scripts/_cap-segs.mjs <url> ${tienda}-movil (decálogo #9: QA móvil por tramos antes de publicar).`);
  }

  // 5) Clon: convergencia + informe con 0 diferencias + go-live en vivo + checklist declarada
  const candado = candadoClon(tienda);
  if (candado) {
    fallos.push(...chequeosClon(tienda, st));
    const live = await chequeosGoLiveEnVivo(candado, tienda);
    fallos.push(...live.fallos);
    if (live.avisos.length) process.stderr.write("⚠️ go-live: " + live.avisos.join(" · ") + "\n");
    if (!esPushLive) {
      const informe = leer(join(root, "capturas", `informe-diferencias-${tienda}.md`));
      if (!(/moneda/i.test(informe) && /checkout/i.test(informe) && /descuento|cobro/i.test(informe))) {
        fallos.push("el informe de diferencias no lleva la sección GO-LIVE declarada. Añade un bloque `## GO-LIVE` que diga, punto por punto y con evidencia: moneda de la TIENDA en todo precio pintado · display = cobro (descuento automático verificado en el carrito) · home/nav/footer sin restos del producto anterior · logo del checkout · add-ons del bundle completos y visibles en el widget.");
      }
    }
  }
  return fallos;
}

export function chequeosSafePush(tienda, st, cmd) {
  const fallos = [];
  if (!backupReciente(tienda)) fallos.push(`sin backup reciente (<24h) en backups/${tienda}/ → node scripts/backup-theme.mjs ${tienda} (guardarraíl 1: backup antes de tocar nada)`);
  if (!validateTrasEdicion(st, st?.temas?.[tienda] || 0)) fallos.push("validate_theme (Dev MCP) no se ha ejecutado DESPUÉS de la última edición del tema en esta sesión (guardarraíl 3).");
  // --only con varios ficheros tras UNA bandera sube solo el primero, en silencio (ficha 2026-08-31)
  if (/--only\s+\S+\s+(?!--)\S+\.(json|liquid|css|js)\b/.test(cmd || "")) fallos.push("`--only a b` sube SOLO `a` (silencioso). Repite la bandera: `--only a --only b`.");
  return fallos;
}

export function chequeosAdminGraphql(cmd) {
  const fallos = [];
  if (!/\bmutation\b/i.test(cmd)) return fallos;
  // handle de producto = iniciales, nunca el nombre legible (regla dura 2026-08-24)
  if (/product(Create|Update|Set)\b/.test(cmd)) {
    const re = /handle\\?["']?\s*[:=]\s*\\?["']([^"'\\]+)\\?["']/g;
    let m;
    while ((m = re.exec(cmd))) {
      if (!RE_HANDLE_INICIALES.test(m[1])) fallos.push(`handle "${m[1]}" no es de INICIALES sin guiones (regla dura 2026-08-24: "The Blue Lamp Set" → tbls; ofusca el funnel a la competencia).`);
    }
  }
  // códigos de campaña NUNCA con fecha de fin (ficha 2026-09-09)
  if (/discountCode\w*(Create|Update)/.test(cmd) && /endsAt\\?["']?\s*:\s*\\?["']\d/.test(cmd)) {
    fallos.push("código de descuento con `endsAt`: el operador (2026-09-09) → los códigos de campaña NUNCA llevan fecha de fin aunque el correo diga \"ends tonight\"; la urgencia es solo copy.");
  }
  return fallos;
}
