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

The Realtime session uses the dashboard prompt from the environment:

```sh
OPENAI_REALTIME_PROMPT_ID=pmpt_69eafbd8d1d881938d6169b79a9cb4a90cee44e456b6540a
OPENAI_REALTIME_PROMPT_VERSION=2
```

`OPENAI_REALTIME_PROMPT_VARIABLES` can be set to a JSON object if the prompt later uses variables. The backend still adds guard instructions so the model only speaks backend-approved resolver text.

Optional Realtime voice activity settings:

```sh
OPENAI_REALTIME_VAD_THRESHOLD=0.5
OPENAI_REALTIME_VAD_PREFIX_PADDING_MS=500
OPENAI_REALTIME_VAD_SILENCE_DURATION_MS=1200
```

The browser also waits briefly after a finalized transcript before sending it to the resolver. If the user starts speaking again during that grace window, the app keeps listening and joins the transcript pieces into one user turn.

## Behavior policy
The runtime resolver is driven by a generated behavior policy:

- Source spec: `docs/behavior-spec.md`
- Strict schema: `apps/realtime/backend/policy-schema.js`
- Generated artifact: `apps/realtime/backend/generated/behavior-policy.json`

Compile the policy after editing the spec:

```sh
npm run realtime:policy:compile
```

The compiler uses the OpenAI Responses API with Structured Outputs. It is an explicit build-time step, not a per-turn runtime call.

At runtime the resolver keeps lightweight in-memory session state keyed by `session_id`. It returns one step at a time, waits for confirmation, and handles short follow-ups like "joo", "ei", "en löydä", and "mitä tarkoitat". Restarting the backend clears this state.

Run the backend resolver and Realtime session proxy from the repository root:

```sh
npm run realtime:backend
```

Run the browser app in a second terminal:

```sh
npm run realtime:dev
```

Open the Vite URL in normal desktop Chrome. The Codex in-app browser is useful for checking layout and debug panels, but it is not the primary validation environment for the microphone path.

Flow:
1. Click Connect.
2. Allow microphone access in Chrome.
3. Click Listen and speak a short Finnish app-support request.
4. Mic audio is streamed to OpenAI Realtime over WebRTC.
5. The finalized Realtime transcript is sent to `/resolve-turn`.
6. The approved Finnish resolver text is sent back to Realtime.
7. Realtime generates and plays the assistant audio in the browser.
8. The debug panel shows `mode`, `case_id`, and `confidence`.

The text input is a debug convenience for local resolver testing. It is not the main voice path.

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
