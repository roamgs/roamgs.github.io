import { curves } from './progression-data.js';

const figure = document.querySelector('.paper-curves');
const counts = [50, 100, 300, 500];
const colors = {
  'ROAM-GS': '#1f5fa0', ActiveGS: '#d1495b', ActiveSplat: '#2a9d8f',
  NARUTO: '#8c5a3c', 'POp-GS': '#e39b2d', FisherRF: '#7b5ea7'
};

// Plot bounds in points from the paper figure's 495 × 203.04 SVG viewBox.
const columns = [27.36, 107.52, 183.36, 263.52, 339.36, 419.52];
const tooltip = document.createElement('div');
tooltip.className = 'curve-tooltip';
tooltip.hidden = true;
const title = document.createElement('strong');
const subtitle = document.createElement('span');
const values = document.createElement('dl');
tooltip.append(title, subtitle, values);
figure.append(tooltip);

const guide = document.createElement('span');
guide.className = 'checkpoint-guide';
guide.setAttribute('aria-hidden', 'true');
const rows = Object.entries(colors).map(([name, color]) => {
  const label = document.createElement('dt');
  label.textContent = name;
  label.style.setProperty('--series', color);
  const value = document.createElement('dd');
  values.append(label, value);
  const dot = document.createElement('i');
  dot.style.backgroundColor = color;
  guide.append(dot);
  return { name, value, dot };
});

function close() {
  tooltip.hidden = true;
  guide.remove();
}

function addPlot(dataset, size, metric, x, y) {
  const plot = document.createElement('div');
  plot.className = 'checkpoint-plot';
  plot.tabIndex = 0;
  plot.setAttribute('role', 'slider');
  plot.setAttribute('aria-label', [dataset, size, metric, 'observation checkpoint'].join(' '));
  plot.setAttribute('aria-valuemin', '50');
  plot.setAttribute('aria-valuemax', '500');
  plot.setAttribute('aria-valuenow', '50');
  plot.style.left = x / 495 * 100 + '%';
  plot.style.top = y / 203.04 * 100 + '%';
  figure.append(plot);
  let current = 0;

  function show(index) {
    if (!tooltip.hidden && guide.parentElement === plot && current === index) return;
    current = index;
    const count = counts[index];
    const unit = metric === 'PSNR' ? 'dB' : '%';
    title.textContent = dataset + ' · ' + size + ' homes';
    subtitle.textContent = count + ' views · ' + metric + ' (' + unit + ')';
    const spoken = [];
    for (const { name, dot, value } of rows) {
      const [mean, sd] = curves[dataset][size][metric][name][index + 1];
      value.textContent = mean.toFixed(2) + ' ± ' + sd.toFixed(2);
      spoken.push(name + ' ' + value.textContent);
      dot.style.bottom = mean / (metric === 'PSNR' ? 30 : 100) * 100 + '%';
    }
    plot.setAttribute('aria-valuenow', count);
    plot.setAttribute('aria-valuetext', count + ' views. ' + spoken.join(', '));
    plot.append(guide);
    guide.style.left = count / 500 * 100 + '%';
    tooltip.hidden = false;
    const anchor = plot.offsetLeft + plot.clientWidth * count / 500;
    tooltip.style.left = Math.max(0, Math.min(anchor - tooltip.offsetWidth / 2, figure.clientWidth - tooltip.offsetWidth)) + 'px';
    const above = plot.getBoundingClientRect().top > tooltip.offsetHeight + 12;
    tooltip.style.top = (above ? plot.offsetTop - tooltip.offsetHeight - 8 : plot.offsetTop + plot.offsetHeight + 8) + 'px';
  }

  function inspect(event) {
    const rect = plot.getBoundingClientRect();
    const count = (event.clientX - rect.left) / rect.width * 500;
    const nearest = counts.reduce((a, b) => Math.abs(count - a) <= Math.abs(count - b) ? a : b);
    show(counts.indexOf(nearest));
  }
  plot.addEventListener('pointermove', inspect);
  plot.addEventListener('pointerdown', inspect);
  plot.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') close(); });
  plot.addEventListener('focus', () => show(current));
  plot.addEventListener('blur', close);
  plot.addEventListener('keydown', event => {
    const next = { ArrowLeft: current - 1, ArrowDown: current - 1,
      ArrowRight: current + 1, ArrowUp: current + 1, Home: 0, End: counts.length - 1 }[event.key];
    if (event.key === 'Escape') close();
    if (next === undefined) return;
    event.preventDefault();
    show(Math.max(0, Math.min(next, counts.length - 1)));
  });
}

for (const [row, dataset] of ['HSSD', 'HM3D'].entries()) {
  columns.forEach((x, col) => addPlot(dataset, ['Small', 'Medium', 'Large'][Math.floor(col / 2)],
    col % 2 ? 'Cov10' : 'PSNR', x, row ? 113.76 : 23.04));
}
document.addEventListener('pointerdown', event => { if (!event.target.closest('.checkpoint-plot')) close(); });
window.addEventListener('resize', close);
