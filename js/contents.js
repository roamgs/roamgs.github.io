(() => {
  const mast = document.querySelector('.mast');
  const nav = document.querySelector('.contents');
  const links = [...nav.querySelectorAll('a')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const glass = document.querySelector('.scroll-glass');
  const hero = document.getElementById('home');
  function markCurrent() {
    mast.classList.toggle('is-compact', scrollY > 12);
    if (glass) {
      const bounds = hero.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -bounds.top / bounds.height));
      const frost = Math.sin(Math.PI * progress) ** 2;
      glass.style.setProperty('--scroll-frost', frost.toFixed(3));
    }
    const visible = scrollY > Math.min(innerHeight * .2, 140);
    nav.classList.toggle('is-visible', visible);
    nav.inert = !visible;
    const line = Math.min(innerHeight * .25, 180);
    const index = sections.findLastIndex(section => section.getBoundingClientRect().top <= line);
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const active = atEnd ? links.length - 1 : Math.max(0, index);
    nav.style.setProperty('--progress', active / (links.length - 1));
    links.forEach((link, i) => {
      if (i === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', markCurrent, {passive:true});
  window.addEventListener('resize', markCurrent);
  window.addEventListener('hashchange', markCurrent);
  window.addEventListener('pageshow', markCurrent);
  markCurrent();
})();
