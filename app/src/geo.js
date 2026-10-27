// Géométrie du parcours : distances, caps, échantillonnage, horaires de passage.

const R = 6371.0088; // rayon terrestre moyen, km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distance (km) entre deux points { lat, lon }. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap (degrés, 0 = nord, 90 = est) pour aller de a vers b. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
/** « nord-est » pour 45°. */
export const compass = (d) => POINTS[Math.round((((d % 360) + 360) % 360) / 45) % 8];
export const compassShort = (d) => SHORT[Math.round((((d % 360) + 360) % 360) / 45) % 8];

/**
 * Trace enrichie : distance cumulée (km), altitude lissée, dénivelés.
 * Les points sans altitude reprennent celle du voisin connu.
 */
export function buildTrack(points) {
  const pts = points.map((p) => ({ ...p }));
  let last = pts.find((p) => p.ele != null)?.ele ?? null;
  for (const p of pts) { if (p.ele == null) p.ele = last; else last = p.ele; }
  let km = 0;
  let up = 0;
  let down = 0;
  pts.forEach((p, i) => {
    if (i) km += distanceKm(pts[i - 1], p);
    p.km = km;
  });
  // Dénivelé sur altitudes filtrées (seuil de 3 m) pour ne pas compter le bruit du GPS.
  let ref = pts[0].ele;
  for (const p of pts) {
    if (p.ele == null || ref == null) continue;
    const d = p.ele - ref;
    if (d > 3) { up += d; ref = p.ele; } else if (d < -3) { down -= d; ref = p.ele; }
  }
  const hasEle = pts.some((p) => p.ele != null);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const gap = distanceKm(start, end);
  return {
    points: pts,
    lengthKm: km,
    gainM: hasEle ? up : null,
    lossM: hasEle ? down : null,
    hasEle,
    startEndGapKm: gap,
    // Boucle : arrivée à moins de 2 km (ou 3 % de la longueur) du départ.
    isLoop: gap <= Math.max(2, km * 0.03),
  };
}

/** Même trace parcourue dans l'autre sens. */
export function reverseTrack(track) {
  return buildTrack([...track.points].reverse().map(({ lat, lon, ele }) => ({ lat, lon, ele })));
}

function pointAt(pts, km, from = 0) {
  let i = from;
  while (i < pts.length - 2 && pts[i + 1].km < km) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const f = b.km > a.km ? Math.min(1, Math.max(0, (km - a.km) / (b.km - a.km))) : 0;
  return {
    i,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    ele: a.ele == null || b.ele == null ? (a.ele ?? b.ele) : a.ele + (b.ele - a.ele) * f,
  };
}

/** Pas d'échantillonnage (km) pour ne pas dépasser `max` points. */
export const stepFor = (lengthKm, max = 80, min = 2) => Math.max(min, lengthKm / (max - 1));

/**
 * Points régulièrement espacés le long de la trace, avec le cap local
 * (moyenné sur ± `window` km pour ignorer les lacets).
 */
export function sampleTrack(track, stepKm, window = 0.6) {
  const pts = track.points;
  const n = Math.max(1, Math.round(track.lengthKm / stepKm));
  const out = [];
  let i = 0;
  for (let k = 0; k <= n; k++) {
    const km = (track.lengthKm * k) / n;
    const p = pointAt(pts, km, i);
    i = p.i;
    const a = pointAt(pts, Math.max(0, km - window));
    const b = pointAt(pts, Math.min(track.lengthKm, km + window));
    out.push({ km, lat: p.lat, lon: p.lon, ele: p.ele, heading: bearing(a, b) });
  }
  return out;
}

/**
 * Horaires de passage : la vitesse moyenne demandée est respectée sur l'ensemble,
 * mais on va moins vite en montée et plus vite en descente
 * (100 m de D+ « valent » 1 km de plat, 100 m de D- en font gagner 0,5).
 * Renvoie pour chaque échantillon l'heure (ms) et la vitesse locale (km/h).
 */
export function passageTimes(samples, startMs, avgKmh) {
  const effort = [0];
  for (let k = 1; k < samples.length; k++) {
    const d = samples[k].km - samples[k - 1].km;
    const dz = (samples[k].ele ?? 0) - (samples[k - 1].ele ?? 0);
    const e = d + (dz > 0 ? dz / 100 : dz / 200);
    effort.push(Math.max(d * 0.5, e));
  }
  const total = effort.reduce((s, e) => s + e, 0);
  const lengthKm = samples[samples.length - 1].km;
  const durationH = lengthKm / avgKmh;
  let t = startMs;
  return samples.map((s, k) => {
    const h = total > 0 ? (effort[k] / total) * durationH : 0;
    t += h * 3600e3;
    const prev = k ? samples[k - 1].km : 0;
    const speed = h > 0 ? (s.km - prev) / h : avgKmh;
    return { ...s, time: t, speed };
  });
}
