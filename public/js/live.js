'use strict';

/* Live-Board für den PC/Beamer: Statistiken, Abstimmungen und Ereignisse in Echtzeit.
   "Geheimnisse zeigen" aus = Publikumsmodus, sicher für einen Bildschirm, den alle sehen. */

const PIN_KEY = 'amongus_mod_pin';
const SECRET_KEY = 'amongus_live_secret';
let state = null;
let loggedIn = false;
let joinInfo = null;
let secret = false;
try { secret = localStorage.getItem(SECRET_KEY) === '1'; } catch { /* egal */ }

/* ---------- Login ---------- */

async function login(pin) {
  const res = await new Promise((r) => socket.emit('mod:login', { pin }, r));
  if (!res.ok) {
    try { localStorage.removeItem(PIN_KEY); } catch { /* egal */ }
    return toast(res.error, 'error');
  }
  loggedIn = true;
  try { localStorage.setItem(PIN_KEY, pin); } catch { /* egal */ }
  $('#login').classList.add('hidden');
  $('#board').classList.remove('hidden');
  render();
}

socket.on('connect', () => {
  let pin = null;
  try { pin = localStorage.getItem(PIN_KEY); } catch { /* egal */ }
  if (pin) login(pin);
});

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  unlockAudio();
  login($('#pin').value.trim());
});

$('#secret-toggle').checked = secret;
$('#secret-toggle').addEventListener('change', (e) => {
  secret = e.target.checked;
  try { localStorage.setItem(SECRET_KEY, secret ? '1' : '0'); } catch { /* egal */ }
  render();
});

$('#fullscreen-btn').addEventListener('click', () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => toast('Vollbild wird hier nicht unterstützt.', 'error'));
});

socket.on('state', (next) => {
  syncClock(next);
  if (state) {
    if (next.meeting && (!state.meeting || state.meeting.id !== next.meeting.id)) sounds.meeting();
    if (next.sabotage && !state.sabotage) sounds.sabotage();
    if (next.phase === 'ended' && state.phase !== 'ended') sounds.start();
  }
  state = next;
  if (state.phase === 'lobby' && !joinInfo) loadJoinInfo();
  render();
});

async function loadJoinInfo() {
  joinInfo = await fetch('/api/join-info').then((r) => r.json()).catch(() => null);
  render();
}

/* ---------- Hilfen ---------- */

const colorOf = (p) => state.colors[p.color]?.hex || '#888';
const playerById = (id) => state.players.find((p) => p.id === id);
const participants = () => state.players.filter((p) => p.playing);

/** Im Publikumsmodus gilt ein Spieler erst als tot, wenn seine Leiche gefunden wurde. */
const isAlive = (p) => (secret || state.phase === 'ended' ? p.alive : p.alive || !p.bodyReported);
const showRole = (p) => secret || state.phase === 'ended'
  || (p.ejected && state.settings.confirmEjects);

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function gameTime(at) {
  return state.startedAt ? clock(at - state.startedAt) : '';
}

/* Diagramm-Zeitachse regelmäßig nachziehen, auch wenn gerade nichts passiert */
setInterval(() => {
  if (state && state.phase === 'playing') render();
}, 5000);

/* Aufwärts laufende Uhr (Spielzeit) */
setInterval(() => {
  document.querySelectorAll('[data-since]').forEach((el) => {
    el.textContent = clock(serverNow() - Number(el.dataset.since));
  });
}, 500);

/* ---------- Tooltip für Diagramme ---------- */

const tip = $('#tip');
document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
  tip.style.transform = `translate(${x}px, ${y}px)`;
});

/* ---------- Rendering ---------- */

function render() {
  if (!loggedIn || !state) return;
  $('#secret-label').textContent = secret ? 'Geheimnisse sichtbar' : 'Publikumsmodus';
  document.body.classList.toggle('secret-on', secret);
  const phaseLabel = { lobby: 'Lobby', playing: 'Spiel läuft', meeting: 'Meeting', ended: 'Spiel beendet' }[state.phase];
  setHTML($('#live-badges'), `
    <span class="badge ${state.phase}">${phaseLabel}</span>
    ${state.startedAt && state.phase !== 'lobby'
      ? `<span class="badge clock">⏱ ${state.endedAt ? clock(state.endedAt - state.startedAt) : `<span data-since="${state.startedAt}">${clock(serverNow() - state.startedAt)}</span>`}</span>`
      : ''}`);
  let html;
  if (state.phase === 'lobby') html = renderLobby();
  else if (state.phase === 'meeting' && state.meeting) html = renderMeeting();
  else if (state.phase === 'ended') html = renderEnded();
  else html = renderPlaying();
  setHTML($('#live-main'), html);
  updateCountdowns();
}

function avatar(p, size = 40) {
  return crewmate(colorOf(p), { dead: !isAlive(p), size });
}

function roleTag(p) {
  if (!p.role || !showRole(p)) return '';
  return p.role === 'impostor' ? '<span class="role-tag imp">Impostor</span>' : '<span class="role-tag crew">Crew</span>';
}

/* --- Lobby: QR-Code groß, wer schon da ist --- */

function renderLobby() {
  const s = state.settings;
  const selected = state.players.filter((p) => p.selected);
  return `<div class="live-grid lobby-grid">
    <section class="panel join-panel">
      <h2>Jetzt beitreten</h2>
      ${joinInfo?.qr ? `<img class="qr big" src="${joinInfo.qr}" alt="QR-Code zum Beitreten">` : '<p class="hint">QR-Code wird geladen …</p>'}
      ${(joinInfo?.urls || []).slice(0, 1).map((u) => `<p class="url">${esc(u)}</p>`).join('')}
      <p class="hint">Gleiches WLAN wie dieser Rechner.</p>
    </section>
    <section class="panel">
      <h2>Crew an Bord <span class="count">${selected.length}</span></h2>
      ${state.players.length ? `<div class="lobby-players">${state.players.map((p) => `
        <div class="lobby-player ${p.selected ? '' : 'out'} ${p.connected ? '' : 'offline'}">
          ${crewmate(colorOf(p), { size: 64 })}
          <span>${esc(p.name)}</span>
        </div>`).join('')}</div>` : '<p class="empty">Noch niemand da. Scannt den QR-Code!</p>'}
      <ul class="rule-chips">
        <li><b>${s.impostors}</b> Impostor</li>
        <li><b>${s.tasksPerPlayer}</b> Aufgaben pro Person</li>
        <li><b>${s.emergencyMeetings}</b> Notfall-Meeting${s.emergencyMeetings === 1 ? '' : 's'}</li>
        <li><b>${s.discussionTime}s</b> Diskussion · <b>${s.votingTime}s</b> Abstimmung</li>
        <li>Kill-Cooldown <b>${s.killCooldown}s</b></li>
        ${s.killDelay > 0 ? `<li>Opfer sterben nach <b>${s.killDelay}s</b></li>` : ''}
        ${s.sabotageEnabled ? `<li><b>${s.sabotagesPerRound}×</b> Sabotage pro Runde · <b>${s.sabotageFixesNeeded}</b> ausgeloste Reparierer · <b>${s.sabotageDuration}s</b></li>` : ''}
      </ul>
    </section>
  </div>`;
}

/* --- Laufendes Spiel --- */

function statTiles() {
  const ps = participants();
  const tp = state.taskProgress || { done: 0, total: 0 };
  const pct = tp.total ? Math.round((tp.done / tp.total) * 100) : 0;
  const alive = ps.filter(isAlive);
  const kills = state.events.filter((e) => e.type === 'kill').length;
  const tiles = [
    [`${pct}%`, 'Aufgaben erledigt', `${tp.done} von ${tp.total}`],
    secret
      ? [`${alive.filter((p) => p.role === 'crewmate').length} : ${alive.filter((p) => p.role === 'impostor').length}`, 'Crew : Impostor am Leben', '']
      : [`${alive.length}/${ps.length}`, 'Spieler am Leben', ''],
    [String(state.meetingHistory.length), 'Meetings', ''],
  ];
  if (secret) tiles.push([String(kills), 'Kills', '']);
  return `<div class="tiles">${tiles.map(([v, l, sub]) => `
    <div class="tile"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;
}

/** Stufen-Linie: Aufgaben-Fortschritt in % über die Spielzeit, Meetings als Markierung. */
function progressChart() {
  const log = state.progressLog || [];
  if (!state.startedAt || !log.length) return '<p class="empty">Noch keine Daten.</p>';
  const W = 640, H = 230, L = 44, R = 20, T = 22, B = 30;
  const t0 = state.startedAt;
  const tEnd = Math.max(state.endedAt || serverNow(), t0 + 60_000);
  const x = (t) => L + ((t - t0) / (tEnd - t0)) * (W - L - R);
  const y = (pct) => T + (1 - pct / 100) * (H - T - B);
  const pts = log.map((e) => ({ at: e.at, pct: e.total ? (e.done / e.total) * 100 : 0, done: e.done, total: e.total }));
  const last = pts[pts.length - 1];
  let d = `M${x(pts[0].at)},${y(pts[0].pct)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].at)} V${y(pts[i].pct)}`;
  d += ` H${x(tEnd)}`;
  const area = `${d} V${y(0)} H${x(pts[0].at)} Z`;
  const grid = [0, 50, 100].map((v) => `
    <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}%</text>`).join('');
  const xticks = [t0, t0 + (tEnd - t0) / 2, tEnd].map((t, i) => `
    <text x="${x(t)}" y="${H - 8}" class="axis" text-anchor="${['start', 'middle', 'end'][i]}">${clock(t - t0)}</text>`).join('');
  const meetings = state.meetingHistory.map((m, i) => `
    <g data-tip="Meeting ${i + 1} bei ${clock(m.at - t0)}${m.ejectedId ? `: ${playerById(m.ejectedId)?.name || '?'} raus` : ': niemand raus'}">
      <line x1="${x(m.at)}" x2="${x(m.at)}" y1="${T - 6}" y2="${y(0)}" class="marker"/>
      <rect x="${x(m.at) - 12}" y="${T - 18}" width="24" height="16" rx="4" class="marker-box"/>
      <text x="${x(m.at)}" y="${T - 6}" class="marker-label" text-anchor="middle">M${i + 1}</text>
    </g>`).join('');
  const dots = pts.slice(1).map((p) => `
    <circle cx="${x(p.at)}" cy="${y(p.pct)}" r="9" class="hit" data-tip="${clock(p.at - t0)}: ${p.done}/${p.total} Aufgaben (${Math.round(p.pct)}%)"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aufgaben-Fortschritt über die Zeit, aktuell ${Math.round(last.pct)} Prozent">
    ${grid}
    <path d="${area}" class="area"/>
    <path d="${d}" class="line"/>
    ${meetings}
    ${dots}
    <circle cx="${x(tEnd)}" cy="${y(last.pct)}" r="5" class="end"/>
    <text x="${x(tEnd) - 8}" y="${y(last.pct) - 10}" class="end-label" text-anchor="end">${Math.round(last.pct)}%</text>
    ${xticks}
  </svg>`;
}

function playerBoard() {
  const ps = participants();
  return `<div class="board-players">${ps.map((p) => {
    const alive = isAlive(p);
    const done = p.tasks.filter((t) => t.done).length;
    let detail = '';
    if (secret && p.role === 'crewmate') {
      detail = `<div class="mini-bar" data-tip="${esc(p.name)}: ${done}/${p.tasks.length} Aufgaben"><i style="width:${p.tasks.length ? (done / p.tasks.length) * 100 : 0}%"></i></div>
        <small>${done}/${p.tasks.length} Aufgaben</small>`;
    } else if (secret && p.role === 'impostor' && p.alive && state.phase === 'playing') {
      detail = `<small>Kill ${countdown(p.killReadyAt, { doneText: 'bereit' })}</small>`;
    }
    const pending = secret ? (state.pendingKills || []).find((k) => k.victimId === p.id) : null;
    const status = pending ? `☠️ stirbt in ${countdown(pending.diesAt, { doneText: 'gleich' })}`
      : alive ? '' : p.ejected ? 'rausgeworfen' : (secret && !p.bodyReported ? 'tot (unentdeckt)' : 'tot');
    return `<div class="bp ${alive ? '' : 'dead'} ${p.connected ? '' : 'offline'}">
      ${avatar(p, 44)}
      <div class="bp-info">
        <b>${esc(p.name)}</b>
        ${roleTag(p)}
        ${status ? `<small class="bp-status">${status}</small>` : ''}
        ${detail}
      </div>
    </div>`;
  }).join('')}</div>`;
}

const EVENT_ICONS = {
  start: '🚀', poison: '☠️', task: '✅', 'fake-task': '🎭', kill: '🔪', report: '🚨', meeting: '📣', dead: '💀',
  eject: '🛸', 'eject-role': '🔎', sabotage: '☢️', 'sabotage-by': '☢️', fixed: '🔧', end: '🏁', mod: '🛠',
};

function eventFeed(limit = 12) {
  const list = state.events.filter((e) => secret || !e.secret).slice(-limit).reverse();
  if (!list.length) return '<p class="empty">Noch nichts passiert.</p>';
  return `<ol class="feed">${list.map((e) => `
    <li class="${e.secret ? 'is-secret' : ''}">
      <time>${gameTime(e.at)}</time>
      <span class="ev-icon" aria-hidden="true">${EVENT_ICONS[e.type] || '•'}</span>
      <span>${esc(e.text)}</span>
    </li>`).join('')}</ol>`;
}

function meetingHistoryList() {
  if (!state.meetingHistory.length) return '<p class="empty">Noch kein Meeting.</p>';
  return `<ol class="history">${state.meetingHistory.map((m, i) => {
    const caller = m.callerId ? playerById(m.callerId)?.name : 'Moderator';
    const body = m.bodyId ? playerById(m.bodyId)?.name : null;
    const ej = m.ejectedId ? playerById(m.ejectedId) : null;
    const reveal = ej && (secret || state.phase === 'ended' || state.settings.confirmEjects);
    return `<li>
      <span class="h-num">M${i + 1}</span>
      <span>${body ? `🚨 ${esc(caller)} fand ${esc(body)}` : `📣 ${esc(caller)}`}</span>
      <span class="h-result">${ej ? `🛸 ${esc(ej.name)}${reveal ? ` <em class="${m.ejectedWasImpostor ? 'imp' : 'crew'}">${m.ejectedWasImpostor ? 'Impostor' : 'Crew'}</em>` : ''}` : `niemand${m.tie ? ' (Gleichstand)' : ''}`}</span>
    </li>`;
  }).join('')}</ol>`;
}

function sabotageBanner() {
  const s = state.sabotage;
  if (!s) return '';
  const fixers = s.assigned.map((id) => {
    const p = playerById(id);
    return p ? `<span class="fixer ${s.fixedBy.includes(id) ? 'done' : ''}">${crewmate(colorOf(p), { size: 26 })}${esc(p.name)} ${s.fixedBy.includes(id) ? '✅' : '⏳'}</span>` : '';
  }).join('');
  return `<div class="live-sabotage">
    <span>☢️ REAKTOR-KERNSCHMELZE</span>
    <b>${countdown(s.endsAt)}</b>
    <span>Reparieren müssen:</span>
    <span class="fixers">${fixers}</span>
  </div>`;
}

function renderPlaying() {
  return `${sabotageBanner()}
  <div class="live-grid play-grid">
    <div class="col-main">
      ${statTiles()}
      <section class="panel"><h2>Aufgaben-Fortschritt</h2>${progressChart()}</section>
      <section class="panel"><h2>Meetings</h2>${meetingHistoryList()}</section>
    </div>
    <div class="col-side">
      <section class="panel"><h2>Spieler</h2>${playerBoard()}</section>
      <section class="panel"><h2>Ereignisse</h2>${eventFeed()}</section>
    </div>
  </div>`;
}

/* --- Meeting mit Abstimmungs-Visualisierung --- */

function voteBars(m) {
  const ps = participants();
  const voters = ps.filter((p) => p.alive || (m.votes && m.votes[p.id]));
  const maxVotes = Math.max(1, voters.length);
  const votes = m.votes || (m.result && m.result.votes) || {};
  const showVotes = m.stage === 'result' || secret;
  const showWho = secret || (m.stage === 'result' && !state.settings.anonymousVotes);
  const targets = [...ps.filter((p) => p.alive || p.id === m.result?.ejectedId), { id: 'skip', name: 'Überspringen' }];
  const rows = targets.map((t) => {
    const by = Object.entries(votes).filter(([, target]) => target === t.id).map(([v]) => playerById(v)).filter(Boolean);
    const isSkip = t.id === 'skip';
    const ejected = m.result?.ejectedId === t.id;
    const voted = !isSkip && m.votedIds.includes(t.id);
    return `<div class="vrow ${ejected ? 'ejected' : ''} ${isSkip ? 'skip' : ''}">
      <div class="vname">
        ${isSkip ? '<span class="skip-icon">⏭</span>' : crewmate(colorOf(t), { size: 34 })}
        <span>${esc(t.name)}</span>
        ${!isSkip && m.stage === 'voting' ? `<span class="vstate ${voted ? 'done' : ''}">${voted ? '✔ abgestimmt' : '… wartet'}</span>` : ''}
      </div>
      <div class="vbar-track">
        ${showVotes ? `<div class="vbar" style="width:${(by.length / maxVotes) * 100}%;--c:${isSkip ? 'var(--muted)' : colorOf(t)}"
             data-tip="${esc(t.name)}: ${by.length} Stimme${by.length === 1 ? '' : 'n'}"></div>` : ''}
        ${showVotes && showWho ? `<div class="voters">${by.map((v) => `<span title="${esc(v.name)}">${crewmate(colorOf(v), { size: 20 })}</span>`).join('')}</div>` : ''}
      </div>
      <span class="vcount">${showVotes ? by.length : ''}</span>
    </div>`;
  }).join('');
  return `<div class="vote-chart">${rows}</div>`;
}

function renderMeeting() {
  const m = state.meeting;
  const caller = m.callerId ? playerById(m.callerId) : null;
  const body = m.bodyId ? playerById(m.bodyId) : null;
  const alive = participants().filter((p) => p.alive);
  const votedCount = m.votedIds.length;
  const stageText = { discussion: 'Diskussion', voting: 'Abstimmung', result: 'Ergebnis' }[m.stage];
  let result = '';
  if (m.stage === 'result') {
    const ej = m.result.ejectedId ? playerById(m.result.ejectedId) : null;
    const known = m.result.ejectedWasImpostor !== null && (secret || state.settings.confirmEjects);
    result = `<div class="eject-banner">
      ${ej ? `${crewmate(colorOf(ej), { size: 70 })}<div><h2>${esc(ej.name)} wurde rausgeworfen.</h2>
        ${known ? `<p class="${m.result.ejectedWasImpostor ? 'imp' : 'crew'}">${esc(ej.name)} war ${m.result.ejectedWasImpostor ? '' : 'k'}ein Impostor.</p>` : ''}</div>`
        : `<div><h2>Niemand wurde rausgeworfen.</h2><p>${m.result.tie ? 'Gleichstand!' : 'Die Mehrheit hat übersprungen.'}</p></div>`}
    </div>`;
  }
  const dead = participants().filter((p) => !p.alive);
  return `<div class="meeting-board">
    <div class="meeting-head">
      <div>
        <h2>${m.type === 'report' ? '🚨 Leiche gemeldet' : '📣 Notfall-Meeting'}</h2>
        <p>${caller ? `Einberufen von <b>${esc(caller.name)}</b>` : 'Einberufen vom Moderator'}${body ? ` · Leiche: <b>${esc(body.name)}</b>` : ''}</p>
      </div>
      <div class="meeting-timer">
        <span>${stageText}</span>
        <b>${countdown(m.endsAt)}</b>
        ${m.stage === 'voting' ? `<small>${votedCount}/${alive.length} haben abgestimmt</small>` : ''}
      </div>
    </div>
    ${result}
    <div class="live-grid meeting-grid">
      <section class="panel">
        <h2>Abstimmung ${!secret && m.stage === 'voting' ? '<small>(Stimmen werden am Ende gezeigt)</small>' : ''}</h2>
        ${m.stage === 'discussion' ? `<p class="empty big">Diskutiert! Die Abstimmung beginnt in ${countdown(m.endsAt)}.</p>` : voteBars(m)}
      </section>
      <section class="panel">
        <h2>Nicht mehr dabei</h2>
        ${dead.length ? `<div class="board-players">${dead.map((p) => `
          <div class="bp dead">${crewmate(colorOf(p), { dead: true, size: 36 })}<div class="bp-info"><b>${esc(p.name)}</b>${roleTag(p)}<small class="bp-status">${p.ejected ? 'rausgeworfen' : 'tot'}</small></div></div>`).join('')}</div>`
          : '<p class="empty">Alle leben noch.</p>'}
        <h2 class="spaced">Bisherige Meetings</h2>
        ${meetingHistoryList()}
      </section>
    </div>
  </div>`;
}

/* --- Spielende mit Statistik --- */

function renderEnded() {
  const w = state.winner;
  const ps = participants();
  const crew = ps.filter((p) => p.role === 'crewmate');
  const imps = ps.filter((p) => p.role === 'impostor');
  const tp = state.taskProgress || { done: 0, total: 0 };
  const kills = state.events.filter((e) => e.type === 'kill').length;
  const ejections = state.meetingHistory.filter((m) => m.ejectedId).length;
  const ranking = crew.map((p) => ({ p, done: p.tasks.filter((t) => t.done).length, total: p.tasks.length }))
    .sort((a, b) => b.done - a.done);
  const maxTasks = Math.max(1, ...ranking.map((r) => r.total));
  const team = (list) => list.map((p) => `<div class="bp ${p.alive ? '' : 'dead'}">${crewmate(colorOf(p), { dead: !p.alive, size: 40 })}<div class="bp-info"><b>${esc(p.name)}</b><small class="bp-status">${p.alive ? 'überlebt' : p.ejected ? 'rausgeworfen' : 'tot'}</small></div></div>`).join('');
  return `<div class="win-banner ${w.team === 'crew' ? 'crew' : 'imp'}">
      <h2>${w.team === 'crew' ? 'Sieg der Crew' : 'Sieg der Impostor'}</h2>
      <p>${esc(w.reason)}</p>
    </div>
    <div class="tiles">
      <div class="tile"><b>${state.endedAt && state.startedAt ? clock(state.endedAt - state.startedAt) : '–'}</b><span>Spieldauer</span></div>
      <div class="tile"><b>${tp.total ? Math.round((tp.done / tp.total) * 100) : 0}%</b><span>Aufgaben erledigt</span></div>
      <div class="tile"><b>${state.meetingHistory.length}</b><span>Meetings</span></div>
      <div class="tile"><b>${kills}</b><span>Kills</span></div>
      <div class="tile"><b>${ejections}</b><span>Rauswürfe</span></div>
    </div>
    <div class="live-grid play-grid">
      <div class="col-main">
        <section class="panel"><h2>Aufgaben-Fortschritt</h2>${progressChart()}</section>
        <section class="panel"><h2>Fleißigste Crewmates</h2>
          <div class="rank">${ranking.map((r) => `
            <div class="rank-row">
              <div class="vname">${crewmate(colorOf(r.p), { size: 28 })}<span>${esc(r.p.name)}</span></div>
              <div class="vbar-track"><div class="vbar" style="width:${(r.done / maxTasks) * 100}%;--c:${colorOf(r.p)}" data-tip="${esc(r.p.name)}: ${r.done}/${r.total}"></div></div>
              <span class="vcount">${r.done}/${r.total}</span>
            </div>`).join('')}</div>
        </section>
      </div>
      <div class="col-side">
        <section class="panel"><h2>Impostor</h2><div class="board-players">${team(imps)}</div>
          <h2 class="spaced">Crew</h2><div class="board-players">${team(crew)}</div></section>
        <section class="panel"><h2>Meetings</h2>${meetingHistoryList()}</section>
        <section class="panel"><h2>Ereignisse</h2>${eventFeed(30)}</section>
      </div>
    </div>`;
}
