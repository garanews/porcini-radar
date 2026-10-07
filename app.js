import { scoreDays, fetchWeather, fmtDay, labelFor } from './radar.js';
import * as db from './db.js';
import * as llm from './llm.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const todayIso = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD locale
const STALE_MS = 3 * 60 * 60 * 1000;

// ---------- Navigazione e stato rete ----------

document.querySelectorAll('nav button').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  }),
);

function updateNet() {
  const net = $('#net');
  net.textContent = navigator.onLine ? 'online' : 'offline';
  net.classList.toggle('off', !navigator.onLine);
}
addEventListener('online', updateNet);
addEventListener('offline', updateNet);
updateNet();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ---------- GPS ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS non disponibile'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'Permesso GPS negato' : 'Posizione non trovata, riprova all\'aperto')),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 },
    );
  });
}

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Radar ----------

let places = [];
const forecasts = new Map(); // id -> { fetchedAt, daily, elevation }

async function loadForecast(place, force = false) {
  const cached = forecasts.get(place.id) ?? (await db.get('kv', `wx:${place.id}`));
  const fresh = cached && Date.now() - cached.fetchedAt < STALE_MS;
  if (cached && (fresh || !navigator.onLine) && !force) {
    forecasts.set(place.id, cached);
    return cached;
  }
  try {
    const wx = { ...(await fetchWeather(place)), fetchedAt: Date.now() };
    forecasts.set(place.id, wx);
    await db.put('kv', wx, `wx:${place.id}`);
    return wx;
  } catch (e) {
    if (cached) { forecasts.set(place.id, cached); return cached; }
    throw e;
  }
}

function placeCard(place, wx, { deletable = true } = {}) {
  const days = wx ? scoreDays(wx.daily, todayIso()) : [];
  if (!days.length) {
    return `<div class="card"><div class="place-head"><h3>${esc(place.name)}</h3></div>
      <p class="muted small">Previsione non disponibile o scaduta: aggiornala quando hai internet.</p></div>`;
  }
  const today = days[0];
  const best = days.reduce((a, b) => (b.score > a.score ? b : a));
  const bars = days.map((d, i) =>
    `<div class="${d.label.cls}${i === 0 ? ' today' : ''}" style="height:${Math.max(4, d.score)}%" title="${fmtDay(d.date)}: ${d.score}"></div>`).join('');
  const labels = days.map((d, i) =>
    `<span>${i === 0 ? 'oggi' : new Date(d.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'narrow' })}</span>`).join('');
  const age = Math.round((Date.now() - wx.fetchedAt) / 60000);
  return `<div class="card">
    <div class="place-head">
      <h3>${esc(place.name)} <span class="muted small">${wx.elevation} m</span></h3>
      <span class="score ${today.label.cls}">${today.score} · ${today.label.text}</span>
    </div>
    <div class="strip">${bars}</div>
    <div class="strip-labels">${labels}</div>
    <p class="small">Giorno migliore: <strong>${fmtDay(best.date)}</strong> (${best.score}, ${best.label.text})</p>
    <details><summary>Perché oggi ${today.score}?</summary><ul>${today.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
    <p class="muted small">Aggiornato ${age < 60 ? `${age} min fa` : `${Math.round(age / 60)} h fa`}
      ${deletable ? `· <a href="#" data-del-place="${place.id}">elimina posto</a>` : ''}</p>
  </div>`;
}

async function renderPlaces(force = false) {
  places = (await db.getAll('places')).sort((a, b) => a.name.localeCompare(b.name));
  if (!places.length) return;
  const status = $('#radar-status');
  status.textContent = 'Carico le previsioni…';
  const cards = [];
  for (const p of places) {
    try { cards.push(placeCard(p, await loadForecast(p, force))); }
    catch { cards.push(placeCard(p, null)); }
  }
  $('#places').innerHTML = cards.join('');
  status.textContent = navigator.onLine ? '' : 'Sei offline: mostro le ultime previsioni salvate.';
}

$('#places').addEventListener('click', async (e) => {
  const id = e.target.dataset?.delPlace;
  if (!id) return;
  e.preventDefault();
  if (!confirm('Eliminare questo posto?')) return;
  await db.del('places', id);
  await db.del('kv', `wx:${id}`);
  forecasts.delete(id);
  $('#places').innerHTML = '';
  renderPlaces();
});

let herePlace = null;

$('#btn-here').addEventListener('click', async () => {
  const status = $('#radar-status');
  try {
    status.textContent = 'Cerco la posizione GPS…';
    const pos = await getPosition();
    herePlace = { id: 'here', name: 'Qui adesso', ...pos };
    // Offline: usa la previsione del posto salvato più vicino (entro 5 km).
    if (!navigator.onLine) {
      const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 5) {
        status.textContent = `Offline: uso la previsione salvata di “${near.p.name}” (${near.d.toFixed(1)} km).`;
        $('#here').innerHTML = placeCard({ ...near.p, name: `Qui (vicino a ${near.p.name})` }, forecasts.get(near.p.id), { deletable: false });
      } else {
        status.textContent = 'Offline e nessun posto salvato qui vicino: salva i posti quando hai rete.';
      }
      return;
    }
    status.textContent = 'Scarico il meteo…';
    const wx = await loadForecast(herePlace, true);
    $('#here').innerHTML = placeCard(herePlace, wx, { deletable: false });
    status.textContent = `Precisione GPS ±${pos.acc} m`;
  } catch (e) {
    status.textContent = e.message;
  }
});

async function savePlace(pos, name) {
  const place = { id: db.newId(), name, lat: pos.lat, lon: pos.lon, savedAt: Date.now() };
  await db.put('places', place);
  return place;
}

$('#btn-save-place').addEventListener('click', async () => {
  const status = $('#radar-status');
  try {
    status.textContent = 'Cerco la posizione GPS…';
    const pos = await getPosition();
    const name = prompt(`Nome del posto (precisione ±${pos.acc} m):`, 'Faggeta');
    if (!name) { status.textContent = ''; return; }
    await savePlace(pos, name.trim());
    status.textContent = `“${name}” salvato.`;
    renderPlaces();
  } catch (e) {
    status.textContent = e.message;
  }
});

$('#btn-refresh').addEventListener('click', () => {
  if (!navigator.onLine) { $('#radar-status').textContent = 'Serve internet per aggiornare.'; return; }
  renderPlaces(true);
});

// ---------- Diario ----------

async function resizePhoto(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
}

// Punteggio radar del giorno dell'uscita, dal posto salvato più vicino: serve per imparare dal diario.
function radarScoreFor(pos, dateIso) {
  const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 5) return null;
  const wx = forecasts.get(near.p.id);
  const day = wx && scoreDays(wx.daily, dateIso)[0];
  return day ? { place: near.p.name, score: day.score } : { place: near.p.name, score: null };
}

$('#entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $('#entry-status');
  const data = new FormData(form);
  let pos = null;
  try {
    status.textContent = 'Cerco la posizione GPS…';
    pos = await getPosition();
  } catch (err) {
    if (!confirm(`${err.message}. Salvare senza posizione?`)) { status.textContent = ''; return; }
  }
  const file = data.get('photo');
  const date = todayIso();
  const entry = {
    id: db.newId(),
    date,
    time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    pos,
    found: Number(data.get('found')) || 0,
    grams: Number(data.get('grams')) || null,
    habitat: data.get('habitat'),
    notes: data.get('notes').trim(),
    photo: file && file.size ? await resizePhoto(file) : null,
    radar: pos ? radarScoreFor(pos, date) : null,
  };
  if (pos && data.get('asPlace')) {
    const name = prompt('Nome del posto:', entry.habitat ? `${entry.habitat} ${date}` : date);
    if (name) {
      const place = await savePlace(pos, name.trim());
      entry.radar = { place: place.name, score: null };
      renderPlaces();
    }
  }
  await db.put('entries', entry);
  form.reset();
  $('#new-entry').open = false;
  status.textContent = '';
  renderEntries();
});

let entries = [];
let photoUrls = [];

async function renderEntries() {
  entries = (await db.getAll('entries')).sort((a, b) => b.id.localeCompare(a.id));
  photoUrls.forEach(URL.revokeObjectURL);
  photoUrls = [];
  $('#entries').innerHTML = entries.length
    ? entries.map((en) => {
        let img = '';
        if (en.photo) { const u = URL.createObjectURL(en.photo); photoUrls.push(u); img = `<img src="${u}" alt="">`; }
        const radar = en.radar?.score != null ? ` · radar ${en.radar.score}` : '';
        return `<div class="card entry">${img}<div class="body">
          <button class="del" data-del-entry="${en.id}">✕</button>
          <strong>${fmtDay(en.date)} ${esc(en.time)}</strong><br>
          <span>🍄 ${en.found} porcini${en.grams ? ` (${en.grams} g)` : ''} · ${esc(en.habitat)}</span><br>
          <span class="muted small">${en.radar?.place ? esc(en.radar.place) : en.pos ? `${en.pos.lat.toFixed(3)}, ${en.pos.lon.toFixed(3)}` : 'senza posizione'}${radar}</span>
          ${en.notes ? `<p class="small">${esc(en.notes)}</p>` : ''}
        </div></div>`;
      }).join('')
    : '<p class="muted">Ancora nessuna uscita registrata.</p>';
}

$('#entries').addEventListener('click', async (e) => {
  const id = e.target.dataset?.delEntry;
  if (!id || !confirm('Eliminare questa uscita?')) return;
  await db.del('entries', id);
  renderEntries();
});

$('#btn-export').addEventListener('click', async () => {
  const toDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const out = {
    exportedAt: new Date().toISOString(),
    places: await db.getAll('places'),
    entries: await Promise.all((await db.getAll('entries')).map(async (en) => ({ ...en, photo: en.photo ? await toDataUrl(en.photo) : null }))),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `porcini-radar-${todayIso()}.json`;
  a.click();
});

// ---------- Chiedi (LLM locale) ----------

const modelSelect = $('#model-select');
for (const [id, label] of Object.entries(llm.MODELS)) modelSelect.add(new Option(label, id));
const history = [];

async function refreshModelStatus() {
  const status = $('#model-status');
  if (!llm.hasWebGPU()) {
    status.textContent = 'Questo browser non supporta WebGPU: serve Chrome aggiornato (Android 12+).';
    $('#btn-load').disabled = true;
    return;
  }
  if (llm.isLoaded()) return;
  const cached = await llm.isCached(modelSelect.value).catch(() => false);
  $('#btn-load').textContent = cached ? 'Avvia modello (già scaricato)' : 'Scarica modello (usa il Wi-Fi)';
  status.textContent = cached
    ? 'Il modello è sul telefono: funziona anche senza campo.'
    : 'Il download serve una volta sola, poi funziona offline.';
}
modelSelect.addEventListener('change', refreshModelStatus);

$('#btn-load').addEventListener('click', async () => {
  const bar = $('#model-progress');
  const status = $('#model-status');
  $('#btn-load').disabled = true;
  bar.hidden = false;
  try {
    await llm.load(modelSelect.value, (p) => { bar.value = p.progress; status.textContent = p.text; });
    status.textContent = '✅ Modello pronto. Tutto gira sul telefono, nessun dato esce.';
    bar.hidden = true;
    $('#ask-input').disabled = false;
    $('#ask-form button').disabled = false;
  } catch (e) {
    status.textContent = `Errore: ${e.message}`;
    $('#btn-load').disabled = false;
  }
});

function buildContext() {
  const lines = [`Oggi è ${fmtDay(todayIso())}.`];
  const all = herePlace && forecasts.get('here') ? [herePlace, ...places] : places;
  for (const p of all) {
    const wx = forecasts.get(p.id);
    const days = wx ? scoreDays(wx.daily, todayIso()) : [];
    if (!days.length) continue;
    lines.push(`Posto "${p.name}" (${wx.elevation} m): punteggio porcini (0-100) per giorno: ` +
      days.slice(0, 8).map((d) => `${fmtDay(d.date)} ${d.score}`).join(', ') +
      `. Oggi: ${days[0].reasons.join('; ')}.`);
  }
  if (!all.length) lines.push('Nessun posto salvato con previsione meteo.');
  const recent = entries.slice(0, 8);
  if (recent.length) {
    lines.push('Diario delle ultime uscite:');
    for (const en of recent) {
      lines.push(`- ${fmtDay(en.date)}: ${en.found} porcini${en.grams ? ` (${en.grams} g)` : ''}, bosco di ${en.habitat}` +
        `${en.radar?.place ? `, zona ${en.radar.place}` : ''}${en.radar?.score != null ? `, punteggio radar ${en.radar.score}` : ''}` +
        `${en.notes ? `. Note: ${en.notes}` : ''}`);
    }
  } else {
    lines.push('Il diario è ancora vuoto.');
  }
  return lines.join('\n');
}

function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  $('#chat').append(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

async function send(question) {
  if (!llm.isLoaded() || !question) return;
  addMsg('user', question);
  if (llm.EDIBILITY_RE.test(question)) {
    addMsg('bot alert', '⚠️ Nessuna app, e nessuna AI, può dirti se un fungo è commestibile. ' +
      'Portalo all\'Ispettorato Micologico dell\'ASL prima di mangiarlo: il controllo è gratuito.');
  }
  history.push({ role: 'user', content: question });
  const out = addMsg('bot', '…');
  $('#ask-input').disabled = true;
  try {
    const answer = await llm.ask(history, buildContext(), (t) => { out.textContent = t; });
    history.push({ role: 'assistant', content: answer });
  } catch (e) {
    out.textContent = `Errore: ${e.message}`;
    history.pop();
  }
  $('#ask-input').disabled = false;
  $('#ask-input').focus();
}

$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#ask-input').value.trim();
  $('#ask-input').value = '';
  send(q);
});
document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));

// ---------- Avvio ----------

renderEntries();
renderPlaces();
refreshModelStatus();
