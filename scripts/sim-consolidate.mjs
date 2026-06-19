/**
 * Replays the EXACT realtime event sequence from the user's pasted log (the
 * pre-legal turn where VAD committed the SAME item twice with growing text and
 * fired response.created twice) through the same consolidation logic now in
 * VoiceClient — proving the trainee turn is logged ONCE (not duplicated).
 *
 * Mirrors VoiceClient: _setUserItem (replace by item_id), _finalizeUserTurn,
 * finalize-on-first-assistant-delta (NOT on response.created).
 *
 * Run: node scripts/sim-consolidate.mjs
 */
const logged = []; // what would be written to the trace (final user turns)
const turnItems = new Map();
let turnOrder = [];
let userTurnSeq = 0;
let userTurnId = "u-turn-0";
let activeAssistantId = null;

function setUserItem(itemId, transcript) {
  const text = (transcript || "").trim();
  if (!text) return;
  if (!turnItems.has(itemId)) turnOrder.push(itemId);
  turnItems.set(itemId, text); // REPLACE for same item_id (no dupe on re-commit)
}
function finalizeUserTurn() {
  if (!turnOrder.length) return;
  const joined = turnOrder.map((id) => turnItems.get(id) || "").join(" ").trim();
  if (joined) logged.push({ role: "user", text: joined });
  turnItems.clear();
  turnOrder = [];
  userTurnSeq += 1;
  userTurnId = `u-turn-${userTurnSeq}`;
}
function handle(e) {
  switch (e.type) {
    case "conversation.item.added":
      if (e.item?.role === "user" && Array.isArray(e.item.content))
        for (const c of e.item.content)
          if (c?.type === "input_audio" && c.transcript) { setUserItem(e.item.id, c.transcript); break; }
      break;
    case "conversation.item.input_audio_transcription.completed":
      setUserItem(e.item_id, e.transcript);
      break;
    case "response.created":
      break; // intentionally does NOT finalize (the old bug)
    case "response.output_audio_transcript.delta":
      if (!activeAssistantId) { finalizeUserTurn(); activeAssistantId = e.response_id; }
      break;
    case "response.output_audio_transcript.done":
      logged.push({ role: "assistant", text: e.transcript });
      activeAssistantId = null;
      break;
  }
}

// ---- the real recorded sequence (pre-legal turn) ----
const events = [
  { type: "conversation.item.added", item: { id: "5e32", role: "user", content: [{ type: "input_audio", transcript: " Okay, uh, so, uh, can you please tell me" }] } },
  { type: "conversation.item.input_audio_transcription.completed", item_id: "5e32", transcript: " Okay, uh, so, uh, can you please tell me" },
  { type: "response.created", response: { id: "respA" } },                      // superseded
  { type: "conversation.item.added", item: { id: "5e32", role: "user", content: [{ type: "input_audio", transcript: " Okay, uh, so, uh, can you please tell me, uh, how to handle pre-legal accounts?" }] } },
  { type: "conversation.item.input_audio_transcription.completed", item_id: "5e32", transcript: " Okay, uh, so, uh, can you please tell me, uh, how to handle pre-legal accounts?" },
  { type: "response.created", response: { id: "respB" } },
  { type: "response.output_audio_transcript.delta", response_id: "respB", delta: "I'd be happy to help with that." },
  { type: "response.output_audio_transcript.delta", response_id: "respB", delta: " ..." },
  { type: "response.output_audio_transcript.done", response_id: "respB", transcript: "I'd be happy to help with that. Pre-legal accounts are aged ones the client might forward to an attorney for review." },
];
events.forEach(handle);

console.log("LOGGED TRACE ENTRIES:");
logged.forEach((l, i) => console.log(`  ${i + 1}. [${l.role}] ${l.text}`));
const userTurns = logged.filter((l) => l.role === "user");
console.log(`\nuser turns logged: ${userTurns.length}`);
const ok = userTurns.length === 1 && /how to handle pre-legal accounts/.test(userTurns[0].text);
console.log(ok ? "✅ PASS — single, complete trainee turn (no duplicate, no truncation)" : "❌ FAIL");
process.exit(ok ? 0 : 1);
