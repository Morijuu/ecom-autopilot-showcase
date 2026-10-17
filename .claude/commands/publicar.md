---
description: Publica los cambios de un tema de forma segura (con backup, validación y OK humano).
argument-hint: <nombre-de-la-tienda>
---

Deploy seguro. NO te saltes ningún paso:

1. **Verifica la tienda correcta**: `node scripts/shopify-tienda.mjs $1 theme info` contra
   `memoria/tiendas/$1.md` y `stores/registry.yml`.
2. **Backup**: `node scripts/backup-theme.mjs $1` (pull del tema vivo a `backups/$1/<timestamp>/`).
3. **Valida**: `validate_theme` del Dev MCP en VERDE (loop hasta 0 errores).
4. **Push a UNPUBLISHED**: `node scripts/safe-push.mjs $1 --theme <id>` (fuerza `--nodelete`, bloquea `--live`).
5. **Preview**: enséñale al operador el tema unpublished
   (`node scripts/shopify-tienda.mjs $1 theme open --theme <id>`) para que lo revise.
6. **Publicar**: `node scripts/shopify-tienda.mjs $1 theme publish --theme <id>` **SOLO cuando el operador diga OK
   explícito**. Verifica el storefront en vivo.
7. Registra el cierre en `memoria/tickets/` y `git commit` + `git push`.

⛔ Nunca `shopify theme push --live` directo. `safe-push.mjs` lo bloquea a propósito (y el wrapper
`shopify-tienda.mjs` bloquea cualquier `push` suelto).
