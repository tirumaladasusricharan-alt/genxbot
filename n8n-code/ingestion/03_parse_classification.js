// Node: "Parse Classification"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Turns the raw LLM reply into a validated verdict. Never throws:
// HTTP errors, empty replies, markdown fences, prose around the JSON, unknown
// labels and out-of-range scores all degrade to a safe "Other / 0.0" verdict,
// which the gate then archives instead of ingesting.
// -----------------------------------------------------------------------------
const ALLOWED_TYPES = ['Client Coaching', 'Internal Operations', 'Sales Discovery', 'Other'];
const PASS_TYPE = 'Client Coaching';
const PASS_CONFIDENCE = 0.8;

// Pair this reply with the session it belongs to (n8n paired-item linking).
const { classifier_request, ...session } = $('Build Classifier Request').item.json;
const reply = $json;

function extractJsonObject(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object found in LLM reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const normaliseType = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  return ALLOWED_TYPES.find((t) => t.toLowerCase() === key) ?? 'Other';
};

const normaliseScore = (value) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

let verdict;
let parseError = null;
try {
  if (reply.error) {
    const msg = typeof reply.error === 'string' ? reply.error : reply.error.message ?? JSON.stringify(reply.error);
    throw new Error(`Classifier request failed: ${msg}`);
  }
  const content = reply?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') throw new Error('Empty classifier reply');
  verdict = extractJsonObject(content);
} catch (err) {
  parseError = err.message;
  verdict = {};
}

const meeting_type = parseError ? 'Other' : normaliseType(verdict.meeting_type);
const confidence_score = parseError ? 0 : Math.round(normaliseScore(verdict.confidence_score) * 1000) / 1000;
const summary = typeof verdict.summary === 'string' && verdict.summary.trim()
  ? verdict.summary.trim()
  : (parseError ? `Classification unavailable: ${parseError}` : '');

const passes = meeting_type === PASS_TYPE && confidence_score >= PASS_CONFIDENCE;
let reject_reason = null;
if (!passes) {
  if (parseError) reject_reason = `classifier_error: ${parseError}`;
  else if (meeting_type !== PASS_TYPE) reject_reason = `meeting_type=${meeting_type}`;
  else reject_reason = `low_confidence=${confidence_score} (< ${PASS_CONFIDENCE})`;
}

return {
  json: {
    ...session,
    meeting_type,
    confidence_score,
    summary,
    gate_decision: passes ? 'ingest' : 'archive',
    reject_reason,
  },
};
