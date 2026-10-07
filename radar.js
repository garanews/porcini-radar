// Porcini Radar: a heuristic estimate of the porcini "flush" from weather data.
//
// Foragers' rules of thumb, turned into numbers:
//  - porcini appear about 10-15 days after heavy rain (>= 20-30 mm);
//  - they need mild temperatures: ideal daily mean 11-18 °C;
//  - cold nights (< 3 °C) and dry, warm spells slow them down.
// It is not a validated scientific model: a starting point to tune with the diary.

import { t, fmtDay } from './i18n.js';

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Weight of the rain that fell k days earlier: highest between 10 and 14 days.
function rainWeight(k) {
  if (k < 7 || k > 21) return 0;
  if (k >= 10 && k <= 14) return 1;
  if (k < 10) return [0.2, 0.4, 0.7][k - 7];
  return 1 - 0.1 * (k - 14);
}

// How favourable a daily mean temperature is (0..1).
function tempSuitability(temp) {
  if (temp >= 11 && temp <= 18) return 1;
  if (temp < 11) return clamp((temp - 5) / 6);
  return clamp((24 - temp) / 6);
}

export function labelFor(score) {
  const cls = score >= 75 ? 'top' : score >= 50 ? 'good' : score >= 25 ? 'maybe' : 'low';
  return { text: t(`label.${cls}`), cls };
}

// daily: { time[], precipitation_sum[], temperature_2m_max[], temperature_2m_min[] }
// Returns a score for every day from today onwards.
export function scoreDays(daily, todayIso) {
  const { time } = daily;
  const rain = daily.precipitation_sum.map((v) => v ?? 0);
  const tmax = daily.temperature_2m_max;
  const tmin = daily.temperature_2m_min;
  const today = time.indexOf(todayIso);
  if (today < 0) return []; // expired forecast: it must be downloaded again
  const start = Math.max(21, today);
  const out = [];

  for (let i = start; i < time.length; i++) {
    const reasons = [];

    // 1. The "right" rain, 1-3 weeks earlier.
    let weighted = 0;
    for (let k = 7; k <= 21; k++) weighted += rain[i - k] * rainWeight(k);
    const rainScore = clamp(weighted / 40);

    // Main rain event (3 days) inside the window, to explain the score.
    let best = { sum: 0, idx: i - 21 };
    for (let j = i - 21; j <= i - 9; j++) {
      const sum3 = rain[j] + rain[j + 1] + rain[j + 2];
      if (sum3 > best.sum) best = { sum: sum3, idx: j };
    }
    reasons.push(best.sum >= 20
      ? t('reason.bigRain', { mm: Math.round(best.sum), day: fmtDay(time[best.idx]), days: i - best.idx })
      : t('reason.littleRain', { mm: Math.round(best.sum) }));

    // 2. Mean temperature of the last week.
    let tSum = 0, n = 0;
    for (let j = i - 6; j <= i; j++) {
      if (tmax[j] != null && tmin[j] != null) { tSum += (tmax[j] + tmin[j]) / 2; n++; }
    }
    const tMean = n ? tSum / n : 12;
    const tempScore = tempSuitability(tMean);
    const tempNote = tempScore === 1 ? 'ideal' : tMean < 11 ? 'cool' : 'warm';
    reasons.push(t('reason.temp', { t: tMean.toFixed(1) }) + t(`reason.temp.${tempNote}`));

    // 3. Penalties: cold nights and a dry, warm week.
    let penalty = 0;
    let coldNights = 0;
    for (let j = i - 5; j <= i; j++) {
      if (tmin[j] == null) continue;
      if (tmin[j] < 0) { penalty += 0.3; coldNights++; }
      else if (tmin[j] < 3) { penalty += 0.15; coldNights++; }
    }
    if (coldNights) reasons.push(t('reason.coldNights', { n: coldNights }));
    let recentRain = 0;
    for (let j = i - 6; j <= i; j++) recentRain += rain[j];
    if (recentRain < 2 && tMean > 18) {
      penalty += 0.2;
      reasons.push(t('reason.dry'));
    }

    const score = Math.round(100 * rainScore * tempScore * clamp(1 - penalty));
    out.push({
      date: time[i],
      score,
      label: labelFor(score),
      forecast: i > today,
      rain: rain[i],
      tmin: tmin[i],
      tmax: tmax[i],
      reasons,
    });
  }
  return out;
}

// Downloads 31 days of history + 16 days of forecast for a GPS point.
// Open-Meteo derives the elevation from its terrain model (more reliable than phone GPS).
export async function fetchWeather({ lat, lon }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
    past_days: 31,
    forecast_days: 16,
    timezone: 'auto',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const data = await res.json();
  return { daily: data.daily, elevation: Math.round(data.elevation) };
}
