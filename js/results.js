(() => {
  const list = document.querySelector('.result-tabs');
  const tabs = Array.from(list.querySelectorAll('button'));
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

  function select(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
  }

  list.setAttribute('role', 'tablist');
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab');
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', tab.id);
    panels[index].tabIndex = 0;
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    });
  });
  function selectLinkedPanel() {
    const index = panels.findIndex(panel => '#' + panel.id === location.hash);
    if (index >= 0) select(index);
  }
  select(0);
  selectLinkedPanel();
  window.addEventListener('hashchange', selectLinkedPanel);
  list.hidden = false;
})();
