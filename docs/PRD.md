# PRD — Realtime Architecture-First Voice Assistant POC

## Objective
Build the first meaningful browser-based proof-of-concept for a Neste-style customer service voice assistant.

This phase is **not** about broad business correctness yet.
This phase is about proving the architecture and getting to a working voice chat as quickly as possible.

## Current scope
Build only the Realtime path first under `apps/realtime`.

The TTS path is deferred until the Realtime architecture has been validated.

## Core architecture
The POC should prove this turn flow:

1. user speaks
2. transcript goes to backend
3. backend classifies the turn and resolves what is allowed to be said
4. backend returns a strict decision object
5. Realtime speaks the approved Finnish text naturally without adding facts

## Decision contract
The backend decision object must contain:
- `mode` = `answer` | `clarify` | `escalate`
- `approved_text_fi`
- `case_id`
- `confidence`

This object is the hard logic boundary.
Realtime is the conversational layer only.

## Demo logic for v0
There is no KB yet.
There is no retrieval yet.

Instead, the backend uses a tiny hard-coded demo layer with 5 Finnish reply templates in a generic gas station mobile app context.

Suggested template areas:
- general help
- finding a station or service
- payment or card problem
- receipt or transaction problem
- technical / update / login problem

## Users
Internal team first.
Secondarily a client audience in a Teams demo.

## Primary questions to answer
1. Does the architecture work end to end?
2. Does Realtime still feel natural when it is tightly constrained by backend logic?
3. Is the interaction credible enough for a live client demo?
4. What should be the next layer after this: simulated case pack or real KB?

## Functional requirements
The Realtime POC must:
- run locally in desktop browser
- connect and disconnect cleanly
- accept spoken user input
- show user transcript
- send transcript to backend
- receive a decision object from backend
- speak `approved_text_fi` aloud in Finnish
- show assistant transcript
- show current status/state
- support repeated turns in a single session

## UX requirements
- clean, minimal UI
- obvious microphone / speaking / idle states
- transcript visible at all times
- tiny debug/status panel for `mode`, `case_id`, and `confidence`
- avoid clutter

## Non-goals
- no broad support knowledge base yet
- no retrieval
- no MCP
- no Teams bot
- no client-system integrations
- no call center features
- no escalation workflows beyond a simple demo mode
- no production auth beyond local env setup

## Deliverables
- monorepo scaffold
- backend turn resolver stub
- five hard-coded Finnish demo reply templates
- realtime POC app
- run instructions
- short comparison notes after manual testing

## Expected next step after v0
Once the architecture works, replace the hard-coded demo layer with a semi-simulated case pack based on screenshots and validated client pain points.
