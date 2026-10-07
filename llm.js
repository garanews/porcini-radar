// Open-weight LLM running inside the phone's browser (WebLLM + WebGPU).
// The model is downloaded once, stays in the browser cache and then works offline.
import { lang } from './i18n.js';

// Gemma, Google's open-weight model, 4-bit quantized. Values are i18n keys for the labels.
export const MODELS = {
  'gemma3-1b-it-q4f16_1-MLC': 'model.gemma3-1b',
  'gemma-2-2b-it-q4f16_1-MLC': 'model.gemma2-2b',
};

// Smaller context: halves the KV cache memory and is enough for weather + diary + question.
// On Android, Chrome kills the tab if the model exceeds the GPU memory it is allowed.
const CHAT_OPTS = { context_window_size: 2048 };

const LANGUAGE = lang === 'it' ? 'Italian' : 'English';

const SYSTEM_PROMPT = `You are "Porcini Radar", an expert companion for foraging porcini mushrooms in Italian woods.
Always answer in ${LANGUAGE}, briefly and practically (6-8 sentences at most), like a seasoned forager giving advice to a friend.
Use the weather data and the diary you are given, without making up numbers.
Useful knowledge: porcini (Boletus edulis, aereus, pinophilus, aestivalis) love beech, chestnut, fir and oak woods;
they appear 10-15 days after heavy rain with mild temperatures; in autumn mid altitudes (800-1400 m) are best, warmer slopes when it is cold and north-facing slopes when it is warm.
ABSOLUTE SAFETY RULE: never say a mushroom is edible or safe, and never try to judge edibility from a description.
If the user asks whether they can eat a mushroom, tell them to have it checked by a mycological inspection service (in Italy the ASL Ispettorato Micologico, free of charge) before eating it.
When relevant, remind the foraging rules: regional permit where required, weight limits, a ventilated basket, never rake the undergrowth.`;

// Questions about edibility: the app shows the warning itself, it does not rely only on the model.
export const EDIBILITY_RE = /(mangi|commestibil|velenos|tossic|cucinar|si pu[oò] mangiare|edible|\beat\b|eating|poison|toxic|safe to|cook)/i;

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
  // Ask the browser not to evict the model when it needs space.
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

// history: [{role, content}], context: text with weather and diary. onToken gets the partial text.
export async function ask(history, context, onToken) {
  // Gemma has no "system" role: instructions and data go at the top of the first user message.
  const recent = history.slice(-4);
  if (recent[0]?.role !== 'user') recent.shift();
  const messages = recent.map((m, i) => (i === 0
    ? { role: 'user', content: `${SYSTEM_PROMPT}\n\nCURRENT DATA:\n${context}\n\nQUESTION:\n${m.content}` }
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
