// Node: "Normalize & Detect Intent"   (Code · Run Once for Each Item)
// -----------------------------------------------------------------------------
// Accepts both entry points (n8n Chat Trigger and the POST /webhook/coach API)
// and flags pure greetings with a regex, so "Hi" never touches the database
// or the LLM. "Hi, how do I handle X?" is NOT a pure greeting and is answered.
// -----------------------------------------------------------------------------
const GREETING = /^(?:hi|hello|hey|hiya|howdy|greetings|yo|good\s+(?:morning|afternoon|evening|day))(?:[\s,]+(?:there|all|team|coach|sara|dr\.?\s*sara(?:\s+hegy)?))?[\s!.,?]*$/i;

const raw = $json.chatInput ?? $json.body?.question ?? $json.body?.chatInput ?? $json.query?.question ?? $json.question ?? '';
const question = String(raw).replace(/\s+/g, ' ').trim();

return {
  json: {
    question,
    is_greeting: question === '' || GREETING.test(question),
    channel: $json.chatInput !== undefined ? 'chat' : 'webhook',
  },
};
