// Météo de parcours : sens de la boucle pour finir vent dans le dos,
// températures au passage selon la position et l'altitude, conseils de tenue.
export { parseGpx, writeGpx } from './gpx.js';
export { distanceKm, bearing, compass, compassShort, buildTrack, sampleTrack, stepFor, passageTimes } from './geo.js';
export { HOURLY, forecastUrl, parseForecast, fetchForecast, weatherAt } from './openmeteo.js';
export {
  tailwind, feltTemp, RIDER_WIND, analyseDirection, reverseSamples, compareDirections, SAME_WIND,
  OUTFITS, outfitFor, clothing,
} from './analyse.js';
