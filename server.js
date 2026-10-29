'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, GameError } = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
const MOD_PIN = process.env.MOD_PIN || String(crypto.randomInt(1000, 10000));
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(game.config(), null, 2));
  } catch (err) {
    console.error('Konnte Konfiguration nicht speichern:', err.message);
  }
}

function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) result.push(addr.address);
    }
  }
  return result;
}

const game = new Game(loadConfig());
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/moderator', (req, res) => res.sendFile(path.join(__dirname, 'public', 'moderator.html')));
app.get('/live', (req, res) => res.sendFile(path.join(__dirname, 'public', 'live.html')));

// QR-Code mit der Beitritts-Adresse, damit Spieler nicht tippen müssen
app.get('/api/join-info', async (req, res) => {
  const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}/`);
  const host = req.headers.host;
  if (host && !/^(localhost|127\.)/.test(host)) urls.unshift(`${req.protocol}://${host}/`);
  const unique = [...new Set(urls)];
  const qr = unique[0] ? await QRCode.toDataURL(unique[0], { margin: 1, width: 320 }) : null;
  res.json({ urls: unique, qr });
});

// ---------- Echtzeit-Kommunikation ----------

const playerSockets = new Map(); // playerId -> Set<socket>

function broadcast() {
  const now = Date.now();
  io.to('moderators').emit('state', game.moderatorView(now));
  for (const [playerId, sockets] of playerSockets) {
    const view = game.viewFor(playerId, now);
    for (const s of sockets) s.emit('state', view);
  }
}

function updateConnected(playerId) {
  const p = game.players.get(playerId);
  if (p) p.connected = (playerSockets.get(playerId)?.size || 0) > 0;
}

/** Führt eine Aktion aus, meldet Fehler an den Absender und verteilt danach den neuen Zustand. */
function handle(socket, fn, { persist = false } = {}) {
  return (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const result = fn(payload || {}, Date.now());
      reply({ ok: true, ...(result || {}) });
      if (persist) saveConfig();
      broadcast();
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      reply({ ok: false, error: err instanceof GameError ? err.message : 'Unerwarteter Fehler.' });
    }
  };
}

io.on('connection', (socket) => {
  let playerId = null;
  let isModerator = false;

  const requireMod = (fn) => (payload, now) => {
    if (!isModerator) throw new GameError('Nur für Moderatoren.');
    return fn(payload, now);
  };
  const requirePlayer = (fn) => (payload, now) => {
    if (!playerId || !game.players.has(playerId)) throw new GameError('Bitte zuerst beitreten.');
    return fn(payload, now);
  };

  // --- Spieler ---
  socket.on('player:join', handle(socket, ({ name, token }) => {
    const player = game.join(name, token);
    if (playerId && playerId !== player.id) playerSockets.get(playerId)?.delete(socket);
    playerId = player.id;
    if (!playerSockets.has(playerId)) playerSockets.set(playerId, new Set());
    playerSockets.get(playerId).add(socket);
    updateConnected(playerId);
    return { token: player.token, playerId: player.id };
  }));

  socket.on('player:leave', handle(socket, requirePlayer(() => {
    if (game.phase === 'lobby') {
      game.removePlayer(playerId);
      playerSockets.delete(playerId);
    }
    playerId = null;
  })));

  socket.on('player:rename', handle(socket, requirePlayer(({ name }) => game.renamePlayer(playerId, name))));
  socket.on('player:color', handle(socket, requirePlayer(({ color }) => game.setColor(playerId, color))));
  socket.on('task:complete', handle(socket, requirePlayer(({ taskId, code }, now) => game.completeTask(playerId, taskId, code, now))));
  socket.on('player:kill', handle(socket, requirePlayer(({ victimId }, now) => game.kill(playerId, victimId, now))));
  socket.on('player:died', handle(socket, requirePlayer((_, now) => game.reportOwnDeath(playerId, now))));
  socket.on('meeting:call', handle(socket, requirePlayer(({ bodyId }, now) => game.callMeeting(playerId, bodyId || null, now))));
  socket.on('meeting:vote', handle(socket, requirePlayer(({ targetId }, now) => game.vote(playerId, targetId, now))));
  socket.on('sabotage:start', handle(socket, requirePlayer((_, now) => game.startSabotage(playerId, now))));
  socket.on('sabotage:fix', handle(socket, requirePlayer(({ code }, now) => game.fixSabotage(playerId, now, code))));

  // --- Moderator ---
  socket.on('mod:login', handle(socket, ({ pin }) => {
    if (String(pin) !== MOD_PIN) throw new GameError('Falscher PIN.');
    isModerator = true;
    socket.join('moderators');
  }));

  socket.on('mod:settings', handle(socket, requireMod((patch) => game.updateSettings(patch)), { persist: true }));
  socket.on('mod:task:add', handle(socket, requireMod((task) => { game.addTask(task); }), { persist: true }));
  socket.on('mod:task:update', handle(socket, requireMod(({ id, ...patch }) => game.updateTask(id, patch)), { persist: true }));
  socket.on('mod:task:remove', handle(socket, requireMod(({ id }) => game.removeTask(id)), { persist: true }));
  socket.on('mod:task:reset', handle(socket, requireMod(() => game.resetTasks()), { persist: true }));
  socket.on('mod:task:all', handle(socket, requireMod(({ enabled }) => {
    for (const t of game.taskCatalog) t.enabled = !!enabled;
  }), { persist: true }));

  socket.on('mod:player:select', handle(socket, requireMod(({ id, selected }) => game.setSelected(id, selected))));
  socket.on('mod:player:impostor', handle(socket, requireMod(({ id, fixed }) => game.setFixedImpostor(id, fixed))));
  socket.on('mod:player:rename', handle(socket, requireMod(({ id, name }) => game.renamePlayer(id, name))));
  socket.on('mod:player:alive', handle(socket, requireMod(({ id, alive }, now) => game.setAlive(id, alive, now))));
  socket.on('mod:player:kick', handle(socket, requireMod(({ id }) => {
    game.removePlayer(id);
    for (const s of playerSockets.get(id) || []) s.emit('kicked');
    playerSockets.delete(id);
  })));

  socket.on('mod:start', handle(socket, requireMod((_, now) => game.start(now))));
  socket.on('mod:meeting', handle(socket, requireMod((_, now) => game.callMeeting(null, null, now))));
  socket.on('mod:meeting:advance', handle(socket, requireMod((_, now) => game.advanceMeeting(now))));
  socket.on('mod:sabotage:end', handle(socket, requireMod((_, now) => {
    if (!game.sabotage) throw new GameError('Keine Sabotage aktiv.');
    game.endSabotage(now);
  })));
  socket.on('mod:announce', handle(socket, requireMod(({ text }, now) => game.announce(text, now))));
  socket.on('mod:end', handle(socket, requireMod(({ winner }, now) => {
    if (game.phase !== 'playing' && game.phase !== 'meeting') throw new GameError('Kein laufendes Spiel.');
    game.end(winner === 'impostors' ? 'impostors' : 'crew', 'Der Moderator hat das Spiel beendet.', now);
  })));
  socket.on('mod:lobby', handle(socket, requireMod(() => game.resetRound())));

  socket.on('disconnect', () => {
    if (playerId) {
      playerSockets.get(playerId)?.delete(socket);
      updateConnected(playerId);
      broadcast();
    }
  });
});

// Timer (Diskussion, Abstimmung, Sabotage) laufen auf dem Server
setInterval(() => {
  if (game.tick(Date.now())) broadcast();
}, 250);

server.listen(PORT, () => {
  const addrs = lanAddresses();
  console.log('\n  ඞ  Among Us Real Life läuft!\n');
  console.log(`  Spieler:    ${addrs.map((a) => `http://${a}:${PORT}/`).join('  ') || `http://localhost:${PORT}/`}`);
  console.log(`  Moderator:  ${addrs.map((a) => `http://${a}:${PORT}/moderator`).join('  ') || `http://localhost:${PORT}/moderator`}`);
  console.log(`  Moderator-PIN: ${MOD_PIN}\n`);
});
