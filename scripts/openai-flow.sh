#!/usr/bin/env bash
# Exercise the OpenAI Responses API calls that replace the Assistants API in the
# Bubble "Response API" connector. Each step is the same HTTP request Bubble will make,
# so this doubles as a smoke test and as the source of sample responses for
# "Initialize call" in the API Connector.
#
# Usage:
#   scripts/openai-flow.sh tutor  "What is the max dose of bupivacaine?"
#   scripts/openai-flow.sh qbank  "Please generate 2 questions on nitrous oxide cylinders"
#   scripts/openai-flow.sh call <create_conversation|create_response|retrieve_response> [args]
#
# Reads OPENAI_API_KEY from .env. Set FLOW_MODEL to override the model.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
: "${OPENAI_API_KEY:?OPENAI_API_KEY missing from .env}"

API=https://api.openai.com/v1
MODEL="${FLOW_MODEL:-gpt-4.1}"
VS_TUTOR=vs_e4vD9Nz8oAgfdVWtS2GLD3g9   # "Vector store for AI Anesthesia"
VS_QBANK=vs_nXTweemTbMdrEl10x3pgirdh   # "Vector store for AI Anesthesia Qbank"

req() { # req METHOD PATH [JSON]
  local m="$1" p="$2" body="${3:-}"
  local args=(-sS -m 120 -X "$m" -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}" "$API/$p"
}
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# --- Call 1: Create a Conversation  (replaces Create a Thread) ---
create_conversation() { req POST conversations '{}'; }

# --- Call 2: Create a Response (replaces Add Message + Create a Run) ---
# background=true returns immediately with status "queued"; poll with retrieve_response.
create_response() { # create_response CONV_ID INSTRUCTIONS_FILE VECTOR_STORE_ID INPUT_TEXT [json_mode]
  local conv="$1" instr_file="$2" vs="$3" input="$4" json_mode="${5:-}"
  python3 - "$conv" "$instr_file" "$vs" "$input" "$MODEL" "$json_mode" <<'PY' | req POST responses "$(cat)"
import json,sys
conv,instr_file,vs,inp,model,json_mode=sys.argv[1:7]
body={"model":model,"background":True,"store":True,
      "conversation":conv,
      "instructions":open(instr_file).read(),
      "input":inp,
      "tools":[{"type":"file_search","vector_store_ids":[vs]}]}
if json_mode: body["text"]={"format":json.load(open(json_mode))}
print(json.dumps(body))
PY
}

# --- Call 3: Retrieve a Response (replaces Retrieve a Run + List Messages) ---
retrieve_response() { req GET "responses/$1"; }

poll() { # poll RESP_ID -> prints final response JSON
  local id="$1" st
  for _ in $(seq 1 60); do
    local r; r="$(retrieve_response "$id")"
    st="$(printf '%s' "$r" | j 'd["status"]')"
    echo "  status=$st" >&2
    case "$st" in queued|in_progress) sleep 3 ;; *) printf '%s\n' "$r"; return ;; esac
  done
  echo "timed out" >&2; return 1
}

cmd="${1:-}"; shift || true
case "$cmd" in
  tutor|qbank)
    if [[ $cmd == tutor ]]; then instr="$ROOT/prompts/tutor.md"; vs=$VS_TUTOR; jm=""; else instr="$ROOT/prompts/qbank.md"; vs=$VS_QBANK; jm="$ROOT/prompts/qbank-schema.json"; fi
    input="${1:?input text}"
    echo "== 1. create conversation" >&2
    conv="$(create_conversation | j 'd["id"]')"; echo "  $conv" >&2
    echo "== 2. create background response" >&2
    resp="$(create_response "$conv" "$instr" "$vs" "$input" "$jm")"
    if printf '%s' "$resp" | j 'd.get("error") or ""' | grep -q .; then echo "$resp" >&2; exit 1; fi
    rid="$(printf '%s' "$resp" | j 'd["id"]')"; echo "  $rid" >&2
    echo "== 3. poll" >&2
    final="$(poll "$rid")"
    printf '%s' "$final" | python3 -c '
import json,sys; d=json.load(sys.stdin)
print("status:",d["status"],"| model:",d["model"],"| usage:",d["usage"]["total_tokens"],"tokens")
text="".join(c["text"] for o in d["output"] if o["type"]=="message" for c in o["content"] if c["type"]=="output_text")
print("output_text:\n"+text)
if "'"$jm"'": json.loads(text); print("\n[valid JSON: %d questions]" % len(json.loads(text)["questions"]))
' ;;
  call) fn="${1:?}"; shift; "$fn" "$@" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
