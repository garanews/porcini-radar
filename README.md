# 🍄 Porcini Radar

Quando e dove andare a porcini, con un'AI open-source che sta nel telefono e funziona anche senza campo.

Progetto per la [Hacktoberfest Open-Source AI Challenge – Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05) di DEV.

## Cosa fa

- **Radar**: stima la "buttata" dei porcini nei tuoi posti per i prossimi 16 giorni, partendo da pioggia e temperature ([Open-Meteo](https://open-meteo.com/)). I posti si salvano con il GPS quando sei nel bosco.
- **Diario**: registri le uscite con foto, posizione GPS, tipo di bosco e quanti porcini hai trovato. Tutto resta sul telefono (IndexedDB) e funziona offline.
- **Chiedi**: un LLM open-weight (Google Gemma 2 2B o Gemma 3 1B, tramite [WebLLM](https://github.com/mlc-ai/web-llm)) gira **dentro il browser del telefono** con WebGPU. Legge le previsioni e il diario e dà consigli anche senza connessione.

## Sicurezza

L'app **non** identifica i funghi e non dice mai se sono commestibili. Prima di mangiarli falli controllare all'Ispettorato Micologico della tua ASL: il servizio è gratuito.

## L'euristica del radar

Il punteggio va da 0 a 100 ed è dato da:

- **pioggia** caduta 7–21 giorni prima, con peso massimo tra 10 e 14 giorni;
- moltiplicata per la **temperatura** media della settimana (ideale 11–18 °C);
- meno le **penalità** per notti sotto i 3 °C e per settimane secche e calde.

Sono regole empiriche dei cercatori, non un modello validato: il diario serve proprio a confrontarle con quello che trovi davvero. La logica è in [radar.js](radar.js).

## Come provarla

È un sito statico senza build. In locale:

```sh
python -m http.server 8000
```

Poi apri http://localhost:8000. Sul telefono serve HTTPS, quindi pubblicala per esempio con GitHub Pages. Requisiti: Chrome su Android 12 o superiore con WebGPU.

## Stack, tutto open

- [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0), incluso in `vendor/`
- [Gemma](https://ai.google.dev/gemma), modello open-weight di Google ([Gemma Terms of Use](https://ai.google.dev/gemma/terms)), quantizzato a 4 bit da MLC
- Dati meteo [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- HTML, CSS e JavaScript senza framework, PWA con service worker
