// Modèle de puissance : vitesse sur chaque portion à partir du poids, de la puissance,
// de la pente, du vent et de la densité de l'air. Unités SI à l'intérieur (m, s, W, kg).

export const G = 9.80665;
export const EFFICIENCY = 0.97; // pertes de transmission
export const VMAX_KMH = 50; // descente : virages, freinage, prudence

/** Vélo / position → traînée (CdA, m²) pour un cycliste de 75 kg, et roulement (Crr). */
export const BIKES = {
  route: { label: 'Route, mains aux cocottes', cda: 0.34, crr: 0.0045 },
  prolongateurs: { label: 'Route, prolongateurs', cda: 0.28, crr: 0.0045 },
  bikepacking: { label: 'Route + sacoches (bikepacking)', cda: 0.38, crr: 0.005 },
  gravel: { label: 'Gravel', cda: 0.38, crr: 0.007 },
  vtt: { label: 'VTT', cda: 0.45, crr: 0.010 },
};

/** La surface frontale grandit avec le gabarit (≈ masse^2/3). */
export const cdaFor = (bikeCda, riderKg) => bikeCda * (riderKg / 75) ** (2 / 3);

/** Densité de l'air (kg/m³) selon l'altitude et la température. */
export function airDensity(altM = 0, tempC = 15) {
  const p = 101325 * (1 - 2.25577e-5 * Math.max(-400, altM ?? 0)) ** 5.25588;
  return p / (287.05 * ((tempC ?? 15) + 273.15));
}

/**
 * Puissance au pédalier (W) pour rouler à v (m/s).
 * `headwind` (m/s) : vent de face au niveau du cycliste (négatif = dans le dos).
 */
export function powerNeeded(v, { mass, cda, crr, rho = 1.2, grade = 0, headwind = 0, eff = EFFICIENCY }) {
  const th = Math.atan(grade);
  const air = v + headwind;
  return (mass * G * (Math.sin(th) + crr * Math.cos(th)) * v + 0.5 * rho * cda * air * Math.abs(air) * v) / eff;
}

/** Vitesse (m/s) obtenue avec la puissance `watts` (bornée à VMAX en descente). */
export function speedFor(watts, opts, vmax = VMAX_KMH / 3.6) {
  if (powerNeeded(vmax, opts) <= watts) return vmax;
  let lo = 0;
  let hi = vmax;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (powerNeeded(mid, opts) < watts) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Puissance réellement développée selon la pente, à partir de la puissance sur le plat :
 * on appuie davantage en montée (jusqu'à +30 % à 6 % et plus), on relâche en descente
 * (pleine puissance jusqu'à -2 %, plus rien à -6 %).
 */
export function riderPower(flatWatts, grade) {
  if (grade > 0) return flatWatts * (1 + 0.3 * Math.min(1, grade / 0.06));
  if (grade > -0.02) return flatWatts;
  return flatWatts * Math.max(0, (grade + 0.06) / 0.04);
}

/** Paramètres du modèle à partir de ce que saisit le cycliste. */
export function riderModel({ riderKg, bikeKg = 12, ftp, intensity = 0.7, bike = 'route', cda, crr, pauseMinPerH = 0 }) {
  const b = BIKES[bike] ?? BIKES.route;
  return {
    mass: riderKg + bikeKg,
    cda: cda ?? cdaFor(b.cda, riderKg),
    crr: crr ?? b.crr,
    flatWatts: ftp * intensity,
    pauseFactor: 1 + pauseMinPerH / 60,
  };
}
