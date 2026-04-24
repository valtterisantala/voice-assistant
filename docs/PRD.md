# PRD — Voice Assistant Feeling Probe

## Objective
Create two very small browser-based proof-of-concepts for a Neste-style customer service voice assistant and compare them side by side.

The comparison is not about business correctness yet. It is about feel, responsiveness, clarity, and demo viability.

## Scope
Build two separate apps:

1. `apps/realtime`
   - speech-to-speech
   - optimized for natural conversational feel

2. `apps/tts`
   - speech-to-text -> text model -> text-to-speech
   - optimized for control and predictability

## Shared baseline
Both POCs must use the same initial assistant baseline:

"You are a Neste customer service specialist, specialising in Neste mobile app scenarios. Keep answers concise, calm, and practical. If the user is unclear, ask one short clarifying question. Do not invent company policy or app features."

## Users
Internal team first.
Secondarily a client audience in a Teams demo.

## Primary questions to answer
1. Which interaction style feels better in live use?
2. Which one is more stable for a remote demo?
3. Is the extra naturalness of Realtime worth the lower controllability?
4. Does the TTS chain feel too stiff or still good enough?

## Functional requirements
Both POCs must:
- run locally in desktop browser
- accept spoken user input
- produce spoken assistant output
- show user transcript
- show assistant transcript
- show current status/state
- support repeated turns in a single session

Realtime POC must:
- connect and disconnect cleanly
- handle low-latency live conversation
- feel responsive enough for a client demo

TTS POC must:
- capture spoken input
- transcribe accurately enough for a demo
- generate a text response
- synthesize that response to speech

## Non-goals
- no production support logic
- no use case knowledge base yet
- no integrations to client systems
- no call center features
- no escalation workflows
- no auth beyond local env setup

## UX requirements
- clean, minimal UI
- similar visual shell in both apps
- obvious microphone / speaking / idle states
- transcript visible at all times
- avoid clutter

## Evaluation criteria
Compare the two POCs on:
- naturalness
- perceived intelligence
- response speed
- answer clarity
- interruption handling
- overall confidence in a Teams demo

## Deliverables
- monorepo scaffold
- realtime POC app
- tts POC app
- shared prompt baseline
- run instructions
- short comparison notes after manual testing
