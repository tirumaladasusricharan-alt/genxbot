// Node: "Format Answer"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Returns the persona answer plus the exact chunks it was grounded on.
// "output" is the field the n8n Chat Trigger displays.
// -----------------------------------------------------------------------------
const ctx = $('Build Persona Request').item.json;
const answer = $json?.choices?.[0]?.message?.content;

const sources = [...ctx.frameworks, ...ctx.voice_samples].map((m) => ({
  session_id: m.session_id,
  stream_type: m.stream_type,
  similarity: m.similarity,
  ...(m.framework_name ? { framework_name: m.framework_name } : {}),
  ...(m.matched_on ? { matched_on: m.matched_on } : {}),
}));

if (typeof answer !== 'string' || answer.trim() === '') {
  const reason = $json?.error ? JSON.stringify($json.error) : 'empty LLM response';
  return {
    json: {
      output: 'The coaching assistant could not generate an answer right now. Please try again in a moment.',
      route: 'llm_error',
      llm_called: true,
      error: reason,
      matched_chunks: ctx.match_count,
      sources,
    },
  };
}

return {
  json: {
    output: answer.trim(),
    route: 'persona_answer',
    llm_called: true,
    matched_chunks: ctx.match_count,
    sources,
  },
};
