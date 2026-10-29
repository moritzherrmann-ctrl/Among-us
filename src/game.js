'use strict';

const crypto = require('crypto');

const COLORS = [
  { name: 'Rot', hex: '#c51111' },
  { name: 'Blau', hex: '#132ed1' },
  { name: 'Grün', hex: '#117f2d' },
  { name: 'Pink', hex: '#ed54ba' },
  { name: 'Orange', hex: '#ef7d0d' },
  { name: 'Gelb', hex: '#f5f557' },
  { name: 'Schwarz', hex: '#3f474e' },
  { name: 'Weiß', hex: '#d6e0f0' },
  { name: 'Lila', hex: '#6b2fbb' },
  { name: 'Braun', hex: '#71491e' },
  { name: 'Cyan', hex: '#38fedc' },
  { name: 'Limette', hex: '#50ef39' },
  { name: 'Kastanie', hex: '#6b2b3c' },
  { name: 'Rosa', hex: '#ecc0d3' },
  { name: 'Beige', hex: '#f0e7a8' },
  { name: 'Grau', hex: '#758593' },
];

const DEFAULT_TASKS = [
  { name: 'Putten', location: '', description: 'Putte die 3 pinken Golfbälle ins Ziel.' },
  { name: 'Müll wegwerfen', location: '', description: 'Wirf 5 Papierkügelchen mit deiner nicht dominanten Hand in den Mülleimer.' },
  { name: 'Müll rausbringen', location: '', description: 'Bring den Mülleimer mit den 5 Papierkügelchen raus.' },
  { name: 'Treibstoff nachfüllen', location: 'Bad (Mitte) → Bad (oben)', description: 'Bring 1 Liter Wasser vom Bad in der Mitte ins Bad oben.' },
  { name: 'Farben sortieren', location: '', description: 'Sortiere die bunten Gegenstände nach Farben.' },
  { name: 'Lego-Modell bauen', location: '', description: 'Baue das Lego-Modell nach der Vorlage zusammen.' },
  { name: 'Würfeln', location: '', description: 'Würfle so lange mit zwei Würfeln, bis du einen 6er-Pasch hast.' },
  { name: 'Knoten lösen', location: '', description: 'Löse den Knoten im Seil vollständig auf.' },
  { name: 'Kabel sortieren', location: '', description: 'Entwirre die Kabel und lege sie ordentlich nebeneinander.' },
  { name: 'Gegenstände zählen', location: '', description: 'Zähle die Gegenstände im Behälter.' },
  { name: 'Gegenstand finden', location: '', description: 'Finde den versteckten Gegenstand im Raum.' },
  { name: 'Becherstapeln', location: '', description: 'Staple die Becher zu einer Pyramide und baue sie wieder ab.' },
  { name: 'Münzen zählen', location: '', description: 'Zähle, wie viel Geld in den Münzen steckt.' },
  { name: 'Ball versenken', location: '', description: 'Versenke den Ball im Ziel.' },
  { name: 'Löffel-Transport', location: '', description: 'Trag den Gegenstand auf einem Löffel ans Ziel, ohne ihn fallen zu lassen.' },
  { name: 'Mutter von Gewindestange', location: '', description: 'Dreh die Mutter ganz von der Gewindestange ab.' },
  { name: 'Spiegelverkehrt schreiben', location: '', description: 'Schreibe deinen Vor- und Nachnamen spiegelverkehrt auf.' },
];

const DEFAULT_SETTINGS = {
  impostors: 1,
  tasksPerPlayer: 4,
  killCooldown: 30, // Sekunden
  killDelay: 0, // Sekunden bis das Opfer nach dem Kill wirklich stirbt (0 = sofort)
  discussionTime: 60, // Sekunden
  votingTime: 60, // Sekunden
  resultTime: 8, // Sekunden, wie lange das Ergebnis angezeigt wird
  emergencyMeetings: 1, // pro Spieler
  confirmEjects: true, // nach Rauswurf verraten, ob Impostor
  anonymousVotes: false,
  sabotageEnabled: true,
  sabotageDuration: 60, // Sekunden bis zur Kernschmelze
  sabotageCooldown: 90, // Sekunden
  sabotageFixesNeeded: 2, // so viele zufällig ausgeloste Crewmates müssen reparieren
  sabotagesPerRound: 2, // wie oft pro Runde sabotiert werden darf
};

const SETTING_LIMITS = {
  impostors: [1, 5],
  tasksPerPlayer: [1, 20],
  killCooldown: [0, 600],
  killDelay: [0, 600],
  discussionTime: [0, 600],
  votingTime: [10, 600],
  resultTime: [3, 60],
  emergencyMeetings: [0, 10],
  sabotageDuration: [15, 600],
  sabotageCooldown: [0, 1200],
  sabotageFixesNeeded: [1, 5],
  sabotagesPerRound: [1, 10],
};

const MAX_NAME = 20;
const MAX_DESCRIPTION = 300;

function id() {
  return crypto.randomBytes(6).toString('hex');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

class GameError extends Error {}

/**
 * Hält den kompletten Spielzustand. Alle zeitabhängigen Methoden bekommen
 * `now` (ms) übergeben, damit die Logik ohne echte Uhr testbar ist.
 */
class Game {
  constructor({ settings, tasks } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    this.taskCatalog = Game.normalizeTasks(tasks || DEFAULT_TASKS);
    this.players = new Map();
    this.fixedImpostors = new Set();
    this.announcements = [];
    this.resetRound();
  }

  static normalizeTasks(tasks) {
    return tasks.map((t) => ({
      id: t.id || id(),
      name: cleanText(t.name, 60),
      location: cleanText(t.location, 40),
      description: cleanText(t.description, MAX_DESCRIPTION),
      code: cleanText(t.code, 12),
      enabled: t.enabled !== false,
    }));
  }

  /** Katalog durch die Standard-Aufgaben ersetzen (alte Aufgaben werden gelöscht). */
  resetTasks() {
    this.taskCatalog = Game.normalizeTasks(DEFAULT_TASKS);
  }

  resetRound() {
    this.phase = 'lobby';
    this.meeting = null;
    this.lastMeeting = null;
    this.sabotage = null;
    this.sabotageReadyAt = 0;
    this.sabotagesUsed = 0;
    this.pendingKills = []; // verzögerte Kills: { impostorId, victimId, at, diesAt }
    this.winner = null;
    this.startedAt = null;
    this.endedAt = null;
    // Für das Live-Board: Ereignisse, Meeting-Verlauf und Aufgaben-Fortschritt über die Zeit
    this.events = [];
    this.meetingHistory = [];
    this.progressLog = [];
    for (const p of this.players.values()) {
      p.role = null;
      p.alive = true;
      p.ejected = false;
      p.bodyReported = false;
      p.tasks = [];
      p.meetingsLeft = this.settings.emergencyMeetings;
      p.killReadyAt = 0;
      p.diedAt = null;
    }
  }

  // ---------- Spieler ----------

  join(name, token) {
    const clean = cleanText(name, MAX_NAME);
    if (token) {
      const existing = this.findByToken(token);
      if (existing) {
        if (clean && clean !== existing.name) this.renamePlayer(existing.id, clean);
        return existing;
      }
    }
    if (!clean) throw new GameError('Bitte gib einen Namen ein.');
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      throw new GameError('Dieser Name ist schon vergeben.');
    }
    if (this.players.size >= COLORS.length) throw new GameError('Das Spiel ist voll.');
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.findIndex((_, i) => !used.has(i));
    const player = {
      id: id(),
      token: crypto.randomBytes(16).toString('hex'),
      name: clean,
      color,
      connected: true,
      // Wer mitten im Spiel beitritt, schaut erst mal nur zu.
      selected: this.phase === 'lobby',
      role: null,
      alive: true,
      ejected: false,
      bodyReported: false,
      tasks: [],
      meetingsLeft: this.settings.emergencyMeetings,
      killReadyAt: 0,
      diedAt: null,
    };
    this.players.set(player.id, player);
    return player;
  }

  findByToken(token) {
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  getPlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) throw new GameError('Spieler nicht gefunden.');
    return p;
  }

  renamePlayer(playerId, name) {
    const p = this.getPlayer(playerId);
    const clean = cleanText(name, MAX_NAME);
    if (!clean) throw new GameError('Name darf nicht leer sein.');
    if ([...this.players.values()].some((o) => o !== p && o.name.toLowerCase() === clean.toLowerCase())) {
      throw new GameError('Dieser Name ist schon vergeben.');
    }
    p.name = clean;
  }

  setColor(playerId, color) {
    const p = this.getPlayer(playerId);
    if (this.phase !== 'lobby') throw new GameError('Farbe nur in der Lobby änderbar.');
    if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) throw new GameError('Ungültige Farbe.');
    if ([...this.players.values()].some((o) => o !== p && o.color === color)) {
      throw new GameError('Farbe ist schon vergeben.');
    }
    p.color = color;
  }

  setSelected(playerId, selected) {
    if (this.phase !== 'lobby') throw new GameError('Spielerauswahl nur in der Lobby möglich.');
    const p = this.getPlayer(playerId);
    p.selected = !!selected;
    if (!p.selected) this.fixedImpostors.delete(p.id);
  }

  setFixedImpostor(playerId, fixed) {
    if (this.phase !== 'lobby') throw new GameError('Nur in der Lobby möglich.');
    const p = this.getPlayer(playerId);
    if (fixed) {
      p.selected = true;
      this.fixedImpostors.add(p.id);
    } else {
      this.fixedImpostors.delete(p.id);
    }
  }

  removePlayer(playerId) {
    const p = this.getPlayer(playerId);
    this.players.delete(p.id);
    this.fixedImpostors.delete(p.id);
    if (this.meeting) delete this.meeting.votes[p.id];
    return p;
  }

  // ---------- Einstellungen & Aufgaben ----------

  updateSettings(patch) {
    if (this.phase !== 'lobby') throw new GameError('Einstellungen nur in der Lobby änderbar.');
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
        this.settings[key] = !!value;
      } else {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n)) continue;
        const [min, max] = SETTING_LIMITS[key];
        this.settings[key] = Math.min(max, Math.max(min, n));
      }
    }
    for (const p of this.players.values()) p.meetingsLeft = this.settings.emergencyMeetings;
  }

  addTask({ name, location, code, description }) {
    const task = {
      id: id(),
      name: cleanText(name, 60),
      location: cleanText(location, 40),
      description: cleanText(description, MAX_DESCRIPTION),
      code: cleanText(code, 12),
      enabled: true,
    };
    if (!task.name) throw new GameError('Aufgabe braucht einen Namen.');
    this.taskCatalog.push(task);
    return task;
  }

  updateTask(taskId, patch) {
    const t = this.taskCatalog.find((x) => x.id === taskId);
    if (!t) throw new GameError('Aufgabe nicht gefunden.');
    if ('name' in patch) {
      const n = cleanText(patch.name, 60);
      if (!n) throw new GameError('Aufgabe braucht einen Namen.');
      t.name = n;
    }
    if ('location' in patch) t.location = cleanText(patch.location, 40);
    if ('description' in patch) t.description = cleanText(patch.description, MAX_DESCRIPTION);
    if ('code' in patch) t.code = cleanText(patch.code, 12);
    if ('enabled' in patch) t.enabled = !!patch.enabled;
  }

  removeTask(taskId) {
    const before = this.taskCatalog.length;
    this.taskCatalog = this.taskCatalog.filter((t) => t.id !== taskId);
    if (this.taskCatalog.length === before) throw new GameError('Aufgabe nicht gefunden.');
  }

  // ---------- Spielablauf ----------

  participants() {
    return [...this.players.values()].filter((p) => p.role);
  }

  start(now) {
    if (this.phase !== 'lobby') throw new GameError('Das Spiel läuft bereits.');
    const chosen = [...this.players.values()].filter((p) => p.selected);
    const { impostors } = this.settings;
    if (chosen.length < 3) throw new GameError('Mindestens 3 ausgewählte Spieler nötig.');
    if (impostors * 2 >= chosen.length) {
      throw new GameError(`Für ${impostors} Impostor braucht ihr mindestens ${impostors * 2 + 1} Spieler.`);
    }
    const enabledTasks = this.taskCatalog.filter((t) => t.enabled);
    if (enabledTasks.length === 0) throw new GameError('Mindestens eine Aufgabe muss aktiv sein.');
    const fixed = chosen.filter((p) => this.fixedImpostors.has(p.id));
    if (fixed.length > impostors) {
      throw new GameError(`Es sind ${fixed.length} Impostor festgelegt, aber nur ${impostors} eingestellt.`);
    }

    this.resetRound();
    const rest = shuffle(chosen.filter((p) => !this.fixedImpostors.has(p.id)));
    const impostorSet = new Set([...fixed, ...rest.slice(0, impostors - fixed.length)]);
    const perPlayer = Math.min(this.settings.tasksPerPlayer, enabledTasks.length);

    for (const p of chosen) {
      p.role = impostorSet.has(p) ? 'impostor' : 'crewmate';
      p.tasks = shuffle(enabledTasks)
        .slice(0, perPlayer)
        .map((t) => ({ id: t.id, name: t.name, location: t.location, description: t.description, code: t.code, done: false }));
      p.killReadyAt = now + this.settings.killCooldown * 1000;
    }
    this.sabotageReadyAt = now + this.settings.sabotageCooldown * 1000;
    this.phase = 'playing';
    this.startedAt = now;
    this.progressLog.push({ at: now, ...this.taskProgress() });
    this.logEvent(now, 'start', `Spiel gestartet: ${chosen.length} Spieler, ${impostors} Impostor`);
  }

  /** secret = nur mit Geheimnissen sichtbar (z. B. wer wen getötet hat). */
  logEvent(now, type, text, { secret = false, players = [] } = {}) {
    this.events.push({ id: id(), at: now, type, text, secret, players });
    if (this.events.length > 200) this.events.shift();
  }

  requirePlaying() {
    if (this.phase !== 'playing') throw new GameError('Das geht gerade nicht.');
  }

  completeTask(playerId, taskId, code, now = Date.now()) {
    const p = this.getPlayer(playerId);
    if (this.phase !== 'playing') throw new GameError('Aufgaben gehen nur während des Spiels.');
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task) throw new GameError('Aufgabe nicht gefunden.');
    if (task.done) return;
    if (task.code && cleanText(code, 12).toLowerCase() !== task.code.toLowerCase()) {
      throw new GameError('Falscher Code. Schau nochmal am Aufgabenort nach!');
    }
    task.done = true;
    if (p.role === 'crewmate') {
      this.progressLog.push({ at: now, ...this.taskProgress() });
      this.logEvent(now, 'task', `${p.name} hat „${task.name}" erledigt`, { secret: true, players: [p.id] });
    } else {
      this.logEvent(now, 'fake-task', `${p.name} hat die Tarnaufgabe „${task.name}" abgehakt`, { secret: true, players: [p.id] });
    }
    this.checkWin(now);
  }

  kill(impostorId, victimId, now) {
    this.requirePlaying();
    const imp = this.getPlayer(impostorId);
    const victim = this.getPlayer(victimId);
    if (imp.role !== 'impostor' || !imp.alive) throw new GameError('Du kannst nicht töten.');
    if (now < imp.killReadyAt) throw new GameError('Dein Kill-Cooldown läuft noch.');
    if (!victim.role || !victim.alive || victim.role === 'impostor') throw new GameError('Ungültiges Opfer.');
    if (this.pendingKills.some((k) => k.victimId === victim.id)) throw new GameError(`${victim.name} stirbt bereits bald.`);
    imp.killReadyAt = now + this.settings.killCooldown * 1000;
    const delay = this.settings.killDelay;
    if (delay > 0) {
      this.pendingKills.push({ impostorId: imp.id, victimId: victim.id, at: now, diesAt: now + delay * 1000 });
      this.logEvent(now, 'poison', `${imp.name} hat ${victim.name} erwischt – stirbt in ${delay} s`, { secret: true, players: [imp.id, victim.id] });
      return;
    }
    this.markDead(victim, now);
    this.logEvent(now, 'kill', `${imp.name} hat ${victim.name} getötet`, { secret: true, players: [imp.id, victim.id] });
    this.checkWin(now);
  }

  /** Opfer meldet selbst „Ich wurde getötet" (Impostor hat im echten Leben angetippt). */
  reportOwnDeath(playerId, now) {
    this.requirePlaying();
    const p = this.getPlayer(playerId);
    if (!p.role || !p.alive) throw new GameError('Du bist schon tot.');
    if (p.role === 'impostor') throw new GameError('Impostor können nicht getötet werden.');
    this.markDead(p, now);
    this.logEvent(now, 'kill', `${p.name} wurde getötet`, { secret: true, players: [p.id] });
    this.checkWin(now);
  }

  markDead(p, now) {
    p.alive = false;
    p.diedAt = now;
    p.bodyReported = false;
    this.afterDeath(p, now);
  }

  /** Aufräumen, wenn jemand stirbt oder rausgeworfen wird. */
  afterDeath(p, now) {
    this.pendingKills = this.pendingKills.filter((k) => k.victimId !== p.id);
    // Stirbt ein ausgeloster Reparierer, übernimmt ein anderer lebender Crewmate.
    const s = this.sabotage;
    if (s && s.assigned.includes(p.id) && !s.fixedBy.includes(p.id)) {
      const replacement = shuffle(this.participants().filter((o) => o.alive && o.role === 'crewmate' && !s.assigned.includes(o.id)))[0];
      s.assigned = s.assigned.filter((pid) => pid !== p.id);
      const task = s.tasks[p.id];
      delete s.tasks[p.id];
      if (replacement) {
        s.assigned.push(replacement.id);
        s.tasks[replacement.id] = task; // Ersatz übernimmt dieselbe Reparatur-Aufgabe
        this.logEvent(now, 'sabotage', `${replacement.name} übernimmt die Reparatur für ${p.name}`, { players: [replacement.id, p.id] });
      }
      s.needed = s.assigned.length;
      if (s.needed === 0 || s.fixedBy.length >= s.needed) this.finishRepair(now);
    }
  }

  /** Verzögerte Kills auslösen, deren Zeit abgelaufen ist (nur während des Spiels, nicht im Meeting). */
  resolvePendingKills(now) {
    if (this.phase !== 'playing') return false;
    const due = this.pendingKills.filter((k) => k.diesAt <= now);
    if (!due.length) return false;
    for (const k of due) {
      const victim = this.players.get(k.victimId);
      this.pendingKills = this.pendingKills.filter((x) => x !== k);
      if (!victim || !victim.alive) continue;
      this.markDead(victim, now);
      const imp = this.players.get(k.impostorId);
      this.logEvent(now, 'kill', `${victim.name} ist gestorben${imp ? ` (Kill von ${imp.name})` : ''}`, { secret: true, players: [victim.id] });
      if (this.phase !== 'playing') break;
    }
    this.checkWin(now);
    return true;
  }

  /** Moderator setzt Lebend/Tot manuell (z. B. bei Fehlbedienung). */
  setAlive(playerId, alive, now) {
    if (this.phase !== 'playing' && this.phase !== 'meeting') throw new GameError('Kein laufendes Spiel.');
    const p = this.getPlayer(playerId);
    if (!p.role) throw new GameError('Spieler spielt nicht mit.');
    if (alive) {
      p.alive = true;
      p.ejected = false;
      p.diedAt = null;
      this.logEvent(now, 'mod', `Moderator hat ${p.name} wiederbelebt`, { secret: true, players: [p.id] });
    } else if (p.alive) {
      this.markDead(p, now);
      this.logEvent(now, 'mod', `Moderator hat ${p.name} als tot markiert`, { secret: true, players: [p.id] });
    }
    this.checkWin(now);
  }

  callMeeting(callerId, bodyId, now) {
    this.requirePlaying();
    if (this.sabotage) throw new GameError('Während einer Sabotage sind keine Meetings möglich!');
    let caller = null;
    if (callerId) {
      caller = this.getPlayer(callerId);
      if (!caller.role || !caller.alive) throw new GameError('Nur lebende Spieler können ein Meeting einberufen.');
    }
    let body = null;
    if (bodyId) {
      body = this.getPlayer(bodyId);
      if (body.alive || body.bodyReported || !body.role) throw new GameError('Diese Leiche kann nicht gemeldet werden.');
    } else if (caller) {
      if (caller.meetingsLeft <= 0) throw new GameError('Du hast keine Notfall-Meetings mehr.');
      caller.meetingsLeft -= 1;
    }

    // Nach dem Meeting gelten alle bis dahin Gestorbenen als gefunden.
    const found = this.participants().filter((p) => !p.alive && !p.bodyReported);
    for (const p of found) p.bodyReported = true;

    if (body) this.logEvent(now, 'report', `${caller.name} hat die Leiche von ${body.name} gemeldet`, { players: [caller.id, body.id] });
    else if (caller) this.logEvent(now, 'meeting', `${caller.name} hat ein Notfall-Meeting einberufen`, { players: [caller.id] });
    else this.logEvent(now, 'meeting', 'Der Moderator hat ein Meeting einberufen');
    const others = found.filter((p) => p !== body);
    if (others.length) {
      this.logEvent(now, 'dead', `Ebenfalls tot: ${others.map((p) => p.name).join(', ')}`, { players: others.map((p) => p.id) });
    }

    const discussion = this.settings.discussionTime;
    this.meeting = {
      id: id(),
      type: body ? 'report' : 'emergency',
      callerId: caller ? caller.id : null,
      bodyId: body ? body.id : null,
      stage: discussion > 0 ? 'discussion' : 'voting',
      endsAt: now + (discussion > 0 ? discussion : this.settings.votingTime) * 1000,
      votes: {},
      result: null,
    };
    this.phase = 'meeting';
  }

  vote(voterId, targetId, now) {
    const m = this.meeting;
    if (this.phase !== 'meeting' || !m || m.stage !== 'voting') throw new GameError('Gerade wird nicht abgestimmt.');
    const voter = this.getPlayer(voterId);
    if (!voter.role || !voter.alive) throw new GameError('Nur lebende Spieler dürfen abstimmen.');
    if (voter.id in m.votes) throw new GameError('Du hast schon abgestimmt.');
    if (targetId !== 'skip') {
      const target = this.getPlayer(targetId);
      if (!target.role || !target.alive) throw new GameError('Für diesen Spieler kann nicht gestimmt werden.');
    }
    m.votes[voter.id] = targetId;
    const alive = this.participants().filter((p) => p.alive);
    if (alive.every((p) => p.id in m.votes)) this.finishVoting(now);
  }

  /** Moderator überspringt die aktuelle Meeting-Phase. */
  advanceMeeting(now) {
    const m = this.meeting;
    if (this.phase !== 'meeting' || !m) throw new GameError('Kein Meeting aktiv.');
    if (m.stage === 'discussion') this.startVoting(now);
    else if (m.stage === 'voting') this.finishVoting(now);
    else this.endMeeting(now);
  }

  startVoting(now) {
    this.meeting.stage = 'voting';
    this.meeting.endsAt = now + this.settings.votingTime * 1000;
  }

  finishVoting(now) {
    const m = this.meeting;
    const tally = {};
    for (const target of Object.values(m.votes)) tally[target] = (tally[target] || 0) + 1;
    let top = null;
    let topCount = 0;
    let tie = false;
    for (const [target, count] of Object.entries(tally)) {
      if (count > topCount) {
        top = target;
        topCount = count;
        tie = false;
      } else if (count === topCount) {
        tie = true;
      }
    }
    let ejected = null;
    if (top && top !== 'skip' && !tie) {
      ejected = this.players.get(top) || null;
      if (ejected) {
        ejected.alive = false;
        ejected.ejected = true;
        ejected.bodyReported = true;
        ejected.diedAt = now;
        this.afterDeath(ejected, now);
      }
    }
    m.stage = 'result';
    m.endsAt = now + this.settings.resultTime * 1000;
    m.result = {
      tally,
      ejectedId: ejected ? ejected.id : null,
      ejectedWasImpostor: ejected ? ejected.role === 'impostor' : null,
      tie,
    };
    this.meetingHistory.push({
      id: m.id,
      at: now,
      type: m.type,
      callerId: m.callerId,
      bodyId: m.bodyId,
      votes: { ...m.votes },
      ...m.result,
    });
    if (ejected) {
      const role = ejected.role === 'impostor' ? 'ein Impostor' : 'kein Impostor';
      this.logEvent(now, 'eject', `${ejected.name} wurde rausgeworfen`, { players: [ejected.id] });
      this.logEvent(now, 'eject-role', `${ejected.name} war ${role}`, { secret: !this.settings.confirmEjects, players: [ejected.id] });
    } else {
      this.logEvent(now, 'eject', `Niemand wurde rausgeworfen${tie ? ' (Gleichstand)' : ''}`);
    }
    this.checkWin(now);
  }

  endMeeting(now) {
    this.lastMeeting = this.meeting;
    this.meeting = null;
    this.phase = 'playing';
    for (const p of this.participants()) {
      if (p.role === 'impostor') p.killReadyAt = now + this.settings.killCooldown * 1000;
    }
    this.sabotageReadyAt = Math.max(this.sabotageReadyAt, now + 10_000);
    this.checkWin(now);
  }

  startSabotage(impostorId, now) {
    this.requirePlaying();
    if (!this.settings.sabotageEnabled) throw new GameError('Sabotage ist deaktiviert.');
    const imp = this.getPlayer(impostorId);
    if (imp.role !== 'impostor') throw new GameError('Nur Impostor können sabotieren.');
    if (this.sabotage) throw new GameError('Es läuft bereits eine Sabotage.');
    if (this.sabotagesUsed >= this.settings.sabotagesPerRound) throw new GameError('Diese Runde sind keine Sabotagen mehr übrig.');
    if (now < this.sabotageReadyAt) throw new GameError('Sabotage ist noch nicht bereit.');
    // Zufällig ausgeloste Crewmates müssen reparieren (Impostor werden nie ausgelost).
    const candidates = this.participants().filter((p) => p.alive && p.role === 'crewmate');
    const assigned = shuffle(candidates).slice(0, this.settings.sabotageFixesNeeded).map((p) => p.id);
    if (!assigned.length) throw new GameError('Niemand da, der reparieren könnte.');
    // Jeder Reparierer bekommt eine zufällige Aufgabe aus dem Katalog (möglichst verschiedene).
    const pool = this.taskCatalog.filter((t) => t.enabled);
    const catalog = pool.length ? pool : this.taskCatalog;
    const picked = shuffle(catalog);
    const tasks = {};
    assigned.forEach((pid, i) => {
      const t = picked.length ? picked[i % picked.length] : null;
      tasks[pid] = t ? { name: t.name, location: t.location, description: t.description, code: t.code } : null;
    });
    this.sabotagesUsed += 1;
    this.sabotage = {
      id: id(),
      startedAt: now,
      endsAt: now + this.settings.sabotageDuration * 1000,
      assigned,
      tasks,
      fixedBy: [],
      needed: assigned.length,
    };
    const names = assigned.map((pid) => {
      const t = tasks[pid];
      return `${this.players.get(pid).name}${t ? ` (${t.name}${t.location ? `, ${t.location}` : ''})` : ''}`;
    }).join(' & ');
    this.logEvent(now, 'sabotage', `Reaktor sabotiert! Reparieren müssen: ${names}`, { players: assigned });
    this.logEvent(now, 'sabotage-by', `Sabotage ausgelöst von ${imp.name}`, { secret: true, players: [imp.id] });
  }

  fixSabotage(playerId, now, code = '') {
    this.requirePlaying();
    const s = this.sabotage;
    if (!s) throw new GameError('Es gibt nichts zu reparieren.');
    const p = this.getPlayer(playerId);
    if (!p.role || !p.alive) throw new GameError('Nur lebende Spieler können reparieren.');
    if (!s.assigned.includes(p.id)) throw new GameError('Du bist nicht ausgelost – die ausgelosten Spieler müssen reparieren!');
    if (s.fixedBy.includes(p.id)) throw new GameError('Du hast schon repariert – jetzt ist der andere dran!');
    const task = s.tasks[p.id];
    if (task && task.code && cleanText(code, 12).toLowerCase() !== task.code.toLowerCase()) {
      throw new GameError('Falscher Code. Schau nochmal am Aufgabenort nach!');
    }
    s.fixedBy.push(p.id);
    if (s.fixedBy.length >= s.needed) this.finishRepair(now);
  }

  finishRepair(now) {
    const s = this.sabotage;
    this.endSabotage(now);
    const names = s.fixedBy.map((pid) => this.players.get(pid)?.name).filter(Boolean).join(' & ');
    this.logEvent(now, 'fixed', names ? `Reaktor repariert von ${names}` : 'Reaktor repariert', { players: s.fixedBy });
  }

  endSabotage(now) {
    this.sabotage = null;
    this.sabotageReadyAt = now + this.settings.sabotageCooldown * 1000;
  }

  end(winner, reason, now = Date.now()) {
    this.phase = 'ended';
    this.sabotage = null;
    this.winner = { team: winner, reason };
    this.endedAt = now;
    this.logEvent(now, 'end', `${winner === 'crew' ? 'Sieg der Crew' : 'Sieg der Impostor'}: ${reason}`);
  }

  taskProgress() {
    const crew = this.participants().filter((p) => p.role === 'crewmate');
    let total = 0;
    let done = 0;
    for (const p of crew) {
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return { total, done };
  }

  checkWin(now = Date.now()) {
    // Während eines Meetings wird erst nach der Ergebnis-Anzeige gewertet (endMeeting).
    if (this.phase !== 'playing') return;
    const ps = this.participants();
    const aliveImp = ps.filter((p) => p.alive && p.role === 'impostor').length;
    const aliveCrew = ps.filter((p) => p.alive && p.role === 'crewmate').length;
    const { total, done } = this.taskProgress();
    if (aliveImp === 0) return this.end('crew', 'Alle Impostor wurden enttarnt!', now);
    if (total > 0 && done >= total) return this.end('crew', 'Alle Aufgaben wurden erledigt!', now);
    if (aliveImp >= aliveCrew) return this.end('impostors', 'Die Impostor sind in der Überzahl!', now);
  }

  /** Wird regelmäßig vom Server aufgerufen; gibt true zurück, wenn sich etwas geändert hat. */
  tick(now) {
    if (this.resolvePendingKills(now)) return true;
    if (this.phase === 'playing' && this.sabotage && now >= this.sabotage.endsAt) {
      this.end('impostors', 'Die Sabotage wurde nicht rechtzeitig repariert!', now);
      return true;
    }
    if (this.phase === 'meeting' && this.meeting && now >= this.meeting.endsAt) {
      const stage = this.meeting.stage;
      if (stage === 'discussion') this.startVoting(now);
      else if (stage === 'voting') this.finishVoting(now);
      else this.endMeeting(now);
      return true;
    }
    return false;
  }

  // ---------- Ansichten (was welches Gerät sehen darf) ----------

  publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      selected: p.selected,
      playing: !!p.role,
      // Tote sieht man erst nach einem Meeting (oder wenn man selbst tot ist, s. u.)
      alive: p.alive || !p.bodyReported,
      ejected: p.ejected,
    };
  }

  meetingView(m, forModerator) {
    if (!m) return null;
    const anonymous = this.settings.anonymousVotes && !forModerator;
    const view = {
      id: m.id,
      type: m.type,
      callerId: m.callerId,
      bodyId: m.bodyId,
      stage: m.stage,
      endsAt: m.endsAt,
      votedIds: Object.keys(m.votes),
      result: null,
    };
    if (m.result) {
      view.result = {
        tally: m.result.tally,
        tie: m.result.tie,
        ejectedId: m.result.ejectedId,
        ejectedWasImpostor: this.settings.confirmEjects || forModerator ? m.result.ejectedWasImpostor : null,
        votes: anonymous ? null : m.votes,
      };
    }
    if (forModerator) view.votes = m.votes;
    return view;
  }

  baseView(now) {
    return {
      serverNow: now,
      phase: this.phase,
      settings: this.settings,
      colors: COLORS,
      taskProgress: this.phase === 'lobby' ? null : this.taskProgress(),
      meeting: this.meetingView(this.meeting, false),
      lastMeetingId: this.lastMeeting ? this.lastMeeting.id : null,
      sabotage: this.sabotage
        ? {
          id: this.sabotage.id,
          endsAt: this.sabotage.endsAt,
          fixes: this.sabotage.fixedBy.length,
          needed: this.sabotage.needed,
          // Wer repariert, ist für alle sichtbar – sonst wüsste niemand, wer zum Reaktor muss.
          assigned: this.sabotage.assigned,
          fixedBy: this.sabotage.fixedBy,
          // Reparatur-Aufgabe je Spieler – ohne Code, der steht nur am Aufgabenort
          tasks: Object.fromEntries(Object.entries(this.sabotage.tasks).map(([pid, t]) => [pid, t
            ? { name: t.name, location: t.location, description: t.description, needsCode: !!t.code } : null])),
        }
        : null,
      sabotagesLeft: this.phase === 'lobby' ? this.settings.sabotagesPerRound : this.settings.sabotagesPerRound - this.sabotagesUsed,
      winner: this.winner,
      announcements: this.announcements.slice(-5),
    };
  }

  viewFor(playerId, now) {
    const me = this.players.get(playerId);
    if (!me) return null;
    const view = this.baseView(now);
    const isImpostor = me.role === 'impostor';
    view.players = [...this.players.values()].map((p) => {
      const pub = this.publicPlayer(p);
      // Tote sehen alles über Leben/Tod; Impostor kennen ihre Opfer ohnehin.
      if (!me.alive || isImpostor || this.phase === 'ended') pub.alive = p.alive;
      if (this.phase === 'ended' || (isImpostor && p.role === 'impostor')) pub.role = p.role;
      return pub;
    });
    view.me = {
      id: me.id,
      name: me.name,
      color: me.color,
      selected: me.selected,
      role: me.role,
      alive: me.alive,
      ejected: me.ejected,
      tasks: me.tasks.map((t) => ({ id: t.id, name: t.name, location: t.location, description: t.description, needsCode: !!t.code, done: t.done })),
      meetingsLeft: me.meetingsLeft,
      killReadyAt: isImpostor ? me.killReadyAt : null,
      sabotageReadyAt: isImpostor ? this.sabotageReadyAt : null,
      hasFixed: this.sabotage ? this.sabotage.fixedBy.includes(me.id) : false,
      mustFix: this.sabotage ? this.sabotage.assigned.includes(me.id) && !this.sabotage.fixedBy.includes(me.id) : false,
      // Impostor sehen die laufenden verzögerten Kills ihres Teams
      pendingKills: isImpostor ? this.pendingKills.map((k) => ({ victimId: k.victimId, impostorId: k.impostorId, diesAt: k.diesAt })) : [],
      myVote: this.meeting ? this.meeting.votes[me.id] ?? null : null,
    };
    // Unentdeckte Leichen, die gemeldet werden können
    view.reportable = this.phase === 'playing' && me.alive
      ? this.participants().filter((p) => !p.alive && !p.bodyReported).map((p) => p.id)
      : [];
    return view;
  }

  moderatorView(now) {
    const view = this.baseView(now);
    view.meeting = this.meetingView(this.meeting, true);
    view.players = [...this.players.values()].map((p) => ({
      ...this.publicPlayer(p),
      alive: p.alive,
      role: p.role,
      fixedImpostor: this.fixedImpostors.has(p.id),
      bodyReported: p.bodyReported,
      meetingsLeft: p.meetingsLeft,
      tasks: p.tasks.map((t) => ({ name: t.name, location: t.location, done: t.done })),
      killReadyAt: p.killReadyAt,
    }));
    view.taskCatalog = this.taskCatalog;
    view.sabotageReadyAt = this.sabotageReadyAt;
    view.startedAt = this.startedAt;
    view.endedAt = this.endedAt;
    view.events = this.events.slice(-60);
    view.meetingHistory = this.meetingHistory;
    view.progressLog = this.progressLog;
    view.pendingKills = this.pendingKills;
    return view;
  }

  announce(text, now) {
    const clean = cleanText(text, 200);
    if (!clean) throw new GameError('Nachricht ist leer.');
    this.announcements.push({ id: id(), text: clean, at: now });
    if (this.announcements.length > 20) this.announcements.shift();
  }

  /** Was dauerhaft gespeichert wird (Aufgaben und Einstellungen). */
  config() {
    return { settings: this.settings, tasks: this.taskCatalog };
  }
}

module.exports = { Game, GameError, COLORS, DEFAULT_SETTINGS, DEFAULT_TASKS };
