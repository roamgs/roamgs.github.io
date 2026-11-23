import {createRenderer} from './splat-renderer.js?v=dense-ply-2';

const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;
const cachedScenes=new Map();
const warmCandidates=new Map();
let idleWarm;
function queueWarm() {
  clearTimeout(idleWarm);
  const connection=navigator.connection;
  if(document.hidden || closeActive || connection?.saveData || /2g/.test(connection?.effectiveType || '')) return;
  idleWarm=setTimeout(()=>{
    const target=[...warmCandidates.keys()].filter(card=>visibleClips.has(card.querySelector('video')))
      .sort((a,b)=>distance(a)-distance(b))[0];
    if(target && !closeActive && !document.hidden) warmCandidates.get(target)();
  },900);
}
function distance(card) {
  const rect=card.getBoundingClientRect();
  return Math.abs(rect.top+rect.height/2-innerHeight/2);
}
const nearScene=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries) {
    if(!isIntersecting && target.dataset.exploring) closeActive?.();
  }
  queueWarm();
},{threshold:[0,.25,.75,1]});

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

  let canvas,renderer,pointer,suppressClick,wasPlaying,expiry,intentTimer;
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
  function leave({resume=wasPlaying}={}) {
    if(!figure.dataset.exploring) return;
    resize.disconnect();
    renderer?.hide();
    if(canvas) canvas.style.visibility='hidden';
    if(resume && visibleClips.has(video)) preferredClip=video;
    delete figure.dataset.exploring;
    delete figure.dataset.orbitReady;
    mode.textContent='Explore 3D';
    mode.setAttribute('aria-pressed','false');
    status.textContent='';
    closeActive=null;
    surface.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+figure.dataset.scene+' comparison');
    syncPlayback();
    if(resume && reducedMotion.matches && !document.hidden && visibleClips.has(video) && !video.hasAttribute('data-user-paused')) video.play().catch(()=>{});
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
  function prepare(background=false) {
    if(renderer || (background && (closeActive || navigator.connection?.saveData || document.hidden))) return;
    // Reserve GPU memory for the active comparison. Reuse a second completed pair on desktop.
    const cap=matchMedia('(pointer:coarse)').matches?1:2;
    for(const [card,cache] of cachedScenes) {
      if(card.dataset.exploring) continue;
      if(!cache.ready() || cachedScenes.size>=cap) cache.release();
    }
    cachedScenes.set(figure,{release,ready:()=>ready});
    const urls=['activegs','roam'].map(method=>
      new URL('models/dense/'+figure.dataset.scene+'-'+method+'.ply',document.baseURI).href);
    canvas=document.createElement('canvas');
    canvas.className='orbit-view'; canvas.style.visibility='hidden';
    canvas.setAttribute('aria-hidden','true');
    viewport.insertBefore(canvas,surface);
    canvas.addEventListener('webglcontextlost',failed);
    try {
      renderer=createRenderer(canvas,urls,figure.hasAttribute('data-center-each'),()=>{
        ready=true;
        if(figure.dataset.exploring) showScene();
        else expireLater();
      },failed);
    } catch(error) {failed(error);}
  }
  function explore(entry) {
    closeActive?.();
    closeActive=leave;
    clearTimeout(expiry);
    yaw=.93; pitch=.64; zoom=1;
    wasPlaying=!video.paused;
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
  nearScene.observe(figure);
  warmCandidates.set(figure,()=>prepare(true));
  viewport.addEventListener('pointerenter',event=>{
    if(event.pointerType==='mouse') {
      clearTimeout(idleWarm);
      intentTimer=setTimeout(()=>prepare(true),160);
    }
  });
  viewport.addEventListener('pointerleave',()=>clearTimeout(intentTimer));
  mode.addEventListener('focus',()=>prepare(true));
  mode.addEventListener('click',()=>{
    if (figure.dataset.exploring) leave();
    else { explore('button'); surface.focus({preventScroll:true}); }
  });
  surface.addEventListener('pointerdown',e=>{
    if (!e.isPrimary || e.button!==0) return;
    clearTimeout(idleWarm);
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

// Begin the first pair while the visitor is still at a gallery navigation link.
for(const link of document.querySelectorAll('a[href="#comparison"], a[href^="#scene-"]')) {
  const warmDestination=()=>{
    const destination=document.getElementById(link.hash.slice(1));
    const card=destination?.matches('.film')?destination:destination?.querySelector('.film');
    warmCandidates.get(card)?.();
  };
  link.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse') warmDestination();});
  link.addEventListener('focus',warmDestination);
  link.addEventListener('pointerdown',warmDestination);
}
