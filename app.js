import { scoreDays, fetchWeather } from './radar.js';
import { t, locale, fmtDay, weekdayNarrow, habitatName, applyStatic } from './i18n.js';
import * as db from './db.js';
import * as llm from './llm.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const todayIso = () => new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD
const STALE_MS = 3 * 60 * 60 * 1000;

// Worker/WebGPU errors are not always Errors with a message: show whatever there is.
function errText(e) {
  if (e?.message) return `${e.name ?? 'Error'}: ${e.message}`;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e) ?? String(e); } catch { return String(e); }
}

applyStatic();

// ---------- Navigation and network status ----------

document.querySelectorAll('nav button').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  }),
);

function updateNet() {
  const net = $('#net');
  net.textContent = t(navigator.onLine ? 'net.online' : 'net.offline');
  net.classList.toggle('off', !navigator.onLine);
}
addEventListener('online', updateNet);
addEventListener('offline', updateNet);
updateNet();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ---------- GPS ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('gps.unavailable')));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(t(e.code === 1 ? 'gps.denied' : 'gps.notFound'))),
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
      <p class="muted small">${t('card.unavailable')}</p></div>`;
  }
  const today = days[0];
  const best = days.reduce((a, b) => (b.score > a.score ? b : a));
  const bars = days.map((d, i) =>
    `<div class="${d.label.cls}${i === 0 ? ' today' : ''}" style="height:${Math.max(4, d.score)}%" title="${fmtDay(d.date)}: ${d.score}"></div>`).join('');
  const labels = days.map((d, i) => `<span>${i === 0 ? t('card.today') : weekdayNarrow(d.date)}</span>`).join('');
  const age = Math.round((Date.now() - wx.fetchedAt) / 60000);
  return `<div class="card">
    <div class="place-head">
      <h3>${esc(place.name)} <span class="muted small">${wx.elevation} m</span></h3>
      <span class="score ${today.label.cls}">${today.score} · ${today.label.text}</span>
    </div>
    <div class="strip">${bars}</div>
    <div class="strip-labels">${labels}</div>
    <p class="small">${t('card.best', { day: fmtDay(best.date), score: best.score, label: best.label.text })}</p>
    <details><summary>${t('card.why', { score: today.score })}</summary><ul>${today.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
    <p class="muted small">${age < 60 ? t('card.updatedMin', { n: age }) : t('card.updatedH', { n: Math.round(age / 60) })}
      ${deletable ? `· <a href="#" data-del-place="${place.id}">${t('card.delete')}</a>` : ''}</p>
  </div>`;
}

async function renderPlaces(force = false) {
  places = (await db.getAll('places')).sort((a, b) => a.name.localeCompare(b.name));
  if (!places.length) return;
  const status = $('#radar-status');
  status.textContent = t('radar.loading');
  const cards = [];
  for (const p of places) {
    try { cards.push(placeCard(p, await loadForecast(p, force))); }
    catch { cards.push(placeCard(p, null)); }
  }
  $('#places').innerHTML = cards.join('');
  status.textContent = navigator.onLine ? '' : t('radar.offlineCached');
}

$('#places').addEventListener('click', async (e) => {
  const id = e.target.dataset?.delPlace;
  if (!id) return;
  e.preventDefault();
  if (!confirm(t('radar.deleteConfirm'))) return;
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
    status.textContent = t('radar.locating');
    const pos = await getPosition();
    herePlace = { id: 'here', name: t('radar.hereName'), ...pos };
    // Offline: use the forecast of the nearest saved spot (within 5 km).
    if (!navigator.onLine) {
      const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 5) {
        status.textContent = t('radar.offlineNear', { name: near.p.name, km: near.d.toFixed(1) });
        $('#here').innerHTML = placeCard({ ...near.p, name: t('radar.nearName', { name: near.p.name }) }, forecasts.get(near.p.id), { deletable: false });
      } else {
        status.textContent = t('radar.offlineNone');
      }
      return;
    }
    status.textContent = t('radar.fetching');
    const wx = await loadForecast(herePlace, true);
    $('#here').innerHTML = placeCard(herePlace, wx, { deletable: false });
    status.textContent = t('radar.accuracy', { acc: pos.acc });
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
    status.textContent = t('radar.locating');
    const pos = await getPosition();
    const name = prompt(t('radar.namePrompt', { acc: pos.acc }), t('radar.nameDefault'));
    if (!name) { status.textContent = ''; return; }
    await savePlace(pos, name.trim());
    status.textContent = t('radar.saved', { name });
    renderPlaces();
  } catch (e) {
    status.textContent = e.message;
  }
});

$('#btn-refresh').addEventListener('click', () => {
  if (!navigator.onLine) { $('#radar-status').textContent = t('radar.needNet'); return; }
  renderPlaces(true);
});

// ---------- Diary ----------

async function resizePhoto(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
}

// Radar score on the day of the outing, from the nearest saved spot: lets the diary check the heuristic.
function radarScoreFor(pos, dateIso) {
  const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 5) return null;
  const wx = forecasts.get(near.p.id);
  const day = wx && scoreDays(wx.daily, dateIso)[0];
  return { place: near.p.name, score: day ? day.score : null };
}

$('#entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $('#entry-status');
  const data = new FormData(form);
  let pos = null;
  try {
    status.textContent = t('radar.locating');
    pos = await getPosition();
  } catch (err) {
    if (!confirm(t('diary.saveNoPos', { err: err.message }))) { status.textContent = ''; return; }
  }
  const file = data.get('photo');
  const date = todayIso();
  const entry = {
    id: db.newId(),
    date,
    time: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    pos,
    found: Number(data.get('found')) || 0,
    grams: Number(data.get('grams')) || null,
    habitat: data.get('habitat'),
    notes: data.get('notes').trim(),
    photo: file && file.size ? await resizePhoto(file) : null,
    radar: pos ? radarScoreFor(pos, date) : null,
  };
  if (pos && data.get('asPlace')) {
    const name = prompt(t('diary.placeName'), `${habitatName(entry.habitat)} ${date}`);
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
        const radar = en.radar?.score != null ? ` · ${t('diary.radar', { score: en.radar.score })}` : '';
        const where = en.radar?.place ? esc(en.radar.place)
          : en.pos ? `${en.pos.lat.toFixed(3)}, ${en.pos.lon.toFixed(3)}` : t('diary.noPos');
        return `<div class="card entry">${img}<div class="body">
          <button class="del" data-del-entry="${en.id}">✕</button>
          <strong>${fmtDay(en.date)} ${esc(en.time)}</strong><br>
          <span>🍄 ${t('diary.porcini', { n: en.found })}${en.grams ? ` (${en.grams} g)` : ''} · ${esc(habitatName(en.habitat))}</span><br>
          <span class="muted small">${where}${radar}</span>
          ${en.notes ? `<p class="small">${esc(en.notes)}</p>` : ''}
        </div></div>`;
      }).join('')
    : `<p class="muted">${t('diary.empty')}</p>`;
}

$('#entries').addEventListener('click', async (e) => {
  const id = e.target.dataset?.delEntry;
  if (!id || !confirm(t('diary.deleteConfirm'))) return;
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

// ---------- Ask (local LLM) ----------

const modelSelect = $('#model-select');
for (const [id, labelKey] of Object.entries(llm.MODELS)) modelSelect.add(new Option(t(labelKey), id));
const history = [];

async function refreshModelStatus() {
  const status = $('#model-status');
  if (!llm.hasWebGPU()) {
    status.textContent = t('ask.noWebGPU');
    $('#btn-load').disabled = true;
    return;
  }
  const cached = await llm.isCached(modelSelect.value).catch(() => false);
  $('#btn-remove').hidden = !cached;
  if (llm.isLoaded()) return;
  $('#btn-load').textContent = t(cached ? 'ask.loadCached' : 'ask.loadDownload');
  status.textContent = t(cached ? 'ask.cached' : 'ask.notCached');
}
modelSelect.addEventListener('change', refreshModelStatus);

$('#btn-remove').addEventListener('click', async () => {
  if (!confirm(t('ask.removeConfirm', { model: t(llm.MODELS[modelSelect.value]) }))) return;
  await llm.remove(modelSelect.value);
  $('#ask-input').disabled = true;
  $('#ask-form button').disabled = true;
  $('#btn-load').disabled = false;
  $('#model-status').textContent = t('ask.removed');
  refreshModelStatus();
});

$('#btn-load').addEventListener('click', async () => {
  const bar = $('#model-progress');
  const status = $('#model-status');
  $('#btn-load').disabled = true;
  bar.hidden = false;
  try {
    await llm.load(modelSelect.value, (p) => { bar.value = p.progress; status.textContent = p.text; });
    status.textContent = t('ask.ready');
    bar.hidden = true;
    $('#ask-input').disabled = false;
    $('#ask-form button').disabled = false;
  } catch (e) {
    console.error(e);
    status.textContent = t('ask.loadError', { err: errText(e) });
    $('#btn-load').disabled = false;
  }
});

function buildContext() {
  const lines = [t('ctx.today', { day: fmtDay(todayIso()) })];
  const all = herePlace && forecasts.get('here') ? [herePlace, ...places] : places;
  let withForecast = 0;
  for (const p of all) {
    const wx = forecasts.get(p.id);
    const days = wx ? scoreDays(wx.daily, todayIso()) : [];
    if (!days.length) continue;
    withForecast++;
    lines.push(t('ctx.place', {
      name: p.name,
      elev: wx.elevation,
      days: days.slice(0, 10).map((d) => `${fmtDay(d.date)} ${d.score}`).join(', '),
      reasons: days[0].reasons.join('; '),
    }));
  }
  if (!withForecast) lines.push(t('ctx.noPlaces'));
  const recent = entries.slice(0, 8);
  if (recent.length) {
    lines.push(t('ctx.diary'));
    for (const en of recent) {
      lines.push(t('ctx.entry', {
        day: fmtDay(en.date),
        n: en.found,
        grams: en.grams ? ` (${en.grams} g)` : '',
        habitat: habitatName(en.habitat),
        place: en.radar?.place ? t('ctx.zone', { name: en.radar.place }) : '',
        score: en.radar?.score != null ? t('ctx.score', { score: en.radar.score }) : '',
        notes: en.notes ? t('ctx.notes', { notes: en.notes }) : '',
      }));
    }
  } else {
    lines.push(t('ctx.noDiary'));
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
  if (llm.EDIBILITY_RE.test(question)) addMsg('bot alert', t('ask.edibility'));
  history.push({ role: 'user', content: question });
  const out = addMsg('bot', '…');
  $('#ask-input').disabled = true;
  try {
    const answer = await llm.ask(history, buildContext(), (text) => { out.textContent = text; });
    history.push({ role: 'assistant', content: answer });
  } catch (e) {
    console.error(e);
    out.textContent = t('ask.error', { err: errText(e) });
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

// ---------- Startup ----------

renderEntries();
renderPlaces();
refreshModelStatus();
