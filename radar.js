// Porcini Radar: a heuristic estimate of the porcini "flush" from weather data.
//
// Foragers' rules of thumb, turned into numbers:
//  - porcini appear about 10-15 days after heavy rain (>= 20-30 mm);
//  - they need mild temperatures: ideal 11-18 °C, measured in the soil (6 cm) where the
//    mycelium lives, falling back to the air temperature when soil data is missing;
//  - the soil must still be damp: rain two weeks ago is useless if it has dried out since;
//  - cold nights (< 3 °C) and dry, warm spells slow them down.
// Soil data comes from Open-Meteo's models and covers about the next 7 days; beyond that the
// air temperature is used and soil moisture counts as unknown.
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

// Mean of arr[from..to], skipping missing values; null if there is none (or no arr).
function meanOf(arr, from, to) {
  if (!arr) return null;
  let sum = 0, n = 0;
  for (let j = from; j <= to; j++) if (arr[j] != null) { sum += arr[j]; n++; }
  return n ? sum / n : null;
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

    // 2. Temperature: soil (last 3 days) when available, otherwise air (last week).
    const soilT = meanOf(daily.soil_temperature, i - 2, i);
    let tMean;
    if (soilT != null) {
      tMean = soilT;
    } else {
      let tSum = 0, n = 0;
      for (let j = i - 6; j <= i; j++) {
        if (tmax[j] != null && tmin[j] != null) { tSum += (tmax[j] + tmin[j]) / 2; n++; }
      }
      tMean = n ? tSum / n : 12;
    }
    const tempScore = tempSuitability(tMean);
    const tempNote = tempScore === 1 ? 'ideal' : tMean < 11 ? 'cool' : 'warm';
    reasons.push(t(soilT != null ? 'reason.soilTemp' : 'reason.temp', { t: tMean.toFixed(1) }) + t(`reason.temp.${tempNote}`));

    // 3. Soil moisture (last 3 days): 0.10 m³/m³ is dry, 0.22 and above is damp enough.
    const moist = meanOf(daily.soil_moisture, i - 2, i);
    const moistScore = moist == null ? 0.8 : clamp((moist - 0.10) / 0.12);
    if (moist != null) {
      const state = moist >= 0.22 ? 'damp' : moist >= 0.15 ? 'drying' : 'dry';
      reasons.push(t(`reason.soil.${state}`, { pct: Math.round(moist * 100) }));
    }

    // 4. Penalties: cold nights and a dry, warm week.
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

    const score = Math.round(100 * rainScore * tempScore * (0.4 + 0.6 * moistScore) * clamp(1 - penalty));
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
    hourly: 'soil_temperature_6cm,soil_moisture_3_to_9cm',
    past_days: 31,
    forecast_days: 16,
    timezone: 'auto',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const data = await res.json();
  // Soil data is hourly: reduce it to daily means aligned with daily.time.
  const daily = {
    ...data.daily,
    soil_temperature: dailyMeans(data.hourly, 'soil_temperature_6cm', data.daily.time),
    soil_moisture: dailyMeans(data.hourly, 'soil_moisture_3_to_9cm', data.daily.time),
  };
  return { daily, elevation: Math.round(data.elevation) };
}

function dailyMeans(hourly, key, days) {
  const sums = new Map();
  hourly.time.forEach((ts, k) => {
    const v = hourly[key][k];
    if (v == null) return;
    const day = ts.slice(0, 10);
    const s = sums.get(day) ?? { sum: 0, n: 0 };
    s.sum += v;
    s.n++;
    sums.set(day, s);
  });
  return days.map((d) => (sums.has(d) ? sums.get(d).sum / sums.get(d).n : null));
}
