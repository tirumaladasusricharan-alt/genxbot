#!/usr/bin/env bash
# End-to-end verification. Run from the repo root after `docker compose up -d`:
#   bash scripts/verify.sh
# 1) runs Workflow A (ingestion) headless, 2) prints the database state,
# 3) sends four test messages to Workflow B, 4) writes docs/verification_log.md
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=docs/verification_log.md
WEBHOOK=${WEBHOOK:-http://localhost:5678/webhook/coach}
psql() { docker compose exec -T postgres psql -U genx -d genx_rag -P pager=off "$@"; }

# Block until the one-shot publisher has confirmed Workflow B's webhook is live.
echo "Waiting for n8n-publish (Workflow B webhook)..." >&2
docker compose wait n8n-publish >/dev/null

{
  echo "# Verification Log"
  echo
  echo "Generated $(date -u '+%Y-%m-%d %H:%M UTC') by \`scripts/verify.sh\`."
  echo
  echo "## 1. Workflow A: ingestion run"
  echo '```text'
  # separate task-runner port: the running n8n already owns 5679
  if docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=IngestFirewall01 --rawOutput >/tmp/ingest_run.json 2>&1; then
    echo "Workflow A executed successfully (n8n execute --id=IngestFirewall01)"
  else
    echo "Workflow A FAILED:"; tail -n 20 /tmp/ingest_run.json
  fi
  echo '```'
  echo
  echo "## 2. Gate decisions (ingestion_log)"
  echo '```text'
  psql -c "SELECT session_id, meeting_type, confidence_score, decision, COALESCE(reason,'-') AS reason, framework_chunks, voice_chunks FROM ingestion_log ORDER BY session_id;"
  echo '```'
  echo
  echo "## 3. knowledge_vault contents (only SES-101 and SES-102 may appear)"
  echo '```text'
  psql -c "SELECT session_id, stream_type, count(DISTINCT metadata->>'chunk_key') AS chunks, count(*) AS index_vectors, min(length(content)) AS min_chars, max(length(content)) AS max_chars, max(vector_dims(embedding)) AS dims FROM knowledge_vault GROUP BY 1,2 ORDER BY 1,2;"
  echo '```'
  echo
  echo "Sample voice_sample chunk (verbatim coach dialogue):"
  echo '```text'
  psql -At -c "SELECT content FROM knowledge_vault WHERE stream_type='voice_sample' AND metadata->>'index_kind'='passage' ORDER BY session_id, id LIMIT 1;"
  echo '```'
  echo
  echo "## 4. archived_sessions (rejected, no embeddings)"
  echo '```text'
  psql -c "SELECT session_id, title, meeting_type, confidence_score, reject_reason FROM archived_sessions ORDER BY session_id;"
  echo '```'
  echo
  echo "## 5. Workflow B: chat tests"
  for q in "Hello" \
           "How should I approach an underperforming VP?" \
           "I keep reviewing every deck my directors send to clients. How do I step back?" \
           "How do I fix my database index?"; do
    echo
    echo "### Q: $q"
    echo '```json'
    curl -s -X POST "$WEBHOOK" -H 'Content-Type: application/json' \
      -d "{\"question\": \"$q\"}" | (command -v jq >/dev/null && jq . || cat)
    echo
    echo '```'
  done
} | tee "$LOG"

echo
echo "Saved to $LOG"
