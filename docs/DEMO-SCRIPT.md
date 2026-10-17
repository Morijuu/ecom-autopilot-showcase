# Demo script (60–90 s)

Two demos: the one you can run from this repo with no credentials (**A**, recorded as `docs/demo.gif`),
and the full one that needs a real store (**B**, recording guide only, because it shows client data).

## A. The gates, locally (recorded — `docs/demo.gif`)

Terminal, 1280×720, dark theme. Each command is typed, output appears, 2 s pause.

| t (s) | Command | What the viewer sees |
| --- | --- | --- |
| 0–8 | `node scripts/gate-selftest.mjs \| tail -3` | `43/43 verdes` — the hooks have a fixture test-suite |
| 8–25 | `node scripts/demo-gates.mjs` (scenario 1) | the model tries `theme publish` → **BLOCKED**: no operator OK in the transcript, no backup < 24 h |
| 25–38 | (scenario 2) | raw `shopify theme push --live` → **BLOCKED**: everything goes through `safe-push.mjs` |
| 38–50 | (scenario 3) | `productUpdate` with handle `the-blue-lamp-set` → **BLOCKED**: handles are initials only (`tbls`) |
| 50–62 | (scenario 4) | image generation with nobody asking for it → **BLOCKED**: costs money, needs a real "yes" |
| 62–80 | (scenario 5) | the model tries to end the turn after editing a store → **BLOCKED**: no ticket written, no 12-point confirmation block |
| 80–90 | `node scripts/gate.mjs estado demo-store` | the dry-run the model is told to ask *before* trying |

Re-record: `node docs/record-demo.mjs` (Playwright renders a fake terminal replaying the real outputs
captured from the commands above, then ffmpeg converts the webm to GIF).

## B. A real clone job end to end (not recorded here: shows a client store)

1. `/visor <store>` — dev server with hot reload on http://127.0.0.1:9292, the operator keeps it open.
2. Operator: *"clone the PDP of <reference url> onto <store>"*. The assistant creates the ticket, pulls the live
   theme, runs `backup-theme.mjs`, then `convergencia.mjs <store> <ref-url> <clone-url>` → both pages captured,
   clone lock armed.
3. Sub-agent `tema` builds the sections; `post_tool.mjs` reminds the convergence rule on each theme edit.
4. Sub-agent `clonador` loops: capture both → write `capturas/informe-diferencias-<store>.md` section by section
   (what the reference has that the clone lacks, colors, type, columns, media, interactions tested with real clicks)
   → fix → repeat until the report says `0 diferencias`.
5. Sub-agent `qa-visual`: desktop + mobile by viewport segments, every button clicked on both pages, scroll curve
   measured every 100 px.
6. `safe-push.mjs <store> --theme <unpublished id>` → preview link to the operator.
7. Operator: *"publish"* → `pre_tool.mjs` checks the transcript for that OK, backup age, validate, captures, 0-diff
   report, GO-LIVE declaration, live `available:true`, initials handle, no rival brand in HTML → `theme publish`.
8. Final message: live link in the first line + collapsed 12-point confirmation; `cierre.mjs` verifies memory is
   committed and pushed, the ticket has its `Etapa: COMPLETADO` line, and every correction got an error card.
