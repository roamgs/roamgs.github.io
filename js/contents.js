(() => {
  const mast = document.querySelector('.mast');
  const nav = document.querySelector('.contents');
  const links = [...nav.querySelectorAll('a')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const glass = document.querySelector('.scroll-glass');
  const hero = document.getElementById('home');
  let pending = false, currentIndex = -1, lastFrost;

  function markCurrent() {
    pending = false;
    const y = scrollY, height = innerHeight;
    const line = Math.min(height * .25, 180);
    const atEnd = y + height >= document.documentElement.scrollHeight - 2;
    const index = sections.findLastIndex(section => section.getBoundingClientRect().top <= line);
    const active = atEnd ? links.length - 1 : Math.max(0, index);
    const progress = Math.min(1, Math.max(0, y / hero.offsetHeight));
    const frost = (Math.sin(Math.PI * progress) ** 2).toFixed(2);
    const visible = y > Math.min(height * .2, 140);

    mast.classList.toggle('is-compact', y > 12);
    nav.classList.toggle('is-visible', visible);
    if (nav.inert === visible) nav.inert = !visible;
    if (glass && frost !== lastFrost) {
      glass.style.setProperty('--scroll-frost', frost);
      lastFrost = frost;
    }
    if (active !== currentIndex) {
      links[currentIndex]?.removeAttribute('aria-current');
      links[active].setAttribute('aria-current', 'location');
      nav.style.setProperty('--progress', active / (links.length - 1));
      currentIndex = active;
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(markCurrent);
  }
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pageshow', schedule);
  markCurrent();
})();
