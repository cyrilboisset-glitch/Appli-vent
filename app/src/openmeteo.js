// Prévisions Open-Meteo (gratuit, sans clé) : https://open-meteo.com/en/docs
// Une seule requête pour tous les points du parcours. En passant l'altitude de chaque
// point, Open-Meteo corrige la température du modèle pour cette altitude
// (le relief du modèle est lissé : un col y est souvent « trop bas », donc trop chaud).

export const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'precipitation_probability', 'precipitation',
];

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** URL de prévision horaire pour les points `samples` entre fromMs et toMs. */
export function forecastUrl(samples, fromMs, toMs, base = 'https://api.open-meteo.com/v1/forecast') {
  const f = (x) => x.toFixed(4);
  const q = new URLSearchParams({
    latitude: samples.map((s) => f(s.lat)).join(','),
    longitude: samples.map((s) => f(s.lon)).join(','),
    hourly: HOURLY.join(','),
    wind_speed_unit: 'kmh',
    timezone: 'GMT',
    timeformat: 'unixtime',
    start_date: day(fromMs - 3600e3),
    end_date: day(toMs + 3600e3),
  });
  if (samples.every((s) => s.ele != null)) q.set('elevation', samples.map((s) => Math.round(s.ele)).join(','));
  return `${base}?${q.toString().replace(/%2C/g, ',')}`;
}

/** Réponse Open-Meteo (objet ou tableau) → une série horaire par point. */
export function parseForecast(json) {
  if (json && json.error) throw new Error(`Open-Meteo : ${json.reason ?? 'erreur'}`);
  const list = Array.isArray(json) ? json : [json];
  return list.map((loc) => {
    const h = loc.hourly;
    if (!h || !Array.isArray(h.time)) throw new Error('Réponse météo inattendue.');
    return {
      elevation: loc.elevation ?? null,
      times: h.time.map((t) => t * 1000),
      temp: h.temperature_2m,
      app: h.apparent_temperature,
      ws: h.wind_speed_10m,
      wd: h.wind_direction_10m,
      gust: h.wind_gusts_10m,
      pop: h.precipitation_probability ?? [],
      rain: h.precipitation ?? [],
    };
  });
}

/** Télécharge les prévisions (fetchFn injectable pour les tests). */
export async function fetchForecast(samples, fromMs, toMs, fetchFn = globalThis.fetch) {
  const res = await fetchFn(forecastUrl(samples, fromMs, toMs));
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) throw new Error(`Open-Meteo : ${json?.reason ?? `erreur ${res.status}`}`);
  return parseForecast(json);
}

const lerp = (a, b, f) => (a == null || b == null ? (a ?? b) : a + (b - a) * f);

/** Météo interpolée à l'instant t (ms) ; le vent est interpolé en vecteur. */
export function weatherAt(series, t) {
  const { times } = series;
  if (!times.length) return null;
  if (t < times[0] - 3600e3 || t > times[times.length - 1] + 3600e3) return null;
  let i = 0;
  while (i < times.length - 2 && times[i + 1] <= t) i++;
  const j = Math.min(i + 1, times.length - 1);
  const f = j > i ? Math.min(1, Math.max(0, (t - times[i]) / (times[j] - times[i]))) : 0;
  const vec = (k) => {
    const r = (series.wd[k] * Math.PI) / 180;
    return [series.ws[k] * Math.sin(r), series.ws[k] * Math.cos(r)];
  };
  const [ux, uy] = vec(i);
  const [vx, vy] = vec(j);
  const x = lerp(ux, vx, f);
  const y = lerp(uy, vy, f);
  return {
    temp: lerp(series.temp[i], series.temp[j], f),
    app: lerp(series.app[i], series.app[j], f),
    ws: Math.hypot(x, y),
    wd: (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360,
    gust: lerp(series.gust[i], series.gust[j], f),
    pop: Math.max(series.pop[i] ?? 0, series.pop[j] ?? 0),
    rain: lerp(series.rain[i], series.rain[j], f) ?? 0,
  };
}
