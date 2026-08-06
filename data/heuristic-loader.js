async function loadLastAnalysis(){
  try{
    const res=await fetch('data/last-analysis.json?t='+Date.now());
    const data=await res.json();
    if(data.status==='empty'||!data.heuristics||data.heuristics.length===0)return;
    document.getElementById('heuristicSection').classList.remove('hidden');
    document.getElementById('heuristicUrl').textContent='URL analizada: '+data.url;
    document.getElementById('heuristicDate').textContent='Analisis: '+new Date(data.timestamp).toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'});
    var ct=document.getElementById('heuristicResults');
    ct.innerHTML='';
    data.heuristics.forEach(function(h){
      var sc=h.severity==='high'?'bg-red-100 text-red-700':h.severity==='medium'?'bg-[#ffaa00]/20 text-[#00273d]':'bg-green-100 text-green-700';
      var sl=h.severity==='high'?'Critico':h.severity==='medium'?'Mejora':'OK';
      var rec=h.recommendation?'<p class="text-xs text-[#3e98cc] mt-2">Recomendacion: '+h.recommendation+'</p>':'';
      ct.innerHTML+='<div class="p-4 bg-[#f0f3f4] rounded-lg"><div class="flex items-center justify-between mb-2"><span class="text-sm font-semibold text-[#00273d]">'+h.heuristic+'</span><span class="px-2 py-0.5 rounded-full text-xs font-medium '+sc+'">'+sl+'</span></div><p class="text-sm text-[#333]">'+h.finding+'</p>'+rec+'</div>';
    });
  }catch(e){}
}
loadLastAnalysis();