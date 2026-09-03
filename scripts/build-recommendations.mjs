#!/usr/bin/env node
/**
 * build-recommendations.mjs
 * Consolida data/psi.json + data/clarity.json y genera recomendaciones priorizadas
 * (P1-P4) mapeadas a heuristicas de Nielsen / Leyes de UX, de forma deterministica
 * a partir de las metricas reales recolectadas.
 *
 * Salida: data/recommendations.json
 *
 * No requiere red ni secrets: solo lee los JSON ya generados.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PSI_PATH = join(ROOT, 'data', 'psi.json');
const CLARITY_PATH = join(ROOT, 'data', 'clarity.json');
const OUT_PATH = join(ROOT, 'data', 'recommendations.json');

// Umbrales (Core Web Vitals oficiales de Google)
const TH = {
  lcp: { good: 2500, poor: 4000 },   // ms
  tbt: { good: 200, poor: 600 },     // ms
  cls: { good: 0.1, poor: 0.25 },    // score
  fcp: { good: 1800, poor: 3000 },   // ms
  perf: { good: 90, poor: 50 },      // score
};

// Mapeo de audits Lighthouse -> heuristica Nielsen + hallazgo legible
const AUDIT_MAP = {
  'image-alt': { h: 'H1 - Visibilidad del estado', f: 'Imagenes sin texto alternativo: lectores de pantalla no identifican el contenido', rec: 'Agregar atributo alt descriptivo a todas las imagenes' },
  'color-contrast': { h: 'H8 - Diseno minimalista', f: 'Contraste insuficiente: dificulta lectura con vision reducida', rec: 'Ajustar colores a ratio minimo 4.5:1 (AA)' },
  'tap-targets': { h: 'H7 - Flexibilidad y eficiencia', f: 'Elementos tactiles muy pequenos o cercanos: errores de toque en mobile', rec: 'Areas tactiles minimo 48x48px con separacion adecuada' },
  'button-name': { h: 'H4 - Consistencia y estandares', f: 'Botones sin nombre accesible: el usuario no sabe que hacen', rec: 'Agregar aria-label o texto visible a los botones' },
  'link-name': { h: 'H6 - Reconocer antes que recordar', f: 'Enlaces sin texto descriptivo: no se anticipa el destino', rec: 'Usar texto de enlace descriptivo en vez de "click aqui"' },
  'meta-viewport': { h: 'H7 - Flexibilidad y eficiencia', f: 'Viewport no configurado para mobile: la pagina no se adapta', rec: 'Definir meta viewport width=device-width' },
  'document-title': { h: 'H1 - Visibilidad del estado', f: 'Pagina sin titulo: el usuario no sabe donde esta', rec: 'Definir un <title> unico y descriptivo por pagina' },
  'heading-order': { h: 'H4 - Consistencia y estandares', f: 'Jerarquia de encabezados incorrecta: confunde la estructura', rec: 'Ordenar encabezados h1..h6 sin saltos de nivel' },
  'errors-in-console': { h: 'H9 - Ayuda a reconocer errores', f: 'Errores JavaScript en consola: funcionalidades pueden estar rotas', rec: 'Revisar y corregir los errores de consola' },
  'is-crawlable': { h: 'H1 - Visibilidad del estado', f: 'Pagina bloquea indexacion: no sera encontrada en buscadores', rec: 'Permitir indexacion (robots/meta) de paginas publicas' },
};

async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function bytesToKiB(b) {
  return Math.round(b / 1024);
}

async function run() {
  const psi = await readJsonSafe(PSI_PATH);
  const clarity = await readJsonSafe(CLARITY_PATH);

  const recs = [];
  let idCounter = 1;
  const add = (priority, type, title, finding, tags, impact, effort, rec) => {
    recs.push({
      id: `R${idCounter++}`,
      priority,
      type,
      title,
      finding,
      tags: tags || [],
      impact: impact || null,
      effort: effort || null,
      recommendation: rec || null,
    });
  };

  // ---- Recomendaciones desde PSI (solo prod para UX; preprod es para tracking) ----
  const prodTargets = (psi?.targets || []).filter((t) => t.env === 'prod');
  for (const t of prodTargets) {
    const mobile = t.strategies?.mobile;
    if (!mobile) continue;
    const lab = mobile.lab || {};
    const perf = mobile.score?.performance ?? null;

    if (perf !== null && perf < TH.perf.poor) {
      add(1, 'tech', `Rendimiento critico en ${t.label} mobile (score ${perf})`,
        `El performance score mobile es ${perf}, por debajo del umbral critico (50). La pagina tarda demasiado en ser interactiva.`,
        ['Ley de Doherty', `Score: ${perf}`], 'alto', 'alto',
        'Priorizar optimizacion de recursos criticos (JS/CSS/imagenes) above-the-fold');
    }
    if (lab.lcp != null && lab.lcp > TH.lcp.poor) {
      add(1, 'tech', `Reducir LCP en ${t.label} mobile: ${(lab.lcp / 1000).toFixed(1)}s a <2.5s`,
        `LCP mobile de ${(lab.lcp / 1000).toFixed(1)}s (umbral bueno: 2.5s). El contenido principal tarda demasiado en aparecer.`,
        ['LCP target: <2.5s', 'H1: Visibilidad estado'], 'alto', 'medio',
        'Imagenes responsivas (srcset WebP/AVIF), preload del LCP, critical CSS inline, eliminar recursos sin usar');
    } else if (lab.lcp != null && lab.lcp > TH.lcp.good) {
      add(3, 'tech', `Mejorar LCP en ${t.label} mobile: ${(lab.lcp / 1000).toFixed(1)}s`,
        `LCP mobile de ${(lab.lcp / 1000).toFixed(1)}s esta en zona de mejora (2.5s-4s).`,
        ['LCP target: <2.5s'], 'medio', 'medio',
        'Optimizar imagen hero y priorizar carga above-the-fold');
    }
    if (lab.tbt != null && lab.tbt > TH.tbt.poor) {
      add(1, 'tech', `Reducir TBT en ${t.label} mobile: ${lab.tbt}ms a <200ms`,
        `TBT mobile de ${lab.tbt}ms bloquea el hilo principal. Los usuarios no pueden interactuar durante ese tiempo.`,
        ['TBT target: <200ms', 'H7: Eficiencia de uso'], 'alto', 'alto',
        'Code splitting, defer de scripts de terceros, reducir JS sin usar, tree shaking');
    }
    if (lab.cls != null && lab.cls > TH.cls.good) {
      const sev = lab.cls > TH.cls.poor ? 1 : 2;
      add(sev, 'tech', `Corregir CLS en ${t.label} mobile: ${lab.cls.toFixed(3)}`,
        `CLS de ${lab.cls.toFixed(3)} (umbral bueno: 0.1). Elementos se desplazan al cargar y pueden causar clicks accidentales.`,
        ['CLS target: <0.1', 'H5: Prevencion de errores'], sev === 1 ? 'alto' : 'medio', 'bajo',
        'Reservar espacio con aspect-ratio y dimensiones explicitas en imagenes/embeds');
    }

    for (const op of mobile.opportunities || []) {
      if (op.savingsBytes > 100000) {
        add(3, 'tech', `${op.title} en ${t.label}`,
          `Ahorro potencial de ~${bytesToKiB(op.savingsBytes)} KiB detectado por Lighthouse.`,
          [`Ahorro: ~${bytesToKiB(op.savingsBytes)} KiB`], 'medio', 'medio', null);
      }
    }

    for (const [auditId, info] of Object.entries(mobile.audits || {})) {
      if (info.score !== null && info.score < 1) {
        const map = AUDIT_MAP[auditId];
        if (!map) continue;
        const priority = info.score === 0 ? 2 : 4;
        const type = ['color-contrast', 'image-alt', 'button-name', 'link-name', 'tap-targets'].includes(auditId) ? 'a11y' : 'ux';
        add(priority, type, `${map.h} en ${t.label}`, map.f, [map.h, t.label],
          info.score === 0 ? 'medio' : 'bajo', 'bajo', map.rec);
      }
    }
  }

  // ---- Recomendaciones desde Clarity (senales de usabilidad reales) ----
  const cs = clarity?.summary;
  if (cs) {
    if (cs.rageClicks > 0) {
      add(1, 'ux', 'Investigar rage clicks detectados',
        `Se detectaron ${cs.rageClicks} sesiones con rage clicks (clicks repetidos por frustracion). Indica elementos que no responden como el usuario espera.`,
        ['Nielsen H1', 'Nielsen H4', 'Ley de Doherty'], 'alto', 'medio',
        'Revisar sesiones en Clarity, identificar el elemento (ej. carrusel) y dar feedback inmediato/estado de carga');
    }
    if (cs.deadClicks > 0) {
      add(2, 'ux', 'Corregir dead clicks (clicks sin respuesta)',
        `${cs.deadClicks} sesiones con dead clicks: el usuario hace click en algo que parece interactivo pero no responde.`,
        ['H1: Visibilidad del estado', 'Ley de Jakob'], 'medio', 'medio',
        'Anadir affordances claras: cursor pointer solo en interactivos, loading states, feedback visual');
    }
    if (cs.quickBacks > 0) {
      add(2, 'ux', 'Reducir quick backs (retrocesos rapidos)',
        `${cs.quickBacks} sesiones con quick backs: los usuarios entran a una pagina y regresan de inmediato, senal de que no encontraron lo esperado.`,
        ['H2: Correspondencia sistema-mundo real'], 'medio', 'medio',
        'Alinear expectativa del enlace con el contenido de destino; revisar titulos y previews');
    }
    if (cs.excessiveScroll > 0) {
      add(3, 'ux', 'Revisar excessive scroll',
        `${cs.excessiveScroll} sesiones con scroll excesivo: los usuarios buscan contenido que no encuentran facilmente.`,
        ['H6: Reconocer antes que recordar'], 'medio', 'bajo',
        'Mejorar jerarquia visual y acercar el contenido clave arriba del fold');
    }
    if (cs.scriptErrors > 0) {
      add(2, 'tech', 'Corregir errores de script en produccion',
        `${cs.scriptErrors} sesiones con errores de JavaScript. Pueden romper funcionalidades sin que el usuario lo reporte.`,
        ['H9: Ayuda a reconocer errores'], 'alto', 'medio',
        'Monitorear y corregir errores JS; agregar manejo de errores y observabilidad');
    }
  }

  const impactRank = { alto: 0, medio: 1, bajo: 2, null: 3 };
  recs.sort((a, b) => a.priority - b.priority || (impactRank[a.impact] ?? 3) - (impactRank[b.impact] ?? 3));

  const counts = { p1: 0, p2: 0, p3: 0, p4: 0 };
  for (const r of recs) counts[`p${r.priority}`]++;

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'Consolidado: PageSpeed + Clarity + Nielsen',
    basedOn: {
      psiGeneratedAt: psi?.generatedAt || null,
      clarityGeneratedAt: clarity?.generatedAt || null,
    },
    counts,
    recommendations: recs,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[recs] escrito ${OUT_PATH}: ${recs.length} recomendaciones (P1:${counts.p1} P2:${counts.p2} P3:${counts.p3} P4:${counts.p4})`);
}

run().catch((err) => {
  console.error('[recs] error fatal:', err);
  process.exit(1);
});
