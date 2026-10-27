import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGpx, buildTrack, sampleTrack, smoothEle, powerNeeded, speedFor, riderPower, riderModel, cdaFor, airDensity,
  calibrate, powerTimes, analyseDirection, reverseSamples, BIKES, strava,
} from '../app/src/index.js';

const kmh = (ms) => ms * 3.6;
const base = { mass: 85, cda: 0.32, crr: 0.0045, rho: 1.2 };

test('physique : ordres de grandeur connus', () => {
  // 200 W sur le plat sans vent : ~32 km/h ; 250 W à 8 % pour 85 kg : ~12 km/h.
  const flat = kmh(speedFor(200, base));
  assert.ok(flat > 30 && flat < 35, String(flat));
  const climb = kmh(speedFor(250, { ...base, grade: 0.08 }));
  assert.ok(climb > 10 && climb < 14, String(climb));
  // Aller-retour : la vitesse retrouvée donne bien la puissance demandée.
  const v = speedFor(180, { ...base, grade: 0.03, headwind: 3 });
  assert.ok(Math.abs(powerNeeded(v, { ...base, grade: 0.03, headwind: 3 }) - 180) < 0.01);
});

test('physique : vent, poids, descente bornée, air plus léger en altitude', () => {
  assert.ok(speedFor(200, { ...base, headwind: 5 }) < speedFor(200, base));
  assert.ok(speedFor(200, { ...base, headwind: -5 }) > speedFor(200, base));
  assert.ok(speedFor(250, { ...base, mass: 100, grade: 0.07 }) < speedFor(250, { ...base, grade: 0.07 }));
  assert.equal(Math.round(kmh(speedFor(0, { ...base, grade: -0.1 }))), 50);
  assert.ok(airDensity(2000, 15) < airDensity(0, 15) * 0.82);
  assert.ok(airDensity(0, 0) > airDensity(0, 30));
});

test('puissance selon la pente : on appuie en montée, on relâche en descente', () => {
  assert.equal(riderPower(150, 0), 150);
  assert.equal(riderPower(150, 0.08), 195);
  assert.equal(riderPower(150, -0.01), 150);
  assert.equal(Math.round(riderPower(150, -0.04)), 75);
  assert.equal(riderPower(150, -0.08), 0);
});

test('paramètres du cycliste : gabarit, vélo, pauses', () => {
  const m = riderModel({ riderKg: 75, ftp: 250, intensity: 0.7, bike: 'gravel', pauseMinPerH: 6 });
  assert.equal(m.mass, 87);
  assert.equal(m.flatWatts, 175);
  assert.equal(m.cda, BIKES.gravel.cda);
  assert.equal(m.crr, BIKES.gravel.crr);
  assert.equal(m.pauseFactor, 1.1);
  assert.ok(cdaFor(0.34, 95) > 0.34);
  assert.equal(riderModel({ riderKg: 75, ftp: 250, cda: 0.3 }).cda, 0.3);
});

test('calage Strava : CdA, puissance sur le plat, pauses', () => {
  const ride = (o) => ({ sport_type: 'Ride', device_watts: true, distance: 40000, total_elevation_gain: 40, moving_time: 6000, elapsed_time: 6300, ...o });
  // Sortie construite avec CdA 0,40 : 160 W → vitesse du modèle.
  const v = speedFor(160, { mass: 87, cda: 0.4, crr: BIKES.route.crr, rho: 1.2 });
  const acts = [
    ride({ average_watts: 160, average_speed: v }),
    ride({ average_watts: 160, average_speed: v, elapsed_time: 6600 }),
    ride({ average_watts: 220, average_speed: 6, total_elevation_gain: 900 }), // vallonnée : pas pour le CdA
    ride({ average_watts: 150, average_speed: v, trainer: true }), // home-trainer : ignorée
    ride({ elapsed_time: 6000 * 50, average_watts: 0, device_watts: false }), // montre oubliée : ignorée
    { sport_type: 'Run', distance: 10000, moving_time: 3000, elapsed_time: 3000 },
  ];
  const c = calibrate(acts, { riderKg: 75, ftp: 200 });
  assert.equal(c.flatRides, 2);
  assert.ok(Math.abs(c.cda - 0.4) < 0.001, String(c.cda));
  assert.equal(c.flatWatts, 160);
  assert.equal(c.intensity, 0.8);
  assert.equal(c.pauseRides, 3);
  assert.equal(c.pauseMinPerH, 3);
  assert.equal(calibrate([], { riderKg: 75, ftp: 200 }).cda, null);
});

// Aller-retour plat de 20 km vers le nord puis retour : vent du nord.
function allerRetour() {
  const pts = [];
  for (let k = 0; k <= 100; k++) pts.push({ lat: 45 + (k / 100) * (10 / 111.2), lon: 6, ele: 200 });
  for (let k = 99; k >= 0; k--) pts.push({ lat: 45 + (k / 100) * (10 / 111.2), lon: 6.0001, ele: 200 });
  return buildTrack(pts);
}
function series(samples, { ws = 20, wd = 0, temp = 15 } = {}) {
  const start = Date.UTC(2026, 9, 28);
  const times = Array.from({ length: 48 }, (_, h) => start + h * 3600e3);
  const c = (x) => times.map(() => x);
  return samples.map(() => ({ times, temp: c(temp), app: c(temp), ws: c(ws), wd: c(wd), gust: c(ws), pop: c(0), rain: c(0) }));
}

test('temps de passage : le vent de face ralentit, les pauses allongent', () => {
  const t = allerRetour();
  const s = sampleTrack(t, 1);
  const fine = smoothEle(sampleTrack(t, 0.1));
  const start = Date.UTC(2026, 9, 28, 8);
  const rider = riderModel({ riderKg: 75, ftp: 250, intensity: 0.7 });
  const calm = powerTimes(s, series(s, { ws: 0 }), start, rider, fine);
  const windy = powerTimes(s, series(s, { ws: 25 }), start, rider, fine);
  const mid = Math.round((s.length - 1) / 2);
  // Vent du nord : l'aller (vers le nord) est plus lent, le retour plus rapide.
  assert.ok(windy.rows[mid].time - start > calm.rows[mid].time - start);
  assert.ok(windy.rows[mid - 2].speed < calm.rows[mid - 2].speed);
  assert.ok(windy.rows[mid + 3].speed > calm.rows[mid + 3].speed);
  // Aller-retour avec vent : plus long qu'au calme (on perd plus face qu'on ne gagne dos).
  assert.ok(windy.movingS > calm.movingS);
  assert.ok(Math.abs(calm.avgWatts - 175) < 0.5);
  const paused = powerTimes(s, series(s, { ws: 0 }), start, { ...rider, pauseFactor: 1.1 }, fine);
  assert.ok(Math.abs((paused.rows.at(-1).time - start) / ((calm.rows.at(-1).time - start)) - 1.1) < 1e-6, String((paused.rows.at(-1).time - start) / (calm.rows.at(-1).time - start)));
  assert.equal(paused.movingS, calm.movingS);
});

test('analyse en mode puissance : sens inverse, heures et ressenti cohérents', () => {
  const g = parseGpx(`<gpx>${[[45, 6, 200], [45.05, 6, 600], [45.1, 6, 200], [45.1, 6.07, 200], [45, 6.07, 200], [45, 6, 200]]
    .map(([la, lo, z]) => `<trkpt lat="${la}" lon="${lo}"><ele>${z}</ele></trkpt>`).join('')}</gpx>`);
  const t = buildTrack(g.points);
  const s = sampleTrack(t, 1);
  const fine = smoothEle(sampleTrack(t, 0.1));
  const se = series(s, { ws: 15, wd: 90, temp: 5 });
  const start = Date.UTC(2026, 9, 28, 8);
  const rider = riderModel({ riderKg: 75, ftp: 250 });
  const a = analyseDirection(s, se, start, rider, fine);
  const b = analyseDirection(reverseSamples(s), [...se].reverse(), start, rider, reverseSamples(fine));
  assert.ok(a.movingS > 0 && a.avgWatts > 0);
  assert.ok(a.rows.every((r, k) => k === 0 || r.time > a.rows[k - 1].time));
  // La montée (km 0 à 5 dans le sens GPX) est plus lente que la descente.
  assert.ok(a.rows[3].speed < a.rows[8].speed);
  assert.ok(a.feltMin.felt < 5);
  assert.ok(b.endMs > start);
  assert.throws(() => analyseDirection(s, se, Date.UTC(2027, 0, 1), rider, fine), /16 prochains jours/);
});

test('Strava : adresse d\'autorisation et retour', () => {
  const u = new URL(strava.authorizeUrl(' 12345 ', 'https://exemple.github.io/Appli-vent/', 'x'));
  assert.equal(u.searchParams.get('client_id'), '12345');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://exemple.github.io/Appli-vent/');
  assert.match(u.searchParams.get('scope'), /profile:read_all/);
  assert.deepEqual(strava.readRedirect('?state=x&code=abc&scope=read,profile:read_all'), { code: 'abc', scope: 'read,profile:read_all', state: 'x' });
  assert.match(strava.readRedirect('?error=access_denied').error, /refusé/);
  assert.equal(strava.readRedirect('?foo=1'), null);
});

test('Strava : jetons, rafraîchissement, profil, sorties paginées', async () => {
  const calls = [];
  const fake = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === strava.TOKEN_URL) {
      const p = new URLSearchParams(opts.body);
      if (p.get('client_secret') !== 's3cret') return { ok: false, status: 400, json: async () => ({ message: 'Bad Request' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: `tok-${p.get('grant_type')}`, refresh_token: 'r2', expires_at: 2e9 }) };
    }
    if (url.endsWith('/athlete')) return { ok: true, status: 200, json: async () => ({ firstname: 'A', lastname: 'B', weight: 72.5, ftp: 240 }) };
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, status: 200, json: async () => Array.from({ length: page === 1 ? 100 : 30 }, (_, i) => ({ id: page * 1000 + i })) };
  };
  const creds = { clientId: '1', clientSecret: 's3cret' };
  const tok = await strava.exchangeCode(creds, 'abc', fake);
  assert.equal(tok.access_token, 'tok-authorization_code');
  await assert.rejects(strava.exchangeCode({ clientId: '1', clientSecret: 'faux' }, 'abc', fake), /secret client incorrect/);
  assert.equal(await strava.freshTokens(creds, tok, fake, 1e9), tok, 'encore valide : pas de requête');
  const ref = await strava.freshTokens(creds, { ...tok, expires_at: 1 }, fake, 1e9);
  assert.equal(ref.access_token, 'tok-refresh_token');
  assert.deepEqual(await strava.getAthlete('t', fake), { weight: 72.5, ftp: 240, name: 'A B' });
  assert.equal(calls.at(-1).opts.headers.authorization, 'Bearer t');
  assert.equal((await strava.getActivities('t', 150, fake)).length, 130);
});
