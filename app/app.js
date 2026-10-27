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

// --- État ----------------------------------------------------------------------
let gpx = null;
let track = null;

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
  $('results').innerHTML = '';
  try {
    gpx = parseGpx(await file.text());
    track = buildTrack(gpx.points);
    if (track.lengthKm < 1) throw new Error('Parcours trop court.');
    gpx.name ||= file.name.replace(/\.gpx$/i, '');
    $('drop-text').textContent = `📄 ${file.name}`;
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
    <ul class="facts">
      <li><b>${esc(gpx.name)}</b></li>
      <li><b>${r1(track.lengthKm)}</b> km</li>
      ${track.gainM == null ? '<li>altitude absente du GPX : celle du modèle météo sera utilisée</li>' : `<li><b>${r0(track.gainM)}</b> m D+</li>`}
      <li>${track.isLoop ? '<span class="pill ok">Boucle</span>' : `<span class="pill no">Pas une boucle (arrivée à ${r1(track.startEndGapKm)} km du départ)</span>`}</li>
    </ul>
    ${mapSvg(sampleTrack(track, stepFor(track.lengthKm, 200, 0.2)), null)}`;
}

// --- Carte (projection simple, suffisante à l'échelle d'une sortie) -------------
const TAIL_COLORS = [[-12, 'var(--l4)'], [-SAME_WIND, 'var(--l3)'], [SAME_WIND, 'var(--muted)'], [12, 'var(--l2)'], [Infinity, 'var(--l1)']];
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
      body += `<path d="M-7,6 L0,-8 L7,6 Z" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${r0(r.heading)})" fill="var(--fg)" stroke="var(--card)" stroke-width="1.5"/>`;
    }
  } else {
    body += `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const [sx, sy] = P(rows ? rows[0] : pts[0]);
  body += `<circle class="start" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" stroke="var(--card)" stroke-width="2.5"/>`;
  body += `<text x="${(sx + 11).toFixed(1)}" y="${(sy + 4).toFixed(1)}" class="lbl">Départ</text>`;
  // Nord et vent dominant (flèche vers où souffle le vent).
  body += '<g transform="translate(572,28)"><path d="M0,-14 L5,4 L0,0 L-5,4 Z" fill="var(--muted)"/><text x="0" y="18" text-anchor="middle">N</text></g>';
  if (wind) {
    body += `<g transform="translate(36,36)"><circle r="24" fill="var(--card-2)" stroke="var(--border)"/>
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
    g += `<text x="${W - m.r + 4}" y="${(YT(t) + 4).toFixed(1)}" fill="var(--accent-2)">${t}°</text>`;
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
    ? `<h3>En plus pour le moment le plus froid — ${deg(best.feltMin.felt)} ressentis</h3>
       <p class="readout">${where(best.feltMin)}</p>
       <ul class="outfit">${c.extra.map((i) => `<li class="add">+ ${esc(i)}</li>`).join('')}</ul>`
    : '';
  const startTip = c.start !== c.warm
    ? `<p>Au départ (${deg(best.rows[0].felt)} ressentis) : partir avec la tenue « ${c.start.label} », puis enlever des couches.</p>`
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

  $('results').innerHTML = `
    <section class="card ${cls}">
      <h2>🧭 Sens de la boucle</h2>
      <p class="verdict">${title}</p>
      <p class="verdict-sub">${why}</p>
      <p>Départ vers <b>${towards(first.heading)}</b>, arrivée prévue à <b>${hour(best.endMs)}</b>
        (${hm((best.endMs - best.startMs) / 1000)}${best.avgWatts ? `, dont ${hm(best.movingS)} sur le vélo à ${r0(best.avgWatts)} W de moyenne` : ''}).</p>
      ${track.isLoop ? '' : '<p class="status err">Ce parcours n\'est pas une boucle : le sens inverse part de l\'autre extrémité.</p>'}
      ${mapSvg(best.rows, best.rows, mid)}
      <div class="keys">
        <span><i style="background:var(--l1)"></i>vent dans le dos</span>
        <span><i style="background:var(--muted)"></i>travers / faible</span>
        <span><i style="background:var(--l4)"></i>vent de face</span>
        <span>▲ sens de marche · flèche ronde : vent à mi-parcours</span>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Vent moyen</th><th>1er tiers</th><th>Dernier tiers</th><th>Total</th><th>Arrivée</th></tr></thead>
        <tbody>${dirRow(a, 'Sens du GPX', !reverse)}${dirRow(b, 'Sens inverse', reverse)}</tbody>
      </table></div>
      ${reverse ? '<button id="dl" class="secondary" type="button">⬇️ Télécharger le GPX dans ce sens</button>' : ''}
    </section>

    <section class="card">
      <h2>🌡️ Températures au passage</h2>
      <div class="stats">
        <div class="stat"><div class="k">Mini</div><div class="big cold">${deg(best.tempMin.temp)}</div><div class="where">${where(best.tempMin)}</div></div>
        <div class="stat"><div class="k">Maxi</div><div class="big hot">${deg(best.tempMax.temp)}</div><div class="where">${where(best.tempMax)}</div></div>
        <div class="stat"><div class="k">Ressenti mini</div><div class="big cold">${deg(best.feltMin.felt)}</div><div class="where">vitesse + vent relatif</div></div>
        <div class="stat"><div class="k">Pluie / rafales</div><div class="big">${r0(best.popMax)} %</div><div class="where">rafales jusqu'à ${r0(best.gustMax.gust)} km/h</div></div>
      </div>
      ${profileSvg(best.rows)}
      <div class="keys">
        <span><i style="background:var(--accent-2)"></i>température de l'air</span>
        <span><i style="background:#2f6fd6"></i>ressenti à vélo</span>
        <span><i style="background:color-mix(in srgb, var(--muted) 40%, transparent)"></i>altitude</span>
      </div>
      <p class="readout" id="readout">Toucher le profil pour voir le détail d'un point.</p>
      <details><summary>Détail point par point</summary>
        <div class="tbl-wrap"><table>
          <thead><tr><th>km</th><th>Heure</th><th>Alt.</th><th>Air</th><th>Ressenti</th><th>Vent</th><th>Axe</th><th>Pluie</th></tr></thead>
          <tbody>${pointsRows}</tbody>
        </table></div>
      </details>
    </section>

    <section class="card">
      <h2>🧥 Comment s'habiller</h2>
      <h3>Tenue de base — ${deg(best.feltMax.felt)} au plus chaud (${c.warm.label})</h3>
      <ul class="outfit">${c.warm.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      ${extra}
      ${startTip}
      ${c.layers ? '<p>Gros écart de température sur la sortie : privilégier des couches faciles à enlever et à ranger (manchettes, jambières, gilet).</p>' : ''}
      ${c.rain ? `<p>☔ <b>${esc(c.rain)}</b></p>` : ''}
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
