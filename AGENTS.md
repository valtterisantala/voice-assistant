# AGENTS.md

## Project intent
This repository explores a customer service voice assistant for Neste-style mobile app scenarios.

The repo keeps room for two delivery modes:
- `apps/realtime`: speech-to-speech, low-latency, conversational feel first
- `apps/tts`: speech-to-text -> text model -> text-to-speech, controllability first

## Current priority
Current execution focus is **Realtime architecture first**.

That means:
- build a working browser-based Realtime POC first
- do **not** build a knowledge base yet
- do **not** add retrieval yet
- do **not** add MCP yet
- do **not** build the TTS comparison path yet

The immediate goal is to prove this architecture:
1. user speaks
2. transcript goes to backend
3. backend returns a strict decision object
4. Realtime verbalizes the approved Finnish text naturally

## Decision contract for v0
The backend must return a small structured object with these fields:
- `mode` = `answer` | `clarify` | `escalate`
- `approved_text_fi`
- `case_id`
- `confidence`

Realtime must treat `approved_text_fi` as the authoritative content to speak.
Realtime must **not** add facts beyond that approved content in v0.

## Demo-domain constraint for v0
Use a tiny hard-coded demo layer only.

Start with 5 Finnish reply templates in a generic gas station mobile app context, for example:
- general app help
- station or service finding
- payment or card issue
- receipt or transaction issue
- technical problem / update / login issue

These are placeholders only. They will later be replaced by case cards and then by a broader KB.

## Frontend stack rule
Use **Vite + React + TypeScript + shadcn/ui** for the browser UI.

The preferred shadcn initialization command is:

`npx shadcn@latest init --preset b1YmqvjQ8 --template vite`

Treat that preset as the starting point for the UI shell whenever bootstrapping the frontend.
Do not replace it with a different starter unless there is a concrete technical reason.

## Product rules
- Build for desktop browser first.
- The POC must be presentable over Microsoft Teams screen share.
- Keep the UI minimal and credible.
- Show transcript and connection/status information in the UI.
- Include a tiny debug view for the returned decision object.
- Avoid fake enterprise features in this milestone.
- Prefer simplicity over abstraction.

## Shared assistant baseline
Use this as the starting behavior in the Realtime layer:

"You are a Neste customer service specialist, specialising in Neste mobile app scenarios. Speak in concise, calm, natural Finnish. Only verbalize the approved backend response. Do not invent company policy, app features, or extra steps. If the backend mode is clarify, ask only the approved clarifying question."

## Engineering rules
- Keep this as a light monorepo.
- Reuse shared utilities only when duplication becomes annoying.
- Do not introduce a database in this milestone.
- Use environment variables for API keys and model IDs.
- Keep implementation notes in markdown under `docs/`.
- When in doubt, choose the option that improves demo reliability.

## Expected repo shape
- `apps/realtime`
- `apps/tts`
- `packages/shared`
- `docs`

## Current milestone deliverables
1. Backend turn resolver stub that returns the decision contract.
2. Five hard-coded Finnish demo reply templates.
3. Realtime POC runnable locally in browser.
4. Transcript view and basic status cues.
5. Simple README notes for how to run the Realtime POC.

## Deferred for later
- TTS-chain comparison POC
- simulated KB
- real KB / retrieval
- client integrations
- Teams bot implementation
