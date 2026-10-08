// Interface language: follows the phone's language (Italian or English).
// `?lang=en` or `?lang=it` in the URL overrides it, handy for demos.

const param = new URLSearchParams(location.search).get('lang');
const wanted = (param || navigator.language || 'en').toLowerCase();
export const lang = wanted.startsWith('it') ? 'it' : 'en';
export const locale = lang === 'it' ? 'it-IT' : 'en-GB';

const dict = {
  it: {
    'net.online': 'online',
    'net.offline': 'offline',

    'radar.here': '📍 Radar qui',
    'radar.save': '➕ Salva questo posto',
    'radar.refresh': 'Aggiorna le previsioni',
    'radar.myPlaces': 'I miei posti',
    'radar.noPlaces': 'Nessun posto salvato. Quando sei in un bel bosco premi “Salva questo posto”.',
    'radar.note': 'Punteggio stimato da pioggia delle 1-3 settimane precedenti, temperatura e notti fredde (dati <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>). È un\'euristica: tarala col diario.',
    'radar.loading': 'Carico le previsioni…',
    'radar.offlineCached': 'Sei offline: mostro le ultime previsioni salvate.',
    'radar.locating': 'Cerco la posizione GPS…',
    'radar.fetching': 'Scarico il meteo…',
    'radar.accuracy': 'Precisione GPS ±{acc} m',
    'radar.offlineNear': 'Offline: uso la previsione salvata di “{name}” ({km} km).',
    'radar.offlineNone': 'Offline e nessun posto salvato qui vicino: salva i posti quando hai rete.',
    'radar.namePrompt': 'Nome del posto (precisione ±{acc} m):',
    'radar.nameDefault': 'Faggeta',
    'radar.saved': '“{name}” salvato.',
    'radar.needNet': 'Serve internet per aggiornare.',
    'radar.deleteConfirm': 'Eliminare questo posto?',
    'radar.hereName': 'Qui adesso',
    'radar.nearName': 'Qui (vicino a {name})',
    'card.unavailable': 'Previsione non disponibile o scaduta: aggiornala quando hai internet.',
    'card.best': 'Giorno migliore: <strong>{day}</strong> ({score}, {label})',
    'card.why': 'Perché oggi {score}?',
    'card.updatedMin': 'Aggiornato {n} min fa',
    'card.updatedH': 'Aggiornato {n} h fa',
    'card.delete': 'elimina posto',
    'card.today': 'oggi',

    'label.top': 'Ottimo',
    'label.good': 'Buono',
    'label.maybe': 'Possibile',
    'label.low': 'Scarso',

    'reason.bigRain': 'pioggia importante ({mm} mm) da {day}, {days} giorni prima',
    'reason.littleRain': 'poca pioggia utile nelle 1-3 settimane prima (max {mm} mm in 3 giorni)',
    'reason.temp': 'temperatura media della settimana {t} °C',
    'reason.temp.ideal': ' (ideale)',
    'reason.temp.cool': ' (fresca)',
    'reason.temp.warm': ' (calda)',
    'reason.coldNights': '{n} notti fredde negli ultimi giorni',
    'reason.dry': 'settimana secca e calda: il terreno si asciuga',

    'gps.unavailable': 'GPS non disponibile',
    'gps.denied': 'Permesso GPS negato',
    'gps.notFound': 'Posizione non trovata, riprova all\'aperto',

    'diary.new': '➕ Nuova uscita',
    'diary.photo': 'Foto',
    'diary.found': 'Porcini trovati',
    'diary.grams': 'Peso (g)',
    'diary.habitat': 'Bosco',
    'diary.notes': 'Note',
    'diary.notesPh': 'Versante, terreno, altri funghi visti…',
    'diary.asPlace': 'Salva anche come posto',
    'diary.submit': '💾 Salva (con posizione GPS)',
    'diary.saveNoPos': '{err}. Salvare senza posizione?',
    'diary.placeName': 'Nome del posto:',
    'diary.empty': 'Ancora nessuna uscita registrata.',
    'diary.porcini': '{n} porcini',
    'diary.noPos': 'senza posizione',
    'diary.radar': 'radar {score}',
    'diary.deleteConfirm': 'Eliminare questa uscita?',
    'diary.export': '⬇️ Esporta backup del diario',
    'habitat.beech': 'Faggio',
    'habitat.chestnut': 'Castagno',
    'habitat.fir': 'Abete',
    'habitat.pine': 'Pino',
    'habitat.oak': 'Quercia',
    'habitat.mixed': 'Misto',
    'habitat.other': 'Altro',

    'ask.warning': '⚠️ L\'AI <strong>non</strong> dice se un fungo è commestibile. Prima di mangiarli falli sempre controllare all\'<strong>Ispettorato Micologico dell\'ASL</strong> (è gratis).',
    'ask.modelInfo': 'modello open-weight, gira tutto sul telefono',
    'ask.load': 'Carica modello',
    'ask.remove': '🗑️ Elimina modello',
    'ask.loadCached': 'Avvia modello (già scaricato)',
    'ask.loadDownload': 'Scarica modello (usa il Wi-Fi)',
    'ask.cached': 'Il modello è sul telefono: funziona anche senza campo.',
    'ask.notCached': 'Il download serve una volta sola, poi funziona offline.',
    'ask.noWebGPU': 'Questo browser non supporta WebGPU: serve Chrome aggiornato (Android 12+).',
    'ask.ready': '✅ Modello pronto. Tutto gira sul telefono, nessun dato esce.',
    'ask.loadError': 'Errore nel caricare il modello: {err}',
    'ask.error': 'Errore: {err}',
    'ask.removeConfirm': 'Eliminare il modello dal telefono? Per usarlo andrà riscaricato.',
    'ask.removed': 'Modello eliminato.',
    'ask.placeholder': 'Chiedi al tuo compagno di ricerca…',
    'ask.edibility': '⚠️ Nessuna app, e nessuna AI, può dirti se un fungo è commestibile. Portalo all\'Ispettorato Micologico dell\'ASL prima di mangiarlo: il controllo è gratuito.',
    'chip.where': 'Dove vado nei prossimi giorni?',
    'chip.whereQ': 'Dove conviene andare nei prossimi giorni, e quando?',
    'chip.diary': 'Cosa dice il mio diario?',
    'chip.diaryQ': 'Guardando il mio diario, in che condizioni ho trovato più porcini?',
    'chip.here': 'Sono nel bosco: dove guardo?',
    'chip.hereQ': 'Sono nel bosco adesso: dove guardo per trovare porcini?',

    'ctx.today': 'Oggi è {day}.',
    'ctx.spots': 'Posti (punteggio porcini 0-100):',
    'ctx.spot': '- {name} ({elev} m): oggi {today}, giorno migliore {bestDay} ({best}). {why}.',
    'ctx.noPlaces': 'Nessun posto salvato.',
    'ctx.diary': 'Diario: {outings} uscite, {total} porcini in tutto. Ultime: {recent}.',
    'ctx.entry': '{day} {n} porcini in {habitat}{score}',
    'ctx.score': ' (radar {score})',
    'ctx.noDiary': 'Diario vuoto.',
    'nav.radar': 'Radar',
    'nav.diary': 'Diario',
    'nav.ask': 'Chiedi',
  },

  en: {
    'net.online': 'online',
    'net.offline': 'offline',

    'radar.here': '📍 Radar here',
    'radar.save': '➕ Save this spot',
    'radar.refresh': 'Refresh forecasts',
    'radar.myPlaces': 'My spots',
    'radar.noPlaces': 'No saved spots yet. When you are in a promising wood, tap “Save this spot”.',
    'radar.note': 'Score estimated from the rain of the previous 1-3 weeks, temperature and cold nights (data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>). It is a heuristic: tune it with your diary.',
    'radar.loading': 'Loading forecasts…',
    'radar.offlineCached': 'You are offline: showing the last saved forecasts.',
    'radar.locating': 'Getting GPS position…',
    'radar.fetching': 'Downloading weather…',
    'radar.accuracy': 'GPS accuracy ±{acc} m',
    'radar.offlineNear': 'Offline: using the saved forecast for “{name}” ({km} km away).',
    'radar.offlineNone': 'Offline and no saved spot nearby: save your spots while you have signal.',
    'radar.namePrompt': 'Spot name (accuracy ±{acc} m):',
    'radar.nameDefault': 'Beech wood',
    'radar.saved': '“{name}” saved.',
    'radar.needNet': 'You need internet to refresh.',
    'radar.deleteConfirm': 'Delete this spot?',
    'radar.hereName': 'Right here',
    'radar.nearName': 'Here (near {name})',
    'card.unavailable': 'Forecast missing or expired: refresh it when you have internet.',
    'card.best': 'Best day: <strong>{day}</strong> ({score}, {label})',
    'card.why': 'Why {score} today?',
    'card.updatedMin': 'Updated {n} min ago',
    'card.updatedH': 'Updated {n} h ago',
    'card.delete': 'delete spot',
    'card.today': 'today',

    'label.top': 'Excellent',
    'label.good': 'Good',
    'label.maybe': 'Possible',
    'label.low': 'Poor',

    'reason.bigRain': 'heavy rain ({mm} mm) from {day}, {days} days before',
    'reason.littleRain': 'little useful rain 1-3 weeks before (max {mm} mm in 3 days)',
    'reason.temp': 'average temperature of the week {t} °C',
    'reason.temp.ideal': ' (ideal)',
    'reason.temp.cool': ' (cool)',
    'reason.temp.warm': ' (warm)',
    'reason.coldNights': '{n} cold nights in the last days',
    'reason.dry': 'dry and warm week: the soil is drying out',

    'gps.unavailable': 'GPS not available',
    'gps.denied': 'GPS permission denied',
    'gps.notFound': 'Position not found, try again in the open',

    'diary.new': '➕ New outing',
    'diary.photo': 'Photo',
    'diary.found': 'Porcini found',
    'diary.grams': 'Weight (g)',
    'diary.habitat': 'Woodland',
    'diary.notes': 'Notes',
    'diary.notesPh': 'Slope, soil, other mushrooms seen…',
    'diary.asPlace': 'Also save as a spot',
    'diary.submit': '💾 Save (with GPS position)',
    'diary.saveNoPos': '{err}. Save without position?',
    'diary.placeName': 'Spot name:',
    'diary.empty': 'No outings recorded yet.',
    'diary.porcini': '{n} porcini',
    'diary.noPos': 'no position',
    'diary.radar': 'radar {score}',
    'diary.deleteConfirm': 'Delete this outing?',
    'diary.export': '⬇️ Export diary backup',
    'habitat.beech': 'Beech',
    'habitat.chestnut': 'Chestnut',
    'habitat.fir': 'Fir',
    'habitat.pine': 'Pine',
    'habitat.oak': 'Oak',
    'habitat.mixed': 'Mixed',
    'habitat.other': 'Other',

    'ask.warning': '⚠️ The AI does <strong>not</strong> tell you whether a mushroom is edible. Before eating any, always have them checked by a <strong>local mycological inspection service</strong> (in Italy: the free ASL Ispettorato Micologico).',
    'ask.modelInfo': 'open-weight model, runs entirely on the phone',
    'ask.load': 'Load model',
    'ask.remove': '🗑️ Delete model',
    'ask.loadCached': 'Start model (already downloaded)',
    'ask.loadDownload': 'Download model (use Wi-Fi)',
    'ask.cached': 'The model is on your phone: it works without signal too.',
    'ask.notCached': 'You download it only once, then it works offline.',
    'ask.noWebGPU': 'This browser does not support WebGPU: you need an up-to-date Chrome (Android 12+).',
    'ask.ready': '✅ Model ready. Everything runs on the phone, no data leaves it.',
    'ask.loadError': 'Error loading the model: {err}',
    'ask.error': 'Error: {err}',
    'ask.removeConfirm': 'Delete the model from the phone? You will need to download it again to use it.',
    'ask.removed': 'Model deleted.',
    'ask.placeholder': 'Ask your foraging buddy…',
    'ask.edibility': '⚠️ No app, and no AI, can tell you whether a mushroom is edible. Take it to a mycological inspection service before eating it (in Italy the ASL check is free).',
    'chip.where': 'Where should I go next?',
    'chip.whereQ': 'Where is it worth going in the next days, and when?',
    'chip.diary': 'What does my diary say?',
    'chip.diaryQ': 'Looking at my diary, in which conditions did I find the most porcini?',
    'chip.here': 'I\'m in the woods: where do I look?',
    'chip.hereQ': 'I am in the woods right now: where should I look for porcini?',

    'ctx.today': 'Today is {day}.',
    'ctx.spots': 'Spots (porcini score 0-100):',
    'ctx.spot': '- {name} ({elev} m): today {today}, best day {bestDay} ({best}). {why}.',
    'ctx.noPlaces': 'No saved spots.',
    'ctx.diary': 'Diary: {outings} outings, {total} porcini in all. Latest: {recent}.',
    'ctx.entry': '{day} {n} porcini in {habitat}{score}',
    'ctx.score': ' (radar {score})',
    'ctx.noDiary': 'Empty diary.',
    'nav.radar': 'Radar',
    'nav.diary': 'Diary',
    'nav.ask': 'Ask',
  },
};

export function t(key, params = {}) {
  const s = dict[lang][key] ?? dict.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

export const fmtDay = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

export const weekdayNarrow = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'narrow' });

// Older diary entries stored the Italian name: show it as is.
export const habitatName = (v) => (dict.en[`habitat.${v}`] ? t(`habitat.${v}`) : v);

// Fills the static page: data-i18n (text), data-i18n-html, data-i18n-placeholder, data-i18n-title, data-i18n-q.
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-q]').forEach((el) => { el.dataset.q = t(el.dataset.i18nQ); });
}
