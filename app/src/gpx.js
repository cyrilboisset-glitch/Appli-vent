// Lecture / écriture GPX sans dépendance (fonctionne dans le navigateur comme sous Node).
// Points de trace (trkpt) en priorité, sinon points de route (rtept).

const num = (s) => (s == null ? NaN : Number(s));
const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();

function readPoints(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
  const pts = [];
  for (const m of xml.matchAll(re)) {
    const lat = num(attr(m[1], 'lat'));
    const lon = num(attr(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = num(m[2]?.match(/<(?:\w+:)?ele>\s*([^<]*)</)?.[1]);
    pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return pts;
}

/** Analyse un fichier GPX : { name, points: [{ lat, lon, ele|null }] }. */
export function parseGpx(xml) {
  if (typeof xml !== 'string' || !/<gpx[\s>]/i.test(xml)) throw new Error('Ce fichier n\'est pas un GPX.');
  let points = readPoints(xml, 'trkpt');
  if (points.length < 2) points = readPoints(xml, 'rtept');
  if (points.length < 2) throw new Error('Aucune trace dans ce GPX (il faut au moins 2 points).');
  const name = xml.match(/<(?:trk|rte)\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1]
    ?? xml.match(/<metadata\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1];
  return { name: name ? decode(name) : '', points };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Écrit une trace GPX (utilisé pour télécharger la boucle dans le bon sens). */
export function writeGpx(name, points) {
  const pts = points.map((p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`
    + (p.ele == null ? '' : `<ele>${Math.round(p.ele * 10) / 10}</ele>`) + '</trkpt>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Couteau suisse de l'ultra-distance" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
