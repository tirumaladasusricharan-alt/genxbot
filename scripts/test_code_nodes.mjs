// Offline unit tests for every n8n Code node, run against the real dataset with
// stubbed LLM / embedding replies. No Docker, n8n or API key needed.
//   node scripts/test_code_nodes.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, 'n8n-code', p), 'utf8');
const dataset = JSON.parse(readFileSync(join(ROOT, 'data', 'mock_transcripts.json'), 'utf8'));
const ENV = { GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model' };

// Minimal n8n Code-node runtime: $input, $json, $env and $('Node') accessors.
function run(file, { items = [], json, nodes = {}, env = ENV } = {}) {
  const $ = (name) => {
    const list = nodes[name];
    if (!list) throw new Error(`stub missing for $('${name}')`);
    return {
      item: { json: list[0].json },
      first: () => ({ json: list[0].json }),
      all: () => list,
      itemMatching: (i) => ({ json: list[i].json }),
    };
  };
  const $input = { all: () => items, first: () => items[0] };
  return new Function('$input', '$json', '$env', '$', src(file))($input, json, env, $);
}
const llm = (obj) => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });
const fakeEmbedding = (seed) => ({ embeddings: [Array.from({ length: 1024 }, (_, i) => Math.sin(seed + i) / 32)] });

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

// ---------- Workflow A ----------
console.log('Workflow A — ingestion');
const sampled = run('ingestion/01_split_and_sample.js', { items: [{ json: { data: dataset } }] });

test('sampler emits one item per session, wrapped as { json }', () => {
  assert.equal(sampled.length, 4);
  assert.deepEqual(sampled.map((i) => i.json.session_id), ['SES-101', 'SES-102', 'SES-103', 'SES-104']);
});
test('sampler accepts other Extract-From-File shapes', () => {
  assert.equal(run('ingestion/01_split_and_sample.js', { items: dataset.map((s) => ({ json: s })) }).length, 4);
  assert.equal(run('ingestion/01_split_and_sample.js', { items: [{ json: dataset }] }).length, 4);
});
test('bounded sample = first 40 + last 20 on long transcripts', () => {
  const long = { ...dataset[0], transcript: Array.from({ length: 100 }, (_, i) => ({ timestamp: `t${i}`, speaker: 'A', text: `turn ${i}` })) };
  const [s] = run('ingestion/01_split_and_sample.js', { items: [{ json: { data: [long] } }] });
  const lines = s.json.sample_text.split('\n');
  assert.equal(lines.length, 60);
  assert.match(lines[39], /turn 39$/);
  assert.match(lines[40], /turn 80$/);
  assert.match(lines[59], /turn 99$/);
});

const requests = sampled.map((it) => run('ingestion/02_build_classifier_request.js', { json: it.json }));
test('classifier request uses JSON mode, temperature 0 and a seed', () => {
  const r = requests[0].json.classifier_request;
  assert.equal(r.temperature, 0);
  assert.equal(r.response_format.type, 'json_object');
  assert.equal(typeof r.seed, 'number');
});
test('missing GROQ_API_KEY fails fast with a clear message', () => {
  assert.throws(() => run('ingestion/02_build_classifier_request.js', { json: sampled[0].json, env: {} }), /GROQ_API_KEY/);
});

const verdicts = {
  'SES-101': llm({ meeting_type: 'Client Coaching', confidence_score: 0.95, summary: 'Coaching on delegation.' }),
  'SES-102': llm('```json\n{"meeting_type":"client coaching","confidence_score":"0.9","summary":"Coaching on feedback."}\n```'),
  'SES-103': llm({ meeting_type: 'Internal Operations', confidence_score: 0.97, summary: 'Tech sync.' }),
  'SES-104': llm({ meeting_type: 'Sales Discovery', confidence_score: 0.96, summary: 'Pricing call.' }),
};
const parsed = requests.map((r) => run('ingestion/03_parse_classification.js', {
  json: verdicts[r.json.session_id], nodes: { 'Build Classifier Request': [r] },
}).json);

test('gate decisions: 101/102 ingest, 103/104 archive', () => {
  assert.deepEqual(parsed.map((p) => p.gate_decision), ['ingest', 'ingest', 'archive', 'archive']);
  assert.equal(parsed[1].meeting_type, 'Client Coaching'); // case + fences + string score normalised
  assert.equal(parsed[1].confidence_score, 0.9);
});
test('parser survives garbage, HTTP errors and low confidence', () => {
  const p = (reply) => run('ingestion/03_parse_classification.js', { json: reply, nodes: { 'Build Classifier Request': [requests[0]] } }).json;
  assert.equal(p(llm('not json at all')).gate_decision, 'archive');
  assert.equal(p({ error: { message: '429 rate limit' } }).reject_reason.startsWith('classifier_error'), true);
  assert.equal(p(llm({ meeting_type: 'Client Coaching', confidence_score: 0.79 })).gate_decision, 'archive');
  assert.equal(p(llm({ meeting_type: 'Client Coaching', confidence_score: 7 })).confidence_score, 1);
  assert.equal(p(llm({ meeting_type: 'Podcast', confidence_score: 0.99 })).meeting_type, 'Other');
});

test('archive SQL is injection-safe (base64) and has no embedding', () => {
  const sql = run('ingestion/04_build_archive_sql.js', { json: parsed[3] }).json.sql;
  assert.match(sql, /INSERT INTO archived_sessions/);
  assert.doesNotMatch(sql, /\$8,500/);         // raw "$" text never appears in SQL
  assert.doesNotMatch(sql, /vector/);
});

const approved = parsed.filter((p) => p.gate_decision === 'ingest').map((json) => ({ json }));
const fwRequests = approved.map((a) => run('ingestion/05_build_framework_request.js', { json: a.json }));
const fwReplies = [
  llm({ frameworks: [{ name: 'Completion with Integrity', problem: 'p', core_principle: 'c', method: ['a', 'b'], key_question: 'k', outcome: 'o' }],
        leader_questions: ['How do I stop micromanaging my directors?', 'How do I set exit criteria?', 'How do I stop micromanaging my directors?'] }),
  { error: { message: 'timeout' } }, // forces the safe fallback path for SES-102
];
const rowsOut = run('ingestion/06_dual_stream_parser.js', {
  items: fwReplies.map((json) => ({ json })), nodes: { 'Build Framework Request': fwRequests },
});
// one row per (chunk x index text); the unique chunks are the 'passage' rows
const chunks = rowsOut.filter((r) => r.json.index_kind === 'passage');

test('multi-vector index: passage + each unique leader question per chunk', () => {
  const fw101 = rowsOut.filter((r) => r.json.chunk_key === 'SES-101:framework:0');
  assert.deepEqual(fw101.map((r) => r.json.index_kind), ['passage', 'question', 'question']); // duplicate question removed
  assert.ok(fw101.every((r) => r.json.content === fw101[0].json.content));                // content never changes
  const v102 = rowsOut.filter((r) => r.json.chunk_key === 'SES-102:voice_sample:0');
  assert.deepEqual(v102.map((r) => r.json.index_kind), ['passage']);                      // no questions -> passage only
});

test('dual-stream parser emits framework + voice_sample chunks per session', () => {
  for (const sid of ['SES-101', 'SES-102']) {
    const mine = chunks.filter((c) => c.json.session_id === sid);
    assert.ok(mine.some((c) => c.json.stream_type === 'framework'), `${sid} framework`);
    assert.ok(mine.some((c) => c.json.stream_type === 'voice_sample'), `${sid} voice`);
  }
});
test('voice chunks are 400-700 chars and contain only the coach', () => {
  const voice = chunks.filter((c) => c.json.stream_type === 'voice_sample');
  for (const c of voice) {
    const len = c.json.content.length;
    assert.ok(len >= 400 && len <= 700, `${c.json.session_id}#${c.json.chunk_index} length ${len}`);
    assert.doesNotMatch(c.json.content, /Mark D\.:|Elena R\.:|underwater|reframes my stance/);
  }
  console.log(`      voice chunk lengths: ${voice.map((c) => `${c.json.session_id}=${c.json.content.length}`).join(', ')}`);
});
test('voice chunks are verbatim coach text (every sentence appears in the transcript)', () => {
  const coachText = dataset.flatMap((s) => s.transcript.filter((t) => t.speaker === 'Dr. Sara Hegy').map((t) => t.text)).join(' ');
  for (const c of chunks.filter((x) => x.json.stream_type === 'voice_sample')) {
    for (const part of c.json.content.split(/\n\n/)) assert.ok(coachText.includes(part.split(/(?<=[.!?]) /)[0]), part);
  }
});
test('framework extraction failure falls back instead of dropping the session', () => {
  const fb = chunks.find((c) => c.json.session_id === 'SES-102' && c.json.stream_type === 'framework');
  assert.match(fb.json.content, /Coaching takeaway/);
});

const embedded = rowsOut.map((c, i) => ({ json: fakeEmbedding(i) }));
const upserts = run('ingestion/07_build_vault_upsert_sql.js', { items: embedded, nodes: { 'Dual-Stream Parser': rowsOut } });
test('one transactional upsert per approved session with 1024-dim vectors', () => {
  assert.deepEqual(upserts.map((u) => u.json.session_id), ['SES-101', 'SES-102']);
  assert.equal(upserts[0].json.framework_chunks, 1);   // counts chunks, not vectors
  assert.equal(upserts[0].json.voice_chunks, 2);
  assert.equal(upserts[0].json.index_vectors, 9);      // 3 chunks x (passage + 2 questions)
  const sql = upserts[0].json.sql;
  assert.match(sql, /DELETE FROM knowledge_vault/);
  assert.match(sql, /::vector\(1024\)/);
  assert.match(sql, /'ingested'/);
});
test('wrong embedding size is rejected', () => {
  assert.throws(() => run('ingestion/07_build_vault_upsert_sql.js', {
    items: [{ json: { embeddings: [[0.1, 0.2]] } }], nodes: { 'Dual-Stream Parser': rowsOut },
  }), /1024-dim/);
});

// ---------- Workflow B ----------
console.log('Workflow B — retrieval');
const intent = (q, key = 'chatInput') => run('retrieval/01_normalize_and_detect_intent.js', { json: key === 'body' ? { body: { question: q } } : { [key]: q } }).json;
test('greetings are intercepted', () => {
  for (const q of ['Hello', 'Hi', 'hi!', 'Hey there', 'Good morning', 'hello Dr. Sara', '  HI  ']) assert.equal(intent(q).is_greeting, true, q);
});
test('real questions are not treated as greetings', () => {
  for (const q of ['Hi, how should I approach an underperforming VP?', 'How do I fix my database index?', 'Hello world program in python?']) {
    assert.equal(intent(q).is_greeting, false, q);
  }
  assert.equal(intent('How should I approach an underperforming VP?', 'body').question, 'How should I approach an underperforming VP?');
});

const normalized = { json: { question: 'How should I approach an underperforming VP?', is_greeting: false } };
const gated = run('retrieval/03_build_gated_sql.js', { json: fakeEmbedding(1), nodes: { 'Normalize & Detect Intent': [normalized] } }).json;
test('gated SQL applies independent 0.70 / 0.65 cosine floors with LIMIT 2', () => {
  assert.match(gated.sql, /stream_type = 'framework'\s+AND 1 - \(kv\.embedding <=> query\.v\) >= 0\.7\b/);
  assert.match(gated.sql, /stream_type = 'voice_sample'\s+AND 1 - \(kv\.embedding <=> query\.v\) >= 0\.65\b/);
  assert.equal((gated.sql.match(/LIMIT 2/g) ?? []).length, 2);
  assert.equal((gated.sql.match(/DISTINCT ON \(kv\.metadata->>'chunk_key'\)/g) ?? []).length, 2);
  assert.doesNotMatch(gated.sql, /underperforming/); // user text never reaches SQL
});

const collect = (rows) => run('retrieval/04_collect_matches.js', { items: rows.map((json) => ({ json })), nodes: { 'Normalize & Detect Intent': [normalized] } })[0].json;
test('zero rows (alwaysOutputData empty item) => match_count 0', () => {
  assert.equal(collect([{}]).match_count, 0);
});
const matches = collect([
  { id: 1, session_id: 'SES-102', stream_type: 'framework', content: 'Framework: Table and Shoulder Test', metadata: { framework_name: 'Table and Shoulder Test' }, similarity: 0.74 },
  { id: 5, session_id: 'SES-102', stream_type: 'voice_sample', content: 'The reality is...', metadata: {}, similarity: '0.69' },
]);
test('matches are split by stream', () => {
  assert.equal(matches.match_count, 2);
  assert.equal(matches.voice_samples[0].similarity, 0.69);
});
test('fallback text is exact and marks llm_called=false', () => {
  const fb = run('retrieval/05_circuit_breaker_fallback.js', { json: {} }).json;
  assert.equal(fb.output, 'No documented coaching frameworks match this topic.');
  assert.equal(fb.llm_called, false);
});
const persona = run('retrieval/06_build_persona_request.js', { json: matches, env: ENV }).json;
test('persona prompt = system + 2 positive few-shot pairs + real context', () => {
  const m = persona.persona_request.messages;
  assert.deepEqual(m.map((x) => x.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.match(m[5].content, /\[FRAMEWORK \| SES-102/);
  assert.match(m[5].content, /\[VOICE SAMPLE \| SES-102/);
  assert.doesNotMatch(m[0].content, /\b(never|don't|do not|avoid)\b/i); // positive framing only
});
test('answer formatter returns output + sources, handles LLM errors', () => {
  const ok = run('retrieval/07_format_answer.js', { json: llm('Look, ...'), nodes: { 'Build Persona Request': [{ json: persona }] } }).json;
  assert.equal(ok.route, 'persona_answer');
  assert.equal(ok.sources[0].session_id, 'SES-102');
  const bad = run('retrieval/07_format_answer.js', { json: { error: 'boom' }, nodes: { 'Build Persona Request': [{ json: persona }] } }).json;
  assert.equal(bad.route, 'llm_error');
});

console.log(`\n${passed} tests passed`);
