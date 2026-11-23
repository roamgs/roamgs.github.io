import {createRenderer} from './splat-renderer.js?v=retina-warm';

const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;
const cachedScenes=new Map();
// Keep compact PLY blobs for this page. Decode and allocate GPU buffers for at most
// the first warm scene and the scenes the visitor actually selects.
const modelFiles=new Map();
const downloads=[];
function modelFile(url,priority) {
  if(!modelFiles.has(url)) {
    const request=fetch(url,{priority}).then(response=>{
      if(!response.ok) throw Error('Model unavailable');
      return response.blob();
    }).catch(error=>{modelFiles.delete(url); throw error;});
    modelFiles.set(url,request);
  }
  return modelFiles.get(url);
}
const nearScene=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries) {
    if(!isIntersecting && target.dataset.exploring) closeActive?.();
  }
});

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

  let canvas,renderer,pointer,suppressClick,expiry;
  let ready=false, yaw=.93, pitch=.64, zoom=1;
  const resize=new ResizeObserver(()=>redraw());
  function redraw(moving=false) {
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
  function leave() {
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
    surface.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+figure.dataset.scene+' comparison');
    syncPlayback();
    expireLater();
  }
  function release() {
    clearTimeout(expiry);
    canvas?.removeEventListener('webglcontextlost',failed);
    renderer?.dispose(); canvas?.remove();
    canvas=null; renderer=null; ready=false;
    cachedScenes.delete(figure);
  }
  function failed(error) {
    error.preventDefault?.();
    if(figure.dataset.exploring) {
      leave();
      status.textContent='3D unavailable · Showing replay';
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
  const urls=['activegs','roam'].map(method=>
    new URL('models/dense/'+figure.dataset.scene+'-'+method+'.ply',document.baseURI).href);
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
    try {
      const blobs=await Promise.all(urls.map(url=>modelFile(url,'high')));
      if(canvas!==node) return;
      renderer=createRenderer(canvas,blobs,figure.hasAttribute('data-center-each'),()=>{
        ready=true;
        if(figure.dataset.exploring) showScene();
        else expireLater();
      },failed);
    } catch(error) {if(canvas===node) failed(error);}
  }
  function explore(entry) {
    closeActive?.();
    closeActive=leave;
    clearTimeout(expiry);
    yaw=.93; pitch=.64; zoom=1;
    figure.dataset.exploring=entry;
    mode.textContent='Back to video';
    mode.setAttribute('aria-pressed','true');
    surface.setAttribute('aria-label',entry==='drag'
      ? 'Drag to orbit. Release to resume the video.'
      : 'Drag or use the arrow keys to orbit. Scroll or use + and − to zoom. Escape to return to video.');
    resize.observe(viewport);
    if(ready) showScene();
    else {
      status.textContent='Loading dense 3D…';
      prepare();
    }
  }
  downloads.push({urls,prepare});
  nearScene.observe(figure);
  mode.addEventListener('pointerenter',event=>{
    if(event.pointerType==='mouse' && !closeActive && !navigator.connection?.saveData) prepare();
  });
  mode.addEventListener('focus',()=>{if(!closeActive && !navigator.connection?.saveData) prepare();});
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
    if (dragged) redraw();
    if (dragged && figure.dataset.exploring === 'drag') {
      leave();
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
    redraw(true);
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

async function preloadScenes() {
  if(navigator.connection?.saveData) return;
  for(const [index,scene] of downloads.entries()) {
    for(const url of scene.urls) {
      while(document.hidden || closeActive || clips.some(clip=>!clip.paused &&
        clip.readyState<3 && !clip.error && clip.getBoundingClientRect().bottom>0 &&
        clip.getBoundingClientRect().top<innerHeight)) {
        // A requested scene can always bypass this background queue.
        await new Promise(resolve=>setTimeout(resolve,600));
      }
      try { await modelFile(url,'low'); }
      catch { /* An explicit visit retries any failed background transfer. */ }
    }
    if(index===0 && !document.hidden && !cachedScenes.size && scene.urls.every(url=>modelFiles.has(url))) {
      const warm=()=>{if(!cachedScenes.size && !document.hidden) scene.prepare();};
      if(window.requestIdleCallback) requestIdleCallback(warm,{timeout:1200});
      else setTimeout(warm,120);
    }
  }
}
// The media elements request playback first. Model downloads run one file at a time.
setTimeout(preloadScenes,300);
