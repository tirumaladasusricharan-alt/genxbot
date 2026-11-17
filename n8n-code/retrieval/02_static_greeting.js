// Node: "Static Greeting"   (Code · Run Once for Each Item)
// No database lookup, no LLM call.
return {
  json: {
    output: "Hello! I'm the GenX coaching assistant, grounded in Dr. Sara Hegy's documented frameworks. Ask me a leadership question, for example: \"How should I approach an underperforming VP?\"",
    route: 'greeting',
    llm_called: false,
    matched_chunks: 0,
    sources: [],
  },
};
