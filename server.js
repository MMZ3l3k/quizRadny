'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const config = require('./questions.json');
const rounds = config.rounds;
const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1234';
const TIME_LIMIT_MS = 1000 * Number(process.env.TIME_LIMIT || config.timeLimit || 20);

if (!process.env.HOST_PIN) {
  console.warn('[UWAGA] Brak zmiennej HOST_PIN – używam domyślnego PIN "1234". Na Railway ustaw własny HOST_PIN!');
}

// ---------- HTTP ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/join-url', (req, res) => res.json({ url: joinUrl(req) }));
app.get('/qr', async (req, res) => {
  const svg = await QRCode.toString(joinUrl(req), { type: 'svg', margin: 1, width: 600, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.get('/qr.png', async (req, res) => {
  const buf = await QRCode.toBuffer(joinUrl(req), { margin: 2, width: 1200, errorCorrectionLevel: 'M' });
  res.type('png').send(buf);
});
app.get('/health', (_req, res) => res.json({ ok: true, phase: game.phase, players: players.size }));

function joinUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  return `${req.protocol}://${req.get('host')}/`;
}

// ---------- Stan gry ----------
const players = new Map(); // id -> player
let game = freshGame();

function freshGame() {
  return { phase: 'lobby', roundIdx: 0, qIdx: 0, startedAt: null, deadline: null, timer: null, autoTimer: null, standings: null, finalStandings: null };
}
const currentRound = () => rounds[game.roundIdx];
const currentQuestion = () => currentRound().questions[game.qIdx];
const qKey = () => `${game.roundIdx}-${game.qIdx}`;
const allPlayers = () => [...players.values()];
const activePlayers = () => allPlayers().filter(p => p.status === 'active');
const rankRound = list => [...list].sort((a, b) => b.roundScore - a.roundScore || a.roundTime - b.roundTime || a.joinedAt - b.joinedAt);

function createPlayer(nick) {
  const p = {
    id: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'), nick,
    socketId: null, connected: false, joinedAt: Date.now(),
    status: 'active', place: null, roundScore: 0, roundTime: 0, total: 0, answers: {}, lastResult: null,
  };
  if (game.phase !== 'lobby') {
    if (game.roundIdx === 0 && (game.phase === 'question' || game.phase === 'reveal')) {
      // spóźnialski w eliminacjach – gra dalej, pominięte pytania liczą się jako brak odpowiedzi
      const missed = game.qIdx + (game.phase === 'reveal' ? 1 : 0);
      p.roundTime = missed * TIME_LIMIT_MS;
    } else {
      p.status = 'spectator';
    }
  }
  return p;
}

function publicState() {
  const r = currentRound();
  const s = {
    title: config.title,
    now: Date.now(),
    phase: game.phase,
    roundIdx: game.roundIdx, roundName: r.name, roundsTotal: rounds.length, advance: r.advance, nextLabel: r.nextLabel,
    nextRoundName: rounds[game.roundIdx + 1] ? rounds[game.roundIdx + 1].name : null,
    qIdx: game.qIdx, qTotal: r.questions.length, timeLimit: TIME_LIMIT_MS,
    playerCount: players.size, activeCount: activePlayers().length,
    players: allPlayers().map(p => ({ id: p.id, nick: p.nick, connected: p.connected, status: p.status, place: p.place, roundScore: p.roundScore, total: p.total })),
  };
  if (game.phase === 'question' || game.phase === 'reveal') {
    const q = currentQuestion();
    s.question = { text: q.text, answers: q.answers };
    s.startedAt = game.startedAt;
    s.deadline = game.deadline;
    s.answered = activePlayers().filter(p => p.answers[qKey()]).length;
  }
  if (game.phase === 'reveal') {
    const q = currentQuestion();
    s.correct = q.correct;
    s.counts = [0, 0, 0, 0];
    for (const p of activePlayers()) { const a = p.answers[qKey()]; if (a) s.counts[a.choice]++; }
    s.leaderboard = rankRound(activePlayers()).slice(0, 8).map((p, i) => ({
      rank: i + 1, nick: p.nick, roundScore: p.roundScore, delta: p.lastResult ? p.lastResult.points : 0,
    }));
  }
  if (game.phase === 'roundEnd') s.standings = game.standings;
  if (game.phase === 'gameOver') { s.standings = game.standings; s.finalStandings = game.finalStandings; }
  return s;
}

function privateState(p) {
  const ranked = rankRound(activePlayers());
  const rank = p.status === 'active' ? ranked.findIndex(x => x.id === p.id) + 1 : null;
  const a = p.answers[qKey()];
  return {
    id: p.id, nick: p.nick, status: p.status, place: p.place,
    roundScore: p.roundScore, total: p.total, rank, activeCount: ranked.length,
    answered: a ? a.choice : null,
    lastResult: p.lastResult,
  };
}

function broadcast() {
  const s = publicState();
  io.to('host').emit('state', s);
  for (const p of allPlayers()) {
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) continue;
    sock.emit('state', s);
    sock.emit('me', privateState(p));
  }
}

// ---------- Przebieg ----------
function startRound(i) {
  if (i === 0) for (const p of allPlayers()) if (!p.connected) players.delete(p.id); // start: porządki po rozłączonych
  game.roundIdx = i; game.qIdx = 0;
  for (const p of activePlayers()) { p.roundScore = 0; p.roundTime = 0; p.lastResult = null; }
  startQuestion();
}

function startQuestion() {
  clearTimeout(game.timer); clearTimeout(game.autoTimer);
  game.phase = 'question';
  game.startedAt = Date.now();
  game.deadline = game.startedAt + TIME_LIMIT_MS;
  for (const p of activePlayers()) p.lastResult = null;
  game.timer = setTimeout(reveal, TIME_LIMIT_MS + 400);
  broadcast();
}

function reveal() {
  if (game.phase !== 'question') return;
  clearTimeout(game.timer); clearTimeout(game.autoTimer);
  const q = currentQuestion();
  const k = qKey();
  for (const p of activePlayers()) {
    const a = p.answers[k];
    let points = 0;
    let elapsed = TIME_LIMIT_MS;
    if (a) {
      elapsed = a.time;
      if (a.choice === q.correct) {
        const speed = Math.max(0, 1 - elapsed / TIME_LIMIT_MS);
        points = Math.round(1000 * (0.5 + 0.5 * speed)); // 500–1000 pkt za dobrą odpowiedź
      }
    }
    p.roundScore += points; p.total += points; p.roundTime += elapsed;
    p.lastResult = { answered: !!a, choice: a ? a.choice : null, correct: !!a && a.choice === q.correct, points };
  }
  game.phase = 'reveal';
  broadcast();
}

function endRound() {
  const r = currentRound();
  const isLast = game.roundIdx === rounds.length - 1;
  const ranked = rankRound(activePlayers());
  const standings = ranked.map((p, i) => ({ id: p.id, nick: p.nick, rank: i + 1, roundScore: p.roundScore, total: p.total, advances: !isLast && i + 1 <= r.advance }));
  ranked.forEach((p, i) => {
    const rank = i + 1;
    if (isLast || rank > r.advance) { p.status = 'out'; p.place = rank; }
  });
  game.standings = { roundName: r.name, advance: r.advance, nextRoundName: rounds[game.roundIdx + 1] ? rounds[game.roundIdx + 1].name : null, rows: standings };
  if (isLast) {
    game.finalStandings = allPlayers()
      .filter(p => p.place)
      .sort((a, b) => a.place - b.place)
      .map(p => ({ id: p.id, nick: p.nick, place: p.place, total: p.total }));
    game.phase = 'gameOver';
  } else {
    game.phase = 'roundEnd';
  }
  broadcast();
}

function next() {
  switch (game.phase) {
    case 'lobby':
      if (activePlayers().length === 0) return { ok: false, error: 'Brak graczy.' };
      startRound(0); break;
    case 'question': reveal(); break;
    case 'reveal':
      if (game.qIdx + 1 < currentRound().questions.length) { game.qIdx++; startQuestion(); } else endRound();
      break;
    case 'roundEnd':
      if (game.roundIdx + 1 < rounds.length) startRound(game.roundIdx + 1); else endRound();
      break;
    case 'gameOver': break;
  }
  return { ok: true };
}

function maybeAutoReveal() {
  if (game.phase !== 'question') return;
  const waiting = activePlayers().filter(p => p.connected && !p.answers[qKey()]);
  if (waiting.length === 0) {
    clearTimeout(game.autoTimer);
    game.autoTimer = setTimeout(reveal, 700);
  }
}

function resetGame({ keepPlayers = true } = {}) {
  clearTimeout(game.timer); clearTimeout(game.autoTimer);
  game = freshGame();
  for (const p of allPlayers()) {
    if (!keepPlayers || !p.connected) { kick(p.id, false); continue; }
    Object.assign(p, { status: 'active', place: null, roundScore: 0, roundTime: 0, total: 0, answers: {}, lastResult: null });
  }
  broadcast();
}

function kick(id, notify = true) {
  const p = players.get(id);
  if (!p) return;
  players.delete(id);
  if (p.socketId) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) { sock.data.playerId = null; if (notify) sock.emit('kicked'); }
  }
  if (notify) { maybeAutoReveal(); broadcast(); }
}

// ---------- Socket.IO ----------
io.on('connection', socket => {
  socket.data.playerId = null;
  socket.data.host = false;

  socket.on('join', (data = {}, ack = () => {}) => {
    let p = data.token ? allPlayers().find(x => x.token === data.token) : null;
    if (!p) {
      const nick = String(data.nick || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      if (!nick) return ack({ ok: false, needNick: true });
      if (nick.length < 2) return ack({ ok: false, needNick: true, error: 'Nick musi mieć co najmniej 2 znaki.' });
      if (allPlayers().some(x => x.nick.toLowerCase() === nick.toLowerCase())) return ack({ ok: false, needNick: true, error: 'Ten nick jest już zajęty – wybierz inny.' });
      p = createPlayer(nick);
      players.set(p.id, p);
      console.log(`[+] ${nick} dołączył (${players.size} graczy, status: ${p.status})`);
    }
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) { old.data.playerId = null; old.emit('replaced'); }
    }
    clearTimeout(p.removeTimer);
    p.socketId = socket.id; p.connected = true;
    socket.data.playerId = p.id;
    ack({ ok: true, token: p.token, nick: p.nick });
    broadcast();
  });

  socket.on('answer', (choice) => {
    const p = players.get(socket.data.playerId);
    if (!p || p.status !== 'active' || game.phase !== 'question') return;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
    const k = qKey();
    if (p.answers[k]) return;
    const now = Date.now();
    if (now > game.deadline + 300) return;
    p.answers[k] = { choice, time: Math.min(now - game.startedAt, TIME_LIMIT_MS) };
    socket.emit('me', privateState(p));
    io.to('host').emit('state', publicState());
    maybeAutoReveal();
  });

  socket.on('leave', () => {
    const p = players.get(socket.data.playerId);
    if (p && game.phase === 'lobby') kick(p.id, false);
    socket.data.playerId = null;
    broadcast();
  });

  socket.on('host:auth', (pin, ack = () => {}) => {
    if (String(pin) === String(HOST_PIN)) {
      socket.data.host = true; socket.join('host');
      ack({ ok: true });
      socket.emit('state', publicState());
    } else ack({ ok: false });
  });
  const hostOnly = fn => (...args) => { if (socket.data.host) fn(...args); };
  socket.on('host:next', hostOnly((ack = () => {}) => ack(next())));
  socket.on('host:reveal', hostOnly(() => reveal()));
  socket.on('host:reset', hostOnly((opts) => resetGame(opts || {})));
  socket.on('host:kick', hostOnly(id => kick(id)));

  socket.on('disconnect', () => {
    const p = players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false; p.socketId = null;
      if (game.phase === 'lobby') {
        // w poczekalni dajemy 30 s na powrót (odświeżenie strony), potem usuwamy
        clearTimeout(p.removeTimer);
        p.removeTimer = setTimeout(() => {
          if (!p.connected && players.get(p.id) === p && game.phase === 'lobby') {
            players.delete(p.id); console.log(`[-] ${p.nick} wyszedł z poczekalni`); broadcast();
          }
        }, 30000);
      }
      maybeAutoReveal();
      broadcast();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Quiz działa na porcie ${PORT}`);
  console.log(`Gracze:      http://localhost:${PORT}/`);
  console.log(`Prowadzący:  http://localhost:${PORT}/host  (PIN: ${HOST_PIN})`);
});
