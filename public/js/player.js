'use strict';

const TOKEN_KEY = 'amongus_token';
let token = localStorage.getItem(TOKEN_KEY);
let state = null;
let secretOpen = false;
let seenAnnouncement = localStorage.getItem('amongus_seen_announcement') || null;

const joinScreen = $('#join');
const gameScreen = $('#game');

function show(screen) {
  joinScreen.classList.toggle('hidden', screen !== 'join');
  gameScreen.classList.toggle('hidden', screen !== 'game');
}

/* ---------- Verbindung & Beitritt ---------- */

socket.on('connect', async () => {
  if (!token) return show('join');
  const res = await new Promise((r) => socket.emit('player:join', { token }, r));
  if (!res.ok) {
    // Server neu gestartet oder Spieler entfernt
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    show('join');
  }
});

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const name = $('#name').value;
  const res = await send('player:join', { name });
  if (res.ok) {
    token = res.token;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('amongus_name', name);
  }
});
$('#name').value = localStorage.getItem('amongus_name') || '';
setHTML($('#join-avatar'), crewmate('#c51111', { size: 90 }));

socket.on('kicked', () => {
  token = null;
  state = null;
  localStorage.removeItem(TOKEN_KEY);
  setHTML($('#overlay'), '');
  show('join');
  toast('Du wurdest vom Moderator entfernt.', 'error');
});

socket.on('state', (next) => {
  syncClock(next);
  detectEvents(state, next);
  state = next;
  if (!state) return show('join');
  show('game');
  render();
  updateCountdowns();
});

/* ---------- Ereignisse erkennen (Ton, Vibration, Hinweise) ---------- */

function detectEvents(prev, next) {
  if (!next || !next.me) return;
  const me = next.me;
  if (prev && prev.phase === 'lobby' && next.phase === 'playing') {
    sounds.start();
    secretOpen = false;
    if (me.role) showRoleReveal(next);
  }
  if (next.meeting && (!prev || !prev.meeting || prev.meeting.id !== next.meeting.id)) {
    sounds.meeting();
    closeModal();
  }
  // Spielleiter hat die Diskussion gestartet
  if (prev && prev.meeting && next.meeting && prev.meeting.id === next.meeting.id
    && prev.meeting.stage === 'gathering' && next.meeting.stage !== 'gathering') sounds.notify();
  if (next.sabotage && (!prev || !prev.sabotage || prev.sabotage.id !== next.sabotage.id)) sounds.sabotage();
  // Moderator hat ein Beweisfoto abgelehnt
  if (prev && prev.me) {
    for (const t of me.tasks) {
      const before = prev.me.tasks.find((x) => x.id === t.id);
      if (t.rejected && before && !before.rejected) {
        sounds.notify();
        toast(`❌ Dein Foto für „${t.name}“ wurde abgelehnt. Bitte nochmal erledigen!`, 'error', 8000);
      }
    }
  }
  // Ausgelost (auch als Ersatz für einen gestorbenen Reparierer)
  if (me.mustFix && (!prev || !prev.me || !prev.me.mustFix)) {
    vibrate([400, 150, 400, 150, 400]);
    toast('🔧 Du bist ausgelost! Lauf zum Reaktor und repariere ihn!', 'error', 8000);
  }
  if (prev && prev.me && prev.me.alive && !me.alive && me.role && !me.ejected) {
    sounds.kill();
    toast('Du wurdest getötet! Bleib liegen, bis du gefunden wirst. 💀', 'error', 6000);
  }
  if (prev && prev.phase !== 'ended' && next.phase === 'ended') sounds.start();
  const last = next.announcements[next.announcements.length - 1];
  if (last && last.id !== seenAnnouncement) {
    seenAnnouncement = last.id;
    localStorage.setItem('amongus_seen_announcement', last.id);
    if (prev) {
      sounds.notify();
      toast(`📢 ${last.text}`, 'info', 8000);
    }
  }
}

/** Box mit den anderen Impostorn (nur Impostor bekommen diese Daten vom Server). */
function impostorTeam(partners, colors) {
  if (!partners.length) return '<div class="imp-team"><p>Du bist der einzige Impostor. Viel Glück!</p></div>';
  return `<div class="imp-team">
    <p>${partners.length === 1 ? 'Dein Komplize ist:' : 'Deine Komplizen sind:'}</p>
    <div class="imp-team-list">${partners.map((p) => `
      <div class="imp-mate ${p.alive === false ? 'is-dead' : ''}">${crewmate(colors[p.color]?.hex, { dead: p.alive === false, size: 46 })}<b>${esc(p.name)}</b></div>`).join('')}</div>
    <p class="hint">Verratet euch nicht – nur ihr wisst voneinander.</p>
  </div>`;
}

function showRoleReveal(s) {
  const me = s.me;
  const isImp = me.role === 'impostor';
  const partners = s.players.filter((p) => p.role === 'impostor' && p.id !== me.id);
  openModal(`
    <div class="reveal ${isImp ? 'impostor' : 'crew'}">
      <p class="small">Schirm verdecken! Deine Rolle:</p>
      <h2>${isImp ? 'IMPOSTOR' : 'CREWMATE'}</h2>
      ${crewmate(s.colors[me.color].hex, { size: 110 })}
      ${isImp ? impostorTeam(partners, s.colors) : `<p>Unter euch ${s.settings.impostors === 1 ? 'ist <b>1 Impostor</b>' : `sind <b>${s.settings.impostors} Impostor</b>`}. Erledige deine Aufgaben!</p>`}
      <button class="btn primary big" data-close>Verstanden</button>
    </div>`);
}

/* ---------- Rendering ---------- */

function colorOf(p) {
  return state.colors[p.color]?.hex || '#888';
}

function playerById(id) {
  return state.players.find((p) => p.id === id);
}

function render() {
  const me = state.me;
  renderHeader(me);
  renderAnnouncement();
  if (state.phase === 'lobby') setHTML($('#main'), renderLobby(me));
  else if (!me.role) setHTML($('#main'), renderSpectator());
  else setHTML($('#main'), renderPlaying(me));
  renderOverlay(me);
}

function renderHeader(me) {
  const status = !me.role ? (state.phase === 'lobby' ? (me.selected ? 'Bereit' : 'Zuschauer') : 'Zuschauer')
    : me.alive ? 'Am Leben' : me.ejected ? 'Rausgeworfen 👻' : 'Tot 👻';
  setHTML($('#me-header'), `
    ${crewmate(colorOf(me), { dead: !me.alive && !!me.role, size: 44 })}
    <div class="me-info">
      <div class="me-name">${esc(me.name)} ${state.settings.demoMode ? '<span class="badge demo">DEMO</span>' : ''}</div>
      <div class="me-status">${esc(status)}</div>
    </div>
    ${state.phase === 'lobby' ? '<button class="btn small secondary" data-action="rename">✏️</button>' : ''}`);
}

function renderAnnouncement() {
  const last = state.announcements[state.announcements.length - 1];
  const fresh = last && serverNow() - last.at < 5 * 60 * 1000;
  setHTML($('#announcement'), fresh ? `<div class="announcement">📢 ${esc(last.text)}</div>` : '');
}

function playerChips(list, { showDead = true } = {}) {
  return `<div class="player-grid">${list.map((p) => `
    <div class="chip ${p.alive || !showDead ? '' : 'is-dead'} ${p.connected ? '' : 'offline'}">
      ${crewmate(colorOf(p), { dead: showDead && !p.alive, size: 30 })}
      <span>${esc(p.name)}${p.role === 'impostor' ? ' 🔪' : ''}</span>
    </div>`).join('')}</div>`;
}

function renderLobby(me) {
  const players = state.players.filter((p) => p.selected);
  const used = new Set(state.players.filter((p) => p.id !== me.id).map((p) => p.color));
  return `
    <div class="card center">
      <h2>Warte auf den Start …</h2>
      <p>${me.selected ? 'Du bist für die nächste Runde ausgewählt ✅' : 'Du bist gerade <b>nicht</b> ausgewählt. Der Moderator entscheidet.'}</p>
      <div class="big-avatar">${crewmate(colorOf(me), { size: 100 })}</div>
    </div>
    <div class="card">
      <h3>Deine Farbe</h3>
      <div class="color-grid">${state.colors.map((c, i) => `
        <button class="color-dot ${i === me.color ? 'active' : ''}" style="--c:${c.hex}" title="${esc(c.name)}"
          data-action="color" data-color="${i}" ${used.has(i) ? 'disabled' : ''}></button>`).join('')}</div>
    </div>
    <div class="card">
      <h3>Mitspieler (${players.length})</h3>
      ${playerChips(players, { showDead: false })}
    </div>
    <button class="btn secondary" data-action="leave">Spiel verlassen</button>`;
}

function renderSpectator() {
  return `
    <div class="card center">
      <h2>👀 Du schaust zu</h2>
      <p>Das Spiel läuft bereits. In der nächsten Runde kann dich der Moderator auswählen.</p>
    </div>
    ${renderProgress()}
    ${renderSabotage(null)}
    <div class="card"><h3>Spieler</h3>${playerChips(state.players.filter((p) => p.playing))}</div>`;
}

function renderProgress() {
  const tp = state.taskProgress;
  if (!tp || !tp.total) return '';
  const pct = Math.round((tp.done / tp.total) * 100);
  return `<div class="card progress-card">
    <div class="progress-label"><span>Aufgaben gesamt</span><span>${pct}%</span></div>
    <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
  </div>`;
}

function renderSabotage(me) {
  const s = state.sabotage;
  if (!s || state.phase !== 'playing') return '';
  const fixers = s.assigned.map((id) => {
    const p = playerById(id);
    const done = s.fixedBy.includes(id);
    const t = s.tasks[id];
    return p ? `<div class="fixer ${done ? 'done' : ''}">${crewmate(colorOf(p), { size: 24 })}
      <span><span><b>${esc(p.name)}</b> ${done ? '✅' : '⏳'}</span>${t ? `<small>${taskTitle(t)}${t.location ? ` · 📍 ${esc(t.location)}` : ''}</small>` : ''}</span></div>` : '';
  }).join('');
  let action = '';
  if (me && me.mustFix && me.alive) {
    const t = s.tasks[me.id];
    action = `<div class="repair-task">
        <p>Du bist ausgelost! Deine Reparatur-Aufgabe:</p>
        ${t ? `<h3>${esc(t.name)}</h3>${t.variant ? `<p class="task-variant">🎯 ${esc(t.variant)}</p>` : ''}${t.location ? `<p>📍 ${esc(t.location)}</p>` : ''}${t.description ? `<p class="task-desc">${esc(t.description)}</p>` : ''}` : ''}
      </div>
      <button class="btn danger big" data-action="fix">🔧 ${t ? 'Aufgabe erledigt – reparieren' : 'Reaktor reparieren'}</button>`;
  } else if (me && me.hasFixed) {
    action = '<p><b>Du hast repariert ✅ – jetzt muss noch der andere!</b></p>';
  } else if (me && me.role) {
    action = '<p class="hint">Du bist nicht ausgelost. Hilf den anderen, schnell zum Reaktor zu kommen!</p>';
  }
  return `<div class="card sabotage">
    <h2>⚠️ REAKTOR-KERNSCHMELZE ⚠️</h2>
    <p class="huge">${countdown(s.endsAt)}</p>
    <p>Diese Spieler müssen ihre Reparatur-Aufgabe erledigen (${s.fixes}/${s.needed}):</p>
    <div class="fixers">${fixers}</div>
    ${action}
  </div>`;
}

function renderPlaying(me) {
  const isImp = me.role === 'impostor';
  const openTasks = me.tasks.filter((t) => !t.done).length;
  const reportable = state.reportable.map(playerById).filter(Boolean);
  const meetingBlocked = !!state.sabotage;

  const tasks = !me.alive ? `<div class="card center">
    <h3>Deine Aufgaben</h3>
    <p>👻 Du bist tot und musst <b>keine Aufgaben mehr</b> machen.</p>
    <p class="hint">${me.ejected ? 'Deine offenen Aufgaben zählen für die Crew nicht mehr mit.' : 'Sobald deine Leiche gefunden wurde, zählen deine offenen Aufgaben für die Crew nicht mehr mit.'}</p>
  </div>` : `<div class="card">
    <h3>Deine Aufgaben ${openTasks ? `(${openTasks} offen)` : '✅'}</h3>
    <ul class="task-list">${me.tasks.map((t) => `
      <li class="task ${t.done ? 'done' : ''}">
        <button data-action="task" data-task="${t.id}" ${t.done ? 'disabled' : ''}>
          <span class="check">${t.done ? '✔' : ''}</span>
          <span class="task-text"><b>${esc(t.name)}</b>${t.variant ? `<span class="task-variant">🎯 ${esc(t.variant)}</span>` : ''}${t.location ? `<small>📍 ${esc(t.location)}</small>` : ''}${t.description && !t.done ? `<span class="task-desc">${esc(t.description)}</span>` : ''}${t.rejected && !t.done ? '<span class="task-rejected">❌ Foto abgelehnt – bitte nochmal erledigen</span>' : ''}</span>
          ${t.needsCode && !t.done ? '<span class="tag">Code</span>' : ''}
          ${t.needsPhoto && !t.done ? '<span class="tag photo-tag">📷</span>' : ''}
        </button>
      </li>`).join('')}</ul>
  </div>`;

  const actions = me.alive ? `<div class="actions">
      <button class="btn report big" data-action="report" ${reportable.length && !meetingBlocked ? '' : 'disabled'}>
        🚨 Leiche melden</button>
      <button class="btn emergency big" data-action="emergency" ${me.meetingsLeft > 0 && !meetingBlocked ? '' : 'disabled'}>
        📣 Notfall-Meeting <small>(${me.meetingsLeft} übrig)</small></button>
      <button class="btn secondary" data-action="died">💀 Ich wurde getötet</button>
    </div>` : `<div class="card ghost center">
      <h2>👻 Du bist ein Geist</h2>
      <p>${me.ejected ? 'Du wurdest rausgeworfen.' : 'Bleib liegen, bis deine Leiche gemeldet wurde. Danach darfst du dich als Geist bewegen.'}</p>
      <p>Nicht mehr reden! Abstimmen darfst du nicht mehr.</p>
    </div>`;

  let secret = '';
  if (secretOpen) {
    const partners = state.players.filter((p) => p.role === 'impostor' && p.id !== me.id);
    const pendingIds = new Set(me.pendingKills.map((k) => k.victimId));
    const victims = state.players.filter((p) => p.playing && p.alive && p.role !== 'impostor' && !pendingIds.has(p.id));
    const pending = me.pendingKills.map((k) => {
      const v = playerById(k.victimId);
      const by = k.impostorId === me.id ? '' : ` (von ${esc(playerById(k.impostorId)?.name || '?')})`;
      return v ? `<li>☠️ <b>${esc(v.name)}</b>${by} stirbt in ${countdown(k.diesAt, { doneText: 'gleich' })}</li>` : '';
    }).join('');
    const sabLeft = state.sabotagesLeft;
    secret = isImp ? `
      <div class="secret impostor">
        <h3>Du bist IMPOSTOR 🔪</h3>
        ${impostorTeam(partners, state.colors)}
        <p class="hint">Deine Aufgaben sind nur Tarnung – sie zählen nicht.</p>
        ${me.alive ? `<button class="btn danger big" id="kill-btn" data-action="kill" ${victims.length ? '' : 'disabled'}>
          🔪 Opfer auswählen ${countdown(me.killReadyAt, { prefix: '– ', doneText: '– bereit', toggle: 'kill-btn' })}</button>` : ''}
        ${state.settings.killDelay > 0 ? `<p class="hint">Opfer sterben erst ${state.settings.killDelay} Sekunden nach deinem Kill.</p>` : ''}
        ${pending ? `<ul class="pending-kills">${pending}</ul>` : ''}
        ${state.settings.sabotageEnabled ? (sabLeft > 0
          ? `<button class="btn warning big" id="sabotage-btn" data-action="sabotage" ${state.sabotage ? 'disabled' : ''}>
              ☢️ Reaktor sabotieren <small>(${sabLeft} übrig)</small> ${state.sabotage ? '' : countdown(me.sabotageReadyAt, { prefix: '– ', doneText: '– bereit', toggle: 'sabotage-btn' })}</button>`
          : '<p class="hint">Keine Sabotagen mehr in dieser Runde.</p>') : ''}
      </div>` : `
      <div class="secret crew">
        <h3>Du bist CREWMATE 👩‍🚀</h3>
        <p>Erledige deine Aufgaben und finde die Impostor!</p>
      </div>`;
  }

  return `
    ${renderSabotage(me)}
    ${renderProgress()}
    <button class="btn secret-toggle" data-action="secret">${secretOpen ? '🔓 Rolle verbergen' : '🔒 Rolle & Aktionen zeigen'}</button>
    ${secret}
    ${tasks}
    ${actions}`;
}

function renderOverlay(me) {
  if (state.phase === 'meeting' && state.meeting) return setHTML($('#overlay'), renderMeeting(me, state.meeting));
  if (state.phase === 'ended' && state.winner) return setHTML($('#overlay'), renderEnded(me));
  setHTML($('#overlay'), '');
}

function renderMeeting(me, m) {
  const caller = m.callerId ? playerById(m.callerId) : null;
  const body = m.bodyId ? playerById(m.bodyId) : null;
  const participants = state.players.filter((p) => p.playing);
  const canVote = me.role && me.alive && m.stage === 'voting' && !me.myVote;
  const voted = new Set(m.votedIds);

  let content = '';
  if (m.stage === 'gathering') {
    content = `<p class="stage">🏃 Alle zum Treffpunkt!</p>
      <p class="hint">Die Diskussion beginnt, sobald alle da sind und der Spielleiter sie startet.</p>
      ${playerChips(participants)}`;
  } else if (m.stage === 'discussion') {
    content = `<p class="stage">Diskussion – Abstimmung in ${countdown(m.endsAt)}</p>
      <p class="hint">Besprecht, was ihr gesehen habt.</p>
      ${playerChips(participants)}`;
  } else if (m.stage === 'voting') {
    content = `<p class="stage">Abstimmung – noch ${countdown(m.endsAt)}</p>
      ${!me.role ? '<p class="hint">Du schaust zu.</p>' : !me.alive ? '<p class="hint">Geister dürfen nicht abstimmen.</p>'
        : me.myVote ? `<p class="hint">Du hast für <b>${me.myVote === 'skip' ? 'Überspringen' : esc(playerById(me.myVote)?.name)}</b> gestimmt.</p>`
        : '<p class="hint">Tippe auf einen Spieler, um abzustimmen.</p>'}
      <div class="vote-grid">${participants.map((p) => `
        <button class="vote ${p.alive ? '' : 'is-dead'} ${me.myVote === p.id ? 'mine' : ''}" data-action="vote" data-target="${p.id}"
          ${canVote && p.alive ? '' : 'disabled'}>
          ${crewmate(colorOf(p), { dead: !p.alive, size: 34 })}
          <span>${esc(p.name)}</span>
          ${p.role === 'impostor' && p.id !== me.id ? '<span class="voted mate">🔪 Komplize</span>' : ''}
          ${voted.has(p.id) ? '<span class="voted">✔ gewählt</span>' : ''}
        </button>`).join('')}</div>
      <button class="btn secondary big ${me.myVote === 'skip' ? 'mine' : ''}" data-action="vote" data-target="skip" ${canVote ? '' : 'disabled'}>⏭ Überspringen</button>`;
  } else {
    const r = m.result;
    const ejected = r.ejectedId ? playerById(r.ejectedId) : null;
    const tally = Object.entries(r.tally).sort((a, b) => b[1] - a[1]);
    content = `<div class="result">
      ${ejected
        ? `${crewmate(colorOf(ejected), { size: 80 })}
           <h2>${esc(ejected.name)} wurde rausgeworfen.</h2>
           ${r.ejectedWasImpostor === null ? '' : `<p class="big-text">${esc(ejected.name)} war ${r.ejectedWasImpostor ? '' : '<b>k</b>'}ein Impostor.</p>`}`
        : `<h2>Niemand wurde rausgeworfen.</h2><p>${r.tie ? 'Gleichstand!' : 'Abstimmung übersprungen.'}</p>`}
      <ul class="tally">${tally.map(([target, count]) => {
        const voters = r.votes ? Object.entries(r.votes).filter(([, t]) => t === target).map(([v]) => playerById(v)?.name).filter(Boolean) : [];
        return `<li><b>${target === 'skip' ? 'Überspringen' : esc(playerById(target)?.name || '?')}</b>: ${count} Stimme${count === 1 ? '' : 'n'}
          ${voters.length ? `<small>(${voters.map(esc).join(', ')})</small>` : ''}</li>`;
      }).join('')}</ul>
      <p class="hint">Weiter in ${countdown(m.endsAt)}</p>
    </div>`;
  }

  return `<div class="fullscreen meeting">
    <h1>${m.type === 'report' ? '🚨 LEICHE GEMELDET' : '📣 NOTFALL-MEETING'}</h1>
    <p>${caller ? `Einberufen von <b>${esc(caller.name)}</b>` : 'Einberufen vom Moderator'}${body ? ` – Leiche: <b>${esc(body.name)}</b>` : ''}</p>
    ${content}
  </div>`;
}

function renderEnded(me) {
  const w = state.winner;
  const crewWon = w.team === 'crew';
  const won = me.role ? (me.role === 'impostor') !== crewWon : null;
  const participants = state.players.filter((p) => p.playing);
  return `<div class="fullscreen ended ${crewWon ? 'crew' : 'impostor'}">
    <h1>${crewWon ? 'SIEG DER CREW' : 'SIEG DER IMPOSTOR'}</h1>
    <p class="big-text">${esc(w.reason)}</p>
    ${won === null ? '' : `<h2>${won ? '🏆 Ihr habt gewonnen!' : '😵 Ihr habt verloren.'}</h2>`}
    <div class="roles">
      <h3>Impostor</h3>${playerChips(participants.filter((p) => p.role === 'impostor'))}
      <h3>Crew</h3>${playerChips(participants.filter((p) => p.role === 'crewmate'))}
    </div>
    <p class="hint">Warte auf die nächste Runde …</p>
  </div>`;
}

/* ---------- Aktionen ---------- */

async function onAction(btn) {
  const action = btn.dataset.action;
  const me = state && state.me;
  switch (action) {
    case 'rename': {
      const name = prompt('Neuer Name:', me.name);
      if (name) {
        const res = await send('player:rename', { name });
        if (res.ok) localStorage.setItem('amongus_name', name);
      }
      break;
    }
    case 'color':
      send('player:color', { color: Number(btn.dataset.color) });
      break;
    case 'leave':
      if (await confirmDialog('Spiel wirklich verlassen?', { okText: 'Verlassen', danger: true })) {
        await send('player:leave');
        token = null;
        state = null;
        localStorage.removeItem(TOKEN_KEY);
        show('join');
      }
      break;
    case 'secret':
      secretOpen = !secretOpen;
      render();
      updateCountdowns();
      break;
    case 'task':
      completeTask(me.tasks.find((t) => t.id === btn.dataset.task));
      break;
    case 'report':
      pickPlayer('Wessen Leiche hast du gefunden?', state.reportable.map(playerById).filter(Boolean), 'Melden',
        (id) => send('meeting:call', { bodyId: id }));
      break;
    case 'emergency':
      if (await confirmDialog('Notfall-Meeting einberufen? Alle Spieler werden zusammengerufen.', { okText: 'Meeting!' })) {
        send('meeting:call', {});
      }
      break;
    case 'died':
      if (await confirmDialog('Wurdest du wirklich vom Impostor erwischt?', { okText: 'Ja, ich bin tot', danger: true })) {
        send('player:died');
      }
      break;
    case 'kill': {
      const pendingIds = new Set(me.pendingKills.map((k) => k.victimId));
      const victims = state.players.filter((p) => p.playing && p.alive && p.role !== 'impostor' && !pendingIds.has(p.id));
      const delay = state.settings.killDelay;
      pickPlayer('Wen willst du töten?', victims, 'Töten', (id) => send('player:kill', { victimId: id }).then((r) => {
        if (!r.ok) return;
        sounds.kill();
        if (delay > 0) toast(`${playerById(id)?.name} stirbt in ${delay} Sekunden.`, 'info', 5000);
      }));
      break;
    }
    case 'sabotage':
      if (await confirmDialog(`Reaktor sabotieren? Alle Geräte schlagen Alarm und ${state.settings.sabotageFixesNeeded} zufällige Crewmates müssen reparieren.`, { okText: 'Sabotieren', danger: true })) {
        send('sabotage:start');
      }
      break;
    case 'fix':
      repairReactor(state.sabotage && state.sabotage.tasks[me.id]);
      break;
    case 'vote': {
      const target = btn.dataset.target;
      const label = target === 'skip' ? 'die Abstimmung überspringen' : `für ${playerById(target)?.name} stimmen`;
      if (await confirmDialog(`Willst du ${label}?`, { okText: 'Abstimmen' })) send('meeting:vote', { targetId: target });
      break;
    }
    default:
  }
}

/** Foto verkleinern (max. 1280 px, JPEG), damit es schnell übers WLAN geht. */
async function shrinkImage(file, max = 1280, quality = 0.7) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
      img.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Gemeinsames Fenster zum Abschließen einer Aufgabe oder Reparatur (Code und/oder Beweisfoto). */
function taskDialog(task, { title, question, okText, okClass, event, payload, successText }) {
  const needsPhoto = !!task.needsPhoto;
  const modal = openModal(`
    <h2>${esc(title)}</h2>
    ${task.variant ? `<p class="task-variant big">🎯 ${esc(task.variant)}</p>` : ''}
    ${task.location ? `<p>📍 ${esc(task.location)}</p>` : ''}
    ${task.description ? `<p class="task-desc">${esc(task.description)}</p>` : ''}
    ${task.needsCode
      ? `<p>Gib den Code ein, den du am Aufgabenort findest:</p>
         <input id="task-code" autocomplete="off" autocapitalize="characters" placeholder="Code">`
      : needsPhoto ? '' : `<p>${esc(question)}</p>`}
    ${needsPhoto ? `<div class="photo-box">
        <p>Mach ein <b>Beweisfoto</b> von der erledigten Aufgabe:</p>
        <img id="photo-preview" class="photo-preview" alt="Vorschau des Beweisfotos" hidden>
        <label class="btn secondary photo-btn" id="photo-label">
          <input type="file" accept="image/*" capture="environment" id="photo-input" hidden>
          <span>📷 Foto aufnehmen</span>
        </label>
      </div>` : ''}
    <div class="row">
      <button class="btn secondary" data-close>Abbrechen</button>
      <button class="btn ${okClass}" id="task-ok" ${needsPhoto ? 'disabled' : ''}>${esc(okText)}</button>
    </div>`, { onOpen: (m) => m.querySelector('#task-code')?.focus() });
  const ok = modal.querySelector('#task-ok');
  let photo = null;
  modal.querySelector('#photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const label = modal.querySelector('#photo-label span');
    label.textContent = 'Foto wird vorbereitet …';
    try {
      photo = await shrinkImage(file);
      const preview = modal.querySelector('#photo-preview');
      preview.src = photo;
      preview.hidden = false;
      label.textContent = '📷 Neues Foto aufnehmen';
      ok.disabled = false;
    } catch {
      label.textContent = '📷 Foto aufnehmen';
      toast('Das Foto konnte nicht gelesen werden. Bitte nochmal versuchen.', 'error');
    }
  });
  const submit = async () => {
    if (ok.disabled) return;
    if (needsPhoto && !photo) return toast('Bitte zuerst ein Beweisfoto aufnehmen.', 'error');
    ok.disabled = true;
    const before = ok.textContent;
    if (photo) ok.textContent = 'Wird gesendet …';
    const code = modal.querySelector('#task-code')?.value || '';
    const res = await send(event, { ...payload, code, photo });
    ok.textContent = before;
    ok.disabled = false;
    if (res.ok) {
      closeModal();
      sounds.task();
      toast(successText, 'success');
    }
  };
  ok.addEventListener('click', submit);
  modal.querySelector('#task-code')?.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

function completeTask(task) {
  if (!task || task.done) return;
  taskDialog(task, {
    title: task.name,
    question: 'Hast du die Aufgabe im echten Leben erledigt?',
    okText: 'Erledigt ✔',
    okClass: 'primary',
    event: 'task:complete',
    payload: { taskId: task.id },
    successText: 'Aufgabe erledigt! ✅',
  });
}

function repairReactor(task) {
  if (!task || (!task.needsCode && !task.needsPhoto)) {
    send('sabotage:fix', {}).then((res) => {
      if (res.ok) {
        sounds.task();
        toast('Repariert! ✅', 'success');
      }
    });
    return;
  }
  taskDialog(task, {
    title: `🔧 ${task.name}`,
    question: '',
    okText: 'Reparieren',
    okClass: 'danger',
    event: 'sabotage:fix',
    payload: {},
    successText: 'Repariert! ✅',
  });
}

function pickPlayer(title, players, okText, onPick) {
  if (!players.length) return toast('Niemand verfügbar.', 'error');
  const modal = openModal(`
    <h2>${esc(title)}</h2>
    <div class="vote-grid">${players.map((p) => `
      <button class="vote" data-pick="${p.id}">${crewmate(colorOf(p), { dead: !p.alive, size: 34 })}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <button class="btn secondary" data-close>Abbrechen</button>`);
  modal.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
    closeModal();
    const p = playerById(b.dataset.pick);
    if (await confirmDialog(`${okText}: ${p ? p.name : ''}?`, { okText, danger: true })) onPick(b.dataset.pick);
  }));
}

for (const root of [$('#app'), $('#overlay')]) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn && !btn.disabled && state) onAction(btn);
  });
}
