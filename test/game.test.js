'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError } = require('../src/game');

function setup(n = 5, settings = {}) {
  const game = new Game({ settings: { discussionTime: 10, votingTime: 20, resultTime: 5, ...settings } });
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

test('Sabotage: zwei Reparaturen nötig, sonst gewinnen die Impostor', () => {
  const { game, impostors, crew } = started(5, { sabotageCooldown: 0, sabotageDuration: 30 });
  game.startSabotage(impostors[0].id, 0);
  assert.throws(() => game.callMeeting(crew[0].id, null, 1), /Sabotage/);
  game.fixSabotage(crew[0].id, 1);
  assert.throws(() => game.fixSabotage(crew[0].id, 2), /anderer Spieler/);
  game.fixSabotage(crew[1].id, 3);
  assert.equal(game.sabotage, null);

  const ctx = started(5, { sabotageCooldown: 0, sabotageDuration: 30 });
  ctx.game.startSabotage(ctx.impostors[0].id, 0);
  ctx.game.tick(31_000);
  assert.equal(ctx.game.winner.team, 'impostors');
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
