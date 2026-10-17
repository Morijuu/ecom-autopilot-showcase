---
description: Lee el último cambio pedido en un ticket de Discord y ponte a trabajar sobre esa tienda.
argument-hint: <id-del-canal-de-discord>
---

Vamos a resolver un ticket de Discord.

1. Lee los últimos mensajes del canal: `node scripts/discord-pull.mjs $1`
2. Identifica **qué cliente y qué tienda**. Si no está claro, dilo y pregunta lo justo — no adivines.
3. **Abre el hub del cliente** `memoria/clientes/<cliente>.md`: sus gustos, sus webs y su historial de tickets
   (¿es un cambio sobre algo que ya se hizo? mira el ticket anterior). Si el cliente es nuevo, créalo desde
   `memoria/_plantillas/cliente.md`. Abre también `memoria/gustos.md` (estilo del operador) y la ficha de la tienda.
4. Sigue el **protocolo "antes de tocar un tema"** del CLAUDE.md: `git pull` → identifica modo → `theme pull` fresco → backup.
5. Aplica **SOLO** lo pedido. Valida con el Dev MCP. Enseña preview. Publica **solo con OK del operador**.
6. Al cerrar: deja el registro en `memoria/tickets/<fecha>-<cliente>.md` (plantilla en `_plantillas/ticket.md`),
   añade la línea al historial del hub del cliente, y `git commit` + `git push`.
