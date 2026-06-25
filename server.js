const express = require('express');
const app = express();

const { WORDS: FALLBACK_WORDS, VALID_GUESSES: FALLBACK_GUESSES } = require('./words');
const spotify = require('./spotify');
const twitch  = require('./twitch');

// Middleware — rejects any request missing the correct API key.
// Skips the OAuth routes so the one-time Spotify setup still works.
function requireKey(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // not configured — open access (dev mode)
  if (req.query.key === secret) return next();
  res.status(403).type('text/plain').send('Unauthorized');
}

app.use((req, res, next) => {
  if (req.path.startsWith('/auth/')) return next(); // skip OAuth routes
  requireKey(req, res, next);
});

// In-memory game state: one active game per channel
const games = {};

// Word lists — populated at startup, then never change
let ANSWER_WORDS = [];   // words that can be the answer
let ALL_VALID    = new Set(); // all acceptable guesses

// Fetch the complete 5-letter word lists from public sources at startup.
// Falls back to the bundled lists if the network is unavailable.
async function loadWords() {
  try {
    // tabatkins/wordle-list — the actual original Wordle answer + guess lists
    const [answersRes, guessesRes] = await Promise.all([
      fetch('https://raw.githubusercontent.com/tabatkins/wordle-list/main/words'),
      fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt'),
    ]);

    if (!answersRes.ok || !guessesRes.ok) throw new Error('bad status');

    const answersText = await answersRes.text();
    const guessesText = await guessesRes.text();

    // tabatkins list: one word per line, already 5 letters
    ANSWER_WORDS = answersText
      .split('\n')
      .map(w => w.trim().toUpperCase())
      .filter(w => /^[A-Z]{5}$/.test(w));

    // dwyl list: one word per line, all lengths — filter to exactly 5 letters
    const allEnglish = guessesText
      .split('\n')
      .map(w => w.trim().toUpperCase())
      .filter(w => /^[A-Z]{5}$/.test(w));

    ALL_VALID = new Set([...ANSWER_WORDS, ...allEnglish]);

    console.log(`Loaded ${ANSWER_WORDS.length} answer words, ${ALL_VALID.size} valid guesses from network.`);
  } catch (err) {
    console.warn('Could not fetch word lists, using bundled fallback:', err.message);
    ANSWER_WORDS = FALLBACK_WORDS;
    ALL_VALID    = new Set([...FALLBACK_WORDS, ...FALLBACK_GUESSES]);
    console.log(`Fallback: ${ANSWER_WORDS.length} answer words, ${ALL_VALID.size} valid guesses.`);
  }
}

function randomWord() {
  return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
}

// Returns a 5-char string of 🟩🟨⬛
function evaluate(guess, answer) {
  const result     = Array(5).fill('⬛');
  const answerLeft = answer.split('');
  const guessLeft  = guess.split('');

  // Green pass
  for (let i = 0; i < 5; i++) {
    if (guessLeft[i] === answerLeft[i]) {
      result[i]     = '🟩';
      answerLeft[i] = null;
      guessLeft[i]  = null;
    }
  }

  // Yellow pass
  for (let i = 0; i < 5; i++) {
    if (!guessLeft[i]) continue;
    const j = answerLeft.indexOf(guessLeft[i]);
    if (j !== -1) {
      result[i]     = '🟨';
      answerLeft[j] = null;
    }
  }

  return result.join('');
}

function channel(req) {
  return (req.query.channel || 'default').toLowerCase().replace(/^#/, '');
}

// GET /api/start  — start (or restart) a game; intended for mods
app.get('/api/start', (req, res) => {
  const ch = channel(req);
  games[ch] = { word: randomWord(), guesses: [], over: false };
  res.type('text/plain').send(
    '🟩🟨⬛ A new Wordle game has started! ' +
    'Use !guess <5-letter-word> to play. You have 6 attempts. Good luck! 🍀'
  );
});

// GET /api/status  — show the current board
app.get('/api/status', (req, res) => {
  const ch   = channel(req);
  const game = games[ch];
  res.type('text/plain');

  if (!game) {
    return res.send('No active Wordle game. A mod can type !wordle to start one!');
  }
  if (game.guesses.length === 0) {
    return res.send('Wordle is live! ⬛⬛⬛⬛⬛ — Make your first guess with !guess <word>. 6 attempts remaining.');
  }

  const board     = game.guesses.map((g, i) => `${i + 1}: ${g.result} ${g.guess}`).join(' | ');
  const remaining = 6 - game.guesses.length;
  const suffix    = game.over ? ' [GAME OVER]' : ` | ${remaining} left`;
  res.send(`Wordle (${game.guesses.length}/6): ${board}${suffix}`);
});

// GET /api/guess?channel=…&user=…&guess=…  — submit a guess
app.get('/api/guess', (req, res) => {
  const ch    = channel(req);
  const user  = req.query.user  || 'Anonymous';
  const guess = (req.query.guess || '').toUpperCase().replace(/\s/g, '');
  const game  = games[ch];

  res.type('text/plain');

  if (!game) {
    return res.send(`@${user} No active game! A mod can type !wordle to start one.`);
  }
  if (game.over) {
    return res.send(`@${user} The game has ended. A mod can type !wordle to start a new one!`);
  }
  if (!/^[A-Z]{5}$/.test(guess)) {
    return res.send(`@${user} Please guess exactly 5 letters (e.g. !guess crane).`);
  }
  if (!ALL_VALID.has(guess)) {
    return res.send(`@${user} "${guess}" is not a valid English word — try again!`);
  }

  const result  = evaluate(guess, game.word);
  const guessNo = game.guesses.length + 1;
  game.guesses.push({ guess, result, user });

  const won  = guess === game.word;
  const lost = guessNo >= 6 && !won;

  let msg = `@${user} ${result} (${guessNo}/6)`;

  if (won) {
    game.over = true;
    const praise = ['Genius! 🧠', 'Magnificent! ✨', 'Impressive! 🔥', 'Splendid! 🎊', 'Great! 🎉', 'Phew! 😅'];
    msg += ` ${praise[guessNo - 1] || '🎉'} Solved in ${guessNo}! Type !wordle for a new game.`;
  } else if (lost) {
    game.over = true;
    msg += ` Game over! The word was ${game.word}. Type !wordle to play again!`;
  } else {
    msg += ` — ${6 - guessNo} guess${6 - guessNo === 1 ? '' : 'es'} left. Keep going!`;
  }

  res.send(msg);
});

// GET /api/board  — compact board state
app.get('/api/board', (req, res) => {
  const ch   = channel(req);
  const game = games[ch];
  res.type('text/plain');

  if (!game || game.guesses.length === 0) {
    return res.send('No guesses yet. Use !guess <word> to start!');
  }

  const rows = game.guesses.map(g => `${g.result} ${g.guess}`);
  while (rows.length < 6) rows.push('⬛⬛⬛⬛⬛');
  res.send(rows.join(' | '));
});

// ── Spotify OAuth (one-time setup) ──────────────────────────────────────────

// Step 1: visit /auth/spotify in your browser to kick off the OAuth flow
app.get('/auth/spotify', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.SPOTIFY_REDIRECT_URI,
    scope:         'user-modify-playback-state user-read-currently-playing user-read-playback-state',
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// Step 2: Spotify redirects here — displays your refresh token
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.type('text/plain').send(`Spotify auth error: ${error}`);

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    }),
  });

  const data = await tokenRes.json();
  res.type('text/plain').send(
    `✅ Authorization successful!\n\n` +
    `Add this to your Railway environment variables:\n\n` +
    `SPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n\n` +
    `Then redeploy the server.`
  );
});

// ── Spotify song request endpoints ───────────────────────────────────────────

// GET /api/sr?channel=…&user=…&q=…  — request a song
app.get('/api/sr', async (req, res) => {
  const user  = req.query.user || 'Anonymous';
  const query = (req.query.q || '').trim();
  res.type('text/plain');

  if (!process.env.SPOTIFY_REFRESH_TOKEN) {
    return res.send(`@${user} Song requests are not set up yet.`);
  }
  if (!query) {
    return res.send(`@${user} Usage: !sr <song name or artist>`);
  }

  try {
    const live = await twitch.isLive(channel(req));
    if (!live) return res.send(`@${user} Song requests are only available while the stream is live!`);

    const track = await spotify.searchTrack(query);
    if (!track) return res.send(`@${user} No results found for "${query}".`);

    await spotify.addToQueue(track.uri);
    res.send(`@${user} ✅ Added to queue: "${track.name}" by ${track.artist}`);
  } catch (err) {
    res.send(`@${user} ❌ ${err.message}`);
  }
});

// GET /api/song?channel=…  — show currently playing track
app.get('/api/song', async (req, res) => {
  res.type('text/plain');

  if (!process.env.SPOTIFY_REFRESH_TOKEN) {
    return res.send('Song requests are not set up yet.');
  }

  try {
    const track = await spotify.getCurrentlyPlaying();
    if (!track) return res.send('Nothing is playing on Spotify right now.');
    const status = track.isPlaying ? '🎵 Now playing' : '⏸ Paused';
    res.send(`${status}: "${track.name}" by ${track.artist}`);
  } catch (err) {
    res.send(`Could not fetch current song: ${err.message}`);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

loadWords().then(() => {
  app.listen(PORT, () => {
    console.log(`Twitch Wordle API listening on port ${PORT}`);
  });
});
