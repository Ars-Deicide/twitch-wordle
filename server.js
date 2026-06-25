const express = require('express');
const app = express();

const { WORDS, VALID_GUESSES } = require('./words');

// In-memory game state: one active game per channel
const games = {};

const ALL_VALID = new Set([...WORDS, ...VALID_GUESSES]);

function randomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// Returns a 5-char string of 🟩🟨⬛
function evaluate(guess, answer) {
  const result = Array(5).fill('⬛');
  const answerLeft = answer.split('');
  const guessLeft  = guess.split('');

  // Green pass
  for (let i = 0; i < 5; i++) {
    if (guessLeft[i] === answerLeft[i]) {
      result[i]      = '🟩';
      answerLeft[i]  = null;
      guessLeft[i]   = null;
    }
  }

  // Yellow pass
  for (let i = 0; i < 5; i++) {
    if (!guessLeft[i]) continue;
    const j = answerLeft.indexOf(guessLeft[i]);
    if (j !== -1) {
      result[i]  = '🟨';
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
  games[ch] = {
    word:    randomWord(),
    guesses: [],
    over:    false,
  };
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
    return res.send(
      `Wordle is live! ⬛⬛⬛⬛⬛ — Make your first guess with !guess <word>. 6 attempts remaining.`
    );
  }

  const board = game.guesses.map((g, i) => `${i + 1}: ${g.result} ${g.guess}`).join(' | ');
  const remaining = 6 - game.guesses.length;
  const suffix = game.over ? ' [GAME OVER]' : ` | ${remaining} left`;
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
    return res.send(`@${user} "${guess}" is not in the word list — try a different word!`);
  }

  const result  = evaluate(guess, game.word);
  const guessNo = game.guesses.length + 1;
  game.guesses.push({ guess, result, user });

  const won  = guess === game.word;
  const lost = guessNo >= 6 && !won;

  let msg = `@${user} ${result} (${guessNo}/6)`;

  if (won) {
    game.over = true;
    const praise = ['Genius! 🧠','Magnificent! ✨','Impressive! 🔥','Splendid! 🎊','Great! 🎉','Phew! 😅'];
    msg += ` ${praise[guessNo - 1] || '🎉'} Solved in ${guessNo}! Type !wordle for a new game.`;
  } else if (lost) {
    game.over = true;
    msg += ` Game over! The word was ${game.word}. Type !wordle to play again!`;
  } else {
    msg += ` — ${6 - guessNo} guess${6 - guessNo === 1 ? '' : 'es'} left. Keep going!`;
  }

  res.send(msg);
});

// GET /api/board  — compact multi-line board (useful for checking state mid-game)
app.get('/api/board', (req, res) => {
  const ch   = channel(req);
  const game = games[ch];
  res.type('text/plain');

  if (!game || game.guesses.length === 0) {
    return res.send('No guesses yet. Use !guess <word> to start!');
  }

  const rows = game.guesses.map((g, i) => `${g.result} ${g.guess}`);
  // Fill remaining rows with empties
  while (rows.length < 6) rows.push('⬛⬛⬛⬛⬛');
  res.send(rows.join(' | '));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Twitch Wordle API listening on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /api/start?channel=<channel>');
  console.log('  GET /api/guess?channel=<channel>&user=<user>&guess=<word>');
  console.log('  GET /api/status?channel=<channel>');
  console.log('  GET /api/board?channel=<channel>');
});
