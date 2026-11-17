// Node: "Build Archive SQL"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Rejected sessions go to a flat relational table. No embeddings are created.
// Text is passed to Postgres as base64 and decoded server-side, so quotes,
// backslashes and "$" in transcripts can never break or inject into the SQL.
// Re-running the workflow is idempotent (upserts + cleanup of stale vault rows).
// -----------------------------------------------------------------------------
const toBase64 = (str) => (typeof Buffer !== 'undefined'
  ? Buffer.from(str, 'utf8').toString('base64')
  : btoa(unescape(encodeURIComponent(str))));
const text = (value) => `convert_from(decode('${toBase64(String(value ?? ''))}', 'base64'), 'UTF8')`;
const jsonb = (value) => `${text(JSON.stringify(value ?? null))}::jsonb`;
const tsOrNull = (value) => (value ? `${text(value)}::timestamptz` : 'NULL');
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const s = $json;
const sid = text(s.session_id);

const sql = `
INSERT INTO archived_sessions
  (session_id, title, session_created_at, meeting_type, confidence_score, summary, reject_reason, participants, transcript, archived_at)
VALUES
  (${sid}, ${text(s.title)}, ${tsOrNull(s.session_created_at)}, ${text(s.meeting_type)}, ${num(s.confidence_score)},
   ${text(s.summary)}, ${text(s.reject_reason)}, ${jsonb(s.participants)}, ${jsonb(s.transcript)}, now())
ON CONFLICT (session_id) DO UPDATE SET
  title = EXCLUDED.title, session_created_at = EXCLUDED.session_created_at,
  meeting_type = EXCLUDED.meeting_type, confidence_score = EXCLUDED.confidence_score,
  summary = EXCLUDED.summary, reject_reason = EXCLUDED.reject_reason,
  participants = EXCLUDED.participants, transcript = EXCLUDED.transcript, archived_at = now();

DELETE FROM knowledge_vault WHERE session_id = ${sid};

INSERT INTO ingestion_log
  (session_id, title, meeting_type, confidence_score, summary, decision, reason, framework_chunks, voice_chunks, processed_at)
VALUES
  (${sid}, ${text(s.title)}, ${text(s.meeting_type)}, ${num(s.confidence_score)}, ${text(s.summary)}, 'archived', ${text(s.reject_reason)}, 0, 0, now())
ON CONFLICT (session_id) DO UPDATE SET
  title = EXCLUDED.title, meeting_type = EXCLUDED.meeting_type, confidence_score = EXCLUDED.confidence_score,
  summary = EXCLUDED.summary, decision = EXCLUDED.decision, reason = EXCLUDED.reason,
  framework_chunks = 0, voice_chunks = 0, processed_at = now();

SELECT ${sid} AS session_id, 'archived' AS decision, ${text(s.meeting_type)} AS meeting_type, ${num(s.confidence_score)} AS confidence_score;
`;

return { json: { session_id: s.session_id, meeting_type: s.meeting_type, sql } };
