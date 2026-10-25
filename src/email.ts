// Inbound email handler: parses raw MIME via postal-mime and stores to D1.
import PostalMime from "postal-mime";
import type { Email } from "postal-mime";
import type { Env, MessageRow } from "./types";
import { newId } from "./lib/id";
import {
  getInboxByAddress,
  insertMessage,
  countMessages,
  trimOldestMessages,
} from "./lib/db";

function makePreview(text: string | undefined, html: string | undefined): string {
  let src = text ?? "";
  if (!src && html) {
    // crude tag strip for the snippet only
    src = html.replace(/<[^>]+>/g, " ");
  }
  return src.replace(/\s+/g, " ").trim().slice(0, 140);
}

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const recipient = message.to.toLowerCase();

  // Only accept mail for an inbox that currently exists and is unexpired.
  const inbox = await getInboxByAddress(env, recipient);
  if (!inbox) {
    message.setReject("Recipient address does not exist");
    return;
  }
  if (inbox.expires_at < Date.now()) {
    message.setReject("Recipient address has expired");
    return;
  }

  const maxBytes = parseInt(env.MAX_MESSAGE_BYTES, 10) || 262144;
  if (message.rawSize > maxBytes) {
    message.setReject("Message too large");
    return;
  }

  // Read the raw stream into an ArrayBuffer for postal-mime.
  const reader = message.raw.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }

  let parsed: Email;
  try {
    parsed = await PostalMime.parse(buf);
  } catch {
    message.setReject("Could not parse message");
    return;
  }

  const fromAddr =
    parsed.from?.address ?? message.from ?? "unknown@unknown";
  const fromName = parsed.from?.name || null;
  const subject = parsed.subject ?? "(no subject)";
  const text = parsed.text ?? undefined;
  const html = parsed.html ?? undefined;

  const row: MessageRow = {
    id: newId(),
    inbox_id: inbox.id,
    from_addr: fromAddr,
    from_name: fromName,
    to_addr: recipient,
    subject,
    preview: makePreview(text, html),
    text_body: text ?? null,
    html_body: html ?? null,
    received_at: Date.now(),
    size_bytes: message.rawSize,
    seen: 0,
  };

  await insertMessage(env, row);

  // Enforce per-inbox capacity.
  const cap = parseInt(env.MAX_MESSAGES_PER_INBOX, 10) || 50;
  const count = await countMessages(env, inbox.id);
  if (count > cap) {
    await trimOldestMessages(env, inbox.id, cap);
  }
}
