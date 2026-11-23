(() => {
  const root = document.documentElement;
  const requested = new URL(location.href).searchParams.get('theme');
  let saved;
  try { saved = localStorage.getItem('roam-appearance'); } catch {}
  root.dataset.theme = requested === 'light' || requested === 'dark'
    ? requested : saved === 'light' ? 'light' : 'dark';

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.theme-switch');
    if (!button) return;
    const update = () => button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    update();
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = theme;
      update();
      try { localStorage.setItem('roam-appearance', theme); } catch {}
      const url = new URL(location.href);
      if (url.searchParams.has('theme')) {
        url.searchParams.set('theme', theme);
        history.replaceState(history.state, '', url);
      }
    });
  });
})();
