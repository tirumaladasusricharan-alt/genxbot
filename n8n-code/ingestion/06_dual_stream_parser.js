// Node: "Dual-Stream Parser"   (Code · Run Once for All Items)
// -----------------------------------------------------------------------------
// For every APPROVED coaching session, emit two streams of chunks:
//   Stream 1  framework     dense conceptual takeaway (from the LLM's framework card)
//   Stream 2  voice_sample  the coach's verbatim turns only, packed into
//                           400-700 character chunks on sentence boundaries
// Output: one n8n item per (chunk x index text), ready to be embedded.
//   Every chunk is indexed by its own passage text AND by each leader question
//   the session answers (multi-vector indexing). All rows of one chunk share a
//   chunk_key, and retrieval de-duplicates on it. `content` is always the real
//   framework card / verbatim coach text; only the vector's source text differs.
// -----------------------------------------------------------------------------
const MIN_CHARS = 400;
const MAX_CHARS = 700;

// ---------- Stream 2 helpers: verbatim coach dialogue ----------
const clean = (text) => text.replace(/\s+/g, ' ').trim();

// Split a turn into sentences, keeping punctuation and closing quotes attached.
function toSentences(text) {
  return clean(text)
    .split(/(?<=[.!?]["'’”)]?)\s+(?=["'‘“(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A sentence longer than MAX_CHARS (rare) is cut on a word boundary.
function capLength(sentence) {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const parts = [];
  let rest = sentence;
  while (rest.length > MAX_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_CHARS);
    const at = cut > 0 ? cut : MAX_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Same turn -> joined with a space; a new turn -> blank line, so the rhythm
// of separate spoken turns is preserved inside a chunk.
function render(units) {
  return units
    .map((u, i) => (i === 0 ? '' : u.turn === units[i - 1].turn ? ' ' : '\n\n') + u.text)
    .join('');
}

function packVoiceChunks(coachTurns) {
  const units = [];
  coachTurns.forEach((turn, turnIndex) => {
    for (const sentence of toSentences(turn.text)) {
      for (const piece of capLength(sentence)) units.push({ text: piece, turn: turnIndex, ts: turn.timestamp });
    }
  });
  if (units.length === 0) return [];

  // 1) Greedy pack up to MAX_CHARS.
  const chunks = [];
  let current = [];
  for (const unit of units) {
    if (current.length && render([...current, unit]).length > MAX_CHARS) {
      chunks.push(current);
      current = [];
    }
    current.push(unit);
  }
  if (current.length) chunks.push(current);

  // 2) Rebalance a short tail: borrow whole sentences from the previous chunk
  //    while both stay inside the window; otherwise merge if the result fits.
  for (let i = chunks.length - 1; i > 0; i--) {
    const prev = chunks[i - 1];
    const last = chunks[i];
    while (render(last).length < MIN_CHARS && prev.length > 1) {
      const candidatePrev = prev.slice(0, -1);
      const candidateLast = [prev[prev.length - 1], ...last];
      if (render(candidatePrev).length < MIN_CHARS || render(candidateLast).length > MAX_CHARS) break;
      prev.pop();
      last.unshift(candidateLast[0]);
    }
    if (render(last).length < MIN_CHARS && render([...prev, ...last]).length <= MAX_CHARS) {
      chunks.splice(i - 1, 2, [...prev, ...last]);
    }
  }

  // 3) If sentence boundaries make a 400-700 split impossible (e.g. 836 chars of
  //    coach text => 458 + 384), give the short chunk a whole-sentence OVERLAP
  //    from the end of the previous chunk. Sentences stay intact and verbatim.
  const result = chunks.map((units) => ({ units, overlap: 0 }));
  for (let i = 1; i < result.length; i++) {
    const prev = chunks[i - 1];
    let k = prev.length - 1;
    while (render(result[i].units).length < MIN_CHARS && k >= 0) {
      const candidate = [prev[k], ...result[i].units];
      if (render(candidate).length > MAX_CHARS) break;
      result[i].units = candidate;
      result[i].overlap += 1;
      k -= 1;
    }
  }

  return result.map(({ units, overlap }) => ({
    content: render(units),
    timestamps: [...new Set(units.map((u) => u.ts))],
    overlap_sentences: overlap,
  }));
}

// ---------- Stream 1 helpers: framework card -> dense text ----------
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => clean(String(x))).filter(Boolean);

function parseFrameworks(reply) {
  try {
    if (reply.error) return { frameworks: [], questions: [], error: String(reply.error.message ?? reply.error) };
    const content = reply?.choices?.[0]?.message?.content ?? '';
    const cleaned = content.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    const list = Array.isArray(parsed.frameworks) ? parsed.frameworks : [parsed];
    const questions = [...new Set(asList(parsed.leader_questions))].slice(0, 12);
    return { frameworks: list.filter((f) => f && typeof f.name === 'string' && f.name.trim()), questions, error: null };
  } catch (err) {
    return { frameworks: [], questions: [], error: err.message };
  }
}

function frameworkText(fw, session, coachName) {
  const method = asList(fw.method);
  return [
    `Framework: ${clean(fw.name)} (taught by ${coachName}, session ${session.session_id})`,
    fw.problem && `Problem it solves: ${clean(fw.problem)}`,
    fw.core_principle && `Core principle: ${clean(fw.core_principle)}`,
    method.length && `How to run it: ${method.map((m, i) => `${i + 1}) ${m}`).join(' ')}`,
    fw.key_question && `Key question / rule: ${clean(fw.key_question)}`,
    fw.outcome && `Outcome: ${clean(fw.outcome)}`,
  ].filter(Boolean).join('\n');
}

// One row per index text: the passage itself + every leader question.
const indexTexts = (content, questions) => [
  { index_kind: 'passage', index_text: content },
  ...questions.map((q) => ({ index_kind: 'question', index_text: q })),
];

// ---------- Main ----------
const out = [];

$input.all().forEach((item, index) => {
  const { framework_request, ...session } = $('Build Framework Request').itemMatching(index).json;
  const coachNames = new Set(session.participants.filter((p) => p.is_team_member).map((p) => p.name));
  const coachName = [...coachNames].join(' / ') || 'coach';
  const baseMeta = {
    source: 'mock_transcripts.json',
    title: session.title,
    session_created_at: session.session_created_at,
    coach: coachName,
    meeting_type: session.meeting_type,
    confidence_score: session.confidence_score,
  };
  const sessionInfo = {
    session_id: session.session_id,
    title: session.title,
    meeting_type: session.meeting_type,
    confidence_score: session.confidence_score,
    summary: session.summary,
  };

  // Stream 1: framework
  const { frameworks, questions, error } = parseFrameworks(item.json);
  const frameworkChunks = frameworks.length
    ? frameworks.map((fw) => ({ content: frameworkText(fw, session, coachName), framework_name: clean(fw.name) }))
    : [{ // safe fallback: never lose an approved session because extraction failed
        content: `Coaching takeaway (session ${session.session_id}, ${coachName}): ${session.summary}`,
        framework_name: null,
        extraction_error: error,
      }];

  // Stream 2: voice_sample (coach turns only)
  const coachTurns = session.transcript.filter((t) => coachNames.has(t.speaker));
  const voiceChunks = packVoiceChunks(coachTurns);

  const frameworkName = frameworkChunks.find((fc) => fc.framework_name)?.framework_name ?? null;

  const emit = (stream_type, chunk_index, content, metadata) => {
    const chunk_key = `${session.session_id}:${stream_type}:${chunk_index}`;
    for (const idx of indexTexts(content, questions)) {
      out.push({
        json: {
          ...sessionInfo,
          stream_type,
          chunk_index,
          chunk_key,
          content,
          index_kind: idx.index_kind,
          index_text: idx.index_text,
          metadata: { ...metadata, chunk_key, index_kind: idx.index_kind, index_text: idx.index_text },
        },
        pairedItem: { item: index },
      });
    }
  };

  frameworkChunks.forEach((fc, i) => emit('framework', i, fc.content, {
    ...baseMeta,
    framework_name: fc.framework_name,
    char_count: fc.content.length,
    ...(fc.extraction_error ? { extraction_error: fc.extraction_error } : {}),
  }));

  voiceChunks.forEach((vc, i) => emit('voice_sample', i, vc.content, {
    ...baseMeta,
    framework_name: frameworkName,
    speaker: coachName,
    char_count: vc.content.length,
    within_400_700: vc.content.length >= MIN_CHARS && vc.content.length <= MAX_CHARS,
    turn_timestamps: vc.timestamps,
    overlap_sentences: vc.overlap_sentences,
  }));
});

return out;
