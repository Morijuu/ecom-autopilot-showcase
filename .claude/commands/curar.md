---
description: Cura la memoria — dedupe, generaliza, poda y promociona lo repetido a reglas. El mantenimiento que hace que el sistema MEJORE con el uso.
---

Curación de la memoria (`memoria/`). Córrelo cuando el operador lo pida, cuando un INDEX pase de ~30 líneas,
o si llevas ~2 semanas sin curar. Es lo que convierte "apuntar cosas" en "mejorar con el uso".

1. **`git pull`** y abre los 3 índices: `errores/INDEX.md`, `aprendido/INDEX.md`, `referencias/INDEX.md`.
2. **DEDUPE / FUSIONA**: fichas que riman (mismo tema, misma causa raíz) → fusiónalas en UNA con la
   regla en su forma más general; la que muere queda como enlace "superseded" o se borra si no aporta.
3. **GENERALIZA**: revisa cada regla — ¿está escrita para el caso concreto cuando en realidad aplica a
   cualquier tema/tienda? Reescríbela al nivel MÁS GENERAL que siga siendo verdad (el caso concreto se
   queda como ejemplo dentro de la ficha, los tags dan el contexto).
4. **PROMOCIONA**: lo que aparezca en **≥2 casos** (2 errores iguales, 2 lecciones que riman, un gusto
   del operador repetido) sube de nivel:
   - regla operativa → **CLAUDE.md** (la sección que toque), en 1-3 líneas, con commit APARTE cuyo
     mensaje diga qué evidencia la respalda;
   - gusto estable → `gustos.md`;
   - técnica madura → una ficha `aprendido/` consolidada.
   ⚠️ CLAUDE.md se toca con bisturí: añadir/afinar reglas pequeñas SÍ; reescribir secciones enteras o
   tocar guardarraíles de producción/seguridad → propónselo al operador primero.
5. **PODA**: fichas caducas (una app que ya no se usa, un bug de un tema abandonado) → márcalas al
   final del INDEX bajo "— archivo —" (no borres la ficha: histórico barato).
6. **VALIDA los índices**: cada ficha tiene su línea, cada línea su ficha, los `[[enlaces]]` apuntan a
   ficheros que existen, y los tickets de la quincena tienen su "Feedback del operador" relleno.
7. **Mide y cuéntalo**: nº de errores nuevos vs tickets de la quincena (¿baja la tasa?), qué
   promocionaste y por qué. Resumen corto al operador.
8. **`git add -A && git commit && git push`** (la promoción a CLAUDE.md en su commit aparte).
