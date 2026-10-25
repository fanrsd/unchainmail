// UnchainMail Worker entry point.
// A single Worker exports three handlers:
//   - fetch:     serves the API (/api/*) and static UI (everything else)
//   - email:     receives inbound mail via Cloudflare Email Routing
//   - scheduled: cron purge of expired inboxes/messages
import type { Env } from "./types";
import api from "./api";
import { handleEmail } from "./email";
import { purgeExpired } from "./lib/db";

// Security + privacy headers applied to every response.
function withSecurityHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", "interest-cohort=(), browsing-topics=()");
  h.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // message HTML is rendered inside a sandboxed iframe, not here
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const res = await api.fetch(request, env, ctx);
      return withSecurityHeaders(res);
    }

    // Delegate everything else to the static assets binding.
    const res = await env.ASSETS.fetch(request);
    return withSecurityHeaders(res);
  },

  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await handleEmail(message, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(purgeExpired(env, Date.now()).then(() => undefined));
  },
};
