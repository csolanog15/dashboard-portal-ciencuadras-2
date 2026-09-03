#!/usr/bin/env node
/**
 * collect-clarity.mjs
 * Recolecta senales de usabilidad desde la Microsoft Clarity Data Export API.
 * Solo produccion (preprod no tiene tracking de Clarity).
 *
 * Salida: data/clarity.json
 *
 * Requiere: variable de entorno CLARITY_API_TOKEN (JWT del proyecto, Settings -> Data Export)
 * Node 18+ (usa fetch nativo).
 *
 * Limites de la API (oficial):
 *  - Maximo 10 requests por proyecto por dia.
 *  - Solo datos de los ultimos 1 a 3 dias.
 *  - Respuesta max 1000 filas, sin paginacion.
 *  - Timezone UTC.
 *
 * Estrategia: usamos pocas llamadas para respetar el limite diario.
 *   1) Resumen global (sin dimension)  -> totales para tarjetas principales
 *   2) Desglose por URL (dimension1=URL) -> tabla por pagina
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'data', 'clarity.json');

const TOKEN = process.env.CLARITY_API_TOKEN;
const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const NUM_DAYS = 3;

if (!TOKEN) {
  console.error('ERROR: falta la variable de entorno CLARITY_API_TOKEN');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchInsights(dimensions = []) {
  const params = new URLSearchParams();
  params.set('numOfDays', String(NUM_DAYS));
  dimensions.forEach((d, i) => params.set(`dimension${i + 1}`, d));
  const url = `${ENDPOINT}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Convierte valores que la API a veces manda como string en numero. */
function num(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * La API devuelve [{metricName, information:[...]}]. Los nombres de campo
 * dentro de information varian por metrica. Buscamos de forma tolerante
 * la primera clave que coincida con alguno de los alias dados.
 */
function pickField(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const k = keys.find((key) => key.toLowerCase() === alias.toLowerCase());
    if (k != null) return row[k];
  }
  // busqueda por "contiene"
  for (const alias of aliases) {
    const k = keys.find((key) => key.toLowerCase().includes(alias.toLowerCase()));
    if (k != null) return row[k];
  }
  return undefined;
}

function findMetric(payload, name) {
  if (!Array.isArray(payload)) return null;
  return payload.find(
    (m) => (m.metricName || '').toLowerCase() === name.toLowerCase()
  ) || null;
}

/** Suma un campo numerico a lo largo de todas las filas de una metrica. */
function sumMetric(payload, metricName, fieldAliases) {
  const metric = findMetric(payload, metricName);
  if (!metric || !Array.isArray(metric.information)) return 0;
  return metric.information.reduce((acc, row) => acc + num(pickField(row, fieldAliases)), 0);
}

async function main() {
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'Microsoft Clarity Data Export API',
    windowDays: NUM_DAYS,
    env: 'prod',
    summary: {},
    byUrl: [],
    raw: {},
    error: null,
  };

  try {
    // 1) Resumen global (sin dimension)
    console.log('[Clarity] solicitando resumen global...');
    const global = await fetchInsights([]);
    output.raw.global = global;

    output.summary = {
      traffic: {
        sessions: sumMetric(global, 'Traffic', ['totalSessionCount', 'sessionCount', 'sessions']),
        botSessions: sumMetric(global, 'Traffic', ['totalBotSessionCount', 'botSessionCount']),
        distinctUsers: sumMetric(global, 'Traffic', ['distantUserCount', 'distinctUserCount', 'userCount']),
      },
      deadClicks: sumMetric(global, 'DeadClickCount', ['sessionsWithDeadClicks', 'deadClickCount', 'count', 'subTotal']),
      rageClicks: sumMetric(global, 'RageClickCount', ['sessionsWithRageClicks', 'rageClickCount', 'count', 'subTotal']),
      quickBacks: sumMetric(global, 'QuickbackClick', ['sessionsWithQuickbacks', 'quickbackClickCount', 'count', 'subTotal']),
      excessiveScroll: sumMetric(global, 'ExcessiveScroll', ['sessionsWithExcessiveScroll', 'excessiveScrollCount', 'count', 'subTotal']),
      scriptErrors: sumMetric(global, 'ScriptErrorCount', ['sessionsWithScriptErrors', 'scriptErrorCount', 'count', 'subTotal']),
      errorClicks: sumMetric(global, 'ErrorClickCount', ['sessionsWithErrorClicks', 'errorClickCount', 'count', 'subTotal']),
    };

    await sleep(1500);

    // 2) Desglose por URL (para tabla por pagina)
    console.log('[Clarity] solicitando desglose por URL...');
    const byUrlRaw = await fetchInsights(['URL']);
    output.raw.byUrl = byUrlRaw;

    // Consolidamos por URL a traves de las metricas relevantes
    const urlMap = new Map();
    const metricsToTrack = [
      ['Traffic', ['totalSessionCount', 'sessionCount', 'sessions'], 'sessions'],
      ['DeadClickCount', ['sessionsWithDeadClicks', 'deadClickCount', 'count', 'subTotal'], 'deadClicks'],
      ['RageClickCount', ['sessionsWithRageClicks', 'rageClickCount', 'count', 'subTotal'], 'rageClicks'],
      ['QuickbackClick', ['sessionsWithQuickbacks', 'quickbackClickCount', 'count', 'subTotal'], 'quickBacks'],
      ['ExcessiveScroll', ['sessionsWithExcessiveScroll', 'excessiveScrollCount', 'count', 'subTotal'], 'excessiveScroll'],
    ];
    if (Array.isArray(byUrlRaw)) {
      for (const [metricName, aliases, key] of metricsToTrack) {
        const metric = findMetric(byUrlRaw, metricName);
        if (!metric || !Array.isArray(metric.information)) continue;
        for (const row of metric.information) {
          const url = pickField(row, ['Url', 'URL', 'PageUrl', 'page']);
          if (url == null) continue;
          if (!urlMap.has(url)) urlMap.set(url, { url, sessions: 0, deadClicks: 0, rageClicks: 0, quickBacks: 0, excessiveScroll: 0 });
          urlMap.get(url)[key] += num(pickField(row, aliases));
        }
      }
    }
    output.byUrl = Array.from(urlMap.values())
      .sort((a, b) => (b.rageClicks + b.deadClicks) - (a.rageClicks + a.deadClicks))
      .slice(0, 25);

    console.log(`[Clarity] resumen: ${output.summary.deadClicks} dead, ${output.summary.rageClicks} rage, ${output.byUrl.length} urls`);
  } catch (err) {
    console.error(`[Clarity] error: ${err.message}`);
    output.error = err.message;
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[Clarity] escrito ${OUT_PATH}`);

  if (output.error) process.exit(1);
}

main().catch((err) => {
  console.error('[Clarity] error fatal:', err);
  process.exit(1);
});
