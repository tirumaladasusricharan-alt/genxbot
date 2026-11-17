// Node: "Circuit Breaker Fallback"   (Code · Run Once for Each Item)
// Zero chunks cleared the similarity gate: answer with the fixed fallback.
// The LLM node sits on the other branch and is never executed on this path.
return {
  json: {
    output: 'No documented coaching frameworks match this topic.',
    route: 'circuit_breaker',
    llm_called: false,
    matched_chunks: 0,
    sources: [],
  },
};
