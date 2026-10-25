-- UnchainMail D1 schema
-- Privacy note: we store NO IP addresses, NO user agents, NO tracking data.

CREATE TABLE IF NOT EXISTS inboxes (
  id            TEXT PRIMARY KEY,        -- random public id (used in URLs)
  address       TEXT NOT NULL UNIQUE,    -- full email address, lowercased
  token_hash    TEXT NOT NULL,           -- SHA-256 of the access token (never store raw)
  created_at    INTEGER NOT NULL,        -- unix ms
  expires_at    INTEGER NOT NULL         -- unix ms; row purged after this
);

CREATE INDEX IF NOT EXISTS idx_inboxes_address ON inboxes(address);
CREATE INDEX IF NOT EXISTS idx_inboxes_expires ON inboxes(expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,        -- random public id
  inbox_id      TEXT NOT NULL,
  from_addr     TEXT NOT NULL,
  from_name     TEXT,
  to_addr       TEXT,
  subject       TEXT,
  preview       TEXT,                    -- short snippet for the list view
  text_body     TEXT,
  html_body     TEXT,
  received_at   INTEGER NOT NULL,        -- unix ms
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  seen          INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (inbox_id) REFERENCES inboxes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_id, received_at DESC);
