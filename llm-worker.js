// The model runs in a Web Worker so the UI stays responsive.
import { WebWorkerMLCEngineHandler } from './vendor/web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
