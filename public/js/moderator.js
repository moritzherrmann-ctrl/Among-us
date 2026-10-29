'use strict';

const PIN_KEY = 'amongus_mod_pin';
let state = null;
let loggedIn = false;
let activeTab = 'game';

const SETTINGS = [
  ['impostors', 'Anzahl Impostor'],
  ['tasksPerPlayer', 'Aufgaben pro Spieler'],
  ['killCooldown', 'Kill-Cooldown (Sek.)'],
  ['killDelay', 'Opfer stirbt nach (Sek., 0 = sofort)'],
  ['discussionTime', 'Diskussionszeit (Sek.)'],
  ['votingTime', 'Abstimmungszeit (Sek.)'],
  ['resultTime', 'Ergebnis-Anzeige (Sek.)'],
  ['emergencyMeetings', 'Notfall-Meetings pro Spieler'],
  ['confirmEjects', 'Nach Rauswurf Rolle verraten'],
  ['anonymousVotes', 'Anonyme Abstimmung'],
  ['sabotageEnabled', 'Sabotage erlaubt'],
  ['sabotageDuration', 'Zeit bis Kernschmelze (Sek.)'],
  ['sabotageCooldown', 'Sabotage-Cooldown (Sek.)'],
  ['sabotagesPerRound', 'Sabotagen pro Runde'],
  ['sabotageFixesNeeded', 'Reparierer (zufällig ausgelost)'],
];

const PHASES = {
  lobby: ['Lobby', 'lobby'],
  playing: ['Spiel läuft', 'playing'],
  meeting: ['Meeting', 'meeting'],
  ended: ['Spiel beendet', 'ended'],
};

/* ---------- Login ---------- */

async function login(pin) {
  const res = await new Promise((r) => socket.emit('mod:login', { pin }, r));
  if (res.ok) {
    loggedIn = true;
    localStorage.setItem(PIN_KEY, pin);
    $('#login').classList.add('hidden');
    $('#dash').classList.remove('hidden');
  } else {
    localStorage.removeItem(PIN_KEY);
    toast(res.error, 'error');
  }
}

socket.on('connect', () => {
  const pin = localStorage.getItem(PIN_KEY);
  if (pin) login(pin);
});

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  unlockAudio();
  login($('#pin').value.trim());
});

socket.on('state', (next) => {
  syncClock(next);
  if (state) {
    if (next.meeting && (!state.meeting || state.meeting.id !== next.meeting.id)) sounds.meeting();
    if (next.sabotage && !state.sabotage) sounds.sabotage();
    if (next.phase === 'ended' && state.phase !== 'ended') sounds.start();
  }
  state = next;
  render();
  updateCountdowns();
});

/* ---------- Rendering ---------- */

const colorOf = (p) => state.colors[p.color]?.hex || '#888';
const playerById = (id) => state.players.find((p) => p.id === id);

function render() {
  if (!loggedIn || !state) return;
  const [label, cls] = PHASES[state.phase];
  setHTML($('#phase-badge'), `<span class="badge ${cls}">${label}</span>`);
  setHTML($('#tab-game'), renderGame());
  setHTML($('#tab-players'), renderPlayers());
  setHTML($('#task-list'), renderTasks());
  setHTML($('#tab-settings'), renderSettings());
}

function renderGame() {
  switch (state.phase) {
    case 'lobby': return renderLobby();
    case 'ended': return renderEnded();
    default: return renderRunning();
  }
}

function renderLobby() {
  const selected = state.players.filter((p) => p.selected);
  const fixed = state.players.filter((p) => p.fixedImpostor);
  const activeTasks = state.taskCatalog.filter((t) => t.enabled).length;
  const { impostors, tasksPerPlayer } = state.settings;
  const problems = [];
  if (selected.length < 3) problems.push('Mindestens 3 Spieler auswählen.');
  if (impostors * 2 >= selected.length) problems.push(`Für ${impostors} Impostor braucht ihr mindestens ${impostors * 2 + 1} Spieler.`);
  if (!activeTasks) problems.push('Mindestens eine Aufgabe aktivieren.');
  if (fixed.length > impostors) problems.push('Mehr Impostor festgelegt als eingestellt.');
  return `
    <div class="card">
      <h2>Neue Runde vorbereiten</h2>
      <div class="stats">
        <div><b>${selected.length}</b><span>Spieler ausgewählt</span></div>
        <div><b>${impostors}</b><span>Impostor</span></div>
        <div><b>${activeTasks}</b><span>aktive Aufgaben</span></div>
        <div><b>${Math.min(tasksPerPlayer, activeTasks)}</b><span>Aufgaben/Spieler</span></div>
      </div>
      ${fixed.length ? `<p class="hint">Fest eingeteilte Impostor: ${fixed.map((p) => esc(p.name)).join(', ')}</p>` : ''}
      ${problems.length ? `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <button class="btn primary big" data-action="start" ${problems.length ? 'disabled' : ''}>🚀 Spiel starten</button>
    </div>
    <div class="card">
      <h3>Beigetreten (${state.players.length})</h3>
      ${state.players.length ? `<div class="player-grid">${state.players.map((p) => `
        <div class="chip ${p.selected ? '' : 'unselected'} ${p.connected ? '' : 'offline'}">
          ${crewmate(colorOf(p), { size: 30 })}<span>${esc(p.name)}</span>
        </div>`).join('')}</div>` : '<p class="hint">Noch niemand da. Zeig den QR-Code, damit alle beitreten können.</p>'}
      <p class="hint">Auswahl, Impostor-Festlegung & Entfernen im Tab „Spieler".</p>
    </div>`;
}

function renderRunning() {
  const tp = state.taskProgress;
  const pct = tp.total ? Math.round((tp.done / tp.total) * 100) : 0;
  const participants = state.players.filter((p) => p.playing);
  const aliveImp = participants.filter((p) => p.alive && p.role === 'impostor').length;
  const aliveCrew = participants.filter((p) => p.alive && p.role === 'crewmate').length;
  const m = state.meeting;
  const s = state.sabotage;

  let meeting = '';
  if (m) {
    const caller = m.callerId ? playerById(m.callerId) : null;
    const body = m.bodyId ? playerById(m.bodyId) : null;
    const stageText = { discussion: 'Diskussion', voting: 'Abstimmung', result: 'Ergebnis' }[m.stage];
    const voteRows = participants.filter((p) => p.alive || m.votes[p.id]).map((p) => {
      const v = m.votes[p.id];
      return `<li>${esc(p.name)} → ${v ? (v === 'skip' ? '⏭ Überspringen' : esc(playerById(v)?.name || '?')) : '<i>noch nicht</i>'}</li>`;
    }).join('');
    let result = '';
    if (m.result) {
      const ej = m.result.ejectedId ? playerById(m.result.ejectedId) : null;
      result = `<p class="big-text">${ej ? `${esc(ej.name)} rausgeworfen (${m.result.ejectedWasImpostor ? 'Impostor' : 'Crewmate'})` : `Niemand rausgeworfen${m.result.tie ? ' (Gleichstand)' : ''}`}</p>`;
    }
    meeting = `<div class="card meeting-card">
      <h2>${m.type === 'report' ? '🚨 Leiche gemeldet' : '📣 Notfall-Meeting'}</h2>
      <p>${caller ? `von <b>${esc(caller.name)}</b>` : 'vom Moderator'}${body ? ` – Leiche: <b>${esc(body.name)}</b>` : ''}</p>
      <p class="stage">${stageText} – ${countdown(m.endsAt)}</p>
      ${result}
      <ul class="votes">${voteRows}</ul>
      <button class="btn primary" data-action="advance">⏩ ${m.stage === 'discussion' ? 'Abstimmung starten' : m.stage === 'voting' ? 'Abstimmung beenden' : 'Meeting beenden'}</button>
    </div>`;
  }

  const sabotage = s ? `<div class="card sabotage">
      <h2>☢️ Sabotage aktiv – ${countdown(s.endsAt)}</h2>
      <p>Ausgelost (${s.fixes}/${s.needed} repariert):</p>
      <ul class="repair-list">${s.assigned.map((id) => {
        const t = s.tasks[id];
        return `<li><b>${esc(playerById(id)?.name || '?')}</b> ${s.fixedBy.includes(id) ? '✅' : '⏳'}${t ? ` – ${esc(t.name)}${t.location ? ` (📍 ${esc(t.location)})` : ''}` : ''}</li>`;
      }).join('')}</ul>
      <button class="btn secondary" data-action="end-sabotage">Sabotage beenden</button>
    </div>` : '';

  const rows = participants.map((p) => {
    const done = p.tasks.filter((t) => t.done).length;
    const pending = (state.pendingKills || []).find((k) => k.victimId === p.id);
    const status = pending ? `☠️ stirbt in ${countdown(pending.diesAt, { doneText: 'gleich' })}`
      : p.alive ? '🟢 lebt' : p.ejected ? '🚀 rausgeworfen' : p.bodyReported ? '💀 tot' : '💀 tot (nicht gefunden)';
    return `<tr class="${p.alive ? '' : 'is-dead'}">
      <td><div class="cell-player">${crewmate(colorOf(p), { dead: !p.alive, size: 26 })}<span>${esc(p.name)}${p.connected ? '' : ' <small class="offline-dot">offline</small>'}</span></div></td>
      <td><span class="role ${p.role}">${p.role === 'impostor' ? '🔪 Impostor' : 'Crew'}</span></td>
      <td>${status}</td>
      <td>${p.role === 'impostor' ? (p.alive ? countdown(p.killReadyAt, { doneText: 'Kill bereit' }) : '–') : `${done}/${p.tasks.length}`}</td>
      <td>${p.alive
        ? `<button class="btn small danger" data-action="kill" data-id="${p.id}">Tot</button>`
        : `<button class="btn small secondary" data-action="revive" data-id="${p.id}">Wiederbeleben</button>`}</td>
    </tr>`;
  }).join('');

  return `
    ${meeting}
    ${sabotage}
    <div class="card">
      <div class="stats">
        <div><b>${aliveCrew}</b><span>Crew lebt</span></div>
        <div><b>${aliveImp}</b><span>Impostor leben</span></div>
        <div><b>${pct}%</b><span>Aufgaben</span></div>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      ${state.settings.sabotageEnabled ? `<p class="hint">Sabotagen übrig: ${state.sabotagesLeft} von ${state.settings.sabotagesPerRound}${!s && state.phase === 'playing' && state.sabotagesLeft > 0 ? ` · ${countdown(state.sabotageReadyAt, { prefix: 'bereit in ', doneText: 'bereit' })}` : ''}</p>` : ''}
    </div>
    <div class="card">
      <h3>Spieler</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Rolle</th><th>Status</th><th>Aufgaben</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="card">
      <h3>Steuerung</h3>
      <div class="actions">
        ${state.phase === 'playing' ? '<button class="btn emergency" data-action="meeting">📣 Meeting einberufen</button>' : ''}
        <button class="btn secondary" data-action="end" data-winner="crew">🏁 Beenden – Crew gewinnt</button>
        <button class="btn secondary" data-action="end" data-winner="impostors">🏁 Beenden – Impostor gewinnen</button>
        <button class="btn danger" data-action="lobby">⛔ Abbrechen → Lobby</button>
      </div>
    </div>`;
}

function renderEnded() {
  const w = state.winner;
  const participants = state.players.filter((p) => p.playing);
  const list = (role) => participants.filter((p) => p.role === role).map((p) => `
    <div class="chip ${p.alive ? '' : 'is-dead'}">${crewmate(colorOf(p), { dead: !p.alive, size: 30 })}<span>${esc(p.name)}</span></div>`).join('');
  return `<div class="card center ended-card ${w.team === 'crew' ? 'crew' : 'impostor'}">
      <h2>${w.team === 'crew' ? '🏆 Sieg der Crew' : '🔪 Sieg der Impostor'}</h2>
      <p class="big-text">${esc(w.reason)}</p>
      <h3>Impostor</h3><div class="player-grid">${list('impostor')}</div>
      <h3>Crew</h3><div class="player-grid">${list('crewmate')}</div>
      <button class="btn primary big" data-action="lobby">🔁 Zurück zur Lobby</button>
    </div>`;
}

function renderPlayers() {
  const lobby = state.phase === 'lobby';
  if (!state.players.length) return '<div class="card"><p class="hint">Noch keine Spieler beigetreten.</p></div>';
  return `<div class="card">
    <h3>Spielerauswahl</h3>
    ${lobby ? '' : '<p class="hint">Auswahl und Impostor-Festlegung sind nur in der Lobby änderbar.</p>'}
    <ul class="mod-players">${state.players.map((p) => `
      <li class="${p.connected ? '' : 'offline'}">
        <div class="cell-player">${crewmate(colorOf(p), { size: 30 })}
          <span><b>${esc(p.name)}</b><small>${p.connected ? '🟢 verbunden' : '⚪ offline'}${p.playing ? ` · spielt (${p.role === 'impostor' ? 'Impostor' : 'Crew'})` : ''}</small></span>
        </div>
        <div class="mod-player-actions">
          <label class="toggle"><input type="checkbox" data-action="select" data-id="${p.id}" ${p.selected ? 'checked' : ''} ${lobby ? '' : 'disabled'}> spielt mit</label>
          <label class="toggle"><input type="checkbox" data-action="fix-impostor" data-id="${p.id}" ${p.fixedImpostor ? 'checked' : ''} ${lobby ? '' : 'disabled'}> sicher Impostor</label>
          <button class="btn small secondary" data-action="rename" data-id="${p.id}">✏️</button>
          <button class="btn small danger" data-action="kick" data-id="${p.id}">Entfernen</button>
        </div>
      </li>`).join('')}</ul>
  </div>`;
}

function renderTasks() {
  const enabled = state.taskCatalog.filter((t) => t.enabled).length;
  return `<div class="card">
    <div class="row space">
      <h3>Aufgabenkatalog (${enabled}/${state.taskCatalog.length} aktiv)</h3>
      <div class="row">
        <button class="btn small secondary" data-action="tasks-all" data-enabled="1">Alle an</button>
        <button class="btn small secondary" data-action="tasks-all" data-enabled="0">Alle aus</button>
      </div>
    </div>
    <p class="hint">Jeder Spieler bekommt zufällig ${state.settings.tasksPerPlayer} der aktiven Aufgaben. Änderungen gelten ab der nächsten Runde.</p>
    <ul class="task-editor">${state.taskCatalog.map((t) => `
      <li class="${t.enabled ? '' : 'disabled'}">
        <input type="checkbox" data-field="enabled" data-id="${t.id}" ${t.enabled ? 'checked' : ''} title="aktiv">
        <input data-field="name" data-id="${t.id}" value="${esc(t.name)}" maxlength="60" placeholder="Aufgabe">
        <input data-field="location" data-id="${t.id}" value="${esc(t.location)}" maxlength="40" placeholder="Ort">
        <input data-field="code" data-id="${t.id}" value="${esc(t.code)}" maxlength="12" placeholder="Code">
        <button class="btn small danger" data-action="task-remove" data-id="${t.id}" title="löschen">🗑</button>
      </li>`).join('')}</ul>
  </div>`;
}

function renderSettings() {
  const lobby = state.phase === 'lobby';
  return `<div class="card">
    <h3>Spielregeln</h3>
    ${lobby ? '' : '<p class="hint">Einstellungen sind nur in der Lobby änderbar.</p>'}
    <div class="settings">${SETTINGS.map(([key, label]) => {
      const v = state.settings[key];
      return typeof v === 'boolean'
        ? `<label class="setting toggle"><input type="checkbox" data-setting="${key}" ${v ? 'checked' : ''} ${lobby ? '' : 'disabled'}> ${esc(label)}</label>`
        : `<label class="setting"><span>${esc(label)}</span><input type="number" min="0" data-setting="${key}" value="${v}" ${lobby ? '' : 'disabled'}></label>`;
    }).join('')}</div>
  </div>`;
}

/* ---------- Interaktion ---------- */

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${activeTab}`));
});

$('#dash').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.id;
  const p = id ? playerById(id) : null;
  switch (btn.dataset.action) {
    case 'start':
      send('mod:start');
      break;
    case 'advance':
      send('mod:meeting:advance');
      break;
    case 'meeting':
      if (await confirmDialog('Meeting für alle einberufen?', { okText: 'Meeting' })) send('mod:meeting');
      break;
    case 'end-sabotage':
      send('mod:sabotage:end');
      break;
    case 'end':
      if (await confirmDialog(`Spiel jetzt beenden? Gewinner: ${btn.dataset.winner === 'crew' ? 'Crew' : 'Impostor'}`, { okText: 'Beenden', danger: true })) {
        send('mod:end', { winner: btn.dataset.winner });
      }
      break;
    case 'lobby':
      if (state.phase === 'ended' || await confirmDialog('Runde abbrechen und zurück zur Lobby?', { okText: 'Abbrechen', danger: true })) {
        send('mod:lobby');
      }
      break;
    case 'kill':
      if (await confirmDialog(`${p.name} als tot markieren?`, { okText: 'Tot', danger: true })) send('mod:player:alive', { id, alive: false });
      break;
    case 'revive':
      if (await confirmDialog(`${p.name} wiederbeleben?`, { okText: 'Wiederbeleben' })) send('mod:player:alive', { id, alive: true });
      break;
    case 'rename': {
      const name = prompt('Neuer Name:', p.name);
      if (name) send('mod:player:rename', { id, name });
      break;
    }
    case 'kick':
      if (await confirmDialog(`${p.name} wirklich entfernen?`, { okText: 'Entfernen', danger: true })) send('mod:player:kick', { id });
      break;
    case 'task-remove':
      send('mod:task:remove', { id });
      break;
    case 'tasks-all':
      send('mod:task:all', { enabled: btn.dataset.enabled === '1' });
      break;
    default:
  }
});

$('#dash').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'select') send('mod:player:select', { id: el.dataset.id, selected: el.checked });
  else if (el.dataset.action === 'fix-impostor') send('mod:player:impostor', { id: el.dataset.id, fixed: el.checked });
  else if (el.dataset.setting) {
    send('mod:settings', { [el.dataset.setting]: el.type === 'checkbox' ? el.checked : Number(el.value) }).then(() => {
      // Wert vom Server übernehmen (z. B. wenn außerhalb der Grenzen)
      $('#tab-settings').__html = null;
      render();
    });
  } else if (el.dataset.field) {
    const value = el.type === 'checkbox' ? el.checked : el.value;
    send('mod:task:update', { id: el.dataset.id, [el.dataset.field]: value }).then((r) => {
      if (!r.ok) {
        $('#task-list').__html = null;
        render();
      }
    });
  }
});

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const res = await send('mod:task:add', {
    name: form.name.value,
    location: form.location.value,
    code: form.code.value,
  });
  if (res.ok) {
    form.reset();
    form.name.focus();
    toast('Aufgabe hinzugefügt', 'success');
  }
});

$('#announce-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.text;
  const res = await send('mod:announce', { text: input.value });
  if (res.ok) {
    input.value = '';
    toast('Nachricht gesendet', 'success');
  }
});

$('#qr-btn').addEventListener('click', async () => {
  const info = await fetch('/api/join-info').then((r) => r.json()).catch(() => null);
  if (!info) return toast('Konnte Adresse nicht laden.', 'error');
  openModal(`
    <h2>Zum Beitreten scannen</h2>
    ${info.qr ? `<img class="qr" src="${info.qr}" alt="QR-Code">` : ''}
    <p>Alle Geräte müssen im <b>gleichen WLAN</b> sein.</p>
    ${info.urls.map((u) => `<p class="url">${esc(u)}</p>`).join('')}
    <button class="btn primary" data-close>Schließen</button>`);
});
