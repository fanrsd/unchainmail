// JSON API built on Hono. Inbox access is gated by a bearer token whose
// SHA-256 hash is stored server-side. No IPs, cookies, or analytics.
import { Hono, type Context, type Next } from "hono";
import type { Env } from "./types";
import {
  newId,
  newLocalPart,
  newToken,
  sha256Hex,
  timingSafeEqual,
} from "./lib/id";
import {
  createInbox,
  getInboxById,
  getInboxByAddress,
  extendInbox,
  deleteInbox,
  listMessages,
  getMessage,
  markSeen,
  deleteMessage,
} from "./lib/db";

type Vars = { inboxId: string };
const api = new Hono<{ Bindings: Env; Variables: Vars }>();

function ttlMs(env: Env): number {
  const mins = parseInt(env.INBOX_TTL_MINUTES, 10) || 60;
  return mins * 60 * 1000;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Auth middleware for routes under /api/inboxes/:id
type AppContext = Context<{ Bindings: Env; Variables: Vars }>;

async function requireToken(c: AppContext, next: Next) {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  const inbox = await getInboxById(c.env, id);
  if (!inbox) return c.json({ error: "not_found" }, 404);
  if (inbox.expires_at < Date.now()) return c.json({ error: "expired" }, 410);

  const token = bearer(c.req.raw);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const hash = await sha256Hex(token);
  if (!timingSafeEqual(hash, inbox.token_hash)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("inboxId", id);
  await next();
}

// Create a fresh inbox. Optionally accept a desired local part (sanitized).
api.post("/api/inboxes", async (c) => {
  let desired: string | null = null;
  try {
    const body = (await c.req.json()) as { localPart?: string };
    if (body && typeof body.localPart === "string") {
      const clean = body.localPart.toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (clean.length >= 3 && clean.length <= 32) desired = clean;
    }
  } catch {
    // no body / invalid JSON is fine — we generate a random address
  }

  const domain = c.env.EMAIL_DOMAIN;
  const now = Date.now();
  const expiresAt = now + ttlMs(c.env);
  const token = newToken();
  const tokenHash = await sha256Hex(token);

  // Try a few times to avoid collisions on the unique address.
  let address = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const local = desired && attempt === 0 ? desired : newLocalPart();
    const candidate = `${local}@${domain}`.toLowerCase();
    const existing = await getInboxByAddress(c.env, candidate);
    if (!existing) {
      address = candidate;
      break;
    }
    desired = null; // fall back to random on collision
  }
  if (!address) return c.json({ error: "try_again" }, 503);

  const id = newId();
  await createInbox(c.env, {
    id,
    address,
    token_hash: tokenHash,
    created_at: now,
    expires_at: expiresAt,
  });

  return c.json({
    id,
    address,
    token, // returned ONCE; client stores it in localStorage
    createdAt: now,
    expiresAt,
    ttlMinutes: parseInt(c.env.INBOX_TTL_MINUTES, 10) || 60,
  });
});

// Inbox metadata (also used to poll remaining TTL).
api.get("/api/inboxes/:id", requireToken, async (c) => {
  const inbox = await getInboxById(c.env, c.get("inboxId"));
  if (!inbox) return c.json({ error: "not_found" }, 404);
  return c.json({
    id: inbox.id,
    address: inbox.address,
    createdAt: inbox.created_at,
    expiresAt: inbox.expires_at,
  });
});

// Extend the inbox lifetime by one TTL window from now.
api.post("/api/inboxes/:id/extend", requireToken, async (c) => {
  const expiresAt = Date.now() + ttlMs(c.env);
  await extendInbox(c.env, c.get("inboxId"), expiresAt);
  return c.json({ expiresAt });
});

// Destroy the inbox and all its mail immediately.
api.delete("/api/inboxes/:id", requireToken, async (c) => {
  await deleteInbox(c.env, c.get("inboxId"));
  return c.json({ ok: true });
});

// List messages (no bodies).
api.get("/api/inboxes/:id/messages", requireToken, async (c) => {
  const rows = await listMessages(c.env, c.get("inboxId"));
  return c.json({ messages: rows });
});

// Read a single message (marks it seen).
api.get("/api/inboxes/:id/messages/:mid", requireToken, async (c) => {
  const inboxId = c.get("inboxId");
  const mid = c.req.param("mid");
  if (!mid) return c.json({ error: "not_found" }, 404);
  const msg = await getMessage(c.env, inboxId, mid);
  if (!msg) return c.json({ error: "not_found" }, 404);
  await markSeen(c.env, inboxId, mid);
  return c.json({ message: msg });
});

// Delete a single message.
api.delete("/api/inboxes/:id/messages/:mid", requireToken, async (c) => {
  const mid = c.req.param("mid");
  if (!mid) return c.json({ error: "not_found" }, 404);
  await deleteMessage(c.env, c.get("inboxId"), mid);
  return c.json({ ok: true });
});

api.get("/api/config", (c) =>
  c.json({
    domain: c.env.EMAIL_DOMAIN,
    ttlMinutes: parseInt(c.env.INBOX_TTL_MINUTES, 10) || 60,
  }),
);

export default api;
