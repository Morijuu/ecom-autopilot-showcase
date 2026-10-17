#!/usr/bin/env node
// gate-selftest.mjs — prueba los GATES de .claude/hooks/ con fixtures (transcript + estado sintéticos).
// Córrelo tras tocar cualquier hook: node scripts/gate-selftest.mjs   (0 = todo verde)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root, stateDir, guardarState } from "../.claude/hooks/_gate-lib.mjs";

const SID = "selftest-gates";
const tmp = join(root, ".claude", "state", "selftest-tmp");
mkdirSync(tmp, { recursive: true });
const transcript = join(tmp, "transcript.jsonl");
const T0 = Date.now() - 5 * 60000;
const AHORA = Date.now() - 2000;
const iso = (ms) => new Date(ms).toISOString();

function escribirTranscript(entradas) {
  writeFileSync(transcript, entradas.map(e => JSON.stringify(e)).join("\n") + "\n");
}
const user = (text, ms) => ({ type: "user", origin: { kind: "human" }, message: { role: "user", content: text }, timestamp: iso(ms) });
const toolUse = (name, ms, input = {}) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input }] }, timestamp: iso(ms) });
const texto = (t, ms) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] }, timestamp: iso(ms) });

function runHook(file, payload) {
  try {
    const out = execFileSync(process.execPath, [join(root, ".claude", "hooks", file)], { input: JSON.stringify({ session_id: SID, transcript_path: transcript, cwd: root, ...payload }), stdio: ["pipe", "pipe", "pipe"], cwd: root, timeout: 30000 });
    return { code: 0, out: out.toString(), err: "" };
  } catch (e) { return { code: e.status, out: String(e.stdout || ""), err: String(e.stderr || "") }; }
}
function estado(extra = {}) {
  const st = { session_id: SID, startedAt: T0, transcript, temas: {}, pushes: {}, publishes: {}, mutaciones: [], descartadas: [], ...extra };
  guardarState(SID, st);
  return st;
}

let fallos = 0, n = 0;
function check(nombre, cond, detalle = "") {
  n++;
  if (cond) console.log(`  ✓ ${nombre}`);
  else { fallos++; console.log(`  ✗ ${nombre}\n      ${detalle.replace(/\n/g, "\n      ").slice(0, 600)}`); }
}
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

console.log("PRE-TOOL: imágenes");
escribirTranscript([user("arregla el header de la tienda", T0)]);
estado();
let r = runHook("pre_tool.mjs", bash('node scripts/nano-gen.mjs "hero" out.png'));
check("bloquea nano-gen sin petición del operador", r.code === 2 && /dinero/.test(r.err), r.err);
r = runHook("pre_tool.mjs", { tool_name: "mcp__mcp-image__generate_image", tool_input: { prompt: "x" } });
check("bloquea mcp-image sin petición del operador", r.code === 2, r.err);
escribirTranscript([user("genera 3 variantes del logo con el producto adjunto", T0)]);
r = runHook("pre_tool.mjs", bash('node scripts/nano-gen.mjs "logo" out.png'));
check("pasa cuando el operador pidió imágenes", r.code === 0, r.err);
escribirTranscript([user("arregla el header", T0), texto("¿Genero un hero nuevo con el producto?", T0 + 1000), user("ok adelante", T0 + 2000)]);
r = runHook("pre_tool.mjs", bash('node scripts/gen-image.mjs "hero"'));
check("pasa con OK del operador como último prompt", r.code === 0, r.err);

console.log("PRE-TOOL: publish");
escribirTranscript([user("clona la pdp de x en la tienda", T0)]);
estado({ temas: { "zz-selftest": T0 + 60000 }, pushes: { "zz-selftest": T0 + 120000 } });
r = runHook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs zz-selftest theme publish --theme 123"));
check("bloquea publish sin OK posterior al push", r.code === 2 && /OK del operador/.test(r.err), r.err);
check("…y exige backup", /backup/.test(r.err), r.err);
check("…y exige validate_theme tras la edición", /validate_theme/.test(r.err), r.err);
check("…y exige capturas", /capturas/.test(r.err), r.err);
escribirTranscript([user("clona la pdp", T0), toolUse("mcp__shopify-dev-mcp__validate_theme", T0 + 70000), user("vale, métela", T0 + 180000)]);
mkdirSync(join(root, "backups", "zz-selftest", "x"), { recursive: true }); writeFileSync(join(root, "backups", "zz-selftest", "x", "a.txt"), "1");
mkdirSync(join(root, "capturas"), { recursive: true });
writeFileSync(join(root, "capturas", "zz-selftest-desktop.png"), "png"); writeFileSync(join(root, "capturas", "zz-selftest-movil.png"), "png");
r = runHook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs zz-selftest theme publish --theme 123"));
check("pasa con OK posterior + backup + validate + capturas", r.code === 0, r.err);
r = runHook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs zz-selftest theme push --theme 123"));
check("shopify-tienda push (sin wrapper) sigue pasando al wrapper, que lo bloquea él", r.code === 0, r.err);
r = runHook("pre_tool.mjs", bash("shopify theme push --live --path stores/zz-selftest/theme"));
check("bloquea push directo del CLI", r.code === 2, r.err);

console.log("PRE-TOOL: clon con candado");
writeFileSync(join(root, "capturas", ".clonando-zz-selftest"), "x");
writeFileSync(join(root, "capturas", ".convergencia-zz-selftest.json"), JSON.stringify({ ts: T0 + 20000, ref: "https://rivalmarca.com/products/the-thing", clon: "https://127.0.0.1:9/products/the-thing" }));
r = runHook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs zz-selftest theme publish --theme 123"));
check("bloquea clon con edición posterior a la convergencia", r.code === 2 && /POSTERIORES a la última convergencia/.test(r.err), r.err);
check("…exige informe de diferencias", /informe-diferencias/.test(r.err), r.err);
check("…detecta handle legible en la URL del clon", /INICIALES/.test(r.err), r.err);
writeFileSync(join(root, "capturas", ".convergencia-zz-selftest.json"), JSON.stringify({ ts: Date.now(), ref: "https://rivalmarca.com/products/tt", clon: "https://127.0.0.1:9/products/tt" }));
writeFileSync(join(root, "capturas", "informe-diferencias-zz-selftest.md"), "# informe\nHero: igual.\nResultado: 0 diferencias.\n## GO-LIVE\nmoneda USD ok · descuento automático verificado en carrito (cobro) · checkout logo puesto\n");
r = runHook("pre_tool.mjs", bash("node scripts/shopify-tienda.mjs zz-selftest theme publish --theme 123"));
check("pasa con convergencia fresca + informe 0 diferencias + GO-LIVE (red no disponible = aviso, no bloqueo)", r.code === 0, r.err);
rmSync(join(root, "capturas", ".clonando-zz-selftest"));

console.log("PRE-TOOL: safe-push y admin-graphql");
r = runHook("pre_tool.mjs", bash("node scripts/safe-push.mjs zz-selftest --theme 1 --only a.json b.json"));
check("bloquea --only con dos ficheros", r.code === 2 && /--only a --only b/.test(r.err), r.err);
r = runHook("pre_tool.mjs", bash("node scripts/safe-push.mjs zz-selftest --theme 1 --only a.json --only b.json"));
check("pasa safe-push correcto (backup+validate ok)", r.code === 0, r.err);
r = runHook("pre_tool.mjs", bash(`node scripts/admin-graphql.mjs zz-selftest 'mutation { productUpdate(input:{id:"gid://1", handle:"the-blue-lamp-set"}) { product { id } } }'`));
check("bloquea handle legible", r.code === 2 && /INICIALES/.test(r.err), r.err);
r = runHook("pre_tool.mjs", bash(`node scripts/admin-graphql.mjs zz-selftest 'mutation { productUpdate(input:{id:"gid://1", handle:"tbls"}) { product { id } } }'`));
check("pasa handle de iniciales", r.code === 0, r.err);
r = runHook("pre_tool.mjs", bash(`node scripts/admin-graphql.mjs zz-selftest 'mutation { discountCodeBasicCreate(basicCodeDiscount:{title:"SEEN15", startsAt:"2026-09-09", endsAt:"2026-09-10T00:00:00Z"}) { userErrors { message } } }'`));
check("bloquea código con endsAt", r.code === 2 && /endsAt/.test(r.err), r.err);
r = runHook("pre_tool.mjs", bash(`node scripts/admin-graphql.mjs zz-selftest '{ shop { name } }'`));
check("pasa una query de lectura", r.code === 0, r.err);

console.log("POST-TOOL: estado");
runHook("post_tool.mjs", { tool_name: "Edit", tool_input: { file_path: join(root, "stores", "zz-selftest", "theme", "sections", "x.liquid") } });
runHook("post_tool.mjs", bash("node scripts/safe-push.mjs zz-selftest --theme 1"));
runHook("post_tool.mjs", bash(`node scripts/admin-graphql.mjs zz-selftest 'mutation { productUpdate(input:{id:"1"}) { product { id } } }'`));
const st = JSON.parse((await import("node:fs")).readFileSync(join(stateDir, `${SID}.json`), "utf8"));
check("registra edición de tema, push y mutación", st.temas["zz-selftest"] > 0 && st.pushes["zz-selftest"] > 0 && st.mutaciones.length === 1 && st.mutaciones[0].kind === "productUpdate", JSON.stringify(st));

console.log("CIERRE");
escribirTranscript([user("haz la pdp", T0), texto("Hecho.", T0 + 1000), user("no, está mal: el botón era rojo y lo has puesto negro", AHORA), texto("Corregido.", AHORA + 500)]);
estado({ startedAt: Date.now(), temas: { "zz-selftest": Date.now() } });
r = runHook("cierre.mjs", {});
check("bloquea corrección del operador sin ficha en errores/", r.code === 2 && /corrigió algo/.test(r.err), r.err);
check("…y exige ticket si se tocó una tienda", /tickets/.test(r.err), r.err);
estado({ startedAt: AHORA, temas: { "zz-selftest": AHORA }, descartadas: [{ ts: Date.now(), motivo: "selftest" }] });
r = runHook("cierre.mjs", {});
check("la corrección descartada ya no bloquea", !/corrigió algo/.test(r.err), r.err);
escribirTranscript([user("publica", T0), texto("## Informe\nTodo publicado. Link: https://tienda.com/products/x", T0 + 1000)]);
estado({ publishes: { "zz-selftest": T0 + 500 } });
r = runHook("cierre.mjs", {});
check("bloquea publish sin link en la PRIMERA línea", r.code === 2 && /PRIMERA línea/.test(r.err), r.err);
escribirTranscript([user("publica", T0), texto("https://tienda.com/products/x — publicado.\nDetalles…", T0 + 1000)]);
r = runHook("cierre.mjs", {});
check("pasa con el link en la primera línea", !/PRIMERA línea/.test(r.err), r.err);
escribirTranscript([user("haz x", T0), texto("Hecho. ¿Quieres que lo guarde en memoria y haga commit?", T0 + 1000)]);
estado();
r = runHook("cierre.mjs", {});
check("bloquea la pregunta prohibida", r.code === 2 && /PROHIBIDO preguntar/.test(r.err), r.err);
escribirTranscript([user("haz x", T0), texto("Hecho. Los gates bloquean preguntas del tipo \"¿quieres que lo guarde?\".\nTodo commiteado.", T0 + 1000)]);
r = runHook("cierre.mjs", {});
check("una pregunta prohibida CITADA como ejemplo no bloquea", !/PROHIBIDO preguntar/.test(r.err), r.err);
escribirTranscript([user("haz x", T0), texto("Hecho. ¿Quieres que lo guarde en memoria y haga commit?", T0 + 1000)]);
r = runHook("cierre.mjs", { stop_hook_active: true });
check("con stop_hook_active solo avisa (anti-bucle)", r.code === 0, r.err);
escribirTranscript([user("haz x", T0), texto("Hecho.", T0 + 1000)]);
estado({ mutaciones: [{ ts: Date.now() + 5000, tienda: "aaaaaa-aa", kind: "productUpdate" }] });
r = runHook("cierre.mjs", {});
check("bloquea mutación de producto en tienda del equipo sin productos-en-marcha.md", /productos-en-marcha/.test(r.err), r.err);

console.log("CIERRE DE TURNO (regla 2026-09-10)");
escribirTranscript([user("clona la pdp de https://rivalx.com/products/abc en la tienda", T0), texto("Hecho.", T0 + 1000), user("me encanta el hero, perfecto. bueno, cierro el turno", AHORA)]);
estado({ startedAt: Date.now() });
r = runHook("prompt_submit.mjs", { prompt: "me encanta el hero, perfecto. bueno, cierro el turno" });
check("prompt_submit reconoce el cierre y entrega el inventario", r.code === 0 && /CIERRE DE TURNO/.test(r.out) && /rivalx.com/.test(r.out) && /me encanta/.test(r.out), r.out + r.err);
r = runHook("prompt_submit.mjs", { prompt: "no, está mal el color del botón" });
check("prompt_submit avisa de corrección en el momento", /CORRECCIÓN/.test(r.out), r.out + r.err);
r = runHook("cierre.mjs", {});
check("cierre exige el link en memoria", r.code === 2 && /rivalx.com.*NO está en memoria/.test(r.err), r.err);
check("cierre exige destilar gustos", /gustos\/aprobaciones/.test(r.err), r.err);
check("cierre exige ticket de la sesión", /no hay ticket de esta sesión/.test(r.err), r.err);
writeFileSync(join(root, "memoria", "tickets", "zz-selftest-cierre.md"), "# selftest\nref: https://rivalx.com/products/abc\n");
writeFileSync(join(root, "memoria", "referencias", "zz-selftest.md"), "# selftest gusto\n");
escribirTranscript([user("clona la pdp de https://rivalx.com/products/abc", T0), texto("Hecho.", T0 + 1000), user("me encanta el hero, perfecto. cierro el turno", AHORA), texto("Guardado: ticket, referencia rivalx, gusto en gustos.md. Commit y push hechos.", AHORA + 500)]);
r = runHook("cierre.mjs", {});
check("cierre pasa con link, gusto y ticket guardados", !/rivalx|gustos\/aprobaciones|no hay ticket|resumir QUÉ/.test(r.err), r.err);
rmSync(join(root, "memoria", "tickets", "zz-selftest-cierre.md")); rmSync(join(root, "memoria", "referencias", "zz-selftest.md"));

console.log("NORMA 1: confirmación punto por punto");
escribirTranscript([user("arregla el hero de la pdp", T0), texto("Hecho, hero arreglado y pusheado. Link: https://x.com/products/a", AHORA)]);
estado({ startedAt: Date.now(), temas: { "zz-selftest": AHORA } });
r = runHook("cierre.mjs", {});
check("bloquea trabajo en tienda sin el bloque de confirmación", r.code === 2 && /NORMA 1/.test(r.err) && /falta el bloque entero/.test(r.err), r.err);
const bloque = [
  "https://x.com/products/a — hero arreglado.", "", "CONFIRMACIÓN PUNTO POR PUNTO",
  "1. QA visual ✅ capturas zz-desktop.png y zz-movil.png posteriores a la edición, leídas tramo a tramo (hero, badges, CTA).",
  "2. Fidelidad ✅ el hero replica la referencia sección a sección; informe-diferencias-zz.md dice 0 diferencias.",
  "3. Interacciones ✅ ATC y drawer probados con clicks reales en Chrome: abre con el ítem, cierra y el scroll queda libre.",
  "4. Colores ✅ CTA #e0343c y banda crema tomados del píxel de la captura de la referencia, no de tokens CSS.",
  "5. Imágenes N/A no se ha generado ni sustituido ninguna imagen en este encargo; se usan las de la fuente.",
  "6. Memoria y links ✅ ticket tickets/2026-09-10-zz.md actualizado, link de referencia guardado en referencias/zz.md.",
  "7. Alcance ✅ solo sections/hero.liquid y templates/product.a.json; badges y footer intactos como pedía el encargo.",
  "8. Go-live ✅ precios en EUR, descuento automático verificado en el carrito, sin marca del rival, checkout con logo.",
  "9. Ofertas / bundles N/A este encargo no toca la oferta; el bundle por cantidad sigue como estaba.",
  "10. Ambición de diseño ✅ referencias ref-a y ref-b repasadas; decálogo de gustos.md aplicado (announcement bar arriba).",
  "11. Scroll ✅ curva de scroll medida cada 100px en ref y clon: header y galería sticky se sueltan en el mismo punto (±10px).",
  "12. Botones ✅ pulsados todos los botones de la página en ref y clon (tiers, ATC, drawer, FAQ, load more de reseñas): responden igual.",
].join("\n");
escribirTranscript([user("arregla el hero de la pdp", T0), texto(bloque, AHORA)]);
r = runHook("cierre.mjs", {});
check("pasa con el bloque completo y justificado", !/NORMA 1/.test(r.err), r.err);
escribirTranscript([user("arregla el hero de la pdp", T0), texto(bloque.replace(/^4\. Colores.*$/m, "4. Colores ✅ ok"), AHORA)]);
r = runHook("cierre.mjs", {});
check("bloquea un punto sin justificar ('ok' a secas)", /NORMA 1/.test(r.err) && /4\. Colores/.test(r.err), r.err);
escribirTranscript([user("arregla el hero de la pdp", T0), texto("⏳ EN CURSO — pusheado al tema 123, pendiente tu OK para publicar.", AHORA)]);
r = runHook("cierre.mjs", {});
check("turno a medias con ⏳ EN CURSO no exige el bloque", !/NORMA 1/.test(r.err), r.err);
estado({ startedAt: Date.now(), temas: { "zz-selftest": AHORA }, cierrePedido: Date.now() });
r = runHook("cierre.mjs", {});
check("con cierre de turno pedido, ⏳ EN CURSO no vale", /NORMA 1/.test(r.err), r.err);

console.log("SESSION-START");
r = runHook("session_start.mjs", {});
check("emite additionalContext con los gates", r.code === 0 && /GATES CABLEADOS/.test(r.out), r.out + r.err);

// limpieza
for (const f of ["zz-selftest-desktop.png", "zz-selftest-movil.png", "informe-diferencias-zz-selftest.md", ".convergencia-zz-selftest.json", ".conv-remind-zz-selftest"]) { try { rmSync(join(root, "capturas", f)); } catch {} }
rmSync(join(root, "backups", "zz-selftest"), { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
try { rmSync(join(stateDir, `${SID}.json`)); } catch {}

console.log(`\n${n - fallos}/${n} verdes${fallos ? ` — ${fallos} FALLOS` : ""}`);
process.exit(fallos ? 1 : 0);
