// Node: "Build Classifier Request"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Builds the Groq chat-completions body for the classification agent.
// temperature 0 + fixed seed + JSON mode => repeatable verdicts.
// -----------------------------------------------------------------------------
const apiKey = String($env.GROQ_API_KEY ?? '').trim();
if (!apiKey) {
  throw new Error('GROQ_API_KEY is empty. Put it in .env, then run: docker compose up -d --force-recreate n8n');
}

const s = $json;
const roster = s.participants
  .map((p) => `- ${p.name} (${p.is_team_member ? 'GenX team member' : 'external guest'})`)
  .join('\n');

const system = [
  'You classify recorded meetings for the GenX Leadership Academy knowledge base.',
  'Pick exactly one meeting_type:',
  '- "Client Coaching": a GenX coach works with an external client leader on their leadership, mindset, team, delegation, feedback or personal effectiveness.',
  '- "Internal Operations": GenX team members talking among themselves about the company\'s own engineering, tooling, bugs, sprints, releases or admin.',
  '- "Sales Discovery": a conversation about buying GenX services: pricing, budgets, retainers, contracts, pilots or scope of work.',
  '- "Other": anything that fits none of the above.',
  'confidence_score is your probability (0.0 to 1.0) that the chosen meeting_type is correct.',
  'summary is one or two plain sentences describing what the meeting was about.',
  'Respond with a single JSON object with exactly these keys:',
  '{"meeting_type": "Client Coaching | Internal Operations | Sales Discovery | Other", "confidence_score": 0.0, "summary": "..."}',
].join('\n');

const user = [
  `Meeting title: ${s.title}`,
  'Participants:',
  roster || '- (none listed)',
  `Transcript sample (${s.sample_turn_count} of ${s.total_turn_count} turns):`,
  s.sample_text,
].join('\n');

return {
  json: {
    ...s,
    classifier_request: {
      model: $env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0,
      seed: 42,
      // gpt-oss is a reasoning model: keep reasoning short and out of the reply,
      // and leave enough budget so reasoning can never starve the JSON answer.
      reasoning_effort: 'low',
      include_reasoning: false,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  },
};
