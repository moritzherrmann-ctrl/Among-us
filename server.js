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
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PHOTO_ID = /^[a-f0-9]{12}$/;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Speichert ein Beweisfoto (data:-URL) und gibt seine ID zurück. */
function savePhoto(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new GameError('Das Foto konnte nicht gelesen werden. Bitte nochmal aufnehmen.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) throw new GameError('Das Foto ist zu groß.');
  const photoId = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.writeFileSync(path.join(PHOTO_DIR, `${photoId}.jpg`), bytes);
  return photoId;
}

function removePhoto(photoId) {
  fs.rm(path.join(PHOTO_DIR, `${photoId}.jpg`), { force: true }, () => {});
}

/** Aktion mit optionalem Foto ausführen; schlägt sie fehl, wird das Foto wieder gelöscht. */
function withPhoto(photo, fn) {
  const photoId = photo ? savePhoto(photo) : null;
  try {
    return fn(photoId);
  } catch (err) {
    if (photoId) removePhoto(photoId);
    throw err;
  }
}

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
// Beweisfotos werden als verkleinertes JPEG über die Verbindung geschickt
const io = new Server(server, { maxHttpBufferSize: 8 * 1024 * 1024 });

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
  res.json({
    urls: unique,
    qr,
    moderatorUrl: unique[0] ? `${unique[0]}moderator` : null,
    liveUrl: unique[0] ? `${unique[0]}live` : null,
  });
});

// Beweisfotos nur für den Moderator (PIN als Parameter, weil <img> keine Header schicken kann)
app.get('/api/photo/:id', (req, res) => {
  if (String(req.query.pin) !== MOD_PIN || !PHOTO_ID.test(req.params.id)) return res.status(403).end();
  res.sendFile(path.join(PHOTO_DIR, `${req.params.id}.jpg`), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
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
  socket.on('task:complete', handle(socket, requirePlayer(({ taskId, code, photo }, now) => withPhoto(photo,
    (photoId) => game.completeTask(playerId, taskId, code, now, photoId)))));
  socket.on('player:kill', handle(socket, requirePlayer(({ victimId }, now) => game.kill(playerId, victimId, now))));
  socket.on('player:died', handle(socket, requirePlayer((_, now) => game.reportOwnDeath(playerId, now))));
  socket.on('meeting:call', handle(socket, requirePlayer(({ bodyId }, now) => game.callMeeting(playerId, bodyId || null, now))));
  socket.on('meeting:vote', handle(socket, requirePlayer(({ targetId }, now) => game.vote(playerId, targetId, now))));
  socket.on('sabotage:start', handle(socket, requirePlayer((_, now) => game.startSabotage(playerId, now))));
  socket.on('sabotage:fix', handle(socket, requirePlayer(({ code, photo }, now) => withPhoto(photo,
    (photoId) => game.fixSabotage(playerId, now, code, photoId)))));

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
  socket.on('mod:photo:review', handle(socket, requireMod(({ id, ok }, now) => game.reviewProof(id, !!ok, now))));
  socket.on('mod:task:photo-all', handle(socket, requireMod(({ photo }) => {
    for (const t of game.taskCatalog) t.photo = !!photo;
  }), { persist: true }));
  socket.on('mod:task:reset', handle(socket, requireMod(() => game.resetTasks()), { persist: true }));
  socket.on('mod:task:all', handle(socket, requireMod(({ enabled }) => {
    for (const t of game.taskCatalog) t.enabled = !!enabled;
  }), { persist: true }));

  socket.on('mod:player:select', handle(socket, requireMod(({ id, selected }) => game.setSelected(id, selected))));
  socket.on('mod:player:impostor', handle(socket, requireMod(({ id, fixed }) => game.setFixedImpostor(id, fixed))));
  socket.on('mod:player:rename', handle(socket, requireMod(({ id, name }) => game.renamePlayer(id, name))));
  socket.on('mod:player:alive', handle(socket, requireMod(({ id, alive }, now) => game.setAlive(id, alive, now))));
  socket.on('mod:player:kick', handle(socket, requireMod(({ id }, now) => {
    game.removePlayer(id, now);
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
  const urls = (p) => addrs.map((a) => `http://${a}:${PORT}${p}`).join('  ') || `http://localhost:${PORT}${p}`;
  console.log('\n  ඞ  Among Us Real Life läuft!\n');
  console.log(`  Spieler:     ${urls('/')}`);
  console.log(`  Moderator:   ${urls('/moderator')}`);
  console.log(`  Live-Board:  ${urls('/live')}   (auf diesem Rechner: http://localhost:${PORT}/live)`);
  console.log(`  Moderator-PIN: ${MOD_PIN}\n`);
});
