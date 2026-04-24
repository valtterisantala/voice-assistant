# Voice Assistant

Monorepo for two browser-based proof-of-concepts for a Neste-style customer service voice assistant:

- `apps/realtime` — low-latency speech-to-speech POC
- `apps/tts` — controlled speech-to-text -> text model -> text-to-speech POC

The first milestone is a feeling probe only: no knowledge base, no case cards, no production integrations. The goal is to compare UX, responsiveness, and demo viability for a Teams-based client presentation.

## Realtime resolver

The Realtime POC has a small local backend resolver stub under `apps/realtime/backend`.

Install the Realtime app dependencies:

```sh
cd apps/realtime
npm install
```

Run the endpoint:

```sh
npm run realtime:backend
```

Run the browser client:

```sh
npm run realtime:dev
```

Use normal desktop Chrome for the full voice path. The Codex in-app browser can inspect the UI, but microphone validation should happen in Chrome.

Run bundled sample turns:

```sh
npm run realtime:resolver:samples
```

See `apps/realtime/README.md` for the endpoint contract and curl example.
