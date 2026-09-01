/**
 * Configuracion del analizador interactivo (home.html).
 *
 * PSI_KEY: API key de Google PageSpeed Insights usada por el analizador on-demand.
 * Esta key es visible en el cliente (es una web estatica), por eso conviene:
 *   1) Restringirla en Google Cloud Console a la PageSpeed Insights API.
 *   2) Restringirla por HTTP referrer al dominio de GitHub Pages
 *      (https://csolanog15.github.io/*).
 *
 * Como actualizarla:
 *   - Reemplaza el valor de PSI_KEY abajo por tu key vigente.
 *   - La recoleccion automatica diaria (workflow) NO usa esta key: usa el
 *     secret PSI_API_KEY de GitHub Actions. Esta es solo para el analizador manual.
 *
 * NOTA: la key anterior habia expirado. Coloca una nueva aqui para reactivar
 * el analizador on-demand.
 */
window.PSI_KEY = 'REEMPLAZAR_CON_TU_PAGESPEED_API_KEY';
