import {createRenderer} from './splat-renderer.js?v=sharp-orbit';

const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;
const cachedScenes=new Map();

for (const figure of document.querySelectorAll('.film')) {
  const viewport=figure.querySelector('.viewport');
  const video=viewport.querySelector('video'), surface=viewport.querySelector('.film-surface');
  if (figure.dataset.explorer === 'video-only') continue;
  const mode=document.createElement('button');
  mode.type='button';
  mode.className='scene-mode';
  mode.textContent='Explore 3D';
  mode.setAttribute('aria-pressed','false');
  const status=document.createElement('span');
  status.className='scene-status';
  status.setAttribute('role','status');
  viewport.append(mode,status);

  let load, canvas, renderer, frame, pointer, suppressClick, wasPlaying;
  let ready=false, fullReady=false, expiry, loadingHint, pendingLayer, warmTimer;
  let yaw=.93, pitch=.64, zoom=1;
  const resize=new ResizeObserver(redraw);
  function redraw() {
    if (!renderer || frame || !figure.dataset.exploring) return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      renderer?.draw(yaw,pitch,zoom);
    });
  }
  function turn(dx,dy) {
    yaw-=dx*.012;
    pitch=clamp(pitch+dy*.009,-1.4,1.48);
    redraw();
  }
  function expireLater() {
    clearTimeout(expiry);
    expiry=setTimeout(()=>{
      if (!figure.dataset.exploring && !visibleClips.has(video)) release();
    },60000);
  }
  function leave({resume = wasPlaying} = {}) {
    if (!figure.dataset.exploring) return;
    clearTimeout(loadingHint);
    cancelAnimationFrame(frame); frame=0;
    resize.disconnect();
    if (canvas) canvas.style.visibility='hidden';
    delete figure.dataset.exploring;
    mode.textContent='Explore 3D';
    mode.setAttribute('aria-pressed','false');
    status.textContent='';
    closeActive=null;
    surface.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+figure.dataset.scene+' comparison');
    clips.forEach(updatePlayback);
    if (resume && reducedMotion.matches && !document.hidden && visibleClips.has(video) && !video.hasAttribute('data-user-paused')) video.play().catch(()=>{});
    expireLater();
  }
  function disposeLayer(node, view) {
    view?.dispose();
    if (!node) return;
    node.removeEventListener('webglcontextlost',failed);
    node.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    node.remove();
  }
  function release() {
    clearTimeout(expiry);
    load?.abort(); load=null;
    if (pendingLayer) disposeLayer(pendingLayer.node,pendingLayer.view);
    pendingLayer=null;
    disposeLayer(canvas,renderer);
    canvas=null; renderer=null; ready=false; fullReady=false;
    cachedScenes.delete(figure);
  }
  function failed(error) {
    error.preventDefault?.();
    if (figure.dataset.exploring) {
      leave();
      status.textContent='3D unavailable · Showing replay';
    }
    release();
  }
  function showScene() {
    if(!figure.dataset.exploring) return;
    clearTimeout(loadingHint);
    canvas.style.visibility='visible';
    status.textContent=figure.dataset.exploring==='drag' ? 'Release drag to play' : 'Drag to orbit';
  }
  async function prepare(previewOnly=false) {
    if(load || fullReady || (previewOnly && ready)) return;
    if(previewOnly && !('DecompressionStream' in window)) return;
    if (!cachedScenes.has(figure) && cachedScenes.size>=3) {
      const oldest=[...cachedScenes].find(([card])=>!card.dataset.exploring && (!previewOnly || !visibleClips.has(card.querySelector('video'))));
      if (oldest) oldest[1]();
      else if (previewOnly) return;
    }
    cachedScenes.delete(figure);
    cachedScenes.set(figure,release);
    const active=new AbortController();
    load=active;
    async function loadPair(folder) {
      return Promise.all(['activegs','roam'].map(async method=>{
        const name=figure.dataset.scene+'-'+method+'.splat';
        const url=folder ? 'models/'+folder+'/'+name+'.gz' : 'models/'+name;
        const response=await fetch(url,{signal:active.signal});
        if (!response.ok) throw Error('Model unavailable');
        if (!folder) return response.arrayBuffer();
        const blob=await response.blob();
        const magic=new Uint8Array(await blob.slice(0,2).arrayBuffer());
        // Some static hosts transparently decompress .gz assets.
        if (magic[0]!==31 || magic[1]!==139) return blob.arrayBuffer();
        return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }));
    }
    async function present(buffers) {
      if(active.signal.aborted) return;
      const node=document.createElement('canvas');
      node.className='orbit-view';
      node.style.visibility='hidden';
      node.setAttribute('aria-hidden','true');
      viewport.insertBefore(node,surface);
      const layer={node};
      pendingLayer=layer;
      await new Promise((resolve,reject)=>{
        const abort=()=>reject(new DOMException('Aborted','AbortError'));
        active.signal.addEventListener('abort',abort,{once:true});
        layer.view=createRenderer(node,buffers,figure.hasAttribute('data-center-each'),()=>{
          active.signal.removeEventListener('abort',abort);
          if(active.signal.aborted) return;
          disposeLayer(canvas,renderer);
          canvas=node; renderer=layer.view; pendingLayer=null; ready=true;
          canvas.addEventListener('webglcontextlost',failed);
          renderer.draw(yaw,pitch,zoom);
          clearTimeout(loadingHint);
          showScene();
          resolve();
        },event=>{
          if (pendingLayer===layer) reject(new Error('Scene initialization failed'));
          else if (canvas===node) failed(event);
        });
        layer.view.draw(yaw,pitch,zoom);
      });
    }
    try {
      if ('DecompressionStream' in window) {
        // Keep the preview draggable until the full pair has a sorted frame.
        try { if (!ready) await present(await loadPair('previews')); }
        catch(error) { if(active.signal.aborted || pendingLayer) throw error; }
        if(active.signal.aborted) return;
        if(!figure.dataset.exploring) { load=null; expireLater(); return; }
        let full;
        try { full=await loadPair('compressed'); }
        catch(error) { if(active.signal.aborted) throw error; full=await loadPair(''); }
        await present(full);
      } else {
        await present(await loadPair(''));
      }
      if(!active.signal.aborted) fullReady=true;
    } catch(error) {
      if(active.signal.aborted) return;
      if(ready && canvas) {
        if (pendingLayer) disposeLayer(pendingLayer.node,pendingLayer.view);
        pendingLayer=null; load=null;
        return;
      }
      failed(error);
    }
  }
  function explore(entry) {
    closeActive?.();
    closeActive=leave;
    clearTimeout(expiry);
    yaw=.93; pitch=.64; zoom=1;
    wasPlaying=!video.paused;
    figure.dataset.exploring=entry;
    clips.forEach(updatePlayback);
    mode.textContent='Back to video';
    mode.setAttribute('aria-pressed','true');
    surface.setAttribute('aria-label',entry==='drag'
      ? 'Drag to orbit. Release to resume the video.'
      : 'Drag or use the arrow keys to orbit. Scroll or use + and − to zoom. Escape to return to video.');
    resize.observe(viewport);
    if(ready) {
      renderer.draw(yaw,pitch,zoom);
      showScene();
      prepare();
    } else {
      status.textContent='';
      loadingHint=setTimeout(()=>{status.textContent='Loading 3D…';},180);
      prepare();
    }
  }

  function warmPreview() {
    if(document.hidden || closeActive || navigator.connection?.saveData) return;
    clearTimeout(warmTimer);
    prepare(true);
  }
  // Give the visible replay its first frame before preparing a drag.
  video.addEventListener('playing',()=>{
    clearTimeout(warmTimer);
    warmTimer=setTimeout(()=>{ if(visibleClips.has(video) && !video.paused) warmPreview(); },450);
  });
  viewport.addEventListener('pointerenter',e=>{
    if(e.pointerType==='mouse') {
      clearTimeout(warmTimer);
      warmTimer=setTimeout(warmPreview,180);
    }
  });
  mode.addEventListener('focus',warmPreview);
  mode.addEventListener('click',()=>{
    if (figure.dataset.exploring) leave();
    else { explore('button'); surface.focus({preventScroll:true}); }
  });
  surface.addEventListener('pointerdown',e=>{
    if (!e.isPrimary || e.button!==0) return;
    warmPreview();
    suppressClick=false;
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,drag:false};
    surface.setPointerCapture(e.pointerId);
  });
  surface.addEventListener('pointermove',e=>{
    if (pointer?.id!==e.pointerId) return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if (!pointer.drag && Math.hypot(dx,dy)<5) return;
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
    if (dragged) redraw();
    if (dragged && figure.dataset.exploring === 'drag') {
      leave({resume: event.type === 'pointerup' || wasPlaying});
    }
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
    redraw();
  },{passive:false});
  viewport.addEventListener('keydown',e=>{
    if (!figure.dataset.exploring) return;
    if (e.key==='Escape') { leave(); mode.focus(); return; }
    if (e.target!==surface) return;
    const delta={ArrowLeft:[-7,0],ArrowRight:[7,0],ArrowUp:[0,6],ArrowDown:[0,-6]}[e.key];
    if (delta) turn(...delta);
    else if (['+','=','-'].includes(e.key)) { zoom=clamp(zoom*(e.key==='-'?.9:1.1),.65,2.8); redraw(); }
    else return;
    e.preventDefault();
  });
}
