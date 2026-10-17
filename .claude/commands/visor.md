---
description: Levanta el visor local de una tienda (theme dev con hot-reload) para ver los cambios en vivo antes de subir nada.
argument-hint: <nombre-de-la-tienda>
---

Taller visual de la tienda $1 — el operador ve cada cambio en vivo antes de que toque Shopify:

1. Si no hay copia fresca del tema: `mkdir -p stores/$1/theme` y luego
   `node scripts/shopify-tienda.mjs $1 theme pull --live --force --path stores/$1/theme`
   (sin `--live --force` y con la carpeta inexistente, el CLI pregunta interactivo y se cuelga — ver `memoria/aprendido/cli-no-interactivo.md`).
2. Arranca el visor EN BACKGROUND: `node scripts/shopify-tienda.mjs $1 theme dev --path stores/$1/theme`
   y dile al operador que abra **http://127.0.0.1:9292**. Renderiza con los datos REALES de su tienda y se
   refresca solo con cada guardado (hot-reload). Es un tema de DESARROLLO temporal: el live ni se entera.
3. Itera: el operador pide por prompt → editas → él lo ve. Pídele pantallazos del visor para criticarlos tú
   primero (loop visual del CLAUDE.md).
4. Cuando el operador diga "métela": para el visor y sigue los guardarraíles — backup → `validate_theme` →
   `safe-push` a unpublished → preview → publish SOLO con su OK explícito.
