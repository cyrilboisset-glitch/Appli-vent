// Connexion Strava (OAuth) directement depuis le navigateur, sans serveur.
// Chacun crée sa propre « application API » Strava (gratuit) : l'identifiant client et
// le secret restent dans son navigateur et ne sont envoyés qu'à Strava.
// https://developers.strava.com/docs/authentication/

export const AUTH_URL = 'https://www.strava.com/oauth/authorize';
export const TOKEN_URL = 'https://www.strava.com/oauth/token';
export const API = 'https://www.strava.com/api/v3';
// profile:read_all : poids et FTP ; activity:read_all : sorties pour le calage.
export const SCOPE = 'read,profile:read_all,activity:read_all';

/** Adresse de la page d'autorisation Strava. */
export function authorizeUrl(clientId, redirectUri, state = '') {
  const q = new URLSearchParams({
    client_id: String(clientId).trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** Lit le retour de Strava dans l'adresse de la page : { code, scope } ou { error }. */
export function readRedirect(search) {
  const q = new URLSearchParams(search);
  if (q.get('error')) return { error: q.get('error') === 'access_denied' ? 'Accès refusé sur Strava.' : q.get('error') };
  if (!q.get('code')) return null;
  return { code: q.get('code'), scope: q.get('scope') ?? '', state: q.get('state') ?? '' };
}

async function tokenRequest(params, fetchFn) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`Strava : ${json?.message ?? `erreur ${res.status}`}${res.status === 400 || res.status === 401 ? ' (identifiant ou secret client incorrect ?)' : ''}`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at };
}

/** Échange le code de retour contre des jetons. */
export const exchangeCode = ({ clientId, clientSecret }, code, fetchFn = globalThis.fetch) => tokenRequest({
  client_id: String(clientId).trim(), client_secret: String(clientSecret).trim(), code, grant_type: 'authorization_code',
}, fetchFn);

/** Jetons valides (rafraîchis s'ils expirent dans moins d'une minute). */
export async function freshTokens(creds, tokens, fetchFn = globalThis.fetch, nowS = Date.now() / 1000) {
  if (tokens.expires_at - 60 > nowS) return tokens;
  return tokenRequest({
    client_id: String(creds.clientId).trim(),
    client_secret: String(creds.clientSecret).trim(),
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  }, fetchFn);
}

async function get(path, token, fetchFn) {
  const res = await fetchFn(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw new Error('Strava : autorisation expirée ou insuffisante, se reconnecter.');
  if (!res.ok) throw new Error(`Strava : ${json?.message ?? `erreur ${res.status}`}`);
  return json;
}

/** Profil : { weight (kg|null), ftp (W|null), name }. */
export async function getAthlete(token, fetchFn = globalThis.fetch) {
  const a = await get('/athlete', token, fetchFn);
  return { weight: a.weight || null, ftp: a.ftp || null, name: [a.firstname, a.lastname].filter(Boolean).join(' ') };
}

/** Dernières sorties (résumés), jusqu'à `max`. */
export async function getActivities(token, max = 150, fetchFn = globalThis.fetch) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const batch = await get(`/athlete/activities?per_page=${Math.min(100, max)}&page=${page}`, token, fetchFn);
    out.push(...batch);
    if (batch.length < Math.min(100, max)) break;
  }
  return out.slice(0, max);
}
