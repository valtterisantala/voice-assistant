# Architecture

## Chosen direction
Use a light monorepo with two browser-first apps and one shared package.

- `apps/realtime` = speech-to-speech POC
- `apps/tts` = speech-to-text -> text model -> text-to-speech POC
- `packages/shared` = shared prompt text, UI primitives later, helpers later

## Why this architecture
- One repo keeps prompts, UI shell, and comparison criteria aligned.
- Browser apps are easiest to present over Teams.
- We avoid premature platform lock-in.
- The first milestone is a feeling probe, not a production system.

## Teams demo posture
This repository is optimized for a Teams-friendly sales demo:
- run in desktop browser
- screen-share one app window in Teams
- keep transcript visible on screen
- support a simple local demo flow before any deeper Teams integration

## App A: Realtime
Target shape:
- browser client
- microphone capture in browser
- OpenAI Realtime connection from browser
- short spoken replies
- transcript/status panel in UI

Keep the first pass narrow:
- one connect button
- one disconnect button
- live transcript area
- current connection state
- no external knowledge base yet

## App B: TTS chain
Target shape:
- browser client records user audio
- transcription step
- text model response step
- speech synthesis step
- transcript/status panel in UI

Keep the first pass narrow:
- one talk/submit flow
- visible transcript for user and assistant
- assistant response spoken aloud
- no external knowledge base yet

## Shared behavior
Both apps should:
- use the same base support persona
- keep answers concise and practical
- expose transcript and basic timing/status cues
- avoid pretending to know company policy not provided by prompt

## Not in milestone 1
- no Teams bot
- no mobile app
- no account system
- no analytics backend
- no retrieval or vector database
- no customer-specific logic
- no human handoff flow yet
- no ticket creation flow yet

## Deferred roadmap after milestone 1
Later layers may add:
- deeper Teams-native participation through a Teams bot integration
- backend-controlled handoff to a human specialist when a defined discussion rule or endpoint is reached
- backend-controlled creation of Jira tickets, or tickets in a Jira-like agentic ticketing system, as part of escalation workflows

## Future control rule
Handoff and ticket creation must be backend-authorized actions. Realtime should never decide these actions on its own.
