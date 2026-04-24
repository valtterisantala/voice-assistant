# AGENTS.md

## Project intent
This repository compares two browser-based proof-of-concepts for a customer service voice assistant:
- `apps/realtime`: speech-to-speech, low-latency, conversational feel first
- `apps/tts`: speech-to-text -> text model -> text-to-speech, controllability first

The first milestone is deliberately narrow:
- no use case knowledge base yet
- no client data integrations
- no production auth flows
- no Teams bot implementation
- no mobile app build

The goal of milestone 1 is to let a human tester have an open conversation with both demos and compare:
- conversational feel
- responsiveness
- clarity of spoken answers
- stability in a remote demo context

## Product rules
- Build for desktop browser first.
- Both POCs must be presentable over Microsoft Teams screen share.
- Keep the visual shell as similar as possible between the two apps.
- Use the same base support persona/prompt in both apps.
- Keep spoken responses short and speech-friendly.
- Show transcript and connection/status information in the UI.
- Avoid fake enterprise features in milestone 1.
- Prefer simplicity over abstraction.

## Shared assistant baseline
Use this as the starting behavior in both POCs:

"You are a Neste customer service specialist, specialising in Neste mobile app scenarios. Keep answers concise, calm, and practical. If the user is unclear, ask one short clarifying question. Do not invent company policy or app features."

## Engineering rules
- Keep this as a light monorepo.
- Reuse shared utilities only when duplication becomes annoying.
- Do not introduce a database in milestone 1.
- Use environment variables for API keys and model IDs.
- Keep implementation notes in markdown under `docs/`.
- When in doubt, choose the option that improves demo reliability.

## Expected repo shape
- `apps/realtime`
- `apps/tts`
- `packages/shared`
- `docs`

## Milestone 1 deliverables
1. Realtime POC runnable locally in browser.
2. TTS-chain POC runnable locally in browser.
3. Similar UI shell for both.
4. Basic transcript view and latency/status cues.
5. Simple README notes for how to run each app.
