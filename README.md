# 🍄 Porcini Radar

When and where to go porcini hunting, with an open-source AI that lives in your phone and works with no signal.

**Live app:** https://garanews.github.io/porcini-radar/ (Italian or English, following the phone's language; add `?lang=en` or `?lang=it` to force one)

Built for the DEV [Hacktoberfest Open-Source AI Challenge – Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).

## What it does

- **Radar** – estimates the porcini "flush" for the next 16 days at your spots, from rain and temperatures ([Open-Meteo](https://open-meteo.com/)). You save spots with the GPS while you are in the woods; at home you check them all.
- **Diary** – log each outing with photo, GPS position, woodland type and how many porcini you found. Everything stays on the phone (IndexedDB) and works offline. Each entry also stores that day's radar score, so over time you can see whether the heuristic is right.
- **Ask** – an open-weight LLM (Google **Gemma 2 2B**, via [WebLLM](https://github.com/mlc-ai/web-llm)) runs **inside the phone's browser** on WebGPU. It reads a compact summary of your forecasts and diary and gives advice, with no connection.

### Choosing a model that fits in a phone

- **Gemma 2 2B** with the default 4096-token context crashed Chrome on a Poco F3 (out of GPU memory). With the context cut to 1024 tokens and a compact prompt (one question at a time) it needs about 1.6 GB.
- **Gemma 3 1B** would be lighter, but WebLLM's build of it degenerates into garbage on real prompts (its config pairs an 8192 context with a 512 sliding window, which WebLLM cannot run).
- **Llama 3.2 1B** works and is lighter, but it uses the data poorly and invents facts. It stays available as a fallback: add `?model=Llama-3.2-1B-Instruct-q4f16_1-MLC` to the URL.

[tests/ask-test.html](tests/ask-test.html) runs the app's prompt through the model to compare them.

## Why it runs on the phone

- **No signal in the woods.** A cloud API is useless where porcini grow.
- **Secret spots stay secret.** No forager wants to send the exact coordinates of their spots to someone else's server. Here nothing leaves the phone: the only network calls are the weather download (coordinates rounded, no account) and the one-time model download.
- **No cost, no account, no API key.**

## Safety

The app does **not** identify mushrooms and never says whether one is edible. Small models make mistakes, and with mushrooms like *Amanita phalloides* a mistake can kill. Before eating any wild mushroom, have it checked by a mycological inspection service; in Italy the ASL *Ispettorato Micologico* does it for free. If a question is about edibility, the app shows a fixed warning itself, without relying on the model.

## The radar heuristic

The score (0-100) is:

- the **rain** of 7-21 days before, weighted most between 10 and 14 days;
- multiplied by how suitable the week's mean **temperature** is (ideal 11-18 °C);
- minus **penalties** for nights below 3 °C and for dry, warm weeks.

These are foragers' rules of thumb, not a validated model: the diary is there to check them against what you actually find. The logic is in [radar.js](radar.js).

## Run it

It is a static site with no build step:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. On a phone it needs HTTPS (for GPS, WebGPU and installing), e.g. GitHub Pages. Requirements for the AI: Chrome on Android 12+ with WebGPU. [tests/radar-test.html](tests/radar-test.html) scores real weather data for a sample spot.

## Stack, all open

- [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0), vendored in `vendor/`
- [Gemma 2](https://ai.google.dev/gemma), Google's open-weight model ([Gemma Terms of Use](https://ai.google.dev/gemma/terms)), 4-bit quantized by MLC
- Weather data by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Plain HTML, CSS and JavaScript, PWA with a service worker
