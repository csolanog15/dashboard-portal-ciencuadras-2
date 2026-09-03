#!/usr/bin/env node
/**
 * collect-psi.mjs
 * Recolecta Core Web Vitals + scores de Lighthouse desde la PageSpeed Insights API
 * para cada URL definida en config/urls.json (prod y preprod), en mobile y desktop.
 *
 * Salida: data/psi.json
 *
 * Requiere: variable de entorno PSI_API_KEY (Google Cloud PageSpeed Insights API key)
 * Node 18+ (usa fetch nativo).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'config', 'urls.json');
const OUT_PATH = join(ROOT, 'data', 'psi.json');

const PSI_API_KEY = process.env.PSI_API_KEY;
const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const STRATEGIES = ['mobile', 'desktop'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 4000;

if (!PSI_API_KEY) {
  console.error('ERROR: falta la variable de entorno PSI_API_KEY');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(pageUrl, strategy) {
  const params = new URLSearchParams();
  params.set('url', pageUrl);
  params.set('strategy', strategy);
  params.set('key', PSI_API_KEY);
  for (const c of CATEGORIES) params.append('category', c);
  return `${PSI_ENDPOINT}?${params.toString()}`;
}

async function fetchPsi(pageUrl, strategy) {
  const url = buildUrl(pageUrl, strategy);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) {
        const body = await res.text();
        // 429/500 son transitorios: reintentar. 4xx de la pagina: no reintentar.
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      throw err;
    }
  }
}

function round(n) {
  return n == null ? null : Math.round(n);
}

function parseResult(data, strategy) {
  const lh = data.lighthouseResult;
  const cats = lh.categories;
  const m = lh.audits.metrics?.details?.items?.[0] ?? {};

  // Field data (CrUX) - datos reales de usuarios, ultimos 28 dias
  const field = data.loadingExperience;
  let fieldData = null;
  if (field && field.metrics && Object.keys(field.metrics).length > 0) {
    const fm = field.metrics;
    fieldData = {
      overall: field.overall_category ?? null,
      lcp: fm.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      inp: fm.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      cls: fm.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null,
      fcp: fm.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    };
  }

  // Oportunidades de ahorro (bytes) para recomendaciones
  const opportunities = [];
  for (const [id, audit] of Object.entries(lh.audits)) {
    const bytes = audit?.details?.overallSavingsBytes;
    if (bytes && bytes > 20000) {
      opportunities.push({ id, title: audit.title, savingsBytes: bytes });
    }
  }
  opportunities.sort((a, b) => b.savingsBytes - a.savingsBytes);

  // Audits relevantes para el mapeo heuristico (usabilidad/accesibilidad)
  const relevantAudits = {};
  const auditIds = ['image-alt', 'color-contrast', 'tap-targets', 'button-name',
    'link-name', 'meta-viewport', 'document-title', 'heading-order',
    'errors-in-console', 'is-crawlable'];
  for (const id of auditIds) {
    const a = lh.audits[id];
    if (a && a.score !== null && a.score !== undefined) {
      relevantAudits[id] = { score: a.score, title: a.title };
    }
  }

  return {
    strategy,
    score: {
      performance: round((cats.performance?.score ?? 0) * 100),
      accessibility: round((cats.accessibility?.score ?? 0) * 100),
      bestPractices: round((cats['best-practices']?.score ?? 0) * 100),
      seo: round((cats.seo?.score ?? 0) * 100),
    },
    lab: {
      fcp: m.firstContentfulPaint ?? null,
      lcp: m.largestContentfulPaint ?? null,
      tbt: m.totalBlockingTime ?? null,
      cls: m.cumulativeLayoutShift ?? null,
      si: m.speedIndex ?? null,
    },
    field: fieldData,
    opportunities: opportunities.slice(0, 6),
    audits: relevantAudits,
  };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const targets = config.targets.filter((t) => t.psi && t.url && t.url.trim() !== '');

  const results = [];
  for (const target of targets) {
    const entry = {
      id: target.id,
      label: target.label,
      url: target.url,
      env: target.env,
      type: target.type,
      strategies: {},
      error: null,
    };
    for (const strategy of STRATEGIES) {
      try {
        console.log(`[PSI] ${target.id} (${strategy}) -> ${target.url}`);
        const data = await fetchPsi(target.url, strategy);
        entry.strategies[strategy] = parseResult(data, strategy);
        // pausa suave entre llamadas para no golpear rate limits
        await sleep(1500);
      } catch (err) {
        console.error(`[PSI] fallo ${target.id} (${strategy}): ${err.message}`);
        entry.error = (entry.error ? entry.error + ' | ' : '') + `${strategy}: ${err.message}`;
      }
    }
    results.push(entry);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'PageSpeed Insights API (Lighthouse + CrUX)',
    targets: results,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[PSI] escrito ${OUT_PATH} con ${results.length} targets`);

  const failed = results.filter((r) => r.error && Object.keys(r.strategies).length === 0);
  if (failed.length === results.length && results.length > 0) {
    console.error('[PSI] TODAS las URLs fallaron');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[PSI] error fatal:', err);
  process.exit(1);
});
