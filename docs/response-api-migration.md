# OpenAI Assistants → Responses API migration

**Why:** OpenAI shut down the Assistants API on 2026-08-26. Every call in the Bubble
connector `bTNor0` (Create Thread / Add Message / Create Run / Retrieve Run / List
Messages / Assistants) now returns 404. Separately, `mock_exam` requests the retired
model `gpt-4-1106-preview` and the image calls request retired `dall-e-*` models.

**Approach:** new API Connector **"Response API"** with 6 calls. Old connector stays
untouched for reference. No data-type changes: `thread_id_text` stores the
`conv_…` id and `run_id_text` stores the `resp_…` id.

Everything below was verified live with the app's key via `scripts/openai-flow.sh`.

| Old (Assistants) | New (Responses) |
|---|---|
| `asst_…` object with instructions + file_search | `instructions` text + `tools:[file_search]` sent on every response (prompts in `prompts/`) |
| Create a Thread → `thread_…` | **Create a Conversation** → `conv_…` |
| Add Message + Create a Run → `run_…` | **Create a Response** (`background: true`) → `resp_…` |
| Retrieve a Run → `status` | **Retrieve a Response** → `status` |
| List Messages → first message text | **List Conversation Items** (`order=desc&limit=1`) → `data[0].id`, then **Get Conversation Item** → `content[0].text` (see §2a) |

Run status values: `queued` → `in_progress` → `completed` | `failed` | `incomplete` | `cancelled`.
(Assistants used `queued`/`in_progress`/`completed`/`failed`/`expired`/`requires_action` — no `requires_action` any more.)

---

## 1. Connector setup: "Response API"

- **Authentication:** Private key in header
  - Key name: `Authorization`
  - Key value: `Bearer sk-…` (same key as the old connector)
- **Shared header:** `Content-Type: application/json`
- No `OpenAI-Beta` header (that was Assistants-only).

Constants used below:

| Name | Value |
|---|---|
| AI Anesthesia vector store (Assistant + Calculator) | `vs_e4vD9Nz8oAgfdVWtS2GLD3g9` ("Vector store for AI Anesthesia", 19 files) |
| Qbank vector store | `vs_nXTweemTbMdrEl10x3pgirdh` ("Vector store for AI Anesthesia Qbank", 22 files) |
| Model | `gpt-4.1` for Assistant/Calculator; **`gpt-4.1-mini` for Qbank** (2026-09-21, ~10 s faster on the 5-question prompt; `gpt-5-mini` measured 84 s — reasoning models are too slow here) |

---

## 2. Calls

### Call 1 — `Create a Conversation`
- Use as: **Action** · Data type: JSON
- `POST https://api.openai.com/v1/conversations`
- Body: `{}`
- Initialize → returns `id` (`conv_…`). Save to `thread_id_text`.

### Call 2 — `Create a Response (AI Anesthesia)`
- Use as: **Action** · Data type: JSON
- `POST https://api.openai.com/v1/responses`
- Body:
```json
{
  "model": "gpt-4.1",
  "background": true,
  "store": true,
  "conversation": "<conversation_id>",
  "instructions": "<instructions>",
  "input": <input>,
  "tools": [ { "type": "file_search", "vector_store_ids": ["vs_e4vD9Nz8oAgfdVWtS2GLD3g9"] } ]
}
```
- Parameters:
  - `conversation_id` — not private. Workflow passes `Session's thread_id`.
  - `instructions` — **private**. Paste the one-line contents of `prompts/assistant.escaped.txt`
    (it is already JSON-escaped; do not add quotes — the body template has them).
  - `input` — not private. Workflow passes the question `:formatted as JSON-safe`
    (this adds the surrounding quotes, same as the old `Add Message` call's `question`).
- Initialize → returns `id` (`resp_…`), `status` (`queued`). Save `id` to `run_id_text`.

### Call 2b — `Create a Response (Calculator)`
Identical to Call 2 (same vector store) but `instructions` ← `prompts/calculator.escaped.txt`.
Used when `session's analytic_type` is **AI Calculator**; Call 2 when it is **AI Anesthesia**.

### Call 3 — `Create a Response (Qbank)`
Same as Call 2 with the Qbank prompt, Qbank vector store, and a strict JSON schema
so the output always matches the `Objective (AI Qbank_new)` parser:
```json
{
  "model": "gpt-4.1",
  "background": true,
  "store": true,
  "conversation": "<conversation_id>",
  "instructions": "<instructions>",
  "input": <input>,
  "tools": [ { "type": "file_search", "vector_store_ids": ["vs_nXTweemTbMdrEl10x3pgirdh"] } ],
  "text": { "format": {"type":"json_schema","name":"qbank_questions","strict":true,"schema":{"type":"object","additionalProperties":false,"properties":{"questions":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"question":{"type":"string"},"difficulty":{"type":"string","enum":["easy","medium","hard"]},"answer_options":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"option":{"type":"string"},"text":{"type":"string"},"is_correct":{"type":"boolean"},"explanation":{"type":"string"}},"required":["option","text","is_correct","explanation"]}}},"required":["question","difficulty","answer_options"]}}},"required":["questions"]}} }
}
```
- `instructions` (private) ← `prompts/qbank.escaped.txt`.
- Output shape (guaranteed by the schema):
  `{"questions":[{"question","difficulty","answer_options":[{"option","text","is_correct","explanation"}]}]}`
  ⚠️ Check this against the fields your `Objective (AI Qbank_new)` Bubble-API call was
  initialized with (API Connector → Bubble API → that call). If it expects e.g.
  `options` instead of `answer_options`, rename the key in the schema + `prompts/qbank.md`.
  Because the output is now strict JSON with no ```json fences, the fence-stripping
  steps (`:find & replace "```json"`) in *AI Qbank: List Messages* become no-ops — harmless.

### Call 4 — `Retrieve a Response`
- Use as: **Data** (or Action — matches how you used Retrieve a Run) · Data type: JSON
- `GET https://api.openai.com/v1/responses/[response_id]`
- Initialize with a real `resp_…` id (run `scripts/openai-flow.sh assistant "hi"` to get one).
- Fields used: `status`, `error message`, `incomplete_details reason`.

### Call 5 — `List Conversation Items`
- Use as: **Data** · Data type: JSON
- `GET https://api.openai.com/v1/conversations/[conversation_id]/items?order=desc&limit=1`
- Returns the latest item, i.e. the assistant's answer:
  **`body data:first item's content:first item's text`**
  (also `data:first item's role` = `assistant`, `status` = `completed`).

### Call 6 — `Get Conversation Item`
- Use as: **Action** · Data type: JSON · wrap_error on (id `bTShU0`)
- `GET https://api.openai.com/v1/conversations/[conversation_id]/items/[item_id]`
- Returns one item; the text is **`body's content:first item's text`** (one list level).

---

## 2a. Bubble runtime limitation: list-in-list paths resolve empty

**Symptom (2026-09-13):** AI Anesthesia Assistant/Calculator loaded forever, Qbank produced the
same 4 Parkinson's questions whatever the topic, and the user's `loading_stat` stayed `waiting`.

**Root cause:** the expression `body's data:first item's content:first item's text` on the
*List Conversation Items* result is accepted by the editor but evaluates **empty at runtime** —
Bubble's API-connector runtime resolves one list level (`data:first item's id` works) but not a
list nested inside a list item. Consequences:
- *List Messages*: Basic Question created with empty content → *Done Generating* never scheduled
  → `loading_stat` stuck `waiting`, which also blocks the Qbank "Complete Exam" view (its loader
  shows while `loading_stat = waiting`).
- *AI Qbank: List Messages*: the Json Converter `content` param was empty, so Bubble sent the
  connector's **initialization sample** (4 Parkinson's questions, old schema) instead.

Proved with `wf_debug_items` (exposed, token-protected): `nested` (two-level path) returns empty,
`item_text` (via Get Conversation Item) returns the reply.

**Fix (done in both List Messages workflows):** step 1 List Conversation Items → step 2
**Get Conversation Item** (`conversation_id = Session's thread_id`,
`item_id = Result of step 1's body's data:first item's id`) → every consumer reads
`Result of step 2's body's content:first item's text` (Basic Question `content`, both Json
Converter `content` params, Question Bank Session `raw_json {question}`).

**Repair tool:** `wf_debug_items` (`POST /api/1.1/wf/wf_debug_items`, Bearer token) takes
`conversation_id` (optional, debug) and `session_id` (optional): when `session_id` is given it
re-schedules *List Messages* for that Basic Question Session, which re-reads the finished reply
from OpenAI, creates the Basic Question and runs *Done Generating* (resets `loading_stat`).
Used once to unstick session `1789316385802x748702025821454300`.

---

## 3. Workflow changes — DONE on branch `api-migration` (2026-09-13)

All six backend workflows were rewired in the Bubble editor (via Playwright, see
`scripts/bubble-editor-helpers.js`). The old "Assistants API" connector and its calls are
left in place for reference; only the workflows changed. Final shapes:

- **AI Qbank: Create a Thread** — Create a conversation → (Delete/Terminate guards) → set thread_id →
  Create a Response (Qbank) [input = Arbitrary text:formatted as JSON-safe] → set run_id → schedule
  AI Qbank: Retrieve a Run → error email/cleanup.
- **AI Qbank: Retrieve a Run** — Retrieve a Response (response_id = run_id) → reschedule while
  `body's status is not completed` → schedule List Messages when completed → Retrieve a Run Failed /
  Terminate when status is in All ⚙️Run Failed Status.
- **AI Qbank: List Messages** — List Conversation Items → Get Conversation Item → Json Converter
  (1st & 2nd) and `raw_json {question}` get `step 2's body's content:first item's text` → unchanged.
- **AI Anesthesia: Create a Thread** — Create a conversation → set thread_id → Create a Response
  (AI Anesthesia) *only when analytic_type is AI Anesthesia* / Create a Response (Calculator) *only when
  AI Calculator* → run_id = `step A's body's id defaulting to step B's body's id` → schedule Retrieve a Run.
- **Retrieve a Run** — Retrieve a Response; token_update uses `body's usage's total_tokens`.
- **List Messages** — List Conversation Items → Get Conversation Item → Create Basic Question
  (content = `step 2's body's content:first item's text`); Trigger Delete if Failed also fires when
  that content is empty.

Because "Include errors in response" is on for every Response API call, all fields are under
`'s body` (e.g. `'s body's id`, `'s body's status`) and `'s returned_an_error` / `'s error's body`
are available — the same convention the old calls used.

Original migration table (kept for reference):

### `AI Anesthesia: Create a Thread` / `AI Qbank: Create a Thread`
| Step | Old | New |
|---|---|---|
| 0 | Create a Thread | **Create a Conversation** |
| 3 | set `thread_id` = Thread's `id` | set `thread_id` = Conversation's `id` |
| 4 | Add Message | **delete** (input goes into the response) |
| 5 | Create a Run {AI Test}/{AI Qbank} | **Create a Response (AI Anesthesia / Calculator / Qbank)** — `conversation_id` = Session's thread_id, `input` = the same text that went to Add Message. In the AI Anesthesia workflow this becomes **two** conditional steps: *(AI Anesthesia)* only when `session's analytic_type is AI Anesthesia`, *(Calculator)* only when it is `AI Calculator` — replacing the old `assistant_id` ternary. |
| 6 | set `run_id` = Run's `id` | set `run_id` = Response's `id` (AI Anesthesia workflow: two conditional "Make changes" steps, one per response step) |
| 7 | schedule *Retrieve a Run* | unchanged (schedule after 3–5 s) |
| 8 | error email | update the "returned an error" conditions to point at the new steps |

Old assistant → new call: `asst_eaXJ…` (AI Anesthesia) → Call 2, `asst_Atg…` (AI Calculator) → Call 2b,
`asst_w43h…` (Qbank) → Call 3.

### `Retrieve a Run` / `AI Qbank: Retrieve a Run`
| Step | Old | New |
|---|---|---|
| 0 | Retrieve a Run (thread_id, run_id) | **Retrieve a Response** (`response_id` = Session's run_id) |
| 1 | re-schedule self when status is `queued`/`in_progress` | same, on the new call's `status` |
| 2 | schedule *List Messages* when `completed` | same |
| 3 | error handling when `failed`/`expired` | when `failed`/`incomplete`/`cancelled` |

### `List Messages` / `AI Qbank: List Messages`
| Step | Old | New |
|---|---|---|
| 0 | List Messages (thread_id) → `data:first item's content:first item's text value` | **List Conversation Items** → **Get Conversation Item** (`item_id` = step 1's `data:first item's id`) → `content:first item's text` (nested list paths are empty at runtime, §2a) |
| rest | unchanged | unchanged |

---

## 4. Other fixes (old connector, keep in place)

| Call | Change |
|---|---|
| `mock_exam`, `mock_exam (test)` | `"model": "gpt-4-1106-preview"` → `"gpt-4.1"` (keeps `response_format: json_object`) |
| `Create Images` | `"model": "dall-e-3"` → `"gpt-image-1"`; response no longer has `url` — it returns `data[0].b64_json` (base64), so the workflow must save it via `:formatted as …` or switch to a URL-returning approach. Ask before touching this one. |
| `variations` | `dall-e-2` retired and `/images/variations` has no gpt-image equivalent — if unused, leave dead. |

---

## 5. Testing

1. `scripts/openai-flow.sh assistant "…"` / `scripts/openai-flow.sh qbank "…"` — proves the
   calls and prompts outside Bubble.
2. After the connector is set up, initialize each call with the values above.
3. In Bubble, run the exposed `create_thread` API workflow or trigger the Qbank/tutor
   UI on **version-test**, then inspect `question_bank_session` via
   `scripts/bubble get question_bank_session` (requires exposing that type in Settings → API).

---

## 6. Latency tuning (live, 2026-09-21)

Measured on live: Qbank ≈ 60 s click→done (41 s OpenAI generation, 25 s first-poll delay + 10 s
poll interval, ~10 s creating questions); Assistant ≈ 14 s, but the "Done" toast could appear
before the reply record reached the browser (Bubble pushes server-created things with a small lag).

Changes made on Main:
- *AI Qbank: Create a Thread* → first *Retrieve a Run* at `+8 s` (was 25 s).
- *AI Qbank: Retrieve a Run* → re-poll every `4 s` (was 10 s). Assistant already used 3 s / 4 s.
- *List Messages* → *Done Generating* scheduled at `Current date/time + 3 s` so the Basic Question
  is visible before `loading_stat` flips to `done`.
- *Create a Response (Qbank)* body `model` → `gpt-4.1-mini` (re-initialized).
