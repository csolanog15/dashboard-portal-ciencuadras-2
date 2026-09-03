// Analizador on-demand de home.html — usa la key definida en data/config.js
var PSI_KEY = window.PSI_KEY || '';
var currentStrategy = 'mobile';
var KEY_PLACEHOLDER = 'REEMPLAZAR_CON_TU_PAGESPEED_API_KEY';

function keyIsMissing() { return !PSI_KEY || PSI_KEY === KEY_PLACEHOLDER; }

function showKeyWarning(msg) {
  var el = document.getElementById('keyWarning');
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

// Si no hay key configurada, avisar al cargar (no bloquear la pagina)
document.addEventListener('DOMContentLoaded', function () {
  if (keyIsMissing()) {
    showKeyWarning('El analizador on-demand necesita una API key de PageSpeed vigente. Configurala en data/config.js (PSI_KEY). El observatorio automatico (CWV, Usability, etc.) no depende de esta key.');
  }
});

function getColor(s){return s>=90?'bg-green-500':s>=50?'bg-[#ffaa00]':'bg-red-500';}
function getTC(v,g,n){return v<=g?'text-green-600':v<=n?'text-[#ffaa00]':'text-red-600';}
function renderField(c,label,val,unit,good,poor){
  var pct=Math.min(val/poor*100,100);
  var color=val<=good?'#22c55e':val<=poor?'#ffaa00':'#ef4444';
  c.innerHTML+='<div><p class="text-xs font-medium mb-1">'+label+'</p><p class="text-lg font-bold" style="color:'+color+'">'+val+unit+'</p><div class="metric-bar mt-1"><div class="fill" style="width:'+pct+'%;background:'+color+'"></div></div></div>';
}
async function analyzeUrl(){
  var url=document.getElementById('urlInput').value.trim();
  if(!url){alert('Ingresa una URL');return;}
  if(keyIsMissing()){
    showKeyWarning('No se puede analizar: falta configurar una API key de PageSpeed vigente en data/config.js (PSI_KEY).');
    return;
  }
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('analyzeBtn').disabled=true;
  document.getElementById('analyzeBtn').textContent='Analizando...';
  try{
    var apiUrl='https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url='+encodeURIComponent(url)+'&strategy='+currentStrategy+'&category=performance&category=accessibility&category=best-practices&category=seo&key='+PSI_KEY;
    var res=await fetch(apiUrl);
    var data=await res.json();
    if(data.error){
      var msg=data.error.message||'Error desconocido';
      if(/API key/i.test(msg)){
        showKeyWarning('La API key de PageSpeed no es valida o expiro. Actualizala en data/config.js (PSI_KEY). Detalle: '+msg);
      }else{
        alert('Error: '+msg);
      }
      return;
    }
    var lh=data.lighthouseResult;
    var perfScore=Math.round(lh.categories.performance.score*100);
    var a11yScore=Math.round(lh.categories.accessibility.score*100);
    var bpScore=Math.round(lh.categories['best-practices'].score*100);
    var seoScore=Math.round(lh.categories.seo.score*100);
    document.getElementById('scoreCircle').textContent=perfScore;
    document.getElementById('scoreCircle').className='score-circle mx-auto mb-1 '+getColor(perfScore);
    document.getElementById('scoreA11y').textContent=a11yScore;
    document.getElementById('scoreA11y').className='score-circle mx-auto mb-1 '+getColor(a11yScore);
    document.getElementById('scoreA11y').style.cssText='width:70px;height:70px;font-size:1.3rem';
    document.getElementById('scoreBP').textContent=bpScore;
    document.getElementById('scoreBP').className='score-circle mx-auto mb-1 '+getColor(bpScore);
    document.getElementById('scoreBP').style.cssText='width:70px;height:70px;font-size:1.3rem';
    document.getElementById('scoreSEO').textContent=seoScore;
    document.getElementById('scoreSEO').className='score-circle mx-auto mb-1 '+getColor(seoScore);
    document.getElementById('scoreSEO').style.cssText='width:70px;height:70px;font-size:1.3rem';
    var m=lh.audits.metrics.details.items[0];
    document.getElementById('metricFCP').textContent=(m.firstContentfulPaint/1000).toFixed(1)+' s';
    document.getElementById('metricFCP').className='text-lg font-bold '+getTC(m.firstContentfulPaint,1800,3000);
    document.getElementById('metricLCP').textContent=(m.largestContentfulPaint/1000).toFixed(1)+' s';
    document.getElementById('metricLCP').className='text-lg font-bold '+getTC(m.largestContentfulPaint,2500,4000);
    document.getElementById('metricTBT').textContent=m.totalBlockingTime+' ms';
    document.getElementById('metricTBT').className='text-lg font-bold '+getTC(m.totalBlockingTime,200,600);
    document.getElementById('metricCLS').textContent=m.cumulativeLayoutShift.toFixed(3);
    document.getElementById('metricCLS').className='text-lg font-bold '+getTC(m.cumulativeLayoutShift*1000,100,250);
    document.getElementById('metricSI').textContent=(m.speedIndex/1000).toFixed(1)+' s';
    document.getElementById('metricSI').className='text-lg font-bold '+getTC(m.speedIndex,3400,5800);
    var field=data.loadingExperience;
    var fs2=document.getElementById('fieldData');
    var fm=document.getElementById('fieldMetrics');
    fm.innerHTML='';
    if(field&&field.metrics&&Object.keys(field.metrics).length>0){
      fs2.classList.remove('hidden');
      var st=field.overall_category;
      document.getElementById('fieldStatus').innerHTML='Metricas web esenciales: <span class="font-bold '+(st==='FAST'?'text-green-600':st==='AVERAGE'?'text-[#ffaa00]':'text-red-600')+'">'+(st==='FAST'?'aprobada':st==='AVERAGE'?'necesita mejoras':'desaprobada')+'</span>';
      if(field.metrics.LARGEST_CONTENTFUL_PAINT_MS)renderField(fm,'LCP',(field.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile/1000).toFixed(1),' s',2.5,4.0);
      if(field.metrics.INTERACTION_TO_NEXT_PAINT)renderField(fm,'INP',field.metrics.INTERACTION_TO_NEXT_PAINT.percentile,' ms',200,500);
      if(field.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE)renderField(fm,'CLS',(field.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile/100).toFixed(2),'',0.1,0.25);
      if(field.metrics.FIRST_CONTENTFUL_PAINT_MS)renderField(fm,'FCP',(field.metrics.FIRST_CONTENTFUL_PAINT_MS.percentile/1000).toFixed(1),' s',1.8,3.0);
    }else{fs2.classList.add('hidden');}
    var ux=[];
    var am={'image-alt':{h:'H1 - Visibilidad del estado',f:'Imagenes sin texto alternativo: usuarios con lectores de pantalla no identifican el contenido'},'color-contrast':{h:'H8 - Diseno minimalista',f:'Contraste insuficiente: dificulta lectura para usuarios con vision reducida'},'tap-targets':{h:'H7 - Flexibilidad y eficiencia',f:'Elementos tactiles muy pequenos o cercanos: errores de toque en mobile'},'button-name':{h:'H4 - Consistencia',f:'Botones sin nombre accesible: usuario no sabe que hace el boton'},'link-name':{h:'H6 - Reconocer antes que recordar',f:'Enlaces sin texto descriptivo: usuario no anticipa destino'},'document-title':{h:'H1 - Visibilidad del estado',f:'Pagina sin titulo: usuario no sabe donde esta'},'heading-order':{h:'H4 - Consistencia',f:'Jerarquia de encabezados incorrecta: confunde estructura'},'errors-in-console':{h:'H9 - Ayuda a reconocer errores',f:'Errores JavaScript en consola: funcionalidades pueden estar rotas'}};
    Object.keys(am).forEach(function(id){var a=lh.audits[id];if(a&&a.score!==null&&a.score<1){ux.push({h:am[id].h,f:am[id].f,s:a.score===0?'high':'medium'});}});
    if(perfScore<50)ux.push({h:'Ley de Doherty',f:'Rendimiento critico (score '+perfScore+'): pagina tarda demasiado en ser interactiva',s:'high'});
    if(m.largestContentfulPaint>4000)ux.push({h:'H1 - Visibilidad del estado',f:'LCP de '+(m.largestContentfulPaint/1000).toFixed(1)+'s: contenido principal tarda en aparecer',s:'high'});
    if(m.cumulativeLayoutShift>0.25)ux.push({h:'H5 - Prevencion de errores',f:'CLS de '+m.cumulativeLayoutShift.toFixed(2)+': elementos se mueven causando clicks accidentales',s:'high'});
    if(m.totalBlockingTime>600)ux.push({h:'H7 - Flexibilidad y eficiencia',f:'TBT de '+m.totalBlockingTime+'ms: pagina no responde durante mas de medio segundo',s:'medium'});
    var uxC=document.getElementById('uxFindings');
    if(ux.length>0){
      document.getElementById('uxSection').classList.remove('hidden');
      uxC.innerHTML='';
      ux.forEach(function(u){
        var sc=u.s==='high'?'bg-red-100 text-red-700':'bg-[#ffaa00]/20 text-[#00273d]';
        var sl=u.s==='high'?'Critico':'Mejora';
        uxC.innerHTML+='<div class="p-4 bg-[#f0f3f4] rounded-lg"><div class="flex items-center justify-between mb-2"><span class="text-sm font-semibold text-[#00273d]">'+u.h+'</span><span class="px-2 py-0.5 rounded-full text-xs font-medium '+sc+'">'+sl+'</span></div><p class="text-sm text-[#333]">'+u.f+'</p></div>';
      });
    }
    document.getElementById('results').classList.remove('hidden');
  }catch(e){alert('Error: '+e.message);}
  finally{document.getElementById('loading').classList.add('hidden');document.getElementById('analyzeBtn').disabled=false;document.getElementById('analyzeBtn').textContent='Analizar';}
}
document.getElementById('urlInput').addEventListener('keypress',function(e){if(e.key==='Enter')analyzeUrl();});
