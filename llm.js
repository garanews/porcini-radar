// Open-weight LLM running inside the phone's browser, on the CPU.
// wllama is llama.cpp compiled to WebAssembly: the model is downloaded once, stays in the
// browser storage and then works offline.
//
// Why CPU and not WebGPU: with WebLLM on a Poco F3 (Adreno 650) the GPU driver reset or
// froze the screen while answering, and WebLLM's Gemma 3 build degenerated into garbage.
// llama.cpp runs Gemma correctly, in the phone's RAM instead of its GPU memory.
import { Wllama } from './vendor/wllama/index.js';
import { t } from './i18n.js';

// Google's open-weight Gemma models, 4-bit GGUF. The label keys are in i18n.js.
export const MODELS = {
  'gemma3-1b': {
    name: 'Gemma 3 1B',
    label: 'model.gemma3-1b',
    url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_0.gguf',
  },
  'gemma2-2b': {
    name: 'Gemma 2 2B',
    label: 'model.gemma2-2b',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
  },
};
export const DEFAULT_MODEL = 'gemma3-1b';

// Every token costs time on a phone CPU: short answers.
const MAX_ANSWER_TOKENS = 150;

// Questions about edibility: the app shows the warning itself, it does not rely on the model.
export const EDIBILITY_RE = /(mangi|commestibil|velenos|tossic|cucinar|si pu[oò] mangiare|edible|\beat\b|eating|poison|toxic|safe to|cook)/i;

const WASM = { default: new URL('./vendor/wllama/wllama.wasm', import.meta.url).href };
const newWllama = () => new Wllama(WASM, { allowOffline: true, suppressNativeLog: true });
let wllama = newWllama();
let loadedId = null;

export async function isCached(id) {
  const entries = await wllama.cacheManager.list();
  return entries.some((e) => e.metadata?.originalURL === MODELS[id].url);
}

export async function load(id, onProgress) {
  if (loadedId === id) return;
  if (loadedId) {
    await wllama.exit();
    wllama = newWllama();
    loadedId = null;
  }
  // Ask the browser not to evict the model when it needs space.
  await navigator.storage?.persist?.();
  await wllama.loadModelFromUrl(MODELS[id].url, {
    n_ctx: 2048,
    n_gpu_layers: 0, // CPU only: no GPU driver resets
    // The Snapdragon 870 has 4 fast cores: more threads would land on the slow ones.
    n_threads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
    progressCallback: ({ loaded, total }) => onProgress({
      progress: total ? loaded / total : 0,
      text: `${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`,
    }),
  });
  loadedId = id;
}

export async function remove(id) {
  if (loadedId === id) {
    await wllama.exit();
    wllama = newWllama();
    loadedId = null;
  }
  await wllama.cacheManager.delete(MODELS[id].url);
}

export const isLoaded = (id) => (id ? loadedId === id : loadedId !== null);

// Threads actually in use (1 means no cross-origin isolation: slower).
export const threads = () => (loadedId ? wllama.getNumThreads() : 0);

// Small models open with "Sure, here is my answer:": drop that first line.
const PREAMBLE_RE = /^\s*(certo|ecco|ok|okay|sure|here|of course)\b[^\n]*(\n+|$)/i;
const clean = (text) => text.replace(PREAMBLE_RE, '').trimStart();

// One question at a time. What makes a 1B model behave:
//  - instructions in the user's language;
//  - data as plain sentences already interpreted by the radar (no scores to misread);
//  - one worked example of the expected answer;
//  - no mention of topics it should not bring up by itself.
export async function ask(question, situation, onToken) {
  const messages = [
    { role: 'user', content: `${t('llm.instructions')}\n\n${t('llm.example.situation')}\n\n${t('llm.question')}: ${t('llm.example.q')}` },
    { role: 'assistant', content: t('llm.example.a') },
    { role: 'user', content: `${situation}\n\n${t('llm.question')}: ${question}` },
  ];
  const stream = await wllama.createChatCompletion({
    messages,
    stream: true,
    temperature: 0.3, // less creative: sticks closer to the data
    max_tokens: MAX_ANSWER_TOKENS,
  });
  let text = '';
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content ?? '';
    onToken(clean(text));
  }
  return { text: clean(text) };
}
