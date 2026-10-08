// Open-weight LLM running inside the phone's browser, on the CPU.
// wllama is llama.cpp compiled to WebAssembly: the model is downloaded once, stays in the
// browser storage and then works offline.
//
// Why CPU and not WebGPU: with WebLLM on a Poco F3 (Adreno 650) the GPU driver reset or
// froze the screen while answering, and WebLLM's Gemma 3 build degenerated into garbage.
// llama.cpp runs Gemma 3 correctly (sliding-window attention included) and a 1B model is
// fast enough on the phone's CPU cores.
import { Wllama } from './vendor/wllama/index.js';
import { lang } from './i18n.js';

// Gemma 3 1B instruct, Google's open-weight model, 4-bit Q4_0 GGUF (fastest on ARM CPUs).
export const MODEL_NAME = 'Gemma 3 1B';
const MODEL_URL = 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_0.gguf';
export const MAX_ANSWER_TOKENS = 200;

const LANGUAGE = lang === 'it' ? 'Italian' : 'English';

const INSTRUCTIONS = `You are Porcini Radar, a friendly expert porcini forager. Answer in ${LANGUAGE}, in 3-5 short sentences, using the data below. Never say a mushroom is edible or safe: for that, send the user to the free ASL mycological inspection (Ispettorato Micologico).`;

// Questions about edibility: the app shows the warning itself, it does not rely only on the model.
export const EDIBILITY_RE = /(mangi|commestibil|velenos|tossic|cucinar|si pu[oò] mangiare|edible|\beat\b|eating|poison|toxic|safe to|cook)/i;

const WASM = { default: new URL('./vendor/wllama/wllama.wasm', import.meta.url).href };
let wllama = new Wllama(WASM, { allowOffline: true, suppressNativeLog: true });

export async function isCached() {
  const entries = await wllama.cacheManager.list();
  return entries.some((e) => e.metadata?.originalURL === MODEL_URL);
}

export async function load(onProgress) {
  if (wllama.isModelLoaded()) return;
  // Ask the browser not to evict the model when it needs space.
  await navigator.storage?.persist?.();
  await wllama.loadModelFromUrl(MODEL_URL, {
    n_ctx: 2048,
    n_gpu_layers: 0, // CPU only: no GPU driver resets
    // The Snapdragon 870 has 4 fast cores: more threads would land on the slow ones.
    n_threads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
    progressCallback: ({ loaded, total }) => onProgress({
      progress: total ? loaded / total : 0,
      text: `${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`,
    }),
  });
}

export async function remove() {
  if (wllama.isModelLoaded()) await wllama.exit();
  await wllama.cacheManager.delete(MODEL_URL);
  wllama = new Wllama(WASM, { allowOffline: true, suppressNativeLog: true });
}

export const isLoaded = () => wllama.isModelLoaded();

// Threads actually in use (1 means no cross-origin isolation: slower).
export const threads = () => (wllama.isModelLoaded() ? wllama.getNumThreads() : 0);

// One question at a time, with a compact context: prompt processing on a phone CPU
// takes time for every token.
export async function ask(question, context, onToken) {
  const stream = await wllama.createChatCompletion({
    messages: [{ role: 'user', content: `${INSTRUCTIONS}\n\n${context}\n\n${question}` }],
    stream: true,
    temperature: 0.5,
    max_tokens: MAX_ANSWER_TOKENS,
  });
  let text = '';
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content ?? '';
    onToken(text);
  }
  return { text };
}
