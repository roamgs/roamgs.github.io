const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;
let rendererModule, rendererAttempt=0;
function loadRenderer() {
  if(!rendererModule) {
    const url=new URL('./splat-renderer.js?v=compact-orbit-1',import.meta.url);
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

  let canvas,renderer,pointer,suppressClick,expiry,download,warmTimer;
  let ready=false, yaw=.93, pitch=.64, zoom=1;
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
    if(!ready && !keepPreparing) release();
    else expireLater();
  }
  function release() {
    clearTimeout(expiry); clearTimeout(warmTimer);
    download?.abort();
    download=null;
    canvas?.removeEventListener('webglcontextlost',failed);
    renderer?.dispose(); canvas?.remove();
    canvas=null; renderer=null; ready=false;
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
  }
  const urls=['activegs','roam'].map(method=>{
    const model=figure.dataset.scene+'-'+method;
    const directory=compactModels.has(model) ? 'compact' : 'dense';
    return new URL('models/'+directory+'/'+model+'.ply',document.baseURI).href;
  });
  async function prepare() {
    if(canvas) return;
    // Reserve GPU memory for the active comparison. Reuse a second completed pair on desktop.
    const cap=matchMedia('(pointer:coarse)').matches?1:2;
    for(const [card,cache] of cachedScenes) {
      if(card.dataset.exploring) continue;
      if(!cache.ready() || cachedScenes.size>=cap) cache.release();
    }
    cachedScenes.set(figure,{release,ready:()=>ready});
    canvas=document.createElement('canvas');
    canvas.className='orbit-view'; canvas.style.visibility='hidden';
    canvas.setAttribute('aria-hidden','true');
    viewport.insertBefore(canvas,surface);
    canvas.addEventListener('webglcontextlost',failed);
    const node=canvas;
    download=new AbortController();
    const {signal}=download;
    try {
      const models=Promise.all(urls.map(async url=>{
        const response=await fetch(url,{signal});
        if(!response.ok) throw Error('Model unavailable');
        return response.blob();
      }));
      const [{createRenderer},blobs]=await Promise.all([loadRenderer(),models]);
      if(canvas!==node) return;
      download=null;
      renderer=createRenderer(canvas,blobs,figure.hasAttribute('data-center-each'),()=>{
        if(canvas!==node) return;
        ready=true;
        if(figure.dataset.exploring) showScene();
        else expireLater();
      },error=>{if(canvas===node) failed(error);});
    } catch(error) {if(canvas===node) failed(error);}
  }
  function explore(entry) {
    closeActive?.();
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
  mode.addEventListener('pointerenter',event=>{
    if(event.pointerType==='mouse' && !navigator.connection?.saveData) {
      warmTimer=setTimeout(()=>{if(!closeActive && !document.hidden) prepare();},180);
    }
  });
  mode.addEventListener('pointerleave',()=>clearTimeout(warmTimer));
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
