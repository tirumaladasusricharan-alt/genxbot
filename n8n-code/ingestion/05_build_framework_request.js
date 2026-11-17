// Node: "Build Framework Request"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Stream 1 needs a *dense conceptual takeaway*, which is a summarisation task,
// so an LLM distils it (temperature 0, JSON mode). The Dual-Stream Parser then
// turns that JSON into the framework chunk text deterministically.
//
// It also returns `leader_questions`: first-person questions this session
// answers. They are used as extra index vectors (multi-vector / doc2query
// indexing) because bge-m3 question->passage similarity tops out ~0.55, below
// the brief's 0.70 / 0.65 gates, while question->question similarity for a
// genuine match is 0.72-0.77 and off-domain questions stay <= 0.57 (measured).
// -----------------------------------------------------------------------------
const s = $json;
const coaches = s.participants.filter((p) => p.is_team_member).map((p) => p.name);
const fullTranscript = s.transcript
  .map((t) => `[${t.timestamp ?? '--:--:--'}] ${t.speaker}: ${t.text.trim()}`)
  .join('\n');

const system = [
  'You distil executive-coaching sessions into reusable framework cards for a knowledge base.',
  `The coach is ${coaches.join(' / ') || 'the GenX team member'}.`,
  'Work only from what the coach actually says in the transcript, and keep the coach\'s own name for each framework.',
  'Write dense, specific sentences that someone could act on without reading the transcript.',
  'Return one JSON object in this shape:',
  '{"frameworks": [{',
  '  "name": "framework name as the coach calls it",',
  '  "problem": "the leadership problem it solves, 1-2 sentences",',
  '  "core_principle": "the central idea, 1-2 sentences",',
  '  "method": ["step 1", "step 2", "step 3"],',
  '  "key_question": "the diagnostic question or rule the coach gives, verbatim where possible",',
  '  "outcome": "what changes when the leader applies it"',
  '}],',
  ' "leader_questions": ["10 questions"]}',
  'Include one framework entry per distinct framework the coach teaches (usually one).',
  'For leader_questions, write 10 distinct questions this session\'s advice answers, the way a leader would type them to an executive coach:',
  'first person ("How should I...", "How do I...", "What do I do when..."), naming the concrete situation (the role, the symptom, the relationship),',
  'and covering different angles: the presenting problem, the underlying cause, the conversation to have, and the next step.',
].join('\n');

return {
  json: {
    ...s,
    framework_request: {
      model: $env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0,
      seed: 42,
      reasoning_effort: 'low',
      include_reasoning: false,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Session ${s.session_id}: ${s.title}\n\nTranscript:\n${fullTranscript}` },
      ],
    },
  },
};
