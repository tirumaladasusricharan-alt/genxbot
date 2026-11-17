# Verification Log

Generated 2026-11-17 12:37 UTC by `scripts/verify.sh`.

## 1. Workflow A: ingestion run
```text
Workflow A executed successfully (n8n execute --id=IngestFirewall01)
```

## 2. Gate decisions (ingestion_log)
```text
 session_id |    meeting_type     | confidence_score | decision |              reason              | framework_chunks | voice_chunks 
------------+---------------------+------------------+----------+----------------------------------+------------------+--------------
 SES-101    | Client Coaching     |            0.980 | ingested | -                                |                1 |            2
 SES-102    | Client Coaching     |            0.990 | ingested | -                                |                1 |            2
 SES-103    | Internal Operations |            0.990 | archived | meeting_type=Internal Operations |                0 |            0
 SES-104    | Sales Discovery     |            0.990 | archived | meeting_type=Sales Discovery     |                0 |            0
(4 rows)

```

## 3. knowledge_vault contents (only SES-101 and SES-102 may appear)
```text
 session_id | stream_type  | chunks | index_vectors | min_chars | max_chars | dims 
------------+--------------+--------+---------------+-----------+-----------+------
 SES-101    | framework    |      1 |            11 |       979 |       979 | 1024
 SES-101    | voice_sample |      2 |            22 |       454 |       455 | 1024
 SES-102    | framework    |      1 |            11 |      1161 |      1161 | 1024
 SES-102    | voice_sample |      2 |            22 |       409 |       438 | 1024
(4 rows)

```

Sample voice_sample chunk (verbatim coach dialogue):
```text
Look, Mark, micromanagement is almost never an ego problem. It is an information architecture breakdown. When you step back in, you're not doing it because you crave control; you're doing it because your system is bleeding signal. That friction is burning out your nervous system.

The reality is, top performers don't fail because of capability; they fail against ambiguous standards. In our practice, we use a framework called Completion with Integrity.
```

## 4. archived_sessions (rejected, no embeddings)
```text
 session_id |             title             |    meeting_type     | confidence_score |          reject_reason           
------------+-------------------------------+---------------------+------------------+----------------------------------
 SES-103    | Technical Sync & Integrations | Internal Operations |            0.990 | meeting_type=Internal Operations
 SES-104    | Partnership Discovery Call    | Sales Discovery     |            0.990 | meeting_type=Sales Discovery
(2 rows)

```

## 5. Workflow B: chat tests

### Q: Hello
```json
{"output":"Hello! I'm the GenX coaching assistant, grounded in Dr. Sara Hegy's documented frameworks. Ask me a leadership question, for example: \"How should I approach an underperforming VP?\"","route":"greeting","llm_called":false,"matched_chunks":0,"sources":[]}
```

### Q: How should I approach an underperforming VP?
```json
{"output":"Look, the VP’s slip isn’t a personal flaw. The reality is the system is fighting him.\n\nRun the Table and Shoulder Test:\n\n1. **Regulate** – Before any meeting, pause. Breathe. Ground yourself so you enter the conversation from safety, not from urgency.  \n2. **Architect the dialogue** – Sit with the VP as a designer of a container, not as an interrogator. Open with the diagnostic question: “Where is the internal system fighting you right now?”  \n3. **Diagnose** – Listen for two signals:  \n   a. **Operational drift** – The role’s scope no longer matches the company’s velocity.  \n   b. **Capacity overload** – Neurological load, bandwidth, or personal bandwidth is maxed out.  \n4. **Decide the load path** –  \n   *If drift*: co‑design a role redesign, adjust responsibilities, or reshape the container.  \n   *If overload*: map a dignified transition, reduce load, or reallocate resources.  \n5. **Close with a clear handoff** – Agree on concrete, binary outcomes for the next 30‑60 days and the next structural step.\n\nThe architecture does the work; you just set the blueprint.\n\n**Action for this week:** Schedule a 30‑minute “system check” with the VP, use the diagnostic question, and capture whether the issue is drift or overload.","route":"persona_answer","llm_called":true,"matched_chunks":3,"sources":[{"session_id":"SES-102","stream_type":"framework","similarity":0.7561,"framework_name":"Table and Shoulder Test","matched_on":"What exact question should I ask my VP to uncover the root cause of his performance decline?"},{"session_id":"SES-102","stream_type":"voice_sample","similarity":0.7561,"framework_name":"Table and Shoulder Test","matched_on":"What exact question should I ask my VP to uncover the root cause of his performance decline?"},{"session_id":"SES-102","stream_type":"voice_sample","similarity":0.7561,"framework_name":"Table and Shoulder Test","matched_on":"What exact question should I ask my VP to uncover the root cause of his performance decline?"}]}
```

### Q: I keep reviewing every deck my directors send to clients. How do I step back?
```json
{"output":"Look, the endless deck reviews are an information‑architecture leak, not a personal flaw. The signal is getting filtered through you, and your bandwidth is burning out.\n\nUse the Completion with Integrity framework:\n\n1. **Identify the initiative** – the client‑facing deck pipeline you are policing.  \n2. **Define binary exit criteria** – e.g., “All slides meet brand‑guideline checklist + key‑message alignment + no more than two data errors.” Write it as a yes/no gate.  \n3. **Communicate and embed** – co‑create the checklist with each director, lock it into the shared template, and make the checklist the handoff gate.  \n4. **Step back** – once a director marks the checklist complete, the system signals “done.” No further “How’s it looking?” needed.\n\nThe reality is, when the gate is crystal‑clear, the load shifts from you to the architecture. Your role becomes the auditor of the gate, not the gatekeeper of every slide.\n\n**Action for this week:** Choose one director, build a one‑page binary checklist for their next deck, get their sign‑off, and then refuse to open the file until the checklist is marked complete.","route":"persona_answer","llm_called":true,"matched_chunks":3,"sources":[{"session_id":"SES-101","stream_type":"framework","similarity":0.7396,"framework_name":"Completion with Integrity","matched_on":"How should I stop reviewing every slide deck and still guarantee quality?"},{"session_id":"SES-101","stream_type":"voice_sample","similarity":0.7396,"framework_name":"Completion with Integrity","matched_on":"How should I stop reviewing every slide deck and still guarantee quality?"},{"session_id":"SES-101","stream_type":"voice_sample","similarity":0.7396,"framework_name":"Completion with Integrity","matched_on":"How should I stop reviewing every slide deck and still guarantee quality?"}]}
```

### Q: How do I fix my database index?
```json
{"output":"No documented coaching frameworks match this topic.","route":"circuit_breaker","llm_called":false,"matched_chunks":0,"sources":[]}
```
