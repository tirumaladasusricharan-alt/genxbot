-- =============================================================================
-- GenX Bounded Dual-Stream RAG — database schema
-- Runs once, automatically, the first time the Postgres volume is created
-- (mounted into /docker-entrypoint-initdb.d by docker-compose.yml).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. knowledge_vault: the ONLY table that holds embeddings.
--    Only sessions that pass the ingestion firewall (Client Coaching, conf >= 0.80)
--    ever land here.
--    Embedding model: bge-m3 (1024 dimensions).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_vault (
    id           BIGSERIAL PRIMARY KEY,
    session_id   TEXT        NOT NULL,
    stream_type  TEXT        NOT NULL CHECK (stream_type IN ('framework', 'voice_sample')),
    content      TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    embedding    vector(1024) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approximate-nearest-neighbour index using COSINE distance (<=> operator).
-- m / ef_construction are pgvector's documented defaults, stated explicitly.
CREATE INDEX IF NOT EXISTS knowledge_vault_embedding_hnsw
    ON knowledge_vault
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Supporting b-tree indexes for the per-stream filters and per-session re-ingest.
CREATE INDEX IF NOT EXISTS knowledge_vault_stream_type_idx ON knowledge_vault (stream_type);
CREATE INDEX IF NOT EXISTS knowledge_vault_session_id_idx  ON knowledge_vault (session_id);

-- -----------------------------------------------------------------------------
-- 2. archived_sessions: flat relational archive for everything the firewall
--    rejects (Internal Operations, Sales Discovery, Other, low confidence).
--    Deliberately has NO embedding column — rejected calls are never vectorised.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archived_sessions (
    session_id         TEXT PRIMARY KEY,
    title              TEXT,
    session_created_at TIMESTAMPTZ,
    meeting_type       TEXT        NOT NULL,
    confidence_score   NUMERIC(4,3) NOT NULL,
    summary            TEXT,
    reject_reason      TEXT        NOT NULL,
    participants       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    transcript         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    archived_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. ingestion_log: one row per session with the classifier's verdict and the
--    gate decision. Used for the verification log / auditing.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_log (
    session_id         TEXT PRIMARY KEY,
    title              TEXT,
    meeting_type       TEXT        NOT NULL,
    confidence_score   NUMERIC(4,3) NOT NULL,
    summary            TEXT,
    decision           TEXT        NOT NULL CHECK (decision IN ('ingested', 'archived')),
    reason             TEXT,
    framework_chunks   INTEGER     NOT NULL DEFAULT 0,
    voice_chunks       INTEGER     NOT NULL DEFAULT 0,
    processed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
