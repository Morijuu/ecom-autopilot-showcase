#!/usr/bin/env node
// Hook puente (AÑADIDO 2026-10-08, no sustituye a ningún gate): reenvía el JSON del hook a la PIZARRA viva del Diario
// (ecom-diario/scripts/pizarra.mjs) con el área de este repo. Nunca bloquea: sale 0 siempre, pase lo que pase.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const AREA = "taller";
const DIARIO = process.env.CEREBRO_DIARIO_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "ecom-diario");
const script = path.join(DIARIO, "scripts", "pizarra.mjs");
try {
  let input = ""; try { input = fs.readFileSync(0, "utf8"); } catch {}
  if (fs.existsSync(script)) spawnSync(process.execPath, [script, "--area", AREA], { input, stdio: ["pipe", "ignore", "ignore"], timeout: 8000, env: { ...process.env, CEREBRO_DIARIO_DIR: DIARIO } });
} catch {}
process.exit(0);
