#!/usr/bin/env node
/**
 * build-history.mjs
 * Acumula un historico diario de Core Web Vitals a partir de data/psi.json.
 * Cada corrida AGREGA una entrada por (fecha, target, estrategia) — no sobreescribe
 * el historico completo, solo reemplaza la entrada del mismo dia si ya existe
 * (idempotente si el workflow corre dos veces el mismo dia).
 *
 * Guarda solo las metricas clave para seguimiento: performance score, LCP, TBT, CLS.
 *
 * Salida: data/history.json
 *   {
 *     "updatedAt": "...",
 *     "entries": [
 *       { "date":"2026-09-03","id":"home-prod","label":"Home","env":"prod","type":"home",
 *         "strategy":"mobile","score":53,"lcp":10834,"tbt":228,"cls":0.0003 },
 *       ...
 *     ]
 *   }
 *
 * No requiere red ni secrets.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PSI_PATH = join(ROOT, 'data', 'psi.json');
const OUT_PATH = join(ROOT, 'data', 'history.json');

// Cuantos dias de historico conservar (evita crecimiento infinito). ~2 anos.
const MAX_DAYS = 730;

async function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function todayUTC() {
  // Fecha en formato YYYY-MM-DD (UTC), coherente con generatedAt del PSI
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const psi = await readJsonSafe(PSI_PATH, null);
  if (!psi || !Array.isArray(psi.targets) || psi.targets.length === 0) {
    console.log('[history] psi.json vacio o pendiente; no se agrega historico.');
    return;
  }

  // Fecha de referencia: la del PSI si existe, si no hoy.
  const date = (psi.generatedAt ? psi.generatedAt.slice(0, 10) : todayUTC());

  const history = await readJsonSafe(OUT_PATH, { updatedAt: null, entries: [] });
  if (!Array.isArray(history.entries)) history.entries = [];

  // Nuevas entradas de esta corrida
  const nuevas = [];
  for (const t of psi.targets) {
    for (const strategy of ['mobile', 'desktop']) {
      const s = t.strategies?.[strategy];
      if (!s || !s.score) continue; // si esa estrategia fallo, no registramos fila vacia
      nuevas.push({
        date,
        id: t.id,
        label: t.label,
        env: t.env,
        type: t.type,
        strategy,
        score: s.score.performance ?? null,
        lcp: s.lab?.lcp ?? null,
        tbt: s.lab?.tbt ?? null,
        cls: s.lab?.cls ?? null,
      });
    }
  }

  if (nuevas.length === 0) {
    console.log('[history] sin metricas validas en psi.json; nada que agregar.');
    return;
  }

  // Idempotencia: quitar del historico las entradas del MISMO dia+id+strategy
  // que vamos a reemplazar con las nuevas.
  const clave = (e) => `${e.date}|${e.id}|${e.strategy}`;
  const clavesNuevas = new Set(nuevas.map(clave));
  history.entries = history.entries.filter((e) => !clavesNuevas.has(clave(e)));

  // Agregar las nuevas
  history.entries.push(...nuevas);

  // Ordenar por fecha ascendente (y por id/strategy para estabilidad)
  history.entries.sort((a, b) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id) || a.strategy.localeCompare(b.strategy)
  );

  // Podar dias muy viejos (conservar solo los ultimos MAX_DAYS dias distintos)
  const dias = Array.from(new Set(history.entries.map((e) => e.date))).sort();
  if (dias.length > MAX_DAYS) {
    const corte = dias[dias.length - MAX_DAYS];
    history.entries = history.entries.filter((e) => e.date >= corte);
  }

  history.updatedAt = new Date().toISOString();

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(history, null, 2), 'utf8');

  const totalDias = new Set(history.entries.map((e) => e.date)).size;
  console.log(`[history] +${nuevas.length} entradas para ${date}. Total: ${history.entries.length} filas en ${totalDias} dias.`);
}

main().catch((err) => {
  console.error('[history] error fatal:', err);
  process.exit(1);
});
