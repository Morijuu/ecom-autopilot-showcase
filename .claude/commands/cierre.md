---
description: Cierra el turno recogiendo TODO lo de la sesión en memoria (correcciones, gustos, links, ticket, lecciones) sin que el operador lo enumere.
---

el operador quiere cerrar el turno. Regla suya (2026-09-10): "cuando diga que quiero cerrar el turno quiero que se
recojan las correcciones, gustos nuevos, etc. sin tener que ponerlo todo cada vez". El hook `prompt_submit.mjs`
ya te ha entregado el inventario de la sesión (o corre `node scripts/gate.mjs cierre` para verlo). Haz, sin preguntar:

1. **Correcciones** → una ficha por cada una en `memoria/errores/` (`_plantillas/error.md`, frase verbatim) + línea
   en `errores/INDEX.md`. Si rima con una ficha existente, actualiza esa (subir de nivel la regla).
2. **Gustos / aprobaciones / rechazos** → `memoria/gustos.md` (el operador) o `clientes/<cliente>.md` (cliente): QUÉ y POR QUÉ.
3. **Links que pasó el operador** → `referencias/<slug>.md` + `referencias/INDEX.md` (tienda de referencia/rival) o el ticket.
4. **Ticket** de la sesión en `memoria/tickets/` (verbatim, qué se hizo, delta exacto, bloque "Feedback del operador") +
   `tiendas/<t>.md` + hub del cliente + `productos-en-marcha.md` si cambió producto.
5. **Lecciones técnicas** → `aprendido/<tema>.md` + INDEX. Lo repetido ≥2 veces se promociona (como en `/curar`).
6. `git add -A && git commit && git push`. Termina con un resumen corto de QUÉ quedó guardado. Sin preguntas.

7. **NORMA 1**: el mensaje final lleva el bloque literal "CONFIRMACIÓN PUNTO POR PUNTO" con los 10 puntos del operador
   (QA visual · Fidelidad · Interacciones · Colores · Imágenes · Memoria y links · Alcance · Go-live · Ofertas/bundles ·
   Ambición de diseño), cada uno con ✅/N/A + dónde se aplicó o por qué está cubierto.

El gate de cierre bloquea el turno hasta que todo esto esté hecho.
