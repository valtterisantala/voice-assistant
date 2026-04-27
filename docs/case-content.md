# Realtime POC Case Content

The Realtime resolver now separates behavior policy from case content.

## Behavior Policy

Generated at build time from `docs/behavior-spec.md`.

Owns:

- tone and turn-taking rules
- max steps per turn
- allowed follow-up types
- escalation keywords

Does not own:

- case IDs
- case keywords
- approved Finnish replies
- retry or clarification text

## Authored Case Content

Current source:

`apps/realtime/backend/cases/demo-cases.json`

Owns the small demo case layer used by the current POC:

- `general_app_help`
- `station_or_service_find`
- `payment_or_card_issue`
- `receipt_or_transaction_issue`
- `technical_update_or_login_issue`

This is still intentionally tiny and deterministic. It is not a knowledge base, retrieval layer, MCP integration, or ticketing integration.
