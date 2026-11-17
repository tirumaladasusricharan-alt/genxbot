// Node: "Build Vault Upsert SQL"   (Code · Run Once for All Items)
// -----------------------------------------------------------------------------
// Joins every chunk with its bge-m3 embedding and writes ONE transactional SQL
// statement per session: delete old rows -> insert fresh rows -> log decision.
// Re-running ingestion therefore always converges to the same table contents.
// -----------------------------------------------------------------------------
const EMBEDDING_DIM = 1024;

const toBase64 = (str) => (typeof Buffer !== 'undefined'
  ? Buffer.from(str, 'utf8').toString('base64')
  : btoa(unescape(encodeURIComponent(str))));
const text = (value) => `convert_from(decode('${toBase64(String(value ?? ''))}', 'base64'), 'UTF8')`;
const jsonb = (value) => `${text(JSON.stringify(value ?? {}))}::jsonb`;

function vectorLiteral(embedding, label) {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`${label}: expected a ${EMBEDDING_DIM}-dim embedding, got ${Array.isArray(embedding) ? embedding.length : typeof embedding}`);
  }
  if (!embedding.every((n) => Number.isFinite(n))) throw new Error(`${label}: embedding contains non-numeric values`);
  return `'[${embedding.join(',')}]'::vector(${EMBEDDING_DIM})`;
}

// Group chunks by session, preserving order.
const sessions = new Map();
$input.all().forEach((item, index) => {
  const chunk = $('Dual-Stream Parser').itemMatching(index).json;
  const label = `${chunk.chunk_key ?? `${chunk.session_id}/${chunk.stream_type}#${chunk.chunk_index}`} [${chunk.index_kind ?? 'passage'}]`;
  if (item.json.error) throw new Error(`${label}: embedding request failed: ${JSON.stringify(item.json.error)}`);
  const embedding = item.json.embeddings?.[0] ?? item.json.embedding;
  const row = { ...chunk, vector: vectorLiteral(embedding, label), inputIndex: index };
  if (!sessions.has(chunk.session_id)) sessions.set(chunk.session_id, []);
  sessions.get(chunk.session_id).push(row);
});

return [...sessions.entries()].map(([sessionId, rows]) => {
  const first = rows[0];
  const sid = text(sessionId);
  // Count distinct chunks (a chunk has several index vectors).
  const distinctChunks = (stream) => new Set(rows.filter((r) => r.stream_type === stream).map((r) => r.chunk_key)).size;
  const frameworkCount = distinctChunks('framework');
  const voiceCount = distinctChunks('voice_sample');

  const values = rows
    .map((r) => `  (${sid}, '${r.stream_type}', ${text(r.content)}, ${jsonb({ ...r.metadata, chunk_index: r.chunk_index })}, ${r.vector})`)
    .join(',\n');

  const sql = `
DELETE FROM knowledge_vault WHERE session_id = ${sid};

INSERT INTO knowledge_vault (session_id, stream_type, content, metadata, embedding) VALUES
${values};

DELETE FROM archived_sessions WHERE session_id = ${sid};

INSERT INTO ingestion_log
  (session_id, title, meeting_type, confidence_score, summary, decision, reason, framework_chunks, voice_chunks, processed_at)
VALUES
  (${sid}, ${text(first.title)}, ${text(first.meeting_type)}, ${Number(first.confidence_score) || 0}, ${text(first.summary)},
   'ingested', NULL, ${frameworkCount}, ${voiceCount}, now())
ON CONFLICT (session_id) DO UPDATE SET
  title = EXCLUDED.title, meeting_type = EXCLUDED.meeting_type, confidence_score = EXCLUDED.confidence_score,
  summary = EXCLUDED.summary, decision = EXCLUDED.decision, reason = NULL,
  framework_chunks = EXCLUDED.framework_chunks, voice_chunks = EXCLUDED.voice_chunks, processed_at = now();

SELECT ${sid} AS session_id, 'ingested' AS decision, ${frameworkCount} AS framework_chunks, ${voiceCount} AS voice_chunks, ${rows.length} AS index_vectors;
`;

  return {
    json: { session_id: sessionId, framework_chunks: frameworkCount, voice_chunks: voiceCount, index_vectors: rows.length, sql },
    pairedItem: rows.map((r) => ({ item: r.inputIndex })),
  };
});
