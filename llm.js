// LLM open-weight che gira nel browser del telefono (WebLLM + WebGPU).
// Il modello si scarica una volta, resta nella cache del browser e poi funziona offline.

// Gemma, il modello open-weight di Google, in versione quantizzata a 4 bit.
export const MODELS = {
  'gemma3-1b-it-q4f16_1-MLC': 'Gemma 3 1B (consigliato, ~700 MB)',
  'gemma-2-2b-it-q4f16_1-MLC': 'Gemma 2 2B (più bravo, ~1,4 GB: solo telefoni con tanta memoria)',
};

// Contesto ridotto: dimezza la memoria della cache e basta per meteo + diario + domanda.
// Su Android Chrome chiude la scheda se il modello supera la memoria concessa alla GPU.
const CHAT_OPTS = { context_window_size: 2048 };

const SYSTEM_PROMPT = `Sei "Porcini Radar", un compagno esperto per la ricerca dei funghi porcini nei boschi italiani.
Rispondi in italiano, in modo breve e pratico (massimo 6-8 frasi), come un vecchio cercatore che dà consigli a un amico.
Usa i dati meteo e il diario che ti vengono forniti, senza inventare numeri.
Conoscenze utili: i porcini (Boletus edulis, aereus, pinophilus, aestivalis) amano faggete, castagneti, abetaie e querceti;
spuntano 10-15 giorni dopo piogge importanti con temperature miti; in autunno conviene la quota media (800-1400 m) e i versanti più caldi quando fa freddo, quelli a nord quando fa caldo.
REGOLA DI SICUREZZA ASSOLUTA: non dire mai che un fungo è commestibile o sicuro, e non provare a identificarne la commestibilità da una descrizione.
Se l'utente chiede se può mangiare un fungo, rispondi che deve farlo controllare gratuitamente all'Ispettorato Micologico della sua ASL prima di consumarlo.
Ricorda quando serve le regole di raccolta: tesserino regionale dove richiesto, limiti di peso, cestino areato, non rastrellare il sottobosco.`;

// Domande sulla commestibilità: l'avviso lo mostra l'app, non ci affidiamo solo al modello.
export const EDIBILITY_RE = /\b(mangi|commestibil|velenos|tossic|cucinar|mangiabil|si pu[oò] mangiare|è buono da)/i;

let engine = null;
let loadedModel = null;

export const hasWebGPU = () => 'gpu' in navigator;

export async function isCached(modelId) {
  const webllm = await import('./vendor/web-llm.js');
  return webllm.hasModelInCache(modelId);
}

export async function load(modelId, onProgress) {
  if (engine && loadedModel === modelId) return;
  const webllm = await import('./vendor/web-llm.js');
  // Chiede al browser di non cancellare il modello quando serve spazio.
  await navigator.storage?.persist?.();
  if (engine) await engine.unload();
  engine = await webllm.CreateWebWorkerMLCEngine(
    new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' }),
    modelId,
    { initProgressCallback: (p) => onProgress(p) },
    CHAT_OPTS,
  );
  loadedModel = modelId;
}

export async function remove(modelId) {
  if (engine && loadedModel === modelId) {
    await engine.unload();
    engine = null;
    loadedModel = null;
  }
  const webllm = await import('./vendor/web-llm.js');
  await webllm.deleteModelAllInfoInCache(modelId);
}

export const isLoaded = () => engine !== null;

// history: [{role, content}], context: testo con meteo e diario. onToken riceve il testo parziale.
export async function ask(history, context, onToken) {
  // Gemma non ha un ruolo "system": istruzioni e dati vanno in testa al primo messaggio utente.
  const recent = history.slice(-4);
  if (recent[0]?.role !== 'user') recent.shift();
  const messages = recent.map((m, i) => (i === 0
    ? { role: 'user', content: `${SYSTEM_PROMPT}\n\nDATI ATTUALI:\n${context}\n\nDOMANDA:\n${m.content}` }
    : m));
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.6,
    max_tokens: 300,
  });
  let text = '';
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? '';
    onToken(text);
  }
  return text;
}
