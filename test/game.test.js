'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError } = require('../src/game');

function setup(n = 5, settings = {}) {
  const game = new Game({ settings: { discussionTime: 10, votingTime: 20, resultTime: 5, manualMeetingStart: false, ...settings } });
  const players = [];
  for (let i = 0; i < n; i++) players.push(game.join(`P${i}`));
  return { game, players };
}

function started(n = 5, settings = {}) {
  const ctx = setup(n, settings);
  ctx.game.start(0);
  ctx.impostors = ctx.players.filter((p) => p.role === 'impostor');
  ctx.crew = ctx.players.filter((p) => p.role === 'crewmate');
  return ctx;
}

test('Beitritt: Namen eindeutig, Token stellt Spieler wieder her', () => {
  const { game, players } = setup(1);
  assert.throws(() => game.join('p0'), GameError);
  assert.equal(game.join('', players[0].token), players[0]);
  assert.throws(() => game.join('   '), GameError);
});

test('Start verteilt Rollen und Aufgaben', () => {
  const { game, impostors, crew } = started(6, { impostors: 2, tasksPerPlayer: 3 });
  assert.equal(game.phase, 'playing');
  assert.equal(impostors.length, 2);
  assert.equal(crew.length, 4);
  for (const p of [...impostors, ...crew]) assert.equal(p.tasks.length, 3);
});

test('Start braucht genug Spieler', () => {
  const { game } = setup(4, { impostors: 2 });
  assert.throws(() => game.start(0), /mindestens 5/);
});

test('Nicht ausgewählte Spieler spielen nicht mit; feste Impostor werden respektiert', () => {
  const { game, players } = setup(5);
  game.setSelected(players[4].id, false);
  game.setFixedImpostor(players[2].id, true);
  game.start(0);
  assert.equal(players[4].role, null);
  assert.equal(players[2].role, 'impostor');
});

test('Crew gewinnt, wenn alle Aufgaben erledigt sind (Impostor-Aufgaben zählen nicht)', () => {
  const { game, crew, impostors } = started(4);
  for (const t of impostors[0].tasks) game.completeTask(impostors[0].id, t.id);
  assert.equal(game.phase, 'playing');
  for (const p of crew) for (const t of p.tasks) game.completeTask(p.id, t.id);
  assert.equal(game.phase, 'ended');
  assert.equal(game.winner.team, 'crew');
});

test('Aufgaben-Code wird geprüft', () => {
  const game = new Game({ tasks: [{ name: 'Geheim', location: 'Keller', code: 'ABC' }] });
  ['a', 'b', 'c'].forEach((n) => game.join(n));
  game.start(0);
  const p = [...game.players.values()][0];
  assert.throws(() => game.completeTask(p.id, p.tasks[0].id, 'xyz'), /Falscher Code/);
  game.completeTask(p.id, p.tasks[0].id, 'abc');
  assert.equal(p.tasks[0].done, true);
});

test('Kill-Cooldown und Impostor-Sieg bei Gleichstand', () => {
  const { game, impostors, crew } = started(4, { killCooldown: 30 });
  const imp = impostors[0];
  assert.throws(() => game.kill(imp.id, crew[0].id, 1000), /Cooldown/);
  game.kill(imp.id, crew[0].id, 30_000);
  assert.equal(crew[0].alive, false);
  assert.throws(() => game.kill(imp.id, crew[1].id, 31_000), /Cooldown/);
  game.kill(imp.id, crew[1].id, 60_000);
  assert.equal(game.phase, 'ended');
  assert.equal(game.winner.team, 'impostors');
});

test('Meeting: Leiche melden, abstimmen, Impostor rauswerfen → Crew gewinnt nach Ergebnis-Anzeige', () => {
  const { game, impostors, crew } = started(5);
  game.reportOwnDeath(crew[0].id, 1000);
  assert.throws(() => game.callMeeting(crew[0].id, null, 1000), GameError); // Tote dürfen nicht
  game.callMeeting(crew[1].id, crew[0].id, 2000);
  assert.equal(game.phase, 'meeting');
  assert.equal(game.meeting.stage, 'discussion');
  assert.throws(() => game.vote(crew[1].id, impostors[0].id, 2000), /nicht abgestimmt/);
  game.tick(12_000);
  assert.equal(game.meeting.stage, 'voting');
  const alive = [...crew.slice(1), impostors[0]];
  for (const p of alive) game.vote(p.id, p === impostors[0] ? crew[1].id : impostors[0].id, 13_000);
  assert.equal(game.meeting.stage, 'result');
  assert.equal(game.meeting.result.ejectedId, impostors[0].id);
  assert.equal(game.phase, 'meeting'); // Ergebnis wird noch angezeigt
  game.tick(20_000);
  assert.equal(game.phase, 'ended');
  assert.equal(game.winner.team, 'crew');
});

test('Gleichstand → niemand fliegt raus; Notfall-Meetings sind begrenzt', () => {
  const { game, crew, impostors } = started(5, { emergencyMeetings: 1, discussionTime: 0 });
  game.callMeeting(crew[0].id, null, 0);
  assert.equal(game.meeting.stage, 'voting');
  game.vote(crew[0].id, crew[1].id, 1);
  game.vote(crew[1].id, crew[0].id, 1);
  game.vote(crew[2].id, 'skip', 1);
  game.vote(crew[3].id, 'skip', 1);
  game.vote(impostors[0].id, crew[2].id, 1);
  assert.equal(game.meeting.result.ejectedId, null);
  game.advanceMeeting(2);
  assert.equal(game.phase, 'playing');
  assert.throws(() => game.callMeeting(crew[0].id, null, 3), /keine Notfall-Meetings/);
});

test('Sabotage: nur die zwei ausgelosten Crewmates können reparieren, sonst gewinnen die Impostor', () => {
  const { game, impostors, crew } = started(5, { sabotageCooldown: 0, sabotageDuration: 30 });
  game.startSabotage(impostors[0].id, 0);
  const s = game.sabotage;
  assert.equal(s.assigned.length, 2);
  assert.ok(s.assigned.every((id) => game.players.get(id).role === 'crewmate'));
  assert.throws(() => game.callMeeting(crew[0].id, null, 1), /Sabotage/);
  const outsider = crew.find((p) => !s.assigned.includes(p.id));
  assert.throws(() => game.fixSabotage(outsider.id, 1), /nicht ausgelost/);
  game.fixSabotage(s.assigned[0], 1);
  assert.throws(() => game.fixSabotage(s.assigned[0], 2), /schon repariert/);
  game.fixSabotage(s.assigned[1], 3);
  assert.equal(game.sabotage, null);

  const ctx = started(5, { sabotageCooldown: 0, sabotageDuration: 30 });
  ctx.game.startSabotage(ctx.impostors[0].id, 0);
  ctx.game.tick(31_000);
  assert.equal(ctx.game.winner.team, 'impostors');
});

test('Sabotage: Anzahl pro Runde ist begrenzt', () => {
  const { game, impostors } = started(5, { sabotageCooldown: 0, sabotagesPerRound: 1 });
  game.startSabotage(impostors[0].id, 0);
  game.endSabotage(1);
  assert.throws(() => game.startSabotage(impostors[0].id, 2), /keine Sabotagen mehr/);
  assert.equal(game.viewFor(impostors[0].id, 2).sabotagesLeft, 0);
});

test('Sabotage: stirbt ein ausgeloster Reparierer, übernimmt ein anderer', () => {
  const { game, impostors } = started(6, { sabotageCooldown: 0 });
  game.startSabotage(impostors[0].id, 0);
  const [first] = game.sabotage.assigned;
  game.reportOwnDeath(first, 1);
  assert.equal(game.sabotage.assigned.length, 2);
  assert.ok(!game.sabotage.assigned.includes(first));
});

test('Verzögerter Kill: Opfer stirbt erst nach der eingestellten Zeit, nicht während eines Meetings', () => {
  const { game, impostors, crew } = started(6, { killCooldown: 0, killDelay: 20, discussionTime: 0 });
  const imp = impostors[0];
  game.kill(imp.id, crew[0].id, 1000);
  assert.equal(crew[0].alive, true);
  assert.throws(() => game.kill(imp.id, crew[0].id, 1000), /stirbt bereits/);
  assert.deepEqual(game.viewFor(imp.id, 1000).me.pendingKills.map((k) => k.victimId), [crew[0].id]);
  assert.deepEqual(game.viewFor(crew[0].id, 1000).me.pendingKills, []);
  game.tick(20_000);
  assert.equal(crew[0].alive, true);
  // Meeting läuft, als die Zeit abläuft: Tod erst danach
  game.callMeeting(crew[1].id, null, 20_500);
  game.tick(22_000);
  assert.equal(crew[0].alive, true);
  game.advanceMeeting(22_000); // Abstimmung beenden
  game.advanceMeeting(22_000); // Meeting beenden
  game.tick(22_100);
  assert.equal(crew[0].alive, false);
  assert.equal(game.pendingKills.length, 0);
});

test('Verzögerter Kill entfällt, wenn das Opfer vorher rausgeworfen wird', () => {
  const { game, impostors, crew } = started(6, { killCooldown: 0, killDelay: 30, discussionTime: 0 });
  game.kill(impostors[0].id, crew[0].id, 0);
  game.callMeeting(crew[1].id, null, 1);
  for (const p of game.participants().filter((x) => x.alive)) game.vote(p.id, crew[0].id, 2);
  assert.equal(crew[0].ejected, true);
  assert.equal(game.pendingKills.length, 0);
});

test('Spieleransicht verrät keine fremden Rollen und keine unentdeckten Leichen', () => {
  const { game, impostors, crew } = started(5, { killCooldown: 0 });
  game.kill(impostors[0].id, crew[0].id, 0);
  const view = game.viewFor(crew[1].id, 0);
  assert.ok(view.players.every((p) => p.role === undefined));
  assert.equal(view.players.find((p) => p.id === crew[0].id).alive, true);
  assert.deepEqual(view.reportable, [crew[0].id]);
  const impView = game.viewFor(impostors[0].id, 0);
  assert.equal(impView.players.find((p) => p.id === impostors[0].id).role, 'impostor');
  assert.equal(impView.players.find((p) => p.id === crew[0].id).alive, false);
  assert.ok(!JSON.stringify(view).includes('"code"'));
});

test('Neue Runde setzt alles zurück', () => {
  const { game, players } = started(4);
  game.end('crew', 'test');
  game.resetRound();
  assert.equal(game.phase, 'lobby');
  assert.ok(players.every((p) => p.role === null && p.alive && p.tasks.length === 0));
});

test('Live-Board: Ereignisse, Meeting-Verlauf und Fortschritt werden protokolliert', () => {
  const { game, impostors, crew } = started(5, { killCooldown: 0, discussionTime: 0 });
  game.completeTask(crew[0].id, crew[0].tasks[0].id, '', 1000);
  game.kill(impostors[0].id, crew[1].id, 2000);
  game.callMeeting(crew[0].id, crew[1].id, 3000);
  for (const p of [crew[0], crew[2], crew[3], impostors[0]]) game.vote(p.id, 'skip', 4000);
  const types = game.events.map((e) => e.type);
  assert.deepEqual(types, ['start', 'task', 'kill', 'report', 'eject']);
  assert.equal(game.events.find((e) => e.type === 'kill').secret, true);
  assert.equal(game.events.find((e) => e.type === 'report').secret, false);
  assert.equal(game.meetingHistory.length, 1);
  assert.equal(game.meetingHistory[0].ejectedId, null);
  assert.equal(game.progressLog.length, 2);
  const view = game.moderatorView(5000);
  assert.equal(view.events.length, 5);
  assert.equal(view.meetingHistory.length, 1);
});

test('Sabotage: jeder Reparierer bekommt eine eigene zufällige Aufgabe aus dem Katalog, Code wird geprüft', () => {
  const game = new Game({
    settings: { sabotageCooldown: 0 },
    tasks: [
      { name: 'Kabel', location: 'Flur', code: 'K1' },
      { name: 'Müll', location: 'Küche' },
      { name: 'Aus', location: 'Keller', enabled: false },
    ],
  });
  const ps = ['a', 'b', 'c', 'd', 'e'].map((n) => game.join(n));
  game.start(0);
  const imp = ps.find((p) => p.role === 'impostor');
  game.startSabotage(imp.id, 0);
  const s = game.sabotage;
  const names = s.assigned.map((id) => s.tasks[id].name).sort();
  assert.deepEqual(names, ['Kabel', 'Müll']); // verschieden, nur aktive Aufgaben
  const view = game.viewFor(s.assigned[0], 0);
  assert.ok(!JSON.stringify(view.sabotage).includes('K1')); // Code wird nicht verraten
  const withCode = s.assigned.find((id) => s.tasks[id].code);
  const without = s.assigned.find((id) => !s.tasks[id].code);
  assert.throws(() => game.fixSabotage(withCode, 1, 'falsch'), /Falscher Code/);
  game.fixSabotage(without, 1);
  game.fixSabotage(withCode, 2, 'k1');
  assert.equal(game.sabotage, null);
});

test('Sabotage: Ersatz-Reparierer übernimmt die Aufgabe des Gestorbenen', () => {
  const { game, impostors } = started(6, { sabotageCooldown: 0 });
  game.startSabotage(impostors[0].id, 0);
  const [first] = game.sabotage.assigned;
  const task = game.sabotage.tasks[first];
  game.reportOwnDeath(first, 1);
  const replacement = game.sabotage.assigned.find((id) => !(id in game.sabotage.tasks) || game.sabotage.tasks[id] === task);
  assert.equal(game.sabotage.tasks[replacement], task);
  assert.ok(!(first in game.sabotage.tasks));
});

test('Aufgaben-Beschreibung: wird gespeichert, an Spieler verteilt und bei der Reparatur gezeigt', () => {
  const game = new Game({ settings: { sabotageCooldown: 0 }, tasks: [{ name: 'Kabel', location: 'Flur', description: 'Rot an Rot, Blau an Blau' }] });
  const t = game.addTask({ name: 'Müll', location: 'Küche', description: '  Beutel   zur Tonne  ' });
  assert.equal(t.description, 'Beutel zur Tonne');
  game.updateTask(t.id, { description: 'Neuer Text' });
  assert.equal(game.taskCatalog[1].description, 'Neuer Text');
  assert.equal(game.config().tasks[0].description, 'Rot an Rot, Blau an Blau');
  const ps = ['a', 'b', 'c', 'd', 'e'].map((n) => game.join(n));
  game.start(0);
  const view = game.viewFor(ps[0].id, 0);
  assert.ok(view.me.tasks.every((x) => typeof x.description === 'string' && x.description.length > 0));
  game.startSabotage(ps.find((p) => p.role === 'impostor').id, 0);
  const fixer = game.sabotage.assigned[0];
  assert.ok(game.viewFor(fixer, 0).sabotage.tasks[fixer].description.length > 0);
});

test('Standard-Aufgaben: 17 neue Aufgaben, Zurücksetzen ersetzt den Katalog', () => {
  const game = new Game({ tasks: [{ name: 'Alt', location: 'X' }] });
  assert.equal(game.taskCatalog.length, 1);
  game.resetTasks();
  assert.equal(game.taskCatalog.length, 17);
  assert.ok(!game.taskCatalog.some((t) => t.name === 'Alt'));
  assert.ok(game.taskCatalog.every((t) => t.name && t.description && t.enabled));
  assert.equal(new Set(game.taskCatalog.map((t) => t.id)).size, 17);
});

test('Meeting: Sammelphase ohne Zeitlimit, Diskussion startet erst durch den Spielleiter', () => {
  const { game, crew } = started(5, { manualMeetingStart: true, discussionTime: 30 });
  game.callMeeting(crew[0].id, null, 1000);
  assert.equal(game.meeting.stage, 'gathering');
  assert.equal(game.meeting.endsAt, null);
  assert.equal(game.tick(10 * 60 * 1000), false); // bleibt beliebig lange beim Sammeln
  assert.equal(game.meeting.stage, 'gathering');
  assert.throws(() => game.vote(crew[0].id, 'skip', 2000), /nicht abgestimmt/);
  game.advanceMeeting(700_000);
  assert.equal(game.meeting.stage, 'discussion');
  assert.equal(game.meeting.endsAt, 730_000);
  game.tick(730_000);
  assert.equal(game.meeting.stage, 'voting');
});

test('Meeting: ohne Diskussionszeit geht es nach dem Sammeln direkt zur Abstimmung', () => {
  const { game, crew } = started(5, { manualMeetingStart: true, discussionTime: 0 });
  game.callMeeting(crew[0].id, null, 0);
  game.advanceMeeting(5000);
  assert.equal(game.meeting.stage, 'voting');
});

test('Demomodus: Platzhalter statt echter Aufgaben, auch bei der Reparatur', () => {
  const { game, players, impostors } = started(5, { demoMode: true, tasksPerPlayer: 3, sabotageCooldown: 0 });
  const real = new Set(game.taskCatalog.map((t) => t.name));
  for (const p of players) {
    assert.equal(p.tasks.length, 3);
    assert.ok(p.tasks.every((t) => t.name.startsWith('Demo-Aufgabe') && !real.has(t.name)));
  }
  const view = JSON.stringify(game.viewFor(players[0].id, 0));
  assert.ok(![...real].some((n) => view.includes(n)));
  game.startSabotage(impostors[0].id, 0);
  assert.ok(Object.values(game.sabotage.tasks).every((t) => t.name.startsWith('Demo-Reparatur') && !t.code));
});
