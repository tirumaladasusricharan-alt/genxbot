// Node: "Collect Matches"   (Code · Run Once for All Items)
// -----------------------------------------------------------------------------
// "Gated Vector Search" has "Always Output Data" on, so a zero-row result still
// arrives here as one empty item. Real rows are the ones that carry an id.
// -----------------------------------------------------------------------------
const rows = $input.all()
  .map((item) => item.json)
  .filter((row) => row && row.id !== undefined && row.id !== null && typeof row.content === 'string');

const toMatch = (row) => ({
  id: Number(row.id),
  session_id: row.session_id,
  stream_type: row.stream_type,
  similarity: Math.round(Number(row.similarity) * 10000) / 10000,
  content: row.content,
  framework_name: row.metadata?.framework_name ?? null,
  matched_on: row.metadata?.index_kind === 'question' ? row.metadata.index_text : 'passage',
});

const frameworks = rows.filter((r) => r.stream_type === 'framework').map(toMatch);
const voice_samples = rows.filter((r) => r.stream_type === 'voice_sample').map(toMatch);

return [{
  json: {
    question: $('Normalize & Detect Intent').first().json.question,
    match_count: frameworks.length + voice_samples.length,
    frameworks,
    voice_samples,
  },
}];
