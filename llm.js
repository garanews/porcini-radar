// Open-weight LLM running inside the phone's browser (WebLLM + WebGPU).
// The model is downloaded once, stays in the browser cache and then works offline.
import { lang } from './i18n.js';

// Gemma 2 2B, Google's open-weight model, 4-bit quantized (~1.4 GB download).
// The context is cut to 1024 tokens to save GPU memory: Chrome on Android kills the tab
// when a model exceeds what the GPU is allowed (it did with the default 4096).
// Gemma 3 1B was dropped: WebLLM's build of it degenerates into garbage on real prompts.
// Llama 3.2 1B is a lighter fallback (`?model=Llama-3.2-1B-Instruct-q4f16_1-MLC`), weaker with the data.
// The prompt is processed in chunks of this many tokens (the compiled default is 1024).
// Shorter GPU dispatches: on Android a long one made the driver reset the GPU
// ("A valid external Instance reference no longer exists"). Needs the patch in vendor/web-llm.js.
const PREFILL_CHUNK = 64;
const CANDIDATES = {
  'gemma-2-2b-it-q4f16_1-MLC': { name: 'Gemma 2 2B', opts: { context_window_size: 1024, sliding_window_size: -1, prefill_chunk_size: PREFILL_CHUNK } },
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': { name: 'Llama 3.2 1B', opts: { context_window_size: 1024, prefill_chunk_size: PREFILL_CHUNK } },
};
const wantedModel = new URLSearchParams(location.search).get('model');
export const MODEL_ID = CANDIDATES[wantedModel] ? wantedModel : 'gemma-2-2b-it-q4f16_1-MLC';
export const MODEL_NAME = CANDIDATES[MODEL_ID].name;
const CHAT_OPTS = CANDIDATES[MODEL_ID].opts;
export const MAX_ANSWER_TOKENS = 160;

const LANGUAGE = lang === 'it' ? 'Italian' : 'English';

// Kept short on purpose: instructions, data, question and answer share the 1024-token context.
const INSTRUCTIONS = `You are Porcini Radar, a friendly expert porcini forager. Answer in ${LANGUAGE}, in 3-4 short sentences, using the data below. Never say a mushroom is edible or safe: for that, send the user to the free ASL mycological inspection (Ispettorato Micologico).`;

// Questions about edibility: the app shows the warning itself, it does not rely only on the model.
export const EDIBILITY_RE = /(mangi|commestibil|velenos|tossic|cucinar|si pu[oò] mangiare|edible|\beat\b|eating|poison|toxic|safe to|cook)/i;

let engine = null;

export const hasWebGPU = () => 'gpu' in navigator;

export async function isCached() {
  const webllm = await import('./vendor/web-llm.js');
  return webllm.hasModelInCache(MODEL_ID);
}

export async function load(onProgress) {
  if (engine) return;
  const webllm = await import('./vendor/web-llm.js');
  // Ask the browser not to evict the model when it needs space.
  await navigator.storage?.persist?.();
  engine = await webllm.CreateWebWorkerMLCEngine(
    new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' }),
    MODEL_ID,
    { initProgressCallback: (p) => onProgress(p) },
    CHAT_OPTS,
  );
}

export async function remove() {
  if (engine) {
    await engine.unload();
    engine = null;
  }
  const webllm = await import('./vendor/web-llm.js');
  await webllm.deleteModelAllInfoInCache(MODEL_ID);
}

export const isLoaded = () => engine !== null;

// One question at a time (no chat history): the small context has no room for it.
// context: short text with forecasts and diary. onToken gets the partial answer.
export async function ask(question, context, onToken) {
  // Gemma has no "system" role: instructions and data go in the user message.
  const content = `${INSTRUCTIONS}\n\n${context}\n\n${question}`;
  const stream = await engine.chat.completions.create({
    messages: [{ role: 'user', content }],
    stream: true,
    temperature: 0.5,
    max_tokens: MAX_ANSWER_TOKENS,
    stream_options: { include_usage: true },
  });
  let text = '';
  let usage = null;
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? '';
    if (chunk.usage) usage = chunk.usage;
    onToken(text);
  }
  return { text, usage };
}
