// Builds workflows/ingestion_firewall.json and workflows/gated_retrieval.json
// from the readable Code-node sources in n8n-code/.
//   node scripts/build_workflows.mjs
// Output is deterministic: node ids are derived from node names.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (path) => readFileSync(join(ROOT, 'n8n-code', path), 'utf8');

const uuid = (seed) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const PG_CREDENTIAL = { postgres: { id: 'pgLocalGenxRag01', name: 'Local pgvector (genx_rag)' } };
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------- node factories ----------
const node = (wf, name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: uuid(`${wf}:${name}`), name, type, typeVersion, position, ...extra,
});

const codeNode = (wf, name, position, file, mode = 'runOnceForAllItems') =>
  node(wf, name, 'n8n-nodes-base.code', 2, position,
    mode === 'runOnceForEachItem' ? { mode, jsCode: code(file) } : { jsCode: code(file) });

const groqNode = (wf, name, position, bodyField) =>
  node(wf, name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: GROQ_URL,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify($json.${bodyField}) }}`,
    options: { timeout: 60000 },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' });

const embedNode = (wf, name, position, inputExpr, onError) =>
  node(wf, name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: '={{ $env.OLLAMA_BASE_URL }}/api/embed',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ model: $env.EMBEDDING_MODEL || 'bge-m3', input: ${inputExpr} }) }}`,
    options: { timeout: 120000 },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...(onError ? { onError } : {}) });

const pgNode = (wf, name, position, extra = {}) =>
  node(wf, name, 'n8n-nodes-base.postgres', 2.5, position,
    { operation: 'executeQuery', query: '={{ $json.sql }}', options: {} },
    { credentials: PG_CREDENTIAL, ...extra });

const link = (...targets) => targets.map((t) => (t === null ? [] : [{ node: t, type: 'main', index: 0 }]));
const SETTINGS = { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' };

// =====================================================================
// Workflow A — Ingestion & Semantic Firewall
// =====================================================================
const A = 'ingestion';
const ingestion = {
  id: 'IngestFirewall01',
  name: 'A · Ingestion & Semantic Firewall',
  active: false,
  settings: SETTINGS,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [],
  nodes: [
    node(A, 'Run Ingestion', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}),
    node(A, 'Read Transcripts File', 'n8n-nodes-base.readWriteFile', 1, [220, 300],
      { fileSelector: '/data/mock_transcripts.json', options: {} }),
    node(A, 'Extract JSON', 'n8n-nodes-base.extractFromFile', 1, [440, 300],
      { operation: 'fromJson', options: {} }),
    codeNode(A, 'Split & Sample Transcripts', [660, 300], 'ingestion/01_split_and_sample.js'),
    codeNode(A, 'Build Classifier Request', [880, 300], 'ingestion/02_build_classifier_request.js', 'runOnceForEachItem'),
    groqNode(A, 'Classification Agent (Groq)', [1100, 300], 'classifier_request'),
    codeNode(A, 'Parse Classification', [1320, 300], 'ingestion/03_parse_classification.js', 'runOnceForEachItem'),
    node(A, 'Ingestion Gate', 'n8n-nodes-base.switch', 3.2, [1540, 300], {
      rules: {
        values: [{
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              { id: uuid('gate-type'), leftValue: '={{ $json.meeting_type }}', rightValue: 'Client Coaching',
                operator: { type: 'string', operation: 'equals' } },
              { id: uuid('gate-conf'), leftValue: '={{ $json.confidence_score }}', rightValue: 0.8,
                operator: { type: 'number', operation: 'gte' } },
            ],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'Pass: Client Coaching ≥ 0.80',
        }],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Reject: Archive' },
    }),
    // --- Pass branch ---
    codeNode(A, 'Build Framework Request', [1780, 180], 'ingestion/05_build_framework_request.js', 'runOnceForEachItem'),
    groqNode(A, 'Extract Framework (Groq)', [2000, 180], 'framework_request'),
    codeNode(A, 'Dual-Stream Parser', [2220, 180], 'ingestion/06_dual_stream_parser.js'),
    embedNode(A, 'Embed Chunk (bge-m3)', [2440, 180], '$json.index_text'),
    codeNode(A, 'Build Vault Upsert SQL', [2660, 180], 'ingestion/07_build_vault_upsert_sql.js'),
    pgNode(A, 'Upsert knowledge_vault', [2880, 180]),
    // --- Reject branch ---
    codeNode(A, 'Build Archive SQL', [1780, 440], 'ingestion/04_build_archive_sql.js', 'runOnceForEachItem'),
    pgNode(A, 'Archive Rejected Session', [2000, 440]),
  ],
  connections: {
    'Run Ingestion': { main: link('Read Transcripts File') },
    'Read Transcripts File': { main: link('Extract JSON') },
    'Extract JSON': { main: link('Split & Sample Transcripts') },
    'Split & Sample Transcripts': { main: link('Build Classifier Request') },
    'Build Classifier Request': { main: link('Classification Agent (Groq)') },
    'Classification Agent (Groq)': { main: link('Parse Classification') },
    'Parse Classification': { main: link('Ingestion Gate') },
    'Ingestion Gate': { main: link('Build Framework Request', 'Build Archive SQL') },
    'Build Framework Request': { main: link('Extract Framework (Groq)') },
    'Extract Framework (Groq)': { main: link('Dual-Stream Parser') },
    'Dual-Stream Parser': { main: link('Embed Chunk (bge-m3)') },
    'Embed Chunk (bge-m3)': { main: link('Build Vault Upsert SQL') },
    'Build Vault Upsert SQL': { main: link('Upsert knowledge_vault') },
    'Build Archive SQL': { main: link('Archive Rejected Session') },
  },
};

// =====================================================================
// Workflow B — Gated Retrieval & Persona Synthesis
// =====================================================================
const B = 'retrieval';
const retrieval = {
  id: 'GatedRetrieval01',
  name: 'B · Gated Retrieval & Persona Synthesis',
  active: false,
  settings: SETTINGS,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
  tags: [],
  nodes: [
    node(B, 'Chat', '@n8n/n8n-nodes-langchain.chatTrigger', 1.1, [0, 200],
      { options: {} }, { webhookId: uuid('retrieval-chat-webhook') }),
    node(B, 'POST /webhook/coach', 'n8n-nodes-base.webhook', 2, [0, 420],
      { httpMethod: 'POST', path: 'coach', responseMode: 'lastNode', options: {} },
      { webhookId: uuid('retrieval-http-webhook') }),
    codeNode(B, 'Normalize & Detect Intent', [240, 300], 'retrieval/01_normalize_and_detect_intent.js', 'runOnceForEachItem'),
    node(B, 'Intent Router', 'n8n-nodes-base.if', 2, [460, 300], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: uuid('is-greeting'), leftValue: '={{ $json.is_greeting }}', rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    }),
    codeNode(B, 'Static Greeting', [700, 160], 'retrieval/02_static_greeting.js', 'runOnceForEachItem'),
    embedNode(B, 'Embed Query (bge-m3)', [700, 420], '$json.question'),
    codeNode(B, 'Build Gated SQL', [920, 420], 'retrieval/03_build_gated_sql.js', 'runOnceForEachItem'),
    pgNode(B, 'Gated Vector Search', [1140, 420], { alwaysOutputData: true }),
    codeNode(B, 'Collect Matches', [1360, 420], 'retrieval/04_collect_matches.js'),
    node(B, 'Zero-Match Circuit Breaker', 'n8n-nodes-base.if', 2, [1580, 420], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: uuid('zero-match'), leftValue: '={{ $json.match_count }}', rightValue: 0,
          operator: { type: 'number', operation: 'equals' } }],
        combinator: 'and',
      },
      options: {},
    }),
    codeNode(B, 'Circuit Breaker Fallback', [1820, 300], 'retrieval/05_circuit_breaker_fallback.js', 'runOnceForEachItem'),
    codeNode(B, 'Build Persona Request', [1820, 540], 'retrieval/06_build_persona_request.js', 'runOnceForEachItem'),
    groqNode(B, 'Persona Synthesis (Groq)', [2040, 540], 'persona_request'),
    codeNode(B, 'Format Answer', [2260, 540], 'retrieval/07_format_answer.js', 'runOnceForEachItem'),
  ],
  connections: {
    Chat: { main: link('Normalize & Detect Intent') },
    'POST /webhook/coach': { main: link('Normalize & Detect Intent') },
    'Normalize & Detect Intent': { main: link('Intent Router') },
    'Intent Router': { main: link('Static Greeting', 'Embed Query (bge-m3)') },
    'Embed Query (bge-m3)': { main: link('Build Gated SQL') },
    'Build Gated SQL': { main: link('Gated Vector Search') },
    'Gated Vector Search': { main: link('Collect Matches') },
    'Collect Matches': { main: link('Zero-Match Circuit Breaker') },
    'Zero-Match Circuit Breaker': { main: link('Circuit Breaker Fallback', 'Build Persona Request') },
    'Build Persona Request': { main: link('Persona Synthesis (Groq)') },
    'Persona Synthesis (Groq)': { main: link('Format Answer') },
  },
};

for (const [file, wf] of [['ingestion_firewall.json', ingestion], ['gated_retrieval.json', retrieval]]) {
  // sanity: every connection target exists
  const names = new Set(wf.nodes.map((n) => n.name));
  for (const [from, { main }] of Object.entries(wf.connections)) {
    if (!names.has(from)) throw new Error(`${file}: unknown source node ${from}`);
    main.flat().forEach((c) => { if (!names.has(c.node)) throw new Error(`${file}: unknown target node ${c.node}`); });
  }
  writeFileSync(join(ROOT, 'workflows', file), `${JSON.stringify(wf, null, 2)}\n`);
  console.log(`wrote workflows/${file} (${wf.nodes.length} nodes)`);
}
