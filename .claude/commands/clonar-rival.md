---
description: Extrae el sistema de diseño de la web de un rival (colores, tipografía, spacing, animaciones) y reconstruye ese look en la tienda — sin copiar su código.
argument-hint: <url-del-rival>
---

Clonar el LOOK de un rival (no su código): extraemos su sistema de diseño con la herramienta `skillui`
y reconstruimos ese estilo en el tema con las skills de diseño.

## Pasos
1. **Extrae el design system a una carpeta APARTE** (fuera del repo, para no pisar nuestro CLAUDE.md):
   ```
   npx -y skillui@1.3.4 --url $1 --mode ultra --out assets-workspace/clones
   ```
   - Modo **ultra** = screenshots + animaciones capturados **en local** (requiere Playwright, ver HANDOFF).
   - Si Playwright no está instalado, usa el modo por defecto (quita `--mode ultra`) — más simple, pero el
     screenshot lo hace vía un servicio externo (microlink); la URL del rival, que es pública, pasa por ahí.
   - Salida: `assets-workspace/clones/<nombre>/` con `DESIGN.md`, `tokens/*.json`, screenshots y referencias.
2. **Lee los tokens** (`tokens/colors.json`, `typography.json`, `spacing.json`) y `DESIGN.md`. Esos son la
   materia prima: paleta, escala tipográfica, spacing, animaciones del rival.
3. **Reconstruye el look en el tema** con `frontend-design` + `design-taste` + `emil-design-eng`: vuelca los
   tokens a `settings_schema.json`/`settings_data.json` y monta las secciones. **Diferénciate** dondel operador
   pida (no es una copia calcada): aplica su gusto (`memoria/gustos.md`) y el del cliente.
4. **Des-branding**: quita del resultado cualquier marca/nombre/watermark del rival (regla del CLAUDE.md).
5. Sigue el flujo normal: backup → validar → preview → publish con OK.

## Aviso legal (dilo si aplica)
Se replica el **look** (paleta, estructura, ritmo) vía tokens. **No** se copian assets, logos ni copy
propietarios del rival. Eso sería un problema de copyright — el sistema saca el estilo, no roba el contenido.
