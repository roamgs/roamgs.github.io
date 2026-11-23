(() => {
  const root = document.documentElement;
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const url = new URL(location.href);
  const requested = url.searchParams.get('theme');
  let choice = ['light', 'dark'].includes(requested) ? requested : null;
  if (!choice) {
    try { choice = localStorage.getItem('roam-appearance'); } catch {}
  }
  function apply() {
    root.dataset.theme = choice || (preference.matches ? 'dark' : 'light');
  }
  preference.addEventListener('change', apply);
  apply();
})();
