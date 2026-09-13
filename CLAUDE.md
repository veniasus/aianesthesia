# aianesthesia — Bubble app access

This repo is the working area for the Bubble app **ai-anesthesia-board-prep**
(`https://login.aianesthesia.ai`). It holds tooling for talking to the app's API and
a reference copy of its schema — the app itself lives in the Bubble editor.

## Connecting to the app

- Credentials live in `.env` (gitignored): `BUBBLE_BASE_URL`, `BUBBLE_API_TOKEN`.
  Default target is **dev** (`/version-test`). To hit live, change `BUBBLE_BASE_URL`
  to `https://login.aianesthesia.ai` — and confirm with the user first.
- The API token is an admin key that bypasses privacy rules. Never print it or commit it.
- Use `scripts/bubble` for all API calls (run `scripts/bubble help`). Examples:
  - `scripts/bubble meta` — what data types / workflows are exposed
  - `scripts/bubble get supportthread limit=10`
  - `scripts/bubble get supportthread <id>`
  - `scripts/bubble wf search_email '{"email":"x@y.com"}'`
- **Ask before any write** (`post`/`patch`/`put`/`delete`/`bulk`/`wf`) against app data.
- Only data types ticked under Bubble → Settings → API → "Enable Data API" are reachable.
  If `meta` doesn't list a type you need, the user has to expose it in the editor.

## Schema reference

- `docs/bubble-schema.md` — data types, field ids, option sets, backend workflows.
  Regenerate with `scripts/export-schema.py` after a fresh export.
- `bubble-export/*.bubble` (gitignored) — raw app export. It contains live third-party
  secrets (OpenAI, Stripe) in `settings.secure`; never commit it or print that section.
  Refresh it from the Bubble editor → Settings → General → "Export application".

## OpenAI migration (Assistants API → Responses API)

- Context and the exact Bubble connector spec: `docs/response-api-migration.md`.
- Reconstructed system prompts: `prompts/tutor.md`, `prompts/qbank.md` (+ `.escaped.txt`
  one-liners for pasting into the connector), strict output schema `prompts/qbank-schema.json`.
- `scripts/openai-flow.sh tutor|qbank "<input>"` runs the same HTTP calls Bubble makes,
  end to end, using `OPENAI_API_KEY` from `.env`.
- The old Assistants connector (`bTNor0`) stays in the app for reference; the new one is
  named "Response API".
