# Dashboard Portal Ciencuadras 2.0

Performance + Usability Observatory para el portal Ciencuadras.
Los datos se actualizan **automaticamente todos los dias** via GitHub Actions.

## Modulos

| Modulo | Estado | Fuente de datos | Archivo generado |
|--------|--------|-----------------|------------------|
| Usability Signals | Automatico (diario) | Microsoft Clarity | `data/clarity.json` |
| Core Web Vitals (prod + preprod) | Automatico (diario) | PageSpeed API + CrUX | `data/psi.json` |
| Heatmap Intelligence | Automatico (diario) | Microsoft Clarity | `data/clarity.json` |
| Recomendaciones UX/Tecnicas | Automatico (diario) | PSI + Clarity + Nielsen | `data/recommendations.json` |
| Analizador on-demand | Manual (cualquier URL) | PageSpeed API | — |

## Como funciona la automatizacion

Un workflow (`.github/workflows/update-data.yml`) corre **cada dia a las 09:00 UTC (04:00 Bogota)** y:

1. `scripts/collect-psi.mjs` — mide Core Web Vitals de cada URL (prod y preprod, mobile y desktop) via PageSpeed Insights API -> `data/psi.json`.
2. `scripts/collect-clarity.mjs` — trae senales de usabilidad (dead/rage clicks, quick backs, scroll, errores) de produccion via Clarity Data Export API -> `data/clarity.json`.
3. `scripts/build-recommendations.mjs` — consolida ambos y genera recomendaciones priorizadas (P1-P4) mapeadas a heuristicas de Nielsen -> `data/recommendations.json`.
4. Hace commit de los JSON actualizados. Las paginas HTML los leen con `fetch()`.

Tambien se puede ejecutar manualmente desde la pestana **Actions -> Actualizar datos del observatorio -> Run workflow**.

## Configuracion requerida (una sola vez)

### 1. Secrets de GitHub Actions

En **Settings -> Secrets and variables -> Actions -> New repository secret**, crear:

| Secret | De donde sale |
|--------|---------------|
| `PSI_API_KEY` | Google Cloud Console -> habilitar *PageSpeed Insights API* -> crear API key |
| `CLARITY_API_TOKEN` | Proyecto de Clarity -> Settings -> Data Export -> Generate new API token |

### 2. Key del analizador on-demand (opcional)

El analizador manual de `home.html` usa una key aparte definida en `data/config.js`
(`window.PSI_KEY`). Es visible en el cliente, asi que **restringela** en Google Cloud:
por API (solo PageSpeed Insights) y por referrer HTTP (`https://csolanog15.github.io/*`).

## URLs monitoreadas

Se configuran en `config/urls.json`:

- **Produccion (fijas):** Home, `/arriendo`, `/venta` en `www.ciencuadras.com`
- **Pre-produccion:** Home, `/arriendo`, `/venta` en `pre.ciencuadras.com` (solo performance)
- **Detalle de inmueble (rotativa):** editar el campo `url` del target `detalle-arriendo-prod`
  cada dos semanas con la ficha de arriendo a monitorear. Si queda vacio, se omite.

### Como cambiar la URL rotativa

Editar `config/urls.json`, buscar el bloque `detalle-arriendo-prod` y poner la URL:

```json
{
  "id": "detalle-arriendo-prod",
  "url": "https://www.ciencuadras.com/inmueble/....",
  ...
}
```

El siguiente run diario (o un run manual) la tomara automaticamente.

## Limites de las APIs

- **Clarity Data Export:** maximo 10 requests/proyecto/dia, datos de ultimos 1-3 dias, respuesta max 1000 filas. Los scripts usan 2 llamadas por corrida (resumen + desglose por URL).
- **PageSpeed Insights:** cuota generosa con API key; los scripts reintentan ante 429/5xx.

## Usuarios objetivo

- Product Owner
- Lider Tecnico
- Lider UX
- Lider SEO

## Tecnologia

- HTML estatico + Tailwind CSS (CDN) + Chart.js
- Scripts de recoleccion en Node.js (sin dependencias externas, fetch nativo)
- GitHub Actions (cron diario) + GitHub Pages (hosting)

## URL

https://csolanog15.github.io/dashboard-portal-ciencuadras-2/
