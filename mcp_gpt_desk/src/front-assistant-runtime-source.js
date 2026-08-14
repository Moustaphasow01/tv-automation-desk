import { currentUtc } from "./front-control-plane-common.js";

export async function loadFrontAssistantRuntime(store, query = {}) {
  if (typeof store?.getFrontAssistantRuntime === "function") return store.getFrontAssistantRuntime(query);
  const pool = store?.persistence?.pool;
  if (!pool) return { conversations: [], messages: [] };
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const result = await pool.query(`
    SELECT m.assistant_message_id,
           m.assistant_conversation_id,
           m.role,
           m.content,
           m.citation_refs,
           m.created_at_utc,
           c.assistant_profile_id
      FROM assistant_messages m
      JOIN assistant_conversations c ON c.assistant_conversation_id = m.assistant_conversation_id
     ORDER BY m.created_at_utc DESC, m.assistant_message_id DESC
     LIMIT $1::int`, [limit]);
  return {
    messages: result.rows.reverse().map((row) => ({
      messageId: String(row.assistant_message_id),
      conversationId: String(row.assistant_conversation_id),
      assistantId: String(row.assistant_profile_id || ""),
      role: String(row.role || ""),
      text: String(row.content || ""),
      citationIds: Array.isArray(row.citation_refs) ? row.citation_refs.map(String) : [],
      at: iso(row.created_at_utc),
    })),
  };
}

function iso(value) {
  if (!value) return currentUtc();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
