# Realtime POC

Purpose: test the feel of a browser-based speech-to-speech customer service assistant.

## Milestone 1 target
- open in desktop browser
- connect to Realtime session
- user speaks
- assistant speaks back
- transcript and status visible

## Browser Realtime POC
Install frontend dependencies once:

```sh
cd apps/realtime
npm install
```

Create local environment values:

```sh
cp .env.example .env
```

Set `OPENAI_API_KEY` in `apps/realtime/.env`, or export it in the shell that runs the backend.

Run the backend resolver and Realtime session proxy from the repository root:

```sh
npm run realtime:backend
```

Run the browser app in a second terminal:

```sh
npm run realtime:dev
```

Open the Vite URL in a desktop browser. Chrome is recommended because the POC uses browser speech recognition for local transcript capture.

Flow:
1. Click Connect.
2. Speak a short Finnish app-support request.
3. The browser transcript is sent to `/resolve-turn`.
4. The approved Finnish resolver text is sent to Realtime for speech.
5. The debug panel shows `mode`, `case_id`, and `confidence`.

The text input can be used for local testing when browser speech recognition is unavailable.

## Backend turn resolver
This milestone includes a small local backend stub for the Realtime hard-logic layer.

Run it from the repository root:

```sh
npm run realtime:backend
```

The resolver listens on `http://127.0.0.1:8787`.

Resolve a turn:

```sh
curl -s http://127.0.0.1:8787/resolve-turn \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Mistä löydän aseman, jossa on autonpesu?"}'
```

The response is the strict decision object:

```json
{
  "mode": "answer",
  "approved_text_fi": "Avaa sovelluksen asemahaku ja valitse tarvitsemasi palvelu suodattimista. Sen jälkeen näet sopivat asemat kartalla.",
  "case_id": "station_or_service_find",
  "confidence": 0.84
}
```

Run local sample inputs:

```sh
npm run realtime:resolver:samples
```

The sample set includes answer, clarify, and escalate paths.

## Do not add yet
- knowledge base
- company-specific support logic
- Teams bot integration
- analytics backend
