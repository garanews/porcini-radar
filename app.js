import { scoreDays, fetchWeather } from './radar.js';
import { t, locale, fmtDay, weekdayNarrow, habitatName, applyStatic } from './i18n.js';
import * as db from './db.js';
import * as llm from './llm.js';
import * as compass from './nav.js';

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
    // GPS tracking and compass only while the Compass tab is open: they drain the battery.
    if (btn.dataset.tab === 'nav') compass.start(); else compass.stop();
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

// The service worker also adds the cross-origin isolation headers that let llama.cpp use
// several CPU threads. A page loaded before the current worker took over (first visit, or an
// update) is not isolated: reload once when the new worker takes control.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
  if (!window.crossOriginIsolated) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  }
}

// ---------- GPS ----------

function getPosition({ timeout = 30000, maximumAge = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('gps.unavailable')));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(t(e.code === 1 ? 'gps.denied' : 'gps.notFound'))),
      { enableHighAccuracy: true, timeout, maximumAge },
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

// Radar score on the day of the outing, so the diary can check the heuristic ("did the radar
// get it right?"). Online: computed at the exact position. Offline: from the forecast saved
// for the nearest spot within 5 km.
async function radarScoreFor(pos, dateIso) {
  const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
  const placeName = near && near.d <= 5 ? near.p.name : null;
  let wx = null;
  if (navigator.onLine) {
    try { wx = await fetchWeather(pos); } catch {}
  }
  if (!wx && placeName) wx = forecasts.get(near.p.id);
  const day = wx && scoreDays(wx.daily, dateIso)[0];
  if (!day && !placeName) return null;
  return { place: placeName, score: day ? day.score : null };
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
    radar: pos ? await radarScoreFor(pos, date) : null,
  };
  if (pos && data.get('asPlace')) {
    const name = prompt(t('diary.placeName'), `${habitatName(entry.habitat)} ${date}`);
    if (name) {
      const place = await savePlace(pos, name.trim());
      entry.radar = { place: place.name, score: entry.radar?.score ?? null };
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

// "Did the radar get it right?": compares the radar score of outings with porcini against
// outings that came back empty. Needs both kinds, so the diary should log empty outings too.
function calibrationHtml() {
  const scored = entries.filter((en) => en.radar?.score != null);
  const avg = (list) => Math.round(list.reduce((s, en) => s + en.radar.score, 0) / list.length);
  let body;
  if (scored.length < 3) {
    body = `<p class="small">${t('calib.need', { n: scored.length })}</p>`;
  } else {
    const hits = scored.filter((en) => en.found > 0);
    const misses = scored.filter((en) => en.found === 0);
    if (!hits.length || !misses.length) {
      body = `<p class="small">${t('calib.oneSided')}</p>`;
    } else {
      const a = avg(hits), b = avg(misses);
      const verdict = a - b >= 15 ? 'calib.good' : a - b > 0 ? 'calib.weak' : 'calib.bad';
      body = `<p class="small">${t('calib.stats', { a, na: hits.length, b, nb: misses.length })}</p>
        <p class="small"><strong>${t(verdict)}</strong></p>`;
    }
  }
  return `<details class="card calib"><summary>${t('calib.title')}</summary>${body}</details>`;
}

async function renderEntries() {
  entries = (await db.getAll('entries')).sort((a, b) => b.id.localeCompare(a.id));
  photoUrls.forEach(URL.revokeObjectURL);
  photoUrls = [];
  $('#entries').innerHTML = (entries.length ? calibrationHtml() : '') + (entries.length
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
    : `<p class="muted">${t('diary.empty')}</p>`);
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

// Model menu: the choice is remembered on this phone (a convenience; the default works without it).
const modelSelect = $('#model-select');
for (const [id, m] of Object.entries(llm.MODELS)) modelSelect.add(new Option(t(m.label), id));
try { const saved = localStorage.getItem('model'); if (llm.MODELS[saved]) modelSelect.value = saved; } catch {}
if (!llm.MODELS[modelSelect.value]) modelSelect.value = llm.DEFAULT_MODEL;

function setAskEnabled(on) {
  $('#ask-input').disabled = !on;
  $('#ask-form button').disabled = !on;
}

async function refreshModelStatus() {
  const id = modelSelect.value;
  const status = $('#model-status');
  const cached = await llm.isCached(id).catch(() => false);
  $('#btn-remove').hidden = !cached;
  if (llm.isLoaded(id)) {
    $('#btn-load').disabled = true;
    setAskEnabled(true);
    return;
  }
  setAskEnabled(false);
  $('#btn-load').disabled = false;
  $('#btn-load').textContent = t(cached ? 'ask.loadCached' : 'ask.loadDownload');
  status.textContent = t(cached ? 'ask.cached' : 'ask.notCached');
}

// What is downloaded on this phone, with sizes, each with its own delete button.
const fmtMB = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

async function renderStorage() {
  const files = await llm.downloaded().catch(() => []);
  $('#storage-list').innerHTML = files.length
    ? files.map((f) => `<li>${esc(f.name)} · ${fmtMB(f.size)} <button class="del" data-del-model="${esc(f.key)}">🗑️</button></li>`).join('')
    : `<li class="muted">${t('storage.none')}</li>`;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('#storage-total').textContent = est ? t('storage.total', { used: fmtMB(est.usage), free: fmtMB(est.quota - est.usage) }) : '';
}

$('#storage-list').addEventListener('click', async (e) => {
  const key = e.target.dataset?.delModel;
  if (!key || !confirm(t('ask.removeConfirm'))) return;
  await llm.removeFile(key);
  renderStorage();
  refreshModelStatus();
});
$('#storage').addEventListener('toggle', () => { if ($('#storage').open) renderStorage(); });

modelSelect.addEventListener('change', () => {
  try { localStorage.setItem('model', modelSelect.value); } catch {}
  refreshModelStatus();
});

$('#btn-remove').addEventListener('click', async () => {
  if (!confirm(t('ask.removeConfirm'))) return;
  await llm.remove(modelSelect.value);
  $('#model-status').textContent = t('ask.removed');
  refreshModelStatus();
  renderStorage();
});

$('#btn-load').addEventListener('click', async () => {
  const bar = $('#model-progress');
  const status = $('#model-status');
  $('#btn-load').disabled = true;
  modelSelect.disabled = true;
  bar.hidden = false;
  try {
    await llm.load(modelSelect.value, (p) => { bar.value = p.progress; status.textContent = p.text; });
    status.textContent = t('ask.ready', { threads: llm.threads() });
    bar.hidden = true;
    setAskEnabled(true);
    renderStorage();
  } catch (e) {
    console.error(e);
    status.textContent = t('ask.loadError', { err: errText(e) });
    $('#btn-load').disabled = false;
  }
  modelSelect.disabled = false;
});

// Before each question: the radar at the user's current position, so the model answers about
// where they are instead of inventing the weather. Offline it borrows the forecast of a saved
// spot within 5 km. Without GPS the question goes on without it.
async function refreshHere() {
  try {
    // A position up to 10 minutes old is fine, and the question waits at most 10 s for the GPS.
    const pos = await getPosition({ timeout: 10000, maximumAge: 600000 });
    herePlace = { id: 'here', name: t('radar.hereName'), ...pos };
    if (navigator.onLine) {
      await loadForecast(herePlace, true);
      return;
    }
    forecasts.delete('here');
    const near = places.map((p) => ({ p, d: distanceKm(p, pos) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 5 && forecasts.get(near.p.id)) forecasts.set('here', forecasts.get(near.p.id));
  } catch (e) {
    console.warn('No position for the question:', e);
  }
}

const bestOf = (days) => days.reduce((a, b) => (b.score > a.score ? b : a));
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The answer to "should I go?" is computed here, not by the model: a 1B model contradicted
// the data ("yes, go today" with a dry forecast). Returns:
//  - verdict: shown to the user first, always consistent with the radar;
//  - situation: what the model reads, plain sentences, compact (every prompt token costs
//    time on a phone CPU): the verdict, the current position, the 3 best spots, the diary.
function buildAnswerContext() {
  const verdictLines = [];
  const lines = [t('ctx.today', { day: fmtDay(todayIso()) })];

  const hereWx = herePlace && forecasts.get('here');
  const hereDays = hereWx ? scoreDays(hereWx.daily, todayIso()) : [];
  if (hereDays.length) {
    const today = hereDays[0];
    const best = bestOf(hereDays);
    const verdict = today.score >= 50 ? t('verdict.go')
      : best.score >= 50 ? t('verdict.wait', { day: fmtDay(best.date) })
      : t('verdict.poor');
    verdictLines.push(t('answer.here', { elev: hereWx.elevation, verdict: capitalize(verdict) }));
    if (hereWx.elevation < 400) verdictLines.push(t('verdict.lowland'));
    lines.push(t('ctx.here', { elev: hereWx.elevation, why: today.reasons.join('; ') }));
  } else {
    // GPS worked but no forecast (offline, no saved spot nearby) vs no GPS at all.
    verdictLines.push(t(herePlace ? 'answer.noWeather' : 'answer.noHere'));
    lines.push(t('ctx.noHere'));
  }

  const spots = places
    .map((p) => ({ p, wx: forecasts.get(p.id) }))
    .map(({ p, wx }) => ({ p, wx, days: wx ? scoreDays(wx.daily, todayIso()) : [] }))
    .filter((s) => s.days.length)
    .map((s) => ({ ...s, best: bestOf(s.days) }))
    .sort((a, b) => b.best.score - a.best.score)
    .slice(0, 3);
  if (spots.length && spots[0].best.score >= 50) {
    verdictLines.push(t('answer.bestSpot', { day: fmtDay(spots[0].best.date), name: spots[0].p.name }));
  }
  lines.splice(1, 0, t('ctx.verdict', { verdict: verdictLines.join(' ') }));
  if (spots.length) {
    lines.push(t('ctx.spots'));
    for (const { p, wx, days, best } of spots) {
      lines.push(t('ctx.spot', {
        name: p.name.slice(0, 30),
        elev: wx.elevation,
        label: days[0].label.text.toLowerCase(),
        bestDay: fmtDay(best.date),
        bestLabel: best.label.text.toLowerCase(),
      }));
    }
  }
  if (entries.length) {
    const total = entries.reduce((n, en) => n + en.found, 0);
    const recent = entries.slice(0, 3).map((en) => t('ctx.entry', {
      day: fmtDay(en.date),
      n: en.found,
      habitat: habitatName(en.habitat).toLowerCase(),
    }));
    lines.push(t('ctx.diary', { outings: entries.length, total, recent: recent.join('; ') }));
  }
  return { verdict: `📡 ${verdictLines.join(' ')}`, situation: lines.join('\n') };
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
  if (!llm.isLoaded(modelSelect.value) || !question) return;
  addMsg('user', question);
  if (llm.EDIBILITY_RE.test(question)) addMsg('bot alert', t('ask.edibility'));
  const out = addMsg('bot', '📍…');
  $('#ask-input').disabled = true;
  await refreshHere();
  // The radar's verdict appears at once; the model's tips stream in below it.
  const { verdict, situation } = buildAnswerContext();
  out.textContent = `${verdict}\n\n…`;
  try {
    await llm.ask(question.slice(0, 300), situation, (text) => { out.textContent = `${verdict}\n\n${text}`; });
  } catch (e) {
    console.error(e);
    out.textContent = `${verdict}\n\n${t('ask.error', { err: errText(e) })}`;
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
