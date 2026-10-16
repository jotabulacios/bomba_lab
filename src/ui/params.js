// Parameter sliders of the left panel. Values are kept in display units here (rpm, mm,
// m³/h, %, °C, m) and converted in main.js.

export const PARAM_GROUPS = [
  {
    title: 'Operación',
    note: 'La misma bomba: velocidad y recorte del rodete.',
    params: [
      { key: 'n', label: 'Velocidad n', min: 500, max: 3600, step: 10, fmt: (v) => `${v.toFixed(0)} rpm` },
      { key: 'trim', label: 'Recorte de D2', min: 80, max: 100, step: 1, fmt: (v) => `${v.toFixed(0)} %`,
        derived: (s) => `D2 = ${(s.D2mm * s.trim / 100).toFixed(0)} mm (las leyes de afinidad valen hasta ~10 %)` },
    ],
  },
  {
    title: 'Diseño del rodete',
    note: 'Cada cambio recalibra la bomba en su punto de diseño.',
    params: [
      { key: 'beta2', label: 'β2 (desde la tangente)', min: 10, max: 150, step: 1, fmt: (v) => `${v.toFixed(0)}°`,
        derived: (s) => (s.beta2 < 88 ? 'álabes hacia atrás' : s.beta2 <= 92 ? 'álabes radiales' : 'álabes hacia adelante') },
      { key: 'z', label: 'Número de álabes z', min: 3, max: 12, step: 1, fmt: (v) => v.toFixed(0) },
      { key: 'D2mm', label: 'Diámetro nominal D2', min: 40, max: 700, step: 1, fmt: (v) => `${v.toFixed(0)} mm` },
      { key: 'b2mm', label: 'Ancho de salida b2', min: 1, max: 60, step: 0.1, fmt: (v) => `${v.toFixed(1)} mm` },
      { key: 'D1mm', label: 'Diámetro de entrada D1', min: 15, max: 300, step: 1, fmt: (v) => `${v.toFixed(0)} mm` },
      { key: 'Qdh', label: 'Q de diseño (sin choque)', min: 1, max: 800, step: 0.1, fmt: (v) => `${v.toFixed(v < 20 ? 1 : 0)} m³/h` },
      { key: 'etaHd', label: 'ηh de diseño', min: 0.6, max: 0.95, step: 0.01, fmt: (v) => v.toFixed(2) },
      { key: 'slip', label: 'Resbalamiento (Wiesner)', type: 'check' },
    ],
  },
  {
    title: 'Fluido y sitio',
    params: [
      { key: 'T', label: 'Temperatura del agua', min: 5, max: 98, step: 1, fmt: (v) => `${v.toFixed(0)} °C` },
      { key: 'alt', label: 'Altitud del sitio', min: 0, max: 4500, step: 50, fmt: (v) => `${v.toFixed(0)} m` },
    ],
  },
  {
    title: 'Instalación',
    note: 'Curva del sistema: H = H_geo + K·Q².',
    params: [
      { key: 'Hgeo', label: 'Altura geodésica H_geo', min: 0, max: 150, step: 1, fmt: (v) => `${v.toFixed(0)} m` },
      { key: 'hfd', label: 'Pérdidas de la cañería a Q_d', min: 0, max: 80, step: 0.5, fmt: (v) => `${v.toFixed(1)} m` },
      { key: 'valve', label: 'Apertura de la válvula', min: 5, max: 100, step: 1, fmt: (v) => `${v.toFixed(0)} %` },
      { key: 'Hs', label: 'Altura de aspiración Hs', min: -9, max: 10, step: 0.5, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} m`,
        derived: (s) => (s.Hs >= 0 ? 'en carga (tanque arriba de la bomba)' : 'aspirando (tanque abajo de la bomba)') },
      { key: 'hsd', label: 'Pérdidas en la aspiración a Q_d', min: 0, max: 6, step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
    ],
  },
  {
    title: 'Conexión',
    params: [
      { key: 'mode', label: 'Bombas', type: 'select', options: [['single', 'Una bomba'], ['series', 'Dos en serie'], ['parallel', 'Dos en paralelo']] },
      { key: 'nB', label: 'Velocidad de la segunda bomba', min: 50, max: 100, step: 1, fmt: (v) => `${v.toFixed(0)} % de n` },
    ],
  },
];

export function buildParams(host, state, onChange, onHover = () => {}) {
  host.innerHTML = '';
  const outputs = {};
  const derived = [];
  for (const g of PARAM_GROUPS) {
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.innerHTML = `<p>${g.title}${g.note ? `<small>${g.note}</small>` : ''}</p>`;
    for (const p of g.params) {
      const row = document.createElement('div');
      const id = `p-${p.key}`;
      if (p.type === 'check') {
        row.className = 'param check';
        row.innerHTML = `<label for="${id}">${p.label}</label><input id="${id}" type="checkbox" ${state[p.key] ? 'checked' : ''}>`;
        row.querySelector('input').addEventListener('change', (e) => onChange(p.key, e.target.checked));
      } else if (p.type === 'select') {
        row.className = 'param select';
        row.innerHTML = `<label for="${id}">${p.label}</label><select id="${id}">${p.options.map(([v, t]) => `<option value="${v}" ${state[p.key] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
        row.querySelector('select').addEventListener('change', (e) => onChange(p.key, e.target.value));
      } else {
        row.className = 'param';
        row.innerHTML = `<label for="${id}">${p.label}</label><output for="${id}"></output>
          <input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${state[p.key]}">
          ${p.derived ? '<span class="derived"></span>' : ''}`;
        const input = row.querySelector('input');
        const out = row.querySelector('output');
        out.textContent = p.fmt(state[p.key]);
        outputs[p.key] = (v) => { input.value = v; out.textContent = p.fmt(v); };
        input.addEventListener('input', () => {
          const v = Number(input.value);
          out.textContent = p.fmt(v);
          onChange(p.key, v);
        });
      }
      if (p.derived) derived.push([row.querySelector('.derived'), p.derived]);
      row.addEventListener('pointerenter', () => { row.classList.add('hover'); onHover(p.key); });
      row.addEventListener('pointerleave', () => { row.classList.remove('hover'); onHover(null); });
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  return {
    refresh(s) { for (const [el, f] of derived) el.textContent = f(s); },
  };
}
