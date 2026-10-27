import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGpx, writeGpx, distanceKm, bearing, compass, buildTrack, sampleTrack, passageTimes, forecastUrl, parseForecast,
  fetchForecast, weatherAt, tailwind, feltTemp, analyseDirection, reverseSamples, compareDirections, clothing, outfitFor,
} from '../app/src/index.js';

// Boucle carrée d'environ 10 km de côté : nord, est, sud, ouest ; une bosse de 600 m au nord-est.
const DLAT = 10 / 111.2;
const DLON = 10 / (111.2 * Math.cos((45 * Math.PI) / 180));
function squareGpx({ ele = true, attrsOrder = 'latlon' } = {}) {
  const corners = [[45, 6, 200], [45 + DLAT, 6, 400], [45 + DLAT, 6 + DLON, 800], [45, 6 + DLON, 300], [45, 6, 200]];
  const pts = [];
  for (let c = 0; c < 4; c++) {
    const [a, b] = [corners[c], corners[c + 1]];
    for (let k = 0; k < 20; k++) {
      const f = k / 20;
      pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
  }
  pts.push(corners[4]);
  const xml = pts.map(([la, lo, z]) => {
    const at = attrsOrder === 'latlon' ? `lat="${la}" lon="${lo}"` : `lon='${lo}' lat='${la}'`;
    return `<trkpt ${at}>${ele ? `<ele>${z}</ele>` : ''}<time>2026-01-01T00:00:00Z</time></trkpt>`;
  }).join('\n');
  return `<?xml version="1.0"?><gpx version="1.1"><metadata><name>Meta</name></metadata><trk><name>Boucle &amp; test</name><trkseg>${xml}</trkseg></trk></gpx>`;
}

// Prévision fictive : vent constant, température qui baisse de 6,5 °C par 1000 m.
function fakeSeries(samples, { wd = 0, ws = 20, t0 = 15, pop = 0 } = {}) {
  const start = Date.UTC(2026, 9, 28);
  const times = Array.from({ length: 72 }, (_, h) => start + h * 3600e3);
  return samples.map((s) => ({
    times,
    temp: times.map(() => t0 - (s.ele ?? 0) * 0.0065),
    app: times.map(() => t0 - (s.ele ?? 0) * 0.0065 - 3),
    ws: times.map(() => ws),
    wd: times.map(() => wd),
    gust: times.map(() => ws * 1.5),
    pop: times.map(() => pop),
    rain: times.map(() => 0),
  }));
}

test('GPX : trace, nom, altitude, attributs dans le désordre', () => {
  const g = parseGpx(squareGpx());
  assert.equal(g.name, 'Boucle & test');
  assert.equal(g.points.length, 81);
  assert.equal(g.points[0].ele, 200);
  const h = parseGpx(squareGpx({ ele: false, attrsOrder: 'lonlat' }));
  assert.equal(h.points[0].lat, 45);
  assert.equal(h.points[0].ele, null);
});

test('GPX : points de route et refus des fichiers invalides', () => {
  const g = parseGpx('<gpx><rte><rtept lat="45" lon="6"/><rtept lat="45.1" lon="6"/></rte></gpx>');
  assert.equal(g.points.length, 2);
  assert.throws(() => parseGpx('<kml/>'), /pas un GPX/);
  assert.throws(() => parseGpx('<gpx><trk></trk></gpx>'), /Aucune trace/);
});

test('GPX : écriture puis relecture', () => {
  const pts = [{ lat: 45, lon: 6, ele: 210 }, { lat: 45.01, lon: 6.01, ele: null }];
  const g = parseGpx(writeGpx('A < B', pts));
  assert.equal(g.name, 'A < B');
  assert.deepEqual(g.points, [{ lat: 45, lon: 6, ele: 210 }, { lat: 45.01, lon: 6.01, ele: null }]);
});

test('géométrie : distance, cap, points cardinaux', () => {
  assert.ok(Math.abs(distanceKm({ lat: 45, lon: 6 }, { lat: 45 + DLAT, lon: 6 }) - 10) < 0.05);
  assert.ok(Math.abs(bearing({ lat: 45, lon: 6 }, { lat: 46, lon: 6 })) < 0.01);
  assert.ok(Math.abs(bearing({ lat: 45, lon: 6 }, { lat: 45, lon: 7 }) - 90) < 1);
  assert.equal(compass(0), 'nord');
  assert.equal(compass(225), 'sud-ouest');
  assert.equal(compass(350), 'nord');
});

test('trace : longueur, D+, boucle détectée', () => {
  const t = buildTrack(parseGpx(squareGpx()).points);
  assert.ok(Math.abs(t.lengthKm - 40) < 0.3, String(t.lengthKm));
  assert.ok(Math.abs(t.gainM - 600) < 1);
  assert.ok(Math.abs(t.lossM - 600) < 1);
  assert.equal(t.isLoop, true);
  const aller = buildTrack(parseGpx(squareGpx()).points.slice(0, 40));
  assert.equal(aller.isLoop, false);
});

test('échantillons : caps locaux et horaires (plus lent en montée)', () => {
  const t = buildTrack(parseGpx(squareGpx()).points);
  const s = sampleTrack(t, 2);
  assert.equal(s.length, 21);
  assert.ok(Math.abs(s[2].heading) < 2 || Math.abs(s[2].heading - 360) < 2, 'nord');
  assert.ok(Math.abs(s[7].heading - 90) < 2, 'est');
  const start = Date.UTC(2026, 9, 28, 8);
  const p = passageTimes(s, start, 20);
  assert.ok(Math.abs(p[p.length - 1].time - start - (t.lengthKm / 20) * 3600e3) < 1000, 'durée = distance / vitesse');
  assert.ok(p[3].speed < 20 && p[17].speed > 20, 'montée lente, descente rapide');
});

test('Open-Meteo : URL multi-points avec altitude, lecture de la réponse', () => {
  const samples = [{ lat: 45.12345, lon: 6, ele: 812.4 }, { lat: 45.2, lon: 6.1, ele: 1500 }];
  const url = forecastUrl(samples, Date.UTC(2026, 9, 28, 8), Date.UTC(2026, 9, 28, 18));
  assert.match(url, /latitude=45\.1234,45\.2000/);
  assert.match(url, /elevation=812,1500/);
  assert.match(url, /start_date=2026-10-28&end_date=2026-10-28/);
  assert.doesNotMatch(forecastUrl([{ lat: 45, lon: 6, ele: null }], 0, 0), /elevation/);
  const one = { elevation: 800, hourly: { time: [0, 3600], temperature_2m: [1, 3], apparent_temperature: [0, 2], wind_speed_10m: [10, 10], wind_direction_10m: [350, 10], wind_gusts_10m: [20, 20], precipitation_probability: [0, 40], precipitation: [0, 0] } };
  const [s] = parseForecast(one);
  assert.equal(s.elevation, 800);
  const w = weatherAt(s, 1800e3);
  assert.equal(w.temp, 2);
  assert.ok(w.wd < 1 || w.wd > 359, 'vent interpolé en vecteur : nord, pas sud');
  assert.ok(Math.abs(w.ws - 10 * Math.cos(Math.PI / 18)) < 1e-9);
  assert.equal(w.pop, 40);
  assert.equal(weatherAt(s, 10 * 3600e3), null, 'hors de la prévision');
  assert.throws(() => parseForecast({ error: true, reason: 'Parameter invalid' }), /Parameter invalid/);
});

test('Open-Meteo : fetch injecté, erreur remontée', async () => {
  const ok = await fetchForecast([{ lat: 45, lon: 6, ele: 0 }], 0, 0, async () => ({ ok: true, json: async () => [{ hourly: { time: [0], temperature_2m: [5], apparent_temperature: [4], wind_speed_10m: [0], wind_direction_10m: [0], wind_gusts_10m: [0] } }] }));
  assert.equal(ok.length, 1);
  await assert.rejects(
    fetchForecast([{ lat: 45, lon: 6, ele: 0 }], 0, 0, async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: 'Date hors limites' }) })),
    /Date hors limites/,
  );
});

test('vent : composante dans le dos / de face', () => {
  assert.equal(Math.round(tailwind(20, 0, 180)), 20, 'vent du nord, je vais au sud : dans le dos');
  assert.equal(Math.round(tailwind(20, 0, 0)), -20, 'vent du nord, je vais au nord : de face');
  assert.equal(Math.round(tailwind(20, 270, 0)), 0, 'vent de travers');
});

test('température ressentie : refroidissement éolien sous 10 °C seulement', () => {
  assert.equal(feltTemp(15, 40), 15);
  assert.equal(feltTemp(5, 0), 5);
  const f = feltTemp(5, 30);
  assert.ok(f < 1 && f > -1, String(f));
  assert.ok(feltTemp(0, 40) < feltTemp(0, 20));
});

test('sens de la boucle : vent du nord → finir par la ligne droite vers le sud', () => {
  const t = buildTrack(parseGpx(squareGpx()).points);
  const fwd = sampleTrack(t, 1);
  const series = fakeSeries(fwd, { wd: 0 });
  const start = Date.UTC(2026, 9, 28, 8);
  const a = analyseDirection(fwd, series, start, 25);
  const rev = reverseSamples(fwd);
  const b = analyseDirection(rev, [...series].reverse(), start, 25);
  // Sens GPX : N, E, S, O → fin = O (travers). Sens inverse : E, N, O, S → fin = S (dans le dos).
  assert.ok(b.tailEnd > a.tailEnd + 5, `${a.tailEnd} / ${b.tailEnd}`);
  const c = compareDirections(a, b);
  assert.equal(c.best, 'reverse');
  assert.equal(c.clear, true);
  // Et l'inverse quand le vent vient de l'est.
  const se = fakeSeries(fwd, { wd: 90 });
  const a2 = analyseDirection(fwd, se, start, 25);
  const b2 = analyseDirection(rev, [...se].reverse(), start, 25);
  assert.equal(compareDirections(a2, b2).best, 'forward');
});

test('températures : la plus froide au sommet, tenue adaptée', () => {
  const t = buildTrack(parseGpx(squareGpx()).points);
  const s = sampleTrack(t, 1);
  const start = Date.UTC(2026, 9, 28, 8);
  const r = analyseDirection(s, fakeSeries(s, { t0: 12, ws: 10, pop: 60 }), start, 25);
  assert.equal(Math.round(r.tempMin.ele), 800);
  assert.ok(Math.abs(r.tempMin.temp - (12 - r.tempMin.ele * 0.0065)) < 1e-9);
  assert.equal(Math.round(r.tempMax.ele), 200);
  assert.ok(r.feltMin.felt < r.tempMin.temp, 'le vent relatif refroidit');
  const c = clothing(r);
  assert.equal(c.warm, outfitFor(r.feltMax.felt));
  assert.ok(c.extra.length > 0);
  assert.match(c.rain, /imperméable/);
});

test('prévision trop courte : message clair', () => {
  const t = buildTrack(parseGpx(squareGpx()).points);
  const s = sampleTrack(t, 2);
  assert.throws(() => analyseDirection(s, fakeSeries(s), Date.UTC(2027, 0, 1), 25), /16 prochains jours/);
});
