// Node: "Build Gated SQL"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Builds the raw pgvector query. Each stream has its OWN hard similarity floor:
//   framework     1 - (embedding <=> q) >= 0.70   LIMIT 2
//   voice_sample  1 - (embedding <=> q) >= 0.65   LIMIT 2
// A chunk is stored with several index vectors (its passage + the leader
// questions it answers), so each stream keeps only the best-scoring vector per
// chunk_key before applying LIMIT 2. Only numbers (the query vector) are
// interpolated, so the user's text can never reach the SQL string.
// -----------------------------------------------------------------------------
const EMBEDDING_DIM = 1024;
const FRAMEWORK_MIN_SIMILARITY = 0.70;
const VOICE_MIN_SIMILARITY = 0.65;
const PER_STREAM_LIMIT = 2;

if ($json.error) throw new Error(`Query embedding failed: ${JSON.stringify($json.error)}`);
const embedding = $json.embeddings?.[0] ?? $json.embedding;
if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM || !embedding.every(Number.isFinite)) {
  throw new Error(`Expected a ${EMBEDDING_DIM}-dim query embedding from bge-m3`);
}

const q = `'[${embedding.join(',')}]'::vector(${EMBEDDING_DIM})`;

const gatedStream = (stream, minSimilarity) => `
  SELECT * FROM (
    SELECT DISTINCT ON (kv.metadata->>'chunk_key')
           kv.id, kv.session_id, kv.stream_type, kv.content, kv.metadata,
           1 - (kv.embedding <=> query.v) AS similarity
    FROM knowledge_vault kv, query
    WHERE kv.stream_type = '${stream}'
      AND 1 - (kv.embedding <=> query.v) >= ${minSimilarity}
    ORDER BY kv.metadata->>'chunk_key', kv.embedding <=> query.v
  ) best_per_chunk
  ORDER BY similarity DESC
  LIMIT ${PER_STREAM_LIMIT}`;

const sql = `
WITH query AS (SELECT ${q} AS v),
frameworks AS (${gatedStream('framework', FRAMEWORK_MIN_SIMILARITY)}
),
voice_samples AS (${gatedStream('voice_sample', VOICE_MIN_SIMILARITY)}
)
SELECT * FROM frameworks
UNION ALL
SELECT * FROM voice_samples
ORDER BY stream_type, similarity DESC;
`;

return { json: { question: $('Normalize & Detect Intent').item.json.question, sql } };
