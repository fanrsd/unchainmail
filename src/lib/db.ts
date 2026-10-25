// D1 data-access layer. All queries are parameterized.
import type { Env, InboxRow, MessageRow } from "../types";

export async function createInbox(
  env: Env,
  row: InboxRow,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO inboxes (id, address, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.address, row.token_hash, row.created_at, row.expires_at)
    .run();
}

export async function getInboxById(
  env: Env,
  id: string,
): Promise<InboxRow | null> {
  return await env.DB.prepare(`SELECT * FROM inboxes WHERE id = ?`)
    .bind(id)
    .first<InboxRow>();
}

export async function getInboxByAddress(
  env: Env,
  address: string,
): Promise<InboxRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM inboxes WHERE address = ?`,
  )
    .bind(address.toLowerCase())
    .first<InboxRow>();
}

export async function extendInbox(
  env: Env,
  id: string,
  expiresAt: number,
): Promise<void> {
  await env.DB.prepare(`UPDATE inboxes SET expires_at = ? WHERE id = ?`)
    .bind(expiresAt, id)
    .run();
}

export async function deleteInbox(env: Env, id: string): Promise<void> {
  // ON DELETE CASCADE removes messages.
  await env.DB.prepare(`DELETE FROM inboxes WHERE id = ?`).bind(id).run();
}

export async function insertMessage(
  env: Env,
  row: MessageRow,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages
       (id, inbox_id, from_addr, from_name, to_addr, subject, preview,
        text_body, html_body, received_at, size_bytes, seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      row.id,
      row.inbox_id,
      row.from_addr,
      row.from_name,
      row.to_addr,
      row.subject,
      row.preview,
      row.text_body,
      row.html_body,
      row.received_at,
      row.size_bytes,
    )
    .run();
}

/** List view: omits heavy body columns. */
export async function listMessages(
  env: Env,
  inboxId: string,
): Promise<Partial<MessageRow>[]> {
  const res = await env.DB.prepare(
    `SELECT id, inbox_id, from_addr, from_name, subject, preview,
            received_at, size_bytes, seen
     FROM messages WHERE inbox_id = ? ORDER BY received_at DESC`,
  )
    .bind(inboxId)
    .all<Partial<MessageRow>>();
  return res.results ?? [];
}

export async function getMessage(
  env: Env,
  inboxId: string,
  messageId: string,
): Promise<MessageRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM messages WHERE id = ? AND inbox_id = ?`,
  )
    .bind(messageId, inboxId)
    .first<MessageRow>();
}

export async function markSeen(
  env: Env,
  inboxId: string,
  messageId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE messages SET seen = 1 WHERE id = ? AND inbox_id = ?`,
  )
    .bind(messageId, inboxId)
    .run();
}

export async function deleteMessage(
  env: Env,
  inboxId: string,
  messageId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM messages WHERE id = ? AND inbox_id = ?`,
  )
    .bind(messageId, inboxId)
    .run();
}

export async function countMessages(
  env: Env,
  inboxId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE inbox_id = ?`,
  )
    .bind(inboxId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Delete the oldest message(s) when an inbox is over capacity. */
export async function trimOldestMessages(
  env: Env,
  inboxId: string,
  keep: number,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM messages WHERE id IN (
       SELECT id FROM messages WHERE inbox_id = ?
       ORDER BY received_at DESC LIMIT -1 OFFSET ?
     )`,
  )
    .bind(inboxId, keep)
    .run();
}

/** Cron purge: delete expired inboxes (messages cascade). Returns count. */
export async function purgeExpired(env: Env, now: number): Promise<number> {
  const res = await env.DB.prepare(
    `DELETE FROM inboxes WHERE expires_at < ?`,
  )
    .bind(now)
    .run();
  return res.meta?.changes ?? 0;
}
