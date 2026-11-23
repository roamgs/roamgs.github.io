'use strict';

function addReplayControl(figure) {
  const video = figure.querySelector('video');
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const toggle = document.createElement('button');
  toggle.className = 'film-surface';
  toggle.type = 'button';
  figure.prepend(viewport);
  viewport.append(video, toggle);
  video.controls = false;

  function playbackState() {
    if (figure.hasAttribute('data-exploring')) return;
    toggle.setAttribute('aria-label', (video.paused ? 'Play ' : 'Pause ') + figure.dataset.scene + ' comparison');
  }
  toggle.addEventListener('click', () => {
    if (video.paused) {
      delete video.dataset.userPaused;
      video.dispatchEvent(new Event('replay-choice',{bubbles:true}));
      video.play().catch(playbackState);
    } else {
      video.dataset.userPaused = '';
      video.pause();
      video.dispatchEvent(new Event('replay-choice',{bubbles:true}));
    }
  });
  video.addEventListener('play', playbackState);
  video.addEventListener('pause', playbackState);
  playbackState();
}
document.querySelectorAll('figure.film').forEach(addReplayControl);

const allowTilt = matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)');
for (const surface of document.querySelectorAll('.film-slot, #overview figure a, .paper-result a')) {
  function reset() {
    surface.classList.remove('figure-lift');
  }
  surface.addEventListener('pointermove', event => {
    if (surface.querySelector('[data-exploring]')) { reset(); return; }
    if (!allowTilt.matches || event.pointerType === 'touch') return;
    const rect = surface.getBoundingClientRect();
    const x = 2 * (event.clientX - rect.left) / rect.width - 1;
    const y = 2 * (event.clientY - rect.top) / rect.height - 1;
    surface.style.setProperty('--pull-x', (4 * x) + 'px');
    surface.style.setProperty('--pull-y', (3 * y) + 'px');
    surface.style.setProperty('--tilt-x', (-.8 * y) + 'deg');
    surface.style.setProperty('--tilt-y', (.8 * x) + 'deg');
    surface.classList.add('figure-lift');
  });
  surface.addEventListener('pointerleave', reset);
  surface.addEventListener('pointercancel', reset);
  allowTilt.addEventListener('change', reset);
}
