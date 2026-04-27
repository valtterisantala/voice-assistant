# Realtime POC Case Content

The Realtime resolver now separates behavior policy from case content.

## Behavior Policy

Generated at build time from `docs/behavior-spec.md`.

Owns:

- tone and turn-taking rules
- max steps per turn
- allowed follow-up types
- escalation keywords
- confirmation requirement after troubleshooting steps

Does not own:

- case IDs
- case keywords
- approved Finnish replies
- retry or clarification text

The backend also exposes the compiled behavior policy through `/realtime-config`, so the browser speech layer can build per-turn Realtime instructions from the same source as the resolver.

## Sparse Drafts

Human-authored source:

`apps/realtime/backend/case-drafts/*.yaml`

Drafts own the small demo case layer used by the current POC:

- `general_app_help`
- `station_or_service_find`
- `payment_or_card_issue`
- `receipt_or_transaction_issue`
- `technical_update_or_login_issue`

Each draft is intentionally sparse. Authors provide:

- case ID
- intent and goal
- trigger words
- allowed facts
- approved short fact answers
- high-level retry and clarification guidance
- step action and confirmation phrasing

Draft format:

```yaml
case_id: payment_or_card_issue
intent: Help the user check payment method or card selection.
goal: Guide the user to payment methods and active card selection.
triggers:
  - maksu
facts:
  - The demo app has payment methods.
approved_facts:
  - fact_id: active_card
    triggers: aktiivinen kortti, valittu kortti, mikä kortti
    answer_fi: Aktiivinen kortti on se kortti, jota sovellus käyttää maksussa. Näkyykö valittu-merkintä?
retry_guidance: Point the user toward profile and payment methods.
clarify_guidance: Explain what payment methods and active card mean.
escalate_when: The user reports duplicate charge, refund, or money dispute.
steps:
  - step_id: payment_open_methods
    action: Avaa ensin sovelluksen maksutavat.
    confirmation: Näetkö siellä korttisi?
    retry_hint: Okei. Avaa oma profiili ja etsi kohta Maksutavat. Löytyikö se?
    clarify_hint: Maksutavoissa näkyy kortti, jolla sovellus maksaa ostot. Näetkö sen listan?
```

## Generated Dialogue

Build-time generated source:

`apps/realtime/backend/generated/case-dialogue.json`

Generate it with:

```sh
npm run realtime:cases:compile
```

The resolver consumes this generated JSON at runtime. It does not parse YAML at runtime.

## Coverage Model

The resolver handles four deterministic coverage tiers:

- `covered_followup`: the user continues the active step with yes, no, unclear, or cannot-find style language.
- `approved_fact`: the user asks a short question that matches authored `approved_facts` in the current or newly matched case.
- `case_switch`: the user clearly changes from the active case to another known case.
- `out_of_coverage`: the user asks for something outside the current demo scope.

Out-of-coverage replies must name the demo boundary instead of inventing support knowledge.
The returned decision includes `coverage_tier` and `match_reason` so the branch is visible in the UI debug panel.

Authoring workflow:

1. Edit YAML drafts.
2. Compile behavior policy if `docs/behavior-spec.md` changed.
3. Compile case dialogue with `npm run realtime:cases:compile`.
4. Inspect the generated JSON diff.
5. Run resolver samples.

This is still intentionally tiny and deterministic. It is not a knowledge base, retrieval layer, MCP integration, or ticketing integration.
