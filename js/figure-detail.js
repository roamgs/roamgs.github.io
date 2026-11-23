const lens = document.createElement('canvas');
lens.className = 'detail-lens';
lens.hidden = true;
lens.setAttribute('aria-hidden', 'true');
document.body.append(lens);
const context = lens.getContext('2d');
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
let active = null;

function closeLens() {
  if (active) active.target.hidden = true;
  active = null;
  lens.hidden = true;
}

function paint() {
  if (!active) return;
  const { frame, preview, detail, target, point } = active;
  const source = detail.complete && detail.naturalWidth ? detail : preview;
  const box = frame.getBoundingClientRect();
  if (!source.naturalWidth || !box.width || !box.height) return;

  const margin = 12;
  const width = Math.min(300, Math.round(innerWidth * .72), innerWidth - 2 * margin);
  const height = Math.min(Math.round(width * .68), Math.floor(innerHeight * .36));
  const zoom = Math.max(3.25, 2200 / box.width);
  const sampleW = width / zoom, sampleH = height / zoom;
  const left = clamp(point.x * box.width - sampleW / 2, 0, box.width - sampleW);
  const top = clamp(point.y * box.height - sampleH / 2, 0, box.height - sampleH);
  Object.assign(target.style, { left:left+'px', top:top+'px', width:sampleW+'px', height:sampleH+'px' });
  target.hidden = false;

  const scale = Math.min(window.devicePixelRatio || 1, 3);
  const pixelsW = Math.round(width * scale), pixelsH = Math.round(height * scale);
  if (lens.width !== pixelsW || lens.height !== pixelsH) {
    lens.width = pixelsW;
    lens.height = pixelsH;
  }
  lens.style.width = width + 'px';
  lens.style.height = height + 'px';
  context.imageSmoothingQuality = 'high';
  const sx = source.naturalWidth / box.width, sy = source.naturalHeight / box.height;
  context.drawImage(source, left*sx, top*sy, sampleW*sx, sampleH*sy, 0, 0, pixelsW, pixelsH);

  // Put the magnification beside the sampled area, or above/below on narrow screens.
  const startX = box.left + left, startY = box.top + top;
  let lensX = startX + sampleW + margin;
  let lensY = startY + sampleH / 2 - height / 2;
  if (lensX + width + margin > innerWidth) lensX = startX - width - margin;
  if (lensX < margin) {
    lensX = startX + sampleW / 2 - width / 2;
    lensY = startY > height + margin * 2 ? startY - height - margin : startY + sampleH + margin;
  }
  lens.style.left = clamp(lensX, margin, innerWidth-width-margin) + 'px';
  lens.style.top = clamp(lensY, margin, innerHeight-height-margin) + 'px';
  lens.hidden = false;
}

for (const frame of document.querySelectorAll('.detail-surface')) {
  const preview = frame.querySelector('img');
  const detail = new Image();
  const state = { frame, preview, detail, target:frame.querySelector('.detail-target'), point:{x:.5, y:.5} };
  function open(x, y) {
    if (active !== state) closeLens();
    active = state;
    state.point = { x:clamp(x, 0, 1), y:clamp(y, 0, 1) };
    if (!detail.src) detail.src = frame.dataset.detail;
    paint();
  }
  function follow(event) {
    const box = frame.getBoundingClientRect();
    open((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }
  for (const image of [preview, detail]) {
    image.addEventListener('load', () => { if (active === state) paint(); });
  }
  frame.addEventListener('pointermove', follow);
  frame.addEventListener('pointerdown', follow);
  frame.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'touch' && active === state) closeLens();
  });
  frame.addEventListener('pointercancel', closeLens);
  frame.addEventListener('focus', () => {
    if (frame.matches(':focus-visible') && active !== state) open(.5, .5);
  });
  frame.addEventListener('blur', () => { if (active === state) closeLens(); });
  frame.addEventListener('keydown', event => {
    const step = event.shiftKey ? .1 : .025;
    const delta = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    open(state.point.x + delta[0], state.point.y + delta[1]);
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLens(); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('.detail-surface')) closeLens(); });
window.addEventListener('scroll', closeLens, { passive:true });
window.addEventListener('resize', closeLens);
window.addEventListener('blur', closeLens);
