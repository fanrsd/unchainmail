/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EMAIL_DOMAIN: string;
  INBOX_TTL_MINUTES: string;
  MAX_MESSAGES_PER_INBOX: string;
  MAX_MESSAGE_BYTES: string;
}

export interface InboxRow {
  id: string;
  address: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
}

export interface MessageRow {
  id: string;
  inbox_id: string;
  from_addr: string;
  from_name: string | null;
  to_addr: string | null;
  subject: string | null;
  preview: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: number;
  size_bytes: number;
  seen: number;
}
