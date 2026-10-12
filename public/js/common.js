'use strict';

/* Gemeinsame Hilfsfunktionen für Spieler- und Moderator-Ansicht */

const socket = io({ transports: ['websocket', 'polling'] });
let serverOffset = 0; // serverzeit - lokale zeit

function syncClock(state) {
  if (state && state.serverNow) serverOffset = state.serverNow - Date.now();
}

function serverNow() {
  return Date.now() + serverOffset;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (sel, root = document) => root.querySelector(sel);

/** Ersetzt den Inhalt nur, wenn er sich geändert hat – so bleiben Eingaben & Scroll-Position erhalten. */
function setHTML(el, html) {
  if (!el) return;
  if (el.__html !== html) {
    el.__html = html;
    el.innerHTML = html;
  }
}

/** Sendet eine Aktion an den Server und zeigt Fehler als Toast. */
function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res && !res.ok) toast(res.error, 'error');
      resolve(res || { ok: false });
    });
  });
}

let toastTimer = null;
function toast(text, kind = 'info', ms = 3500) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function formatSeconds(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

/** Alle Elemente mit data-ends="<timestamp>" zählen automatisch herunter. */
function updateCountdowns() {
  const now = serverNow();
  document.querySelectorAll('[data-ends]').forEach((el) => {
    const left = (Number(el.dataset.ends) - now) / 1000;
    if (left <= 0 && el.dataset.doneText) el.textContent = el.dataset.doneText;
    else el.textContent = (el.dataset.prefix || '') + formatSeconds(left);
    el.classList.toggle('urgent', left > 0 && left <= 10);
    if (el.dataset.toggle) {
      // Buttons, die erst nach Ablauf aktiv werden (z. B. Kill-Cooldown)
      const btn = document.getElementById(el.dataset.toggle);
      if (btn) btn.disabled = left > 0;
    }
  });
}
setInterval(updateCountdowns, 200);

/** HTML für einen Countdown. Der Text wird von updateCountdowns() gesetzt, damit das HTML stabil bleibt. */
function countdown(endsAt, { prefix = '', doneText = '', toggle = '' } = {}) {
  return `<span class="countdown" data-ends="${endsAt}" data-prefix="${esc(prefix)}" data-done-text="${esc(doneText)}"${toggle ? ` data-toggle="${toggle}"` : ''}></span>`;
}

/** Crewmate-Figur als SVG */
function crewmate(color, { dead = false, size = 48 } = {}) {
  const c = color || '#888';
  return `<svg class="crewmate${dead ? ' dead' : ''}" width="${size}" height="${size * 1.15}" viewBox="0 0 100 115" aria-hidden="true">
    <rect x="6" y="42" width="20" height="44" rx="9" fill="${c}" stroke="#000" stroke-width="5"/>
    <path d="M22 50 Q22 8 55 8 Q88 8 88 50 L88 98 Q88 108 78 108 L68 108 Q61 108 61 98 L61 92 L49 92 L49 98 Q49 108 39 108 L32 108 Q22 108 22 98 Z" fill="${c}" stroke="#000" stroke-width="5"/>
    <path d="M46 30 Q46 22 56 22 L82 22 Q95 22 95 37 Q95 50 82 50 L56 50 Q46 50 46 40 Z" fill="#9ad6e9" stroke="#000" stroke-width="5"/>
    <path d="M60 28 L80 28" stroke="#e8f8ff" stroke-width="5" stroke-linecap="round"/>
    ${dead ? '<path d="M30 30 L80 90 M80 30 L30 90" stroke="#ff2a2a" stroke-width="8" stroke-linecap="round"/>' : ''}
  </svg>`;
}

/* ---------- Ton & Vibration ---------- */

let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* kein Audio verfügbar */
  }
}
document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

function beep(freq, duration, { type = 'square', delay = 0, volume = 0.15 } = {}) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

const sounds = {
  meeting() {
    for (let i = 0; i < 4; i++) {
      beep(880, 0.18, { delay: i * 0.4 });
      beep(660, 0.18, { delay: i * 0.4 + 0.2 });
    }
    vibrate([300, 100, 300, 100, 300]);
  },
  sabotage() {
    for (let i = 0; i < 6; i++) beep(i % 2 ? 440 : 520, 0.25, { type: 'sawtooth', delay: i * 0.3, volume: 0.12 });
    vibrate([500, 200, 500, 200, 500]);
  },
  kill() {
    beep(120, 0.5, { type: 'sawtooth', volume: 0.25 });
    vibrate([800]);
  },
  task() {
    beep(660, 0.1, { type: 'sine' });
    beep(990, 0.15, { type: 'sine', delay: 0.1 });
    vibrate([60]);
  },
  start() {
    [392, 523, 659, 784].forEach((f, i) => beep(f, 0.3, { type: 'triangle', delay: i * 0.15 }));
    vibrate([200, 100, 200]);
  },
  notify() {
    beep(740, 0.15, { type: 'sine' });
    beep(988, 0.2, { type: 'sine', delay: 0.15 });
    vibrate([150, 80, 150]);
  },
};

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* nicht unterstützt */
  }
}

/** Bildschirm wach halten, solange das Spiel offen ist (wo unterstützt). */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    /* nicht unterstützt oder abgelehnt */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});
document.addEventListener('pointerdown', keepAwake, { once: true });

/* Verbindungsanzeige */
function setConnectionBanner(connected) {
  let el = $('#conn');
  if (!el) {
    el = document.createElement('div');
    el.id = 'conn';
    el.className = 'conn-banner';
    el.textContent = 'Verbindung zum Server verloren – verbinde neu …';
    document.body.appendChild(el);
  }
  el.classList.toggle('show', !connected);
}
socket.on('connect', () => setConnectionBanner(true));
socket.on('disconnect', () => setConnectionBanner(false));

/* Modal-Dialog */
function openModal(html, { onOpen } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) closeModal();
  });
  document.body.appendChild(wrap);
  if (onOpen) onOpen(wrap.firstElementChild);
  return wrap.firstElementChild;
}

function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
}

function confirmDialog(text, { okText = 'Ja', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = openModal(`
      <p class="modal-text">${esc(text)}</p>
      <div class="row">
        <button class="btn secondary" data-close>Abbrechen</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" id="confirm-ok">${esc(okText)}</button>
      </div>`);
    modal.querySelector('#confirm-ok').addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    modal.parentElement.addEventListener('click', (e) => {
      if (e.target === modal.parentElement || e.target.closest('[data-close]')) resolve(false);
    });
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
