const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;
let rendererModule, rendererAttempt=0;
function loadRenderer() {
  if(!rendererModule) {
    const url=new URL('./splat-renderer.js?v=progressive-orbit-1',import.meta.url);
    if(rendererAttempt) url.searchParams.set('retry',String(rendererAttempt));
    rendererAttempt++;
    rendererModule=import(url.href).catch(error=>{
      rendererModule=undefined;
      throw error;
    });
  }
  return rendererModule;
}
const cachedScenes=new Map();
const compactModels=new Set([
  '102344250-roam','106365897_174225972-roam',
  '00848-ziup5kvtCCR-activegs','00813-svBbv1Pavdk-roam',
  '00860-RJaJt8UjXav-roam','00879-7Ukhou1GxYi-roam'
]);
function fetchPair(urls,signal,priority) {
  return Promise.all(urls.map(async url=>{
    const response=await fetch(url,{signal,priority});
    if(!response.ok) throw Error('Model unavailable');
    return response.blob();
  }));
}
const nearScene=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries) {
    if(!isIntersecting && target.dataset.exploring) closeActive?.();
  }
});

for (const figure of document.querySelectorAll('.film')) {
  const viewport=figure.querySelector('.viewport');
  if(!viewport || figure.dataset.explorer==='video-only') continue;
  const video=viewport.querySelector('video'), surface=viewport.querySelector('.film-surface');
  if(!video || !surface) continue;
  let mode=viewport.querySelector('.scene-mode');
  if(mode?.hasAttribute('data-explorer-bound')) continue;
  if(!mode) {
    mode=document.createElement('button');
    mode.type='button';
    mode.className='scene-mode';
    mode.textContent='Explore 3D';
    mode.setAttribute('aria-pressed','false');
    viewport.append(mode);
  }
  let status=viewport.querySelector('.scene-status');
  if(!status) {
    status=document.createElement('span');
    status.className='scene-status';
    status.setAttribute('role','status');
    viewport.append(status);
  }

  let canvas,renderer,pointer,suppressClick,expiry,download,warmTimer,detailJob;
  let ready=false,detailedFirst=false,yaw=.93,pitch=.64,zoom=1;
  const resize=new ResizeObserver(()=>redraw());
  function redraw(moving=!!pointer?.drag) {
    if(ready && figure.dataset.exploring) renderer.draw(yaw,pitch,zoom,moving);
  }
  function turn(dx,dy) {
    yaw-=dx*.012;
    pitch=clamp(pitch+dy*.009,-1.4,1.48);
    redraw(true);
  }
  function expireLater() {
    clearTimeout(expiry);
    expiry=setTimeout(()=>{if(!figure.dataset.exploring) release();},60000);
  }
  function leave(keepPreparing=false) {
    if(!figure.dataset.exploring) return;
    resize.disconnect();
    renderer?.hide();
    if(canvas) canvas.style.visibility='hidden';
    delete figure.dataset.exploring;
    delete figure.dataset.orbitReady;
    mode.textContent='Explore 3D';
    mode.setAttribute('aria-pressed','false');
    status.textContent='';
    closeActive=null;
    surface.hidden=video.controls;
    surface.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+figure.dataset.scene+' comparison');
    syncPlayback();
    if(!keepPreparing) stopDetailDownload();
    if(!ready && !keepPreparing) release();
    else expireLater();
  }
  function release() {
    clearTimeout(expiry); clearTimeout(warmTimer);
    download?.abort();
    download=null;
    detailJob?.controller.abort(); detailJob=null;
    canvas?.removeEventListener('webglcontextlost',failed);
    renderer?.dispose(); canvas?.remove();
    canvas=null; renderer=null; ready=false; detailedFirst=false;
    cachedScenes.delete(figure);
  }
  function failed(error) {
    error.preventDefault?.();
    if(figure.dataset.exploring) {
      leave();
      mode.textContent='Retry 3D';
      status.textContent='3D unavailable';
    }
    release();
  }
  function showScene() {
    if(!figure.dataset.exploring) return;
    figure.dataset.orbitReady='';
    syncPlayback();
    redraw();
    canvas.style.visibility='visible';
    status.textContent=figure.dataset.exploring==='drag' ? 'Release drag to play' : 'Drag to orbit';
    refine();
  }
  const models=['activegs','roam'].map(method=>figure.dataset.scene+'-'+method);
  const modelURL=(directory,model)=>new URL('../models/'+directory+'/'+model+'.ply',import.meta.url);
  const starters=models.map(model=>modelURL('starter',model));
  const details=models.map(model=>modelURL(compactModels.has(model)?'compact':'dense',model));
  function stopDetailDownload() {
    if(detailJob?.fetching) {detailJob.controller.abort(); detailJob=null;}
  }
  async function refine() {
    if(detailedFirst || detailJob || !ready || !figure.dataset.exploring) return;
    const job={controller:new AbortController(),fetching:true};
    detailJob=job;
    function failedDetail() {
      if(detailJob!==job) return;
      detailJob=null;
      if(figure.dataset.exploring==='button') status.textContent='Drag to orbit · Detail unavailable';
    }
    try {
      const blobs=await fetchPair(details,job.controller.signal,'low');
      if(detailJob!==job) return;
      job.fetching=false;
      renderer.refine(blobs,failedDetail);
    } catch {job.controller.abort(); failedDetail();}
  }
  async function prepare() {
    if(canvas) return;
    // Reserve GPU memory for the active comparison. Reuse a second completed pair on desktop.
    const cap=matchMedia('(pointer:coarse)').matches?1:2;
    for(const [card,cache] of cachedScenes) {
      if(card.dataset.exploring) continue;
      if(!cache.ready() || cachedScenes.size>=cap) cache.release();
    }
    cachedScenes.set(figure,{release,stopDetailDownload,ready:()=>ready});
    canvas=document.createElement('canvas');
    canvas.className='orbit-view'; canvas.style.visibility='hidden';
    canvas.setAttribute('aria-hidden','true');
    viewport.insertBefore(canvas,surface);
    canvas.addEventListener('webglcontextlost',failed);
    const node=canvas;
    download=new AbortController();
    const {signal}=download;
    try {
      const pair=fetchPair(starters,signal,figure.dataset.exploring?'high':'low').catch(error=>{
        if(signal.aborted || canvas!==node || !figure.dataset.exploring) throw error;
        download.abort();
        download=new AbortController();
        detailedFirst=true;
        return fetchPair(details,download.signal,'high');
      });
      const [{createRenderer},blobs]=await Promise.all([loadRenderer(),pair]);
      if(canvas!==node) return;
      download=null;
      renderer=createRenderer(canvas,blobs,figure.hasAttribute('data-center-each'),()=>{
        if(canvas!==node) return;
        ready=true;
        if(figure.dataset.exploring) showScene();
        else expireLater();
      },error=>{if(canvas===node) failed(error);},detailedFirst);
    } catch(error) {if(canvas===node) failed(error);}
  }
  function explore(entry) {
    closeActive?.();
    for(const [card,cache] of cachedScenes) if(card!==figure) cache.stopDetailDownload();
    closeActive=leave;
    clearTimeout(expiry);
    yaw=.93; pitch=.64; zoom=1;
    figure.dataset.exploring=entry;
    surface.hidden=false;
    syncPlayback();
    mode.textContent='Back to video';
    mode.setAttribute('aria-pressed','true');
    surface.setAttribute('aria-label',entry==='drag'
      ? 'Drag to orbit. Release to resume the video.'
      : 'Drag or use the arrow keys to orbit. Scroll or use + and − to zoom. Escape to return to video.');
    resize.observe(viewport);
    if(ready) showScene();
    else {
      status.textContent='Loading 3D…';
      prepare();
    }
  }
  nearScene.observe(figure);
  function warm(delay) {
    clearTimeout(warmTimer);
    const connection=navigator.connection;
    if(connection?.saveData || ['slow-2g','2g','3g'].includes(connection?.effectiveType)) return;
    warmTimer=setTimeout(()=>{if(!closeActive && !document.hidden) prepare();},delay);
  }
  for(const [element,delay] of [[mode,180],[surface,420]]) {
    element.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse') warm(delay);});
    element.addEventListener('pointerleave',()=>clearTimeout(warmTimer));
  }
  mode.addEventListener('focus',()=>{if(mode.matches(':focus-visible')) warm(180);});
  mode.addEventListener('blur',()=>clearTimeout(warmTimer));
  mode.addEventListener('click',()=>{
    if (figure.dataset.exploring) leave();
    else { explore('button'); surface.focus({preventScroll:true}); }
  });
  surface.addEventListener('pointerdown',e=>{
    if (!e.isPrimary || e.button!==0) return;
    suppressClick=false;
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,drag:false};
    surface.setPointerCapture(e.pointerId);
  });
  surface.addEventListener('pointermove',e=>{
    if (pointer?.id!==e.pointerId) return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if (!pointer.drag) {
      if (Math.hypot(dx,dy)<6) return;
      // Let a vertical swipe scroll the page without starting a model download.
      if(e.pointerType==='touch' && !figure.dataset.exploring && Math.abs(dy)>=Math.abs(dx)) {
        pointer=null;
        return;
      }
    }
    pointer.drag=true;
    suppressClick=true;
    if (!figure.dataset.exploring) explore('drag');
    turn(dx,dy);
    pointer.x=e.clientX; pointer.y=e.clientY;
  });
  function finishDrag(event) {
    if (event.pointerId !== pointer?.id) return;
    const dragged = pointer.drag;
    pointer = null;
    if (dragged && figure.dataset.exploring === 'drag') {
      // A quick first drag may end before the pair arrives. Keep it for a repeat.
      leave(true);
    } else if(dragged) redraw();
  }
  surface.addEventListener('pointerup', finishDrag);
  surface.addEventListener('pointercancel', finishDrag);
  surface.addEventListener('lostpointercapture', finishDrag);
  surface.addEventListener('click',e=>{
    if (figure.dataset.exploring || (suppressClick && e.detail !== 0)) e.stopImmediatePropagation();
    suppressClick=false;
  },true);
  surface.addEventListener('wheel',e=>{
    if (!figure.dataset.exploring || e.ctrlKey) return;
    e.preventDefault();
    zoom=clamp(zoom*Math.exp(-e.deltaY*.002),.65,2.8);
    redraw(true);
  },{passive:false});
  viewport.addEventListener('keydown',e=>{
    if (!figure.dataset.exploring) return;
    if (e.key==='Escape') { leave(); mode.focus(); return; }
    if (e.target!==surface) return;
    const delta={ArrowLeft:[-7,0],ArrowRight:[7,0],ArrowUp:[0,6],ArrowDown:[0,-6]}[e.key];
    if (delta) turn(...delta);
    else if (['+','=','-'].includes(e.key)) { zoom=clamp(zoom*(e.key==='-'?.9:1.1),.65,2.8); redraw(true); }
    else return;
    e.preventDefault();
  });
  mode.dataset.explorerBound='';
}
