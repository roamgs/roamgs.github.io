import {createRenderer} from './splat-renderer.js?v=sharp-orbit';

const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive, releaseCached;

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
  let ready=false, expiry, loadingHint, hoverTimer;
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
    expiry=setTimeout(release,60000);
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
    if (resume && !document.hidden && visibleClips.has(video)) video.play().catch(()=>{});
    expireLater();
  }
  function release() {
    clearTimeout(expiry);
    load?.abort(); load=null;
    renderer?.dispose(); renderer=null;
    if (canvas) {
      canvas.removeEventListener('webglcontextlost',failed);
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove(); canvas=null;
    }
    ready=false;
    if(releaseCached===release) releaseCached=null;
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
  async function prepare() {
    if(load) return;
    releaseCached?.();
    releaseCached=release;
    const active=new AbortController();
    load=active;
    if(!figure.dataset.exploring) expireLater();
    try {
      const buffers=await Promise.all(['activegs','roam'].map(async method=>{
        const url='models/'+figure.dataset.scene+'-'+method+'.splat';
        const res=await fetch(url,{signal:active.signal});
        if (!res.ok) throw Error('Model unavailable');
        return res.arrayBuffer();
      }));
      if(active.signal.aborted) return;
      canvas=document.createElement('canvas');
      canvas.className='orbit-view';
      canvas.style.visibility='hidden';
      canvas.setAttribute('aria-hidden','true');
      viewport.insertBefore(canvas,surface);
      canvas.addEventListener('webglcontextlost',failed);
      renderer=createRenderer(canvas,buffers,figure.hasAttribute('data-center-each'),()=>{
        ready=true;
        showScene();
      },failed);
      renderer.draw(yaw,pitch,zoom);
    } catch(error) {
      if(active.signal.aborted) return;
      console.warn('Scene explorer:',error);
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
    video.pause();
    mode.textContent='Back to video';
    mode.setAttribute('aria-pressed','true');
    surface.setAttribute('aria-label',entry==='drag'
      ? 'Drag to orbit. Release to resume the video.'
      : 'Drag or use the arrow keys to orbit. Scroll or use + and − to zoom. Escape to return to video.');
    resize.observe(viewport);
    if(ready) {
      renderer.draw(yaw,pitch,zoom);
      showScene();
    } else {
      status.textContent='';
      loadingHint=setTimeout(()=>{status.textContent='Loading 3D…';},180);
      prepare();
    }
  }

  // Warm the viewer on deliberate interest, without downloading every gallery model.
  function warm() {
    if(!closeActive && !navigator.connection?.saveData) prepare();
  }
  viewport.addEventListener('pointerenter',e=>{
    if(e.pointerType==='mouse') hoverTimer=setTimeout(warm,220);
  });
  viewport.addEventListener('pointerleave',()=>clearTimeout(hoverTimer));
  mode.addEventListener('focus',warm);
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
