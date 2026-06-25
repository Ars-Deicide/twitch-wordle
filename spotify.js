// Spotify API wrapper — handles token refresh automatically
let accessToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  accessToken = data.access_token;
  tokenExpiry  = Date.now() + data.expires_in * 1000;
  return accessToken;
}

async function spotifyFetch(path, options = {}) {
  const token = await getAccessToken();
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

async function searchTrack(query) {
  const res  = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
  const data = await res.json();
  const track = data.tracks?.items?.[0];
  if (!track) return null;
  return {
    uri:    track.uri,
    name:   track.name,
    artist: track.artists.map(a => a.name).join(', '),
    url:    track.external_urls.spotify,
  };
}

async function addToQueue(uri) {
  const res = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
  // 204 = success, 404 = no active device
  if (res.status === 404) throw new Error('No active Spotify device — open Spotify and play something first.');
  if (res.status === 403) throw new Error('Spotify Premium required to add to queue.');
  return res.status === 204;
}

async function getCurrentlyPlaying() {
  const res = await spotifyFetch('/me/player/currently-playing');
  if (res.status === 204) return null; // nothing playing
  const data = await res.json();
  if (!data?.item) return null;
  return {
    name:      data.item.name,
    artist:    data.item.artists.map(a => a.name).join(', '),
    isPlaying: data.is_playing,
  };
}

module.exports = { searchTrack, addToQueue, getCurrentlyPlaying };
