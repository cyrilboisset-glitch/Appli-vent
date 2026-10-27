// Interface « Vent et températures » : GPX → sens de la boucle, températures, tenue.
import {
  parseGpx, writeGpx, buildTrack, sampleTrack, smoothEle, stepFor, compass, compassShort, fetchForecast,
  analyseDirection, powerTimes, reverseSamples, compareDirections, clothing, SAME_WIND,
  BIKES, riderModel,
} from './src/index.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(`meteo:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`meteo:${k}`, v); } catch { /* stockage indisponible */ } },
};

// --- Thème -------------------------------------------------------------------
const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
applyTheme(store.get('theme'));
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
});

// --- Formats -----------------------------------------------------------------
const r0 = (x) => Math.round(x);
const r1 = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
const deg = (x) => `${r0(x) === 0 ? 0 : r0(x)} °C`;
const signed = (x) => `${x >= 0.5 ? '+' : ''}${r0(x)} km/h`;
let multiDay = false;
const hour = (ms) => new Date(ms).toLocaleString('fr-FR', multiDay
  ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
  : { hour: '2-digit', minute: '2-digit' });
const where = (r) => `km ${r0(r.km)} · ${r.ele == null ? '' : `${r0(r.ele)} m · `}${hour(r.time)}`;
const towards = (d) => (/^[eo]/.test(compass(d)) ? `l'${compass(d)}` : `le ${compass(d)}`);
const tailClass = (x) => (x >= SAME_WIND ? 'tail-pos' : x <= -SAME_WIND ? 'tail-neg' : '');
const tailWord = (x) => (x >= SAME_WIND ? 'dans le dos' : x <= -SAME_WIND ? 'de face' : 'neutre');

// --- Icônes (trait) ---------------------------------------------------------------
const ICONS = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v7"/>',
  shirt: '<path d="M8 3 3.5 5.5 5 10l2-.8V21h10V9.2l2 .8 1.5-4.5L16 3c-.6 1.6-2.1 2.5-4 2.5S8.6 4.6 8 3Z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  rain: '<path d="M7 15a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 9 3 3 0 0 1 18 15H7Z"/><path d="m9 18-1 2m5-2-1 2m5-2-1 2"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4m0 3v.01"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const head = (n, title) => `<div class="card-head"><span class="badge-i">${icon(n)}</span><h2>${title}</h2></div>`;

// --- État ----------------------------------------------------------------------
let gpx = null;
let track = null;
const EMPTY = $('results').innerHTML;

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
$('start').value = defaultStart();

// --- Cycliste : mode de calcul et réglages mémorisés ------------------------------
$('bike').innerHTML = Object.entries(BIKES).map(([k, b]) => `<option value="${k}">${esc(b.label)}</option>`).join('');
const FIELDS = ['speed', 'weight', 'bike-kg', 'ftp', 'intensity', 'bike', 'pauses', 'cda', 'crr'];
for (const id of FIELDS) {
  const v = store.get(id);
  if (v != null) $(id).value = v;
  $(id).addEventListener('change', () => store.set(id, $(id).value));
}
let mode = store.get('mode') ?? 'power';
function setMode(m) {
  mode = m;
  store.set('mode', m);
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-checked', String(b.dataset.mode === m));
  $('mode-power').hidden = m !== 'power';
  $('mode-speed').hidden = m !== 'speed';
}
setMode(mode);
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setMode(b.dataset.mode));

const num = (id) => ($(id).value.trim() === '' ? null : Number($(id).value));
/** Modèle du cycliste à partir des champs, ou message d'erreur. */
function readRider() {
  const riderKg = num('weight');
  const ftp = num('ftp');
  const intensity = num('intensity');
  if (!(riderKg >= 30 && riderKg <= 200)) return 'Poids du cycliste entre 30 et 200 kg.';
  if (!(ftp >= 50 && ftp <= 600)) return 'FTP entre 50 et 600 W.';
  if (!(intensity >= 30 && intensity <= 110)) return 'Allure entre 30 et 110 % de la FTP.';
  return riderModel({
    riderKg, ftp, intensity: intensity / 100, bikeKg: num('bike-kg') ?? 12, bike: $('bike').value,
    pauseMinPerH: num('pauses') ?? 0, cda: num('cda') ?? undefined, crr: num('crr') ?? undefined,
  });
}

function status(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = `status ${kind}`;
}

// --- Import GPX ----------------------------------------------------------------
async function loadFile(file) {
  if (!file) return;
  $('results').innerHTML = EMPTY;
  try {
    gpx = parseGpx(await file.text());
    track = buildTrack(gpx.points);
    if (track.lengthKm < 1) throw new Error('Parcours trop court.');
    gpx.name ||= file.name.replace(/\.gpx$/i, '');
    $('drop-text').textContent = file.name;
    $('drop').querySelector('.drop-ico').innerHTML = icon('file');
    $('drop').classList.add('loaded');
    renderRoute();
    $('go').disabled = false;
    status('');
  } catch (e) {
    gpx = null;
    track = null;
    $('route').innerHTML = '';
    $('go').disabled = true;
    status(e.message, 'err');
  }
}

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

function renderRoute() {
  $('route').innerHTML = `
    <p class="route-name">${esc(gpx.name)}</p>
    ${track.isLoop ? '<span class="pill ok">Boucle</span>' : `<span class="pill no">Pas une boucle · arrivée à ${r1(track.startEndGapKm)} km du départ</span>`}
    <ul class="facts">
      <li>Distance<b>${r1(track.lengthKm)} km</b></li>
      <li>Dénivelé +<b>${track.gainM == null ? '–' : `${r0(track.gainM)} m`}</b></li>
      <li>Dénivelé −<b>${track.lossM == null ? '–' : `${r0(track.lossM)} m`}</b></li>
    </ul>
    ${track.hasEle ? '' : '<p class="hint">Altitude absente du GPX : celle du modèle météo sera utilisée.</p>'}
    <div class="chart-box" style="margin-top:12px">${mapSvg(sampleTrack(track, stepFor(track.lengthKm, 200, 0.2)), null)}</div>`;
}

// --- Carte (projection simple, suffisante à l'échelle d'une sortie) -------------
const TAIL_COLORS = [[-12, 'var(--l4)'], [-SAME_WIND, 'var(--l3)'], [SAME_WIND, 'var(--faint)'], [12, 'var(--l2)'], [Infinity, 'var(--l1)']];
const tailColor = (x) => TAIL_COLORS.find(([max]) => x < max)[1];

function project(pts, W, H, pad) {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p.lon * k);
  const ys = pts.map((p) => p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((W - 2 * pad) / (x1 - x0 || 1e-9), (H - 2 * pad) / (y1 - y0 || 1e-9));
  const ox = (W - (x1 - x0) * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  return (p) => [ox + (p.lon * k - x0) * s, H - oy - (p.lat - y0) * s];
}

/** Trace ; si `rows` est donné (sens choisi), segments colorés selon le vent et flèches de sens. */
function mapSvg(pts, rows, wind) {
  const W = 600;
  const H = 360;
  const P = project(pts, W, H, 26);
  const line = pts.map((p) => P(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  let body = `<polyline class="route-shadow" points="${line}"/>`;
  if (rows) {
    for (let k = 1; k < rows.length; k++) {
      const [a, b] = [P(rows[k - 1]), P(rows[k])];
      body += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${tailColor((rows[k - 1].tail + rows[k].tail) / 2)}" stroke-width="5" stroke-linecap="round"/>`;
    }
    // Flèches de sens de marche à 10 %, 35 %, 60 %, 85 %.
    for (const f of [0.1, 0.35, 0.6, 0.85]) {
      const r = rows[Math.round(f * (rows.length - 1))];
      const [x, y] = P(r);
      body += `<path d="M-7,6 L0,-8 L7,6 Z" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${r0(r.heading)})" fill="var(--fg)" stroke="var(--surface)" stroke-width="1.5"/>`;
    }
  } else {
    body += `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const [sx, sy] = P(rows ? rows[0] : pts[0]);
  body += `<circle class="start" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" stroke="var(--surface)" stroke-width="2.5"/>`;
  body += `<text x="${(sx + 11).toFixed(1)}" y="${(sy + 4).toFixed(1)}" class="lbl">Départ</text>`;
  // Nord et vent dominant (flèche vers où souffle le vent).
  body += '<g transform="translate(572,28)"><path d="M0,-14 L5,4 L0,0 L-5,4 Z" fill="var(--muted)"/><text x="0" y="18" text-anchor="middle">N</text></g>';
  if (wind) {
    body += `<g transform="translate(36,36)"><circle r="24" fill="var(--surface)" stroke="var(--border)"/>
      <path d="M0,-16 L0,12 M-6,6 L0,13 L6,6" transform="rotate(${r0(wind.wd)})" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
      <text y="44" text-anchor="middle">${r0(wind.ws)} km/h</text></g>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tracé du parcours">${body}</svg>`;
}

// --- Profil : altitude + température au passage ---------------------------------
function profileSvg(rows) {
  const W = 600;
  const H = 260;
  const m = { l: 70, r: 50, t: 14, b: 30 };
  const L = rows[rows.length - 1].km;
  const eles = rows.map((r) => r.ele ?? 0);
  const temps = rows.flatMap((r) => [r.temp, r.felt]);
  let [e0, e1] = [Math.min(...eles), Math.max(...eles)];
  if (e1 - e0 < 100) { e0 -= 50; e1 += 50; }
  let [t0, t1] = [Math.floor(Math.min(...temps)) - 1, Math.ceil(Math.max(...temps)) + 1];
  if (t1 - t0 < 6) { t0 -= 2; t1 += 2; }
  const X = (km) => m.l + (km / L) * (W - m.l - m.r);
  const YE = (e) => H - m.b - ((e - e0) / (e1 - e0)) * (H - m.t - m.b);
  const YT = (t) => H - m.b - ((t - t0) / (t1 - t0)) * (H - m.t - m.b);
  const path = (f) => rows.map((r, k) => `${k ? 'L' : 'M'}${X(r.km).toFixed(1)},${f(r).toFixed(1)}`).join('');
  let g = '';
  // Graduations
  const stepKm = [5, 10, 20, 25, 50, 100, 200].find((s) => L / s <= 8) ?? 500;
  for (let km = 0; km <= L; km += stepKm) g += `<text x="${X(km).toFixed(1)}" y="${H - 8}" text-anchor="middle">${km}</text>`;
  g += ``;
  for (const e of [e0, (e0 + e1) / 2, e1]) g += `<text x="${m.l - 6}" y="${(YE(e) + 4).toFixed(1)}" text-anchor="end">${r0(e)} m</text>`;
  const tStep = t1 - t0 > 20 ? 10 : 5;
  for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) {
    g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${YT(t).toFixed(1)}" y2="${YT(t).toFixed(1)}" stroke-dasharray="2 4"/>`;
    g += `<text x="${W - m.r + 4}" y="${(YT(t) + 4).toFixed(1)}" fill="var(--hot)">${t}°</text>`;
  }
  g += `<path class="ele" d="${path((r) => YE(r.ele ?? 0))}L${X(L).toFixed(1)},${H - m.b}L${m.l},${H - m.b}Z"/>`;
  g += `<path class="t-felt" d="${path((r) => YT(r.felt))}"/>`;
  g += `<path class="t-air" d="${path((r) => YT(r.temp))}"/>`;
  return `<svg class="chart" id="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Altitude et température le long du parcours">
    ${g}<line class="cursor" id="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/></svg>`;
}

function bindProfile(rows) {
  const svg = $('profile');
  const L = rows[rows.length - 1].km;
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 600;
    const km = ((x - 70) / (600 - 120)) * L;
    const r = rows.reduce((b, q) => (Math.abs(q.km - km) < Math.abs(b.km - km) ? q : b));
    const cx = 70 + (r.km / L) * (600 - 120);
    const cur = $('cursor');
    cur.setAttribute('x1', cx);
    cur.setAttribute('x2', cx);
    cur.setAttribute('visibility', 'visible');
    $('readout').innerHTML = `<b>${where(r)}</b> — ${deg(r.temp)}, ressenti ${deg(r.felt)} · vent ${r0(r.ws)} km/h du ${compass(r.wd)}, `
      + `<span class="${tailClass(r.tail)}">${tailWord(r.tail)} (${signed(r.tail)})</span>${r.pop >= 20 ? ` · pluie ${r0(r.pop)} %` : ''}`;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
}

// --- Analyse ---------------------------------------------------------------------
$('go').addEventListener('click', run);

// Durée sans vent (pour savoir sur quelle période demander la météo).
function calmDuration(fine, startMs, rider) {
  const flat = (x) => [x, x];
  const calm = { times: [startMs - 3600e3, startMs + 60 * 86400e3], temp: flat(15), app: flat(15), ws: flat(0), wd: flat(0), gust: flat(0), pop: flat(0), rain: flat(0) };
  const { rows } = powerTimes(fine, fine.map(() => calm), startMs, rider, fine);
  return rows[rows.length - 1].time - startMs;
}

async function run() {
  const startMs = new Date($('start').value).getTime();
  if (!Number.isFinite(startMs)) return status('Indiquer la date et l\'heure de départ.', 'err');
  let pace;
  let durationMs;
  let fine = null;
  if (mode === 'speed') {
    pace = Number($('speed').value);
    if (!(pace >= 5 && pace <= 60)) return status('Vitesse moyenne entre 5 et 60 km/h.', 'err');
    durationMs = (track.lengthKm / pace) * 3600e3;
  } else {
    pace = readRider();
    if (typeof pace === 'string') return status(pace, 'err');
    fine = smoothEle(sampleTrack(track, Math.max(0.1, track.lengthKm / 4000)));
    // Marge : le vent de face peut rallonger la sortie.
    durationMs = calmDuration(fine, startMs, pace) * 1.3;
  }
  multiDay = new Date(startMs).toDateString() !== new Date(startMs + durationMs).toDateString();

  $('go').disabled = true;
  $('go').classList.add('busy');
  status('Prévisions en cours de téléchargement…');
  try {
    const fwd = sampleTrack(track, stepFor(track.lengthKm));
    const series = await fetchForecast(fwd, startMs, startMs + durationMs);
    // Sans altitude dans le GPX, on prend celle du modèle (pour le profil et les pentes).
    if (!track.hasEle) {
      fwd.forEach((s, k) => { s.ele = series[k].elevation; });
      if (fine) {
        const L = track.lengthKm;
        fine.forEach((f) => {
          const x = (f.km / L) * (fwd.length - 1);
          const i = Math.min(fwd.length - 2, Math.floor(x));
          f.ele = fwd[i].ele + (fwd[i + 1].ele - fwd[i].ele) * (x - i);
        });
      }
    }
    const rev = reverseSamples(fwd);
    const a = analyseDirection(fwd, series, startMs, pace, fine ?? undefined);
    const b = analyseDirection(rev, [...series].reverse(), startMs, pace, fine ? reverseSamples(fine) : undefined);
    render({ a, b, cmp: compareDirections(a, b) });
    status('');
  } catch (e) {
    status(e instanceof TypeError ? 'Pas de connexion à Open-Meteo : réessayer avec du réseau.' : e.message, 'err');
  } finally {
    $('go').disabled = false;
    $('go').classList.remove('busy');
  }
}

const hm = (s) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

function render({ a, b, cmp }) {
  const best = cmp.best === 'forward' ? a : b;
  const other = cmp.best === 'forward' ? b : a;
  const reverse = cmp.best === 'reverse';
  const first = best.rows[Math.min(best.rows.length - 1, 2)];
  const cls = !cmp.clear ? 'meh' : best.tailEnd >= SAME_WIND ? 'good' : 'meh';
  const mid = best.rows[Math.floor(best.rows.length / 2)];

  const title = !cmp.clear
    ? 'Les deux sens se valent pour la fin'
    : reverse ? 'Fais la boucle dans le sens inverse du GPX' : 'Garde le sens du GPX';
  const why = !cmp.clear
    ? `Moins de ${r1(SAME_WIND)} km/h d'écart sur le dernier tiers. Sur l'ensemble, ${reverse ? 'le sens inverse' : 'le sens du GPX'} est un peu plus favorable.`
    : `Sur le dernier tiers : vent <b class="${tailClass(best.tailEnd)}">${tailWord(best.tailEnd)} (${signed(best.tailEnd)})</b>, contre <span class="${tailClass(other.tailEnd)}">${signed(other.tailEnd)}</span> dans l'autre sens.`;

  const c = clothing(best);
  const extra = c.extra.length
    ? `<h3>À ajouter pour le moment le plus froid · ${deg(best.feltMin.felt)} ressentis</h3>
       <p class="where-line">${where(best.feltMin)}</p>
       <ul class="outfit">${c.extra.map((i) => `<li class="add">${esc(i)}</li>`).join('')}</ul>`
    : '';
  const startTip = c.start !== c.warm
    ? `<p class="advice">Au départ (<b>${deg(best.rows[0].felt)}</b> ressentis) : partir avec la tenue « ${c.start.label} », puis enlever des couches.</p>`
    : '';

  const dirRow = (r, label, isBest) => `<tr class="${isBest ? 'best' : ''}"><td>${label}</td>
    <td class="${tailClass(r.tailStart)}">${signed(r.tailStart)}</td>
    <td class="${tailClass(r.tailEnd)}">${signed(r.tailEnd)}</td>
    <td class="${tailClass(r.tailAll)}">${signed(r.tailAll)}</td>
    <td>${hour(r.endMs)}</td></tr>`;

  const tableEvery = Math.max(1, Math.round(best.rows.length / 16));
  const pointsRows = best.rows.filter((_, k) => k % tableEvery === 0 || k === best.rows.length - 1).map((r) => `<tr>
    <td>${r0(r.km)}</td><td>${hour(r.time)}</td><td>${r.ele == null ? '–' : r0(r.ele)}</td>
    <td>${deg(r.temp)}</td><td>${deg(r.felt)}</td>
    <td>${r0(r.ws)} ${compassShort(r.wd)}</td>
    <td class="${tailClass(r.tail)}">${signed(r.tail)}</td><td>${r0(r.pop)} %</td></tr>`).join('');

  const total = (best.endMs - best.startMs) / 1000;
  $('results').innerHTML = `
    <section class="card verdict-card ${cls}">
      <p class="eyebrow">Sens de la boucle</p>
      <p class="verdict">${title}</p>
      <p class="verdict-sub">${why}</p>
      <div class="kpis">
        <div class="kpi"><div class="k">Vent, dernier tiers</div><div class="v ${tailClass(best.tailEnd)}">${signed(best.tailEnd)}</div><div class="s">${tailWord(best.tailEnd)}</div></div>
        <div class="kpi"><div class="k">Départ vers</div><div class="v">${compassShort(first.heading)}</div><div class="s">${towards(first.heading)}</div></div>
        <div class="kpi"><div class="k">Arrivée prévue</div><div class="v">${hour(best.endMs)}</div><div class="s">${hm(total)} au total</div></div>
        <div class="kpi"><div class="k">${best.avgWatts ? 'Sur le vélo' : 'Vitesse moyenne'}</div><div class="v">${best.avgWatts ? hm(best.movingS) : `${r1(best.lengthKm / (total / 3600))} km/h`}</div><div class="s">${best.avgWatts ? `${r0(best.avgWatts)} W de moyenne` : 'pauses comprises'}</div></div>
      </div>
      ${track.isLoop ? '' : `<p class="notice">${icon('alert')}<span>Ce parcours n'est pas une boucle : le sens inverse part de l'autre extrémité.</span></p>`}
      <div class="two">
        <div>
          <h3 style="margin-top:0">Vent le long du parcours</h3>
          <div class="chart-box">${mapSvg(best.rows, best.rows, mid)}</div>
          <div class="keys">
            <span><i style="background:var(--l1)"></i>Dans le dos</span>
            <span><i style="background:var(--faint)"></i>Travers ou faible</span>
            <span><i style="background:var(--l4)"></i>De face</span>
            <span>▲ Sens de marche</span>
          </div>
        </div>
        <div>
          <h3 style="margin-top:0">Comparaison des deux sens</h3>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Vent moyen</th><th>1er tiers</th><th>Dernier tiers</th><th>Total</th><th>Arrivée</th></tr></thead>
            <tbody>${dirRow(a, 'Sens du GPX', !reverse)}${dirRow(b, 'Sens inverse', reverse)}</tbody>
          </table></div>
          ${reverse ? `<button id="dl" class="secondary" type="button">${icon('download')}Télécharger le GPX dans ce sens</button>` : ''}
        </div>
      </div>
    </section>

    <section class="card">
      ${head('thermo', 'Températures au passage')}
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="k">Minimum</div><div class="v cold">${deg(best.tempMin.temp)}</div><div class="s">${where(best.tempMin)}</div></div>
        <div class="kpi"><div class="k">Maximum</div><div class="v hot">${deg(best.tempMax.temp)}</div><div class="s">${where(best.tempMax)}</div></div>
        <div class="kpi"><div class="k">Ressenti minimum</div><div class="v cold">${deg(best.feltMin.felt)}</div><div class="s">vitesse et vent relatif</div></div>
        <div class="kpi"><div class="k">Risque de pluie</div><div class="v">${r0(best.popMax)} %</div><div class="s">rafales ${r0(best.gustMax.gust)} km/h</div></div>
      </div>
      <h3>Altitude et température</h3>
      <div class="chart-box">${profileSvg(best.rows)}</div>
      <div class="keys">
        <span><i style="background:var(--hot)"></i>Température de l'air</span>
        <span><i style="background:var(--cold)"></i>Ressenti à vélo</span>
        <span><i style="background:var(--ele)"></i>Altitude</span>
      </div>
      <p class="readout" id="readout">Survoler ou toucher le profil pour le détail d'un point.</p>
      <details><summary>Détail point par point</summary>
        <div class="tbl-wrap"><table>
          <thead><tr><th>km</th><th>Heure</th><th>Alt.</th><th>Air</th><th>Ressenti</th><th>Vent</th><th>Axe</th><th>Pluie</th></tr></thead>
          <tbody>${pointsRows}</tbody>
        </table></div>
      </details>
    </section>

    <section class="card">
      ${head('shirt', 'Tenue conseillée')}
      <h3 style="margin-top:0">Tenue de base · ${deg(best.feltMax.felt)} au plus chaud</h3>
      <ul class="outfit">${c.warm.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      ${extra}
      ${startTip}
      ${c.layers ? '<p class="advice">Écart de température important : privilégier des couches faciles à enlever et à ranger (manchettes, jambières, gilet).</p>' : ''}
      ${c.rain ? `<p class="notice info">${icon('rain')}<span>${esc(c.rain)}</span></p>` : ''}
    </section>`;

  bindProfile(best.rows);
  $('dl')?.addEventListener('click', downloadReversed);
  $('results').firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadReversed() {
  const name = `${gpx.name} (sens inverse)`;
  const blob = new Blob([writeGpx(name, [...gpx.points].reverse())], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '-')}.gpx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
