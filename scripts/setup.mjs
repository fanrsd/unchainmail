#!/usr/bin/env node
// One-command setup for UnchainMail.
// Usage:
//   npm run setup -- yourdomain.com
//   npm run setup            (will prompt for the domain)
//
// Automates: auth check -> D1 create (or reuse) -> write database_id + domain
// into wrangler.jsonc -> apply migrations (remote) -> deploy.
// The only manual step left is enabling Email Routing in the dashboard.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DB_NAME = "unchainmail";
const CONFIG = "wrangler.jsonc";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function log(msg) {
  output.write(msg + "\n");
}

function step(n, msg) {
  log(`\n[${n}] ${msg}`);
}

// Run wrangler (or any cmd), inheriting stderr so the user sees progress.
// Returns { ok, stdout }.
function run(args, { capture = false } = {}) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    shell: true,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  return { ok: res.status === 0, stdout: res.stdout || "" };
}

async function ask(rl, question, fallback = "") {
  const answer = (await rl.question(question)).trim();
  return answer || fallback;
}

function readConfig() {
  if (!existsSync(CONFIG)) {
    log(`ERROR: ${CONFIG} not found. Run this from the project root.`);
    process.exit(1);
  }
  return readFileSync(CONFIG, "utf8");
}

// Surgical string replace so JSONC comments are preserved.
function patchConfig(databaseId, domain) {
  let text = readConfig();

  // Replace the database_id value (placeholder OR an existing uuid).
  text = text.replace(
    /("database_id"\s*:\s*")[^"]*(")/,
    `$1${databaseId}$2`,
  );

  // Replace the EMAIL_DOMAIN value.
  text = text.replace(
    /("EMAIL_DOMAIN"\s*:\s*")[^"]*(")/,
    `$1${domain}$2`,
  );

  writeFileSync(CONFIG, text);
}

// Find an existing D1 database id by name via `wrangler d1 list --json`.
function findExistingDbId() {
  const { ok, stdout } = run(["d1", "list", "--json"], { capture: true });
  if (!ok || !stdout) return null;
  try {
    const list = JSON.parse(stdout);
    const match = Array.isArray(list)
      ? list.find((d) => d.name === DB_NAME)
      : null;
    return match ? match.uuid || match.database_id || null : null;
  } catch {
    return null;
  }
}

// Create the D1 database (or reuse an existing one). Returns its id.
function ensureDatabase() {
  const create = run(["d1", "create", DB_NAME], { capture: true });
  if (create.ok) {
    const m = create.stdout.match(UUID_RE);
    if (m) return m[0];
    log("Created database but could not parse its id; looking it up…");
  } else {
    log("Database may already exist; looking up its id…");
  }

  const existing = findExistingDbId();
  if (existing) return existing;

  log(
    "ERROR: Could not create or find the D1 database. " +
      "Run `npx wrangler d1 create unchainmail` manually and re-run setup.",
  );
  process.exit(1);
}

async function main() {
  log("UnchainMail — one-command setup\n================================");

  // 1. Auth check.
  step(1, "Checking Cloudflare login…");
  const who = run(["whoami"], { capture: true });
  if (!who.ok) {
    log("You are not logged in. Run `npx wrangler login` first, then re-run.");
    process.exit(1);
  }
  log("Logged in.");

  // 2. Domain.
  const rl = createInterface({ input, output });
  let domain = process.argv[2] || "";
  if (!domain) {
    step(2, "Which domain will receive mail?");
    domain = await ask(rl, "Email domain (e.g. mail.example.com): ");
  } else {
    step(2, `Using domain: ${domain}`);
  }
  domain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain || !domain.includes(".")) {
    log("ERROR: A valid domain is required.");
    rl.close();
    process.exit(1);
  }
  rl.close();

  // 3. D1 database.
  step(3, "Creating / locating D1 database…");
  const dbId = ensureDatabase();
  log(`Database id: ${dbId}`);

  // 4. Patch config.
  step(4, "Writing database id and domain into wrangler.jsonc…");
  patchConfig(dbId, domain);
  log("Config updated.");

  // 5. Migrations.
  step(5, "Applying database migrations (remote)…");
  const mig = run(["d1", "migrations", "apply", DB_NAME, "--remote"]);
  if (!mig.ok) {
    log("ERROR: Migration failed. Fix the issue above and re-run setup.");
    process.exit(1);
  }

  // 6. Deploy.
  step(6, "Deploying the Worker…");
  const dep = run(["deploy"]);
  if (!dep.ok) {
    log("ERROR: Deploy failed. See the output above.");
    process.exit(1);
  }

  // 7. Manual step.
  log("\n================================");
  log("Done. One manual step remains (Cloudflare dashboard):");
  log(`  1. Open your domain → Email → Email Routing → Enable.`);
  log(`  2. Routing rules → set the catch-all action to`);
  log(`     "Send to a Worker" → choose "unchainmail".`);
  log(`\nThen visit your Worker URL and an inbox at @${domain} is live.`);
}

main().catch((err) => {
  log("Unexpected error: " + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
