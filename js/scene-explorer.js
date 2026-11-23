import {createRenderer} from './splat-renderer.js?v=panel-centers';

const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
let closeActive;

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

  let request,canvas,render,resize,frame,pointer,suppressClick,wasPlaying;
  let yaw,pitch,zoom;
  function redraw() {
    if (!render || frame) return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      if (render) render(yaw,pitch,zoom);
    });
  }
  function turn(dx,dy) {
    yaw-=dx*.012;
    pitch=clamp(pitch+dy*.009,-1.4,1.48);
    redraw();
  }
  function leave({resume = wasPlaying} = {}) {
    if (!request) return;
    request.abort(); request=null;
    resize?.disconnect(); resize=null;
    cancelAnimationFrame(frame); frame=0; render=null;
    if (canvas) {
      canvas.removeEventListener('webglcontextlost',lost);
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove(); canvas=null;
    }
    delete figure.dataset.exploring;
    mode.textContent='Explore 3D';
    mode.setAttribute('aria-pressed','false');
    status.textContent='';
    closeActive=null;
    surface.setAttribute('aria-label',(video.paused?'Play ':'Pause ')+figure.dataset.scene+' comparison');
    if (resume && !document.hidden && visibleClips.has(video)) video.play().catch(()=>{});
  }
  function lost(e) {
    e.preventDefault();
    leave();
    status.textContent='3D unavailable · Showing replay';
  }
  async function explore(entry) {
    if (request) return;
    closeActive?.();
    closeActive=leave;
    const active=new AbortController();
    request=active;
    yaw=.93; pitch=.64; zoom=1;
    wasPlaying=!video.paused;
    figure.dataset.exploring=entry;
    video.pause();
    mode.textContent='Back to video';
    mode.setAttribute('aria-pressed','true');
    status.textContent='Loading 3D…';
    const instructions = entry === 'drag'
      ? 'Drag to orbit. Release to resume the video.'
      : 'Drag or use the arrow keys to orbit. Scroll or use + and − to zoom. Escape to return to video.';
    surface.setAttribute('aria-label',instructions);
    try {
      const buffers=await Promise.all(['activegs','roam'].map(async method=>{
        const url='models/'+figure.dataset.scene+'-'+method+'.splat';
        const res=await fetch(url,{signal:active.signal});
        if (!res.ok) throw Error('Model unavailable');
        return res.arrayBuffer();
      }));
      if (active.signal.aborted) return;
      canvas=document.createElement('canvas');
      canvas.className='orbit-view';
      canvas.setAttribute('aria-hidden','true');
      viewport.insertBefore(canvas,surface);
      canvas.addEventListener('webglcontextlost',lost);
      render=createRenderer(canvas,buffers,figure.hasAttribute('data-center-each'));
      render(yaw,pitch,zoom);
      resize=new ResizeObserver(redraw);
      resize.observe(viewport);
      status.textContent = entry === 'drag' ? 'Release drag to play' : 'Drag to orbit';
    } catch (error) {
      if (active.signal.aborted) return;
      console.warn('Scene explorer:',error);
      leave();
      status.textContent='3D unavailable · Showing replay';
    }
  }

  mode.addEventListener('click',()=>{
    if (request) leave();
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
    if (!request) explore('drag');
    turn(dx,dy);
    pointer.x=e.clientX; pointer.y=e.clientY;
  });
  function finishDrag(event) {
    if (event.pointerId !== pointer?.id) return;
    const dragged = pointer.drag;
    pointer = null;
    if (dragged && figure.dataset.exploring === 'drag') {
      leave({resume: event.type === 'pointerup' || wasPlaying});
    }
  }
  surface.addEventListener('pointerup', finishDrag);
  surface.addEventListener('pointercancel', finishDrag);
  surface.addEventListener('lostpointercapture', finishDrag);
  surface.addEventListener('click',e=>{
    if (request || (suppressClick && e.detail !== 0)) e.stopImmediatePropagation();
    suppressClick=false;
  },true);
  surface.addEventListener('wheel',e=>{
    if (!request || e.ctrlKey) return;
    e.preventDefault();
    zoom=clamp(zoom*Math.exp(-e.deltaY*.002),.65,2.8);
    redraw();
  },{passive:false});
  viewport.addEventListener('keydown',e=>{
    if (!request) return;
    if (e.key==='Escape') { leave(); mode.focus(); return; }
    if (e.target!==surface) return;
    const delta={ArrowLeft:[-7,0],ArrowRight:[7,0],ArrowUp:[0,6],ArrowDown:[0,-6]}[e.key];
    if (delta) turn(...delta);
    else if (['+','=','-'].includes(e.key)) { zoom=clamp(zoom*(e.key==='-'?.9:1.1),.65,2.8); redraw(); }
    else return;
    e.preventDefault();
  });
}
