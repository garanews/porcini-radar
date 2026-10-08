// Compass tab: "back to the car" / "take me to a spot" navigation, and SOS.
// Works with no signal: only GPS and the phone's compass, no maps or network.
import { t, fmtDay } from './i18n.js';
import * as db from './db.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let watchId = null;
let pos = null;       // last GPS fix { lat, lon, acc, alt }
let heading = null;   // compass heading in degrees, 0 = north; null without a compass
let targets = [];     // [{ key, label, lat, lon }]
let arrived = false;

// ---------- Geometry ----------

const rad = Math.PI / 180;

function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Initial bearing from a to b, degrees clockwise from north.
function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const cardinal = (deg) => t(`nav.dir.${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][Math.round(deg / 45) % 8]}`);
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);

// ---------- Targets: the car, saved spots, diary finds ----------

async function loadTargets() {
  const car = await db.get('kv', 'car');
  const places = await db.getAll('places');
  const entries = (await db.getAll('entries')).filter((en) => en.pos);
  targets = [
    ...(car ? [{ key: 'car', label: t('nav.car', { time: new Date(car.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }), lat: car.lat, lon: car.lon }] : []),
    ...places.map((p) => ({ key: `p:${p.id}`, label: `📍 ${p.name}`, lat: p.lat, lon: p.lon })),
    ...entries.sort((a, b) => b.id.localeCompare(a.id)).map((en) => ({
      key: `e:${en.id}`, label: `🍄 ${fmtDay(en.date)} · ${t('diary.porcini', { n: en.found })}`, lat: en.pos.lat, lon: en.pos.lon,
    })),
  ];
  const select = $('#nav-target');
  const previous = select.value;
  select.innerHTML = targets.length
    ? targets.map((tg) => `<option value="${esc(tg.key)}">${esc(tg.label)}</option>`).join('')
    : `<option value="">${esc(t('nav.noTargets'))}</option>`;
  if (targets.some((tg) => tg.key === previous)) select.value = previous;
  arrived = false;
  render();
}

$('#nav-target').addEventListener('change', () => { arrived = false; render(); });

$('#btn-car').addEventListener('click', async () => {
  const info = $('#nav-info');
  if (!pos) { info.textContent = t('radar.locating'); return; }
  await db.put('kv', { lat: pos.lat, lon: pos.lon, acc: pos.acc, time: Date.now() }, 'car');
  await loadTargets();
  $('#nav-target').value = 'car';
  render();
  info.textContent = t('nav.carSaved', { acc: pos.acc });
});

// ---------- Compass ----------

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                  // Android
  if (h == null) return;
  heading = (h + (screen.orientation?.angle ?? 0) + 360) % 360;
  render();
}

async function startCompass() {
  // iOS asks for permission, and only after a tap.
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
  }
  addEventListener('deviceorientationabsolute', onOrientation);
  addEventListener('deviceorientation', onOrientation);
  $('#btn-compass').hidden = true;
}

$('#btn-compass').addEventListener('click', startCompass);

// ---------- Rendering ----------

function render() {
  renderSos();
  const target = targets.find((tg) => tg.key === $('#nav-target').value);
  const arrow = $('#nav-arrow');
  if (!pos || !target) {
    $('#nav-dist').textContent = '—';
    $('#nav-info').textContent = !pos ? t('radar.locating') : '';
    arrow.style.opacity = 0.25;
    return;
  }
  const d = distanceM(pos, target);
  const b = bearing(pos, target);
  arrow.style.opacity = 1;
  // With a compass the arrow points the way to walk; without one it is drawn north-up.
  arrow.style.transform = `rotate(${heading == null ? b : b - heading}deg)`;
  $('#nav-dist').textContent = fmtDist(d);
  $('#nav-info').textContent = (heading == null ? t('nav.noCompass', { dir: cardinal(b), deg: Math.round(b) }) : t('nav.direction', { dir: cardinal(b) }))
    + ` · ${t('radar.accuracy', { acc: pos.acc })}`;
  // Within 25 m (or the GPS accuracy, if worse) you are there: buzz once.
  if (!arrived && d <= Math.max(25, pos.acc)) {
    arrived = true;
    navigator.vibrate?.([200, 100, 200]);
    $('#nav-info').textContent = t('nav.arrived');
  }
}

// ---------- SOS ----------

function renderSos() {
  if (!pos) return;
  const lat = pos.lat.toFixed(5), lon = pos.lon.toFixed(5);
  $('#sos-coords').textContent = `${lat}, ${lon}`;
  $('#sos-extra').textContent = t('sos.extra', { acc: pos.acc, alt: pos.alt != null ? `${Math.round(pos.alt)} m` : '—' });
  const text = t('sos.text', { lat, lon, acc: pos.acc, url: `https://maps.google.com/?q=${lat},${lon}` });
  // An SMS gets through with signal too weak for internet. "?body=" works on Android and iOS.
  $('#sos-sms').href = `sms:?body=${encodeURIComponent(text)}`;
  $('#sos-share').dataset.text = text;
}

$('#sos-share').addEventListener('click', async (e) => {
  const text = e.currentTarget.dataset.text;
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); $('#nav-info').textContent = t('sos.copied'); }
  } catch {}
});

// ---------- Start/stop with the tab (GPS and compass drain the battery) ----------

export function start() {
  loadTargets();
  if (watchId == null && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), alt: p.coords.altitude };
        render();
      },
      (e) => { $('#nav-info').textContent = t(e.code === 1 ? 'gps.denied' : 'gps.notFound'); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 },
    );
  }
  // Android exposes the compass without asking: start it right away.
  if (typeof DeviceOrientationEvent?.requestPermission !== 'function') startCompass();
}

export function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  removeEventListener('deviceorientationabsolute', onOrientation);
  removeEventListener('deviceorientation', onOrientation);
}
