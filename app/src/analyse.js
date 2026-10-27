// Analyse météo d'un parcours : vent de face / de dos, températures au passage, tenue.
import { passageTimes } from './geo.js';
import { weatherAt } from './openmeteo.js';

const rad = (d) => (d * Math.PI) / 180;

/**
 * Composante du vent dans l'axe de la marche (km/h) : > 0 vent dans le dos, < 0 de face.
 * `windFrom` est la direction météo (d'où vient le vent), `heading` le cap du cycliste.
 */
export const tailwind = (ws, windFrom, heading) => -ws * Math.cos(rad(windFrom - heading));

/** Part du vent de 10 m qui atteint le cycliste (frottement au sol, haies, relief). */
export const RIDER_WIND = 0.7;

/**
 * Température ressentie par le cycliste : refroidissement éolien (formule
 * Environnement Canada / NWS) avec la vitesse de l'air relative = vitesse du vélo
 * + vent de face. Au-dessus de 10 °C, on garde la température de l'air.
 */
export function feltTemp(temp, airKmh) {
  if (temp == null) return null;
  if (temp > 10 || airKmh < 4.8) return temp;
  const v = airKmh ** 0.16;
  return Math.min(temp, 13.12 + 0.6215 * temp - 11.37 * v + 0.3965 * temp * v);
}

/** Moyenne pondérée par la distance d'une valeur sur [fromKm, toKm]. */
function meanOver(rows, key, fromKm, toKm) {
  let s = 0;
  let w = 0;
  for (let k = 1; k < rows.length; k++) {
    const a = Math.max(fromKm, rows[k - 1].km);
    const b = Math.min(toKm, rows[k].km);
    if (b <= a) continue;
    s += ((rows[k - 1][key] + rows[k][key]) / 2) * (b - a);
    w += b - a;
  }
  return w ? s / w : rows.length ? rows[0][key] : 0;
}

const extreme = (rows, key, cmp) => rows.reduce((best, r) => (r[key] != null && (best == null || cmp(r[key], best[key])) ? r : best), null);

/**
 * Une façon de parcourir la trace. `samples` : points du parcours dans l'ordre de marche
 * ({ km, lat, lon, ele, heading }), `series` : prévision de chacun (même ordre).
 */
export function analyseDirection(samples, series, startMs, avgKmh) {
  const timed = passageTimes(samples, startMs, avgKmh);
  const rows = timed.map((s, k) => {
    const w = weatherAt(series[k], s.time);
    if (!w) return { ...s, missing: true };
    const tail = tailwind(w.ws, w.wd, s.heading);
    const air = Math.max(0, s.speed - RIDER_WIND * tail);
    return { ...s, ...w, tail, cross: Math.abs(w.ws * Math.sin(rad(w.wd - s.heading))), felt: feltTemp(w.temp, air) };
  });
  if (rows.some((r) => r.missing)) {
    throw new Error('Pas de prévision pour toute la sortie : choisir une date dans les 16 prochains jours.');
  }
  const L = rows[rows.length - 1].km;
  return {
    rows,
    lengthKm: L,
    startMs,
    endMs: rows[rows.length - 1].time,
    tailStart: meanOver(rows, 'tail', 0, L / 3),
    tailEnd: meanOver(rows, 'tail', (2 * L) / 3, L),
    tailAll: meanOver(rows, 'tail', 0, L),
    tempMin: extreme(rows, 'temp', (a, b) => a < b),
    tempMax: extreme(rows, 'temp', (a, b) => a > b),
    feltMin: extreme(rows, 'felt', (a, b) => a < b),
    feltMax: extreme(rows, 'felt', (a, b) => a > b),
    gustMax: extreme(rows, 'gust', (a, b) => a > b),
    popMax: Math.max(...rows.map((r) => r.pop ?? 0)),
    rainMm: rows.reduce((s, r, k) => (k ? s + (r.rain ?? 0) * ((r.time - rows[k - 1].time) / 3600e3) : s), 0),
  };
}

/**
 * Points du sens inverse à partir de ceux du sens GPX : mêmes positions (donc mêmes
 * prévisions), parcourues dans l'autre ordre, cap retourné.
 */
export function reverseSamples(samples) {
  const L = samples[samples.length - 1].km;
  return [...samples].reverse().map((s) => ({ ...s, km: L - s.km, heading: (s.heading + 180) % 360 }));
}

/** Seuil (km/h) en dessous duquel les deux sens se valent pour le vent de fin. */
export const SAME_WIND = 1.5;

/**
 * Compare les deux sens. Critère principal : vent moyen sur le dernier tiers.
 * Si c'est kif-kif, on départage sur l'ensemble du parcours.
 */
export function compareDirections(forward, reverse) {
  const d = reverse.tailEnd - forward.tailEnd;
  if (Math.abs(d) >= SAME_WIND) {
    return { best: d > 0 ? 'reverse' : 'forward', clear: true, gain: Math.abs(d) };
  }
  return { best: reverse.tailAll > forward.tailAll ? 'reverse' : 'forward', clear: false, gain: Math.abs(d) };
}

// --- Tenue -------------------------------------------------------------------
// Paliers de température ressentie (°C). Chaque palier donne une tenue complète.
export const OUTFITS = [
  { min: 22, label: 'chaud', items: ['Maillot manches courtes', 'Cuissard court', 'Mitaines'] },
  { min: 17, label: 'doux', items: ['Maillot manches courtes', 'Cuissard court', 'Mitaines', 'Gilet coupe-vent (en poche)'] },
  { min: 12, label: 'frais', items: ['Maillot manches courtes', 'Manchettes', 'Cuissard court', 'Genouillères ou jambières', 'Mitaines', 'Gilet coupe-vent'] },
  { min: 7, label: 'froid', items: ['Sous-maillot technique', 'Maillot manches longues', 'Veste coupe-vent', 'Collant long ou jambières', 'Gants longs fins', 'Tour de cou'] },
  { min: 2, label: 'très froid', items: ['Sous-maillot chaud', 'Maillot manches longues thermique', 'Veste hiver coupe-vent', 'Collant long thermique', 'Gants d\'hiver', 'Couvre-chaussures', 'Tour de cou', 'Bandeau ou bonnet fin sous le casque'] },
  { min: -Infinity, label: 'glacial', items: ['Sous-maillot laine', 'Maillot manches longues thermique', 'Veste hiver coupe-vent', 'Collant long thermique', 'Gants grand froid + sous-gants', 'Couvre-chaussures néoprène', 'Chaussettes laine', 'Cagoule ou bonnet sous le casque'] },
];

export const outfitFor = (t) => OUTFITS.find((o) => t >= o.min);

/**
 * Conseils d'habillement : tenue pour la partie la plus chaude, ce qu'il faut en plus
 * (à porter au départ ou à emporter) pour la partie la plus froide, pluie.
 */
export function clothing(report) {
  const warm = outfitFor(report.feltMax.felt);
  const cold = outfitFor(report.feltMin.felt);
  const start = outfitFor(report.rows[0].felt);
  const extra = cold.items.filter((i) => !warm.items.includes(i));
  const rain = report.popMax >= 50 || report.rainMm >= 1
    ? 'Veste imperméable (pluie probable)'
    : report.popMax >= 25 ? 'Veste de pluie légère en poche (averses possibles)' : null;
  return {
    warm,
    cold,
    start,
    extra,
    rain,
    // Gros écart : prévoir des couches faciles à enlever (manchettes, jambières, gilet).
    layers: report.feltMax.felt - report.feltMin.felt >= 8,
  };
}
