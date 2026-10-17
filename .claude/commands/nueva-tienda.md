---
description: Da de alta una tienda nueva (Theme Access) para poder trabajar en ella.
argument-hint: <nombre-corto-de-la-tienda>
---

Alta de una tienda nueva. Guía al operador paso a paso (es un proceso manual del lado del merchant):

1. El merchant instala la app **Theme Access** en su tienda y genera una contraseña (scope `write_themes`).
   Le llega por email un **enlace que caduca a los 7 días o al abrirlo**. Si la tienda no es del operador,
   dale este mensaje LISTO PARA REENVIAR al merchant (ajusta el nombre):
   > Para trabajar en el diseño de tu tienda necesito un acceso limitado SOLO a temas (no ve pedidos,
   > ni pagos, ni clientes, y lo puedes revocar cuando quieras desde tu admin): 1) en tu admin de
   > Shopify → Apps → busca e instala "Theme Access" (gratuita, oficial de Shopify) · 2) dentro, crea
   > una contraseña a nombre del operador · 3) te llega un email — **reenvíamelo SIN abrir el enlace**
   > (es de un solo uso y caduca). Son 3 minutos.
2. Crea la carpeta de la tienda: `stores/$1/` con un `.env` (copia de `.env.example` de la raíz, pero solo
   con `SHOPIFY_CLI_THEME_TOKEN=<theme-access-token>` y `SHOPIFY_FLAG_STORE=<store handle REAL>`). **El token NUNCA al repo.**
   ⚠️ El handle REAL de la tienda a veces NO es el que muestra el admin (vanity-name→xxxxxx-xx):
   confírmalo en el HTML del storefront (`Shopify.shop`) o en Admin → Configuración → Dominios.
3. Verifica el acceso: `node scripts/shopify-tienda.mjs $1 theme list` (carga el token del .env sin exponerlo;
   si lista los temas, credencial OK) y `node scripts/shopify-tienda.mjs $1 theme info` (tienda correcta).
4. Crea la ficha `memoria/tiendas/$1.md` desde `memoria/_plantillas/tienda.md` y rellena lo que sepas.
5. Añade la tienda a `stores/registry.yml` (cliente, dominio, tema, notas — **sin tokens**).
6. **Ofrece conectar el módulo B** (Files/CDN + catálogo + menús + páginas + descuentos por prompt):
   guía `HANDOFF-modulo-B.md` — mini-app `media-$1` en el Dev Dashboard (⚠️ **en la org <agency-org>**,
   la que tiene la colaboración con la tienda; en otra org el instalar da un 500 mudo), ~2-3 min de
   clics dictados + `node scripts/conectar-admin.mjs $1` + clic Instalar → token permanente. Si el operador
   dice "luego", déjalo anotado en la ficha de la tienda como pendiente.
7. **Sube los tokens CIFRADOS a git** (regla del operador 2026-10-09): `node scripts/secretos.mjs sync $1 --push` →
   `stores/$1/.env.enc` viaja a todos los dispositivos. Antes de dar de alta nada, mira si ya existe
   `stores/$1/.env.enc` en git: entonces basta `node scripts/secretos.mjs sync`.
