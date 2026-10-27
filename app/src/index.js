// Météo de parcours : sens de la boucle pour finir vent dans le dos,
// températures au passage selon la position et l'altitude, conseils de tenue.
export { parseGpx, writeGpx } from './gpx.js';
export { distanceKm, bearing, compass, compassShort, buildTrack, sampleTrack, smoothEle, stepFor, passageTimes } from './geo.js';
export { HOURLY, forecastUrl, parseForecast, fetchForecast, weatherAt } from './openmeteo.js';
export {
  tailwind, feltTemp, RIDER_WIND, analyseDirection, powerTimes, reverseSamples, compareDirections, SAME_WIND,
  OUTFITS, outfitFor, clothing,
} from './analyse.js';
export {
  G, EFFICIENCY, VMAX_KMH, BIKES, cdaFor, airDensity, powerNeeded, speedFor, riderPower, riderModel, calibrate,
} from './power.js';
export * as strava from './strava.js';
