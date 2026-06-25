// Twitch Helix API — checks whether a channel is currently live
let appToken   = null;
let tokenExpiry = 0;

async function getAppToken() {
  if (appToken && Date.now() < tokenExpiry - 60_000) return appToken;

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${process.env.TWITCH_CLIENT_ID}` +
    `&client_secret=${process.env.TWITCH_CLIENT_SECRET}` +
    `&grant_type=client_credentials`,
    { method: 'POST' }
  );

  const data = await res.json();
  if (!data.access_token) throw new Error(`Twitch token error: ${JSON.stringify(data)}`);

  appToken    = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return appToken;
}

async function isLive(channelName) {
  const token = await getAppToken();
  const res   = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channelName)}`,
    {
      headers: {
        'Client-ID':     process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();
  return Array.isArray(data.data) && data.data.length > 0;
}

module.exports = { isLive };
