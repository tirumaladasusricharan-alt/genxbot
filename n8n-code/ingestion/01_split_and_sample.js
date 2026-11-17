// Node: "Split & Sample Transcripts"   (Code · Run Once for All Items)
// -----------------------------------------------------------------------------
// Input : the parsed mock_transcripts.json from "Extract JSON".
// Output: one item per session, plus a BOUNDED sample (first 40 + last 20 turns)
//         that is the only thing the classifier ever sees.
// -----------------------------------------------------------------------------
const HEAD_TURNS = 40;
const TAIL_TURNS = 20;

// "Extract From File" may hand us { data: [...] }, a single session, or one item
// per session depending on version/settings. Accept all shapes.
function extractSessions(items) {
  const sessions = [];
  for (const { json } of items) {
    if (Array.isArray(json)) sessions.push(...json);
    else if (Array.isArray(json?.data)) sessions.push(...json.data);
    else if (json?.data?.transcript) sessions.push(json.data);
    else if (json?.transcript) sessions.push(json);
  }
  return sessions;
}

// First 40 + last 20 turns. Short transcripts (<= 60 turns) are sent whole,
// so no turn is ever duplicated or dropped from the middle unnecessarily.
function boundedSample(turns) {
  if (turns.length <= HEAD_TURNS + TAIL_TURNS) return turns;
  return [...turns.slice(0, HEAD_TURNS), ...turns.slice(-TAIL_TURNS)];
}

const formatTurn = (t) => `[${t.timestamp ?? '--:--:--'}] ${t.speaker ?? 'Unknown'}: ${t.text.trim()}`;

const sessions = extractSessions($input.all());
if (sessions.length === 0) {
  throw new Error('No sessions found. Expected an array of sessions in /data/mock_transcripts.json');
}

return sessions.map((session) => {
  const turns = (Array.isArray(session.transcript) ? session.transcript : [])
    .filter((t) => t && typeof t.text === 'string' && t.text.trim() !== '');
  const sample = boundedSample(turns);

  return {
    json: {
      session_id: String(session.id ?? '').trim() || 'UNKNOWN',
      title: session.title ?? '',
      session_created_at: session.created_at ?? null,
      participants: Array.isArray(session.participants) ? session.participants : [],
      transcript: turns,
      total_turn_count: turns.length,
      sample_turn_count: sample.length,
      sample_text: sample.map(formatTurn).join('\n'),
    },
    pairedItem: { item: 0 },
  };
});
