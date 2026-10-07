// Porcini Radar: euristica per stimare la "buttata" dei porcini dai dati meteo.
//
// Regole empiriche dei cercatori, tradotte in numeri:
//  - i porcini spuntano circa 10-15 giorni dopo una pioggia importante (>= 20-30 mm);
//  - servono temperature miti: media giornaliera ideale 11-18 °C;
//  - le notti fredde (< 3 °C) e i periodi secchi e caldi frenano la crescita.
// Non è un modello scientifico validato: è un punto di partenza da tarare con il diario.

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Peso della pioggia caduta k giorni prima: massimo tra 10 e 14 giorni.
function rainWeight(k) {
  if (k < 7 || k > 21) return 0;
  if (k >= 10 && k <= 14) return 1;
  if (k < 10) return [0.2, 0.4, 0.7][k - 7];
  return 1 - 0.1 * (k - 14);
}

// Quanto è favorevole una temperatura media giornaliera (0..1).
function tempSuitability(t) {
  if (t >= 11 && t <= 18) return 1;
  if (t < 11) return clamp((t - 5) / 6);
  return clamp((24 - t) / 6);
}

const fmtDay = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

export function labelFor(score) {
  if (score >= 75) return { text: 'Ottimo', cls: 'top' };
  if (score >= 50) return { text: 'Buono', cls: 'good' };
  if (score >= 25) return { text: 'Possibile', cls: 'maybe' };
  return { text: 'Scarso', cls: 'low' };
}

// daily: { time[], precipitation_sum[], temperature_2m_max[], temperature_2m_min[] }
// Restituisce un punteggio per ogni giorno da oggi in avanti.
export function scoreDays(daily, todayIso) {
  const { time } = daily;
  const rain = daily.precipitation_sum.map((v) => v ?? 0);
  const tmax = daily.temperature_2m_max;
  const tmin = daily.temperature_2m_min;
  const today = time.indexOf(todayIso);
  if (today < 0) return []; // previsione scaduta: va riscaricata
  const start = Math.max(21, today);
  const out = [];

  for (let i = start; i < time.length; i++) {
    const reasons = [];

    // 1. Pioggia "giusta" di 1-3 settimane fa.
    let weighted = 0;
    for (let k = 7; k <= 21; k++) weighted += rain[i - k] * rainWeight(k);
    const rainScore = clamp(weighted / 40);

    // Evento di pioggia principale (3 giorni) dentro la finestra, per spiegare il punteggio.
    let best = { sum: 0, idx: i - 21 };
    for (let j = i - 21; j <= i - 9; j++) {
      const sum3 = rain[j] + rain[j + 1] + rain[j + 2];
      if (sum3 > best.sum) best = { sum: sum3, idx: j };
    }
    if (best.sum >= 20) {
      reasons.push(`pioggia importante (${Math.round(best.sum)} mm) da ${fmtDay(time[best.idx])}, ${i - best.idx} giorni prima`);
    } else {
      reasons.push(`poca pioggia utile nelle 1-3 settimane prima (max ${Math.round(best.sum)} mm in 3 giorni)`);
    }

    // 2. Temperatura media dell'ultima settimana.
    let tSum = 0, n = 0;
    for (let j = i - 6; j <= i; j++) {
      if (tmax[j] != null && tmin[j] != null) { tSum += (tmax[j] + tmin[j]) / 2; n++; }
    }
    const tMean = n ? tSum / n : 12;
    const tempScore = tempSuitability(tMean);
    reasons.push(`temperatura media della settimana ${tMean.toFixed(1)} °C${tempScore === 1 ? ' (ideale)' : tMean < 11 ? ' (fresca)' : ' (calda)'}`);

    // 3. Penalità: notti fredde e settimana secca e calda.
    let penalty = 0;
    let coldNights = 0;
    for (let j = i - 5; j <= i; j++) {
      if (tmin[j] == null) continue;
      if (tmin[j] < 0) { penalty += 0.3; coldNights++; }
      else if (tmin[j] < 3) { penalty += 0.15; coldNights++; }
    }
    if (coldNights) reasons.push(`${coldNights} notti fredde negli ultimi giorni`);
    let recentRain = 0;
    for (let j = i - 6; j <= i; j++) recentRain += rain[j];
    if (recentRain < 2 && tMean > 18) {
      penalty += 0.2;
      reasons.push('settimana secca e calda: il terreno si asciuga');
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

// Scarica 31 giorni di storico + 16 di previsione per un punto GPS.
// La quota la ricava Open-Meteo dal suo modello del terreno (più affidabile del GPS).
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

export { fmtDay };
