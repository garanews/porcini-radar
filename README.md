# 🍄 Porcini Radar

When and where to go porcini hunting, with an open-source AI that lives in your phone and works with no signal.

**Live app:** https://garanews.github.io/porcini-radar/ (Italian or English, following the phone's language; add `?lang=en` or `?lang=it` to force one)

Built for the DEV [Hacktoberfest Open-Source AI Challenge – Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).

## What it does

- **Radar** – estimates the porcini "flush" for the next 16 days at your spots, from rain, soil temperature and soil moisture ([Open-Meteo](https://open-meteo.com/)). You save spots with the GPS while you are in the woods; at home you check them all.
- **Diary** – log each outing with photo, GPS position, woodland type and how many porcini you found. Everything stays on the phone (IndexedDB) and works offline. Each entry stores that day's radar score, and **"Did the radar get it right?"** compares the scores of outings with porcini against empty ones.
- **Compass** – **back to the car** and **take me to a spot or a find**: an arrow, the distance and a buzz on arrival, from GPS and the phone's compass only, no maps or signal needed. **SOS**: your coordinates in large type, a button to call 112 and one to **send your position by SMS**, which gets through when the signal is too weak for internet.
- **Ask** – an open-weight LLM (Google **Gemma 3 1B**, or **Gemma 2 2B** on stronger phones) runs **inside the phone's browser** on the CPU, through [wllama](https://github.com/ngxson/wllama) (llama.cpp compiled to WebAssembly), with no connection.

### Who decides what: code for the verdict, the model for the words

A 1B model is fluent but does not reason reliably over data: asked "should I go today?" with a dry forecast, it answered "yes". So the app splits the work:

1. **The verdict is computed in code** from the radar ("too dry here, better around Sat 17 at your beech wood") and shown first, so it is always consistent with the data.
2. **The model adds practical tips** (which woods, altitude, slope, what to look for), the part a small model does well. It reads the situation as plain sentences, with instructions in the user's language and one worked example; it is told not to repeat or contradict the verdict.

### Getting an LLM to run on a mid-range phone

The target was a Poco F3 (Snapdragon 870). The first attempts used [WebLLM](https://github.com/mlc-ai/web-llm) on the GPU (WebGPU):

- **Gemma 2 2B** crashed Chrome with the default context (out of GPU memory); with a smaller context it loaded, but the GPU driver reset or froze the screen while answering.
- **Gemma 3 1B** degenerated into garbage on real prompts: WebLLM cannot run its sliding-window attention (its config pairs an 8192 context with a 512 window).

So the app now runs **llama.cpp on the CPU** via wllama: it supports Gemma 3 properly, and no GPU driver is involved. A service worker adds the cross-origin isolation headers (which GitHub Pages cannot set), so llama.cpp can use 4 CPU threads. [tests/ask-test.html](tests/ask-test.html) runs the app's prompt through the model and times it.

## Why it runs on the phone

- **No signal in the woods.** A cloud API is useless where porcini grow.
- **Secret spots stay secret.** No forager wants to send the exact coordinates of their spots to someone else's server. Here nothing leaves the phone: the only network calls are the weather download (coordinates rounded, no account) and the one-time model download.
- **No cost, no account, no API key.**

## Safety

The app does **not** identify mushrooms and never says whether one is edible. Small models make mistakes, and with mushrooms like *Amanita phalloides* a mistake can kill. Before eating any wild mushroom, have it checked by a mycological inspection service; in Italy the ASL *Ispettorato Micologico* does it for free. If a question is about edibility, the app shows a fixed warning itself, without relying on the model.

## The radar heuristic

The score (0-100) is:

- the **rain** of 7-21 days before, weighted most between 10 and 14 days;
- multiplied by how suitable the **soil temperature** at 6 cm is (ideal 11-18 °C; the air temperature of the week when soil data is missing);
- multiplied by the **soil moisture** of the last 3 days (rain two weeks ago is useless if the soil has dried out since);
- minus **penalties** for nights below 3 °C and for dry, warm weeks.

Open-Meteo's soil data covers about the next 7 days; beyond that the air temperature is used and moisture counts as unknown.

These are foragers' rules of thumb, not a validated model: the diary is there to check them against what you actually find. The logic is in [radar.js](radar.js).

## Run it

It is a static site with no build step:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. On a phone it needs HTTPS (for GPS, the service worker and installing), e.g. GitHub Pages. [tests/radar-test.html](tests/radar-test.html) scores real weather data for a sample spot.

## Stack, all open

- [wllama](https://github.com/ngxson/wllama) 3.8.1 (MIT), llama.cpp for the browser, vendored in `vendor/wllama/`
- [Gemma 3 1B instruct](https://ai.google.dev/gemma), Google's open-weight model ([Gemma Terms of Use](https://ai.google.dev/gemma/terms)), [Q4_0 GGUF by Unsloth](https://huggingface.co/unsloth/gemma-3-1b-it-GGUF)
- Weather data by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Plain HTML, CSS and JavaScript, PWA with a service worker
