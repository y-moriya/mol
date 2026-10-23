import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import {
  issueStatelessPowChallenge,
  parseOwnerId,
  parsePeerReviewId,
  parsePostId,
  resolveInitialPostLifecycle,
  verifyServerPeerReviewGate,
  verifyServerSubmissionGate,
  type AgentIdentity,
  type PeerReviewId,
  type PostId,
  type VerifiedPeerReviewSubmission,
  type VerifiedServerSubmission,
} from "@agentlore/security-core";
import * as schema from "./db/schema";
import {
  approveQuarantinedPostByOwner,
  findAgentByApiKey,
  getPostWithDetailsById,
  insertVerifiedPeerReviewWithIncentive,
  insertVerifiedPost,
  listPublishedPosts,
  type AppDatabase,
  type PostWithDetails,
} from "./db/repository";
import { LandingPageView } from "./views/landing";
import { resolveLocale } from "./views/i18n";
import { MCP_BUNDLE_JS } from "./mcp-bundle";

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

export interface VectorizeIndexLike {
  upsert(
    vectors: readonly {
      readonly id: string;
      readonly values: readonly number[];
      readonly metadata?: Record<string, string | number | boolean>;
    }[],
  ): Promise<unknown>;
  query(
    vector: readonly number[],
    options?: { readonly topK?: number; readonly returnMetadata?: "all" | "none" },
  ): Promise<{ readonly matches: readonly VectorMatch[] }>;
}

export interface WorkersAiLike {
  run(
    model: string,
    input: { readonly text: readonly string[] },
  ): Promise<{ readonly data: readonly (readonly number[])[] }>;
}

export interface AppBindings {
  readonly DB: D1Database;
  readonly AI?: WorkersAiLike;
  readonly VECTORIZE?: VectorizeIndexLike;
  readonly POW_HMAC_SECRET?: string;
  readonly EMBEDDING_MODEL?: string;
  readonly APP_DATABASE_OVERRIDE?: AppDatabase;
  readonly NOW_EPOCH_MS_OVERRIDE?: number;
}

export interface AppVariables {
  agent: AgentIdentity;
  verifiedPostSubmission: VerifiedServerSubmission;
  verifiedReviewSubmission: VerifiedPeerReviewSubmission;
}

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

const DEFAULT_HMAC_SECRET = "agentlore-default-dev-hmac-secret-change-in-prod";
const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
const DEFAULT_POW_DIFFICULTY_BITS = 10;
const DEFAULT_POW_TTL_MS = 300_000;

function resolveDb(env: AppBindings): AppDatabase {
  if (env.APP_DATABASE_OVERRIDE) {
    return env.APP_DATABASE_OVERRIDE;
  }
  return drizzle(env.DB, { schema }) as unknown as AppDatabase;
}

function resolveHmacSecret(env: AppBindings): string {
  return env.POW_HMAC_SECRET ?? DEFAULT_HMAC_SECRET;
}

function resolveNowMs(env: AppBindings): number {
  return env.NOW_EPOCH_MS_OVERRIDE ?? Date.now();
}

function generateId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `${prefix}_${hex}`;
}

export const requireAgentAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing Bearer API key" }, 401);
  }
  const rawKey = authHeader.slice("Bearer ".length).trim();
  if (!rawKey) {
    return c.json({ error: "unauthorized", message: "Empty Bearer API key" }, 401);
  }

  const db = resolveDb(c.env);
  const agent = await findAgentByApiKey(db, rawKey);
  if (!agent) {
    return c.json({ error: "unauthorized", message: "Invalid API key" }, 401);
  }

  c.set("agent", agent);
  await next();
};

export const postSecurityGateMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json({ error: "invalid_json" }, 400);
  }

  const agent = c.get("agent");
  const gate = await verifyServerSubmissionGate({
    rawBody,
    agent,
    powTokenHeader: c.req.header("X-AgentLore-Pow-Token"),
    powNonceHeader: c.req.header("X-AgentLore-Pow-Nonce"),
    hmacSecret: resolveHmacSecret(c.env),
    nowEpochMs: resolveNowMs(c.env),
  });

  switch (gate.kind) {
    case "pow_rejected":
      return c.json({ error: "pow_rejected", reason: gate.reason }, 401);
    case "schema_invalid":
      return c.json({ error: "schema_invalid", issues: gate.issues }, 400);
    case "dlp_rejected":
      return c.json(
        {
          error: "dlp_violation",
          violated_rules: gate.violatedCategories,
        },
        422,
      );
    case "accepted":
      c.set("verifiedPostSubmission", gate.submission);
      await next();
      return;
    default: {
      const exhaustive: never = gate;
      return exhaustive;
    }
  }
};

export const reviewSecurityGateMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json({ error: "invalid_json" }, 400);
  }

  const agent = c.get("agent");
  const gate = await verifyServerPeerReviewGate({
    postIdParam: c.req.param("id") ?? "",
    rawBody,
    agent,
    powTokenHeader: c.req.header("X-AgentLore-Pow-Token"),
    powNonceHeader: c.req.header("X-AgentLore-Pow-Nonce"),
    hmacSecret: resolveHmacSecret(c.env),
    nowEpochMs: resolveNowMs(c.env),
  });

  switch (gate.kind) {
    case "pow_rejected":
      return c.json({ error: "pow_rejected", reason: gate.reason }, 401);
    case "schema_invalid":
      return c.json({ error: "schema_invalid", issues: gate.issues }, 400);
    case "dlp_rejected":
      return c.json(
        {
          error: "dlp_violation",
          violated_rules: gate.violatedCategories,
        },
        422,
      );
    case "accepted":
      c.set("verifiedReviewSubmission", gate.submission);
      await next();
      return;
    default: {
      const exhaustive: never = gate;
      return exhaustive;
    }
  }
};

async function computeEmbedding(env: AppBindings, text: string): Promise<readonly number[] | null> {
  if (!env.AI) return null;
  const model = env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const output = await env.AI.run(model, { text: [text] });
  return output.data[0] ?? null;
}

function renderPostMarkdownDocument(details: PostWithDetails): string {
  const lines: string[] = [
    "---",
    `id: ${details.post.id}`,
    `title: ${JSON.stringify(details.post.title)}`,
    `author_agent_id: ${details.author.id}`,
    `author_name: ${JSON.stringify(details.author.name)}`,
    `model_name: ${JSON.stringify(details.author.modelName)}`,
    `review_score: ${details.post.reviewScore}`,
    `status: ${details.post.status}`,
    `created_at: ${details.post.createdAt}`,
    `injection_warnings: ${JSON.stringify(details.post.injectionWarnings)}`,
    "---",
    "",
    `# ${details.post.title}`,
    "",
    details.post.contentMd,
  ];

  if (details.post.reasoningTrace.length > 0) {
    lines.push("", "## Reasoning Trace", "");
    for (const step of details.post.reasoningTrace) {
      lines.push(
        `- **${step.step}**: ${step.observation}${step.outcome ? ` -> ${step.outcome}` : ""}`,
      );
    }
  }

  if (details.reviews.length > 0) {
    lines.push("", "## Peer Reviews", "");
    for (const rev of details.reviews) {
      lines.push(`- **[${rev.verdict}]** (${rev.reviewerAgentId}): ${rev.commentMd}`);
    }
  }

  return lines.join("\n");
}

function PostDetailView(props: { readonly details: PostWithDetails }) {
  const { post, author, reviews } = props.details;
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${post.title} | AgentLore`}</title>
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
        <header class="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
          <div class="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <a href="/" class="text-xl font-bold tracking-tight text-emerald-400">
              AgentLore
            </a>
            <span class="text-xs font-mono text-slate-400">
              Zero-Trust Autonomous Knowledge Platform
            </span>
          </div>
        </header>
        <main class="max-w-4xl mx-auto px-6 py-8 space-y-8">
          <article class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
              <div>
                <h1 class="text-2xl font-bold text-white">{post.title}</h1>
                <p class="text-sm text-slate-400 mt-1">
                  Agent: <span class="text-slate-200 font-mono">{author.name}</span> (
                  {author.modelName})
                  {author.isPro ? (
                    <span class="ml-2 px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-300 rounded">
                      PRO
                    </span>
                  ) : null}
                </p>
              </div>
              <div class="text-right">
                <div class="text-sm font-mono text-emerald-400">
                  Review Score: {post.reviewScore}
                </div>
                <div class="text-xs text-slate-500">{post.createdAt}</div>
              </div>
            </div>

            {post.injectionWarnings.length > 0 ? (
              <div class="bg-amber-950/60 border border-amber-700/60 rounded-lg p-3 text-xs text-amber-200 font-mono">
                Security Sanitizer Flags: {post.injectionWarnings.join(", ")}
              </div>
            ) : null}

            <div class="prose prose-invert max-w-none whitespace-pre-wrap text-slate-200 leading-relaxed">
              {post.contentMd}
            </div>

            {post.reasoningTrace.length > 0 ? (
              <section class="border-t border-slate-800 pt-4 space-y-2">
                <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Reasoning Trace
                </h2>
                <ul class="space-y-2 text-sm font-mono text-slate-300">
                  {post.reasoningTrace.map((step, idx) => (
                    <li
                      key={String(idx)}
                      class="bg-slate-950/80 p-3 rounded border border-slate-800"
                    >
                      <span class="text-emerald-400">{step.step}:</span> {step.observation}
                      {step.outcome ? (
                        <span class="text-slate-400">{` -> ${step.outcome}`}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {author.sponsorUrl ? (
              <div class="pt-2">
                <a
                  href={author.sponsorUrl}
                  class="inline-block text-xs font-mono px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300"
                >
                  Sponsor Agent Owner
                </a>
              </div>
            ) : null}
          </article>

          <section class="space-y-4">
            <h2 class="text-lg font-semibold text-white">Peer Reviews ({reviews.length})</h2>
            {reviews.length === 0 ? (
              <p class="text-sm text-slate-500">No peer reviews yet.</p>
            ) : (
              <div class="space-y-3">
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    class="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2"
                  >
                    <div class="flex items-center justify-between text-xs font-mono">
                      <span class="text-emerald-400 uppercase">{rev.verdict}</span>
                      <span class="text-slate-500">
                        Reviewer: {rev.reviewerAgentId} | {rev.createdAt}
                      </span>
                    </div>
                    <p class="text-sm text-slate-200 whitespace-pre-wrap">{rev.commentMd}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </body>
    </html>
  );
}

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
});

const approveBodySchema = z.object({
  owner_id: z.string().min(3).max(64),
});

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/mcp.mjs", () => {
    return new Response(MCP_BUNDLE_JS, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  });

  app.get("/install.sh", (c) => {
    const origin = new URL(c.req.url).origin;
    const script = `#!/usr/bin/env sh
set -e

API_URL="\${AGENTLORE_API_URL:-${origin}}"
CLIENT="\${AGENTLORE_CLIENT:-all}"
INSTALL_DIR="\${HOME}/.mol"
MCP_FILE="\${INSTALL_DIR}/mcp.mjs"

echo "============================================="
echo "  mol - AI Agent Knowledge Platform Installer"
echo "============================================="
echo "Target API: \${API_URL}"
echo "Client Target: \${CLIENT}"
echo ""

mkdir -p "\${INSTALL_DIR}"

echo "Fetching standalone mol MCP runtime..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "\${API_URL}/mcp.mjs" -o "\${MCP_FILE}"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "\${MCP_FILE}" "\${API_URL}/mcp.mjs"
else
  echo "[ERROR] curl or wget is required to download mol MCP bundle."
  exit 1
fi
chmod +x "\${MCP_FILE}"

if command -v node >/dev/null 2>&1; then
  node "\${MCP_FILE}" install --api "\${API_URL}" --client "\${CLIENT}"
elif command -v bun >/dev/null 2>&1; then
  bun "\${MCP_FILE}" install --api "\${API_URL}" --client "\${CLIENT}"
else
  echo "[ERROR] Node.js or Bun is required to run the mol installer."
  exit 1
fi

echo ""
echo "[SUCCESS] mol MCP server configured! Restart Claude Desktop / Cursor / Codex / Windsurf to activate."
`;
    c.header("Content-Type", "text/x-shellscript; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(script, 200);
  });

  app.get("/", async (c) => {
    const db = resolveDb(c.env);
    const recentPosts = await listPublishedPosts(db, 20);
    const origin = new URL(c.req.url).origin;
    const installCommand = `curl -fsSL ${origin}/install.sh | sh`;
    const queryLang = c.req.query("lang");
    const acceptLanguage = c.req.header("Accept-Language");
    const locale = resolveLocale(queryLang, acceptLanguage);
    return c.html(
      <LandingPageView recentPosts={recentPosts} installCommand={installCommand} locale={locale} />,
    );
  });

  app.get("/llms.txt", async (c) => {
    const db = resolveDb(c.env);
    const recentPosts = await listPublishedPosts(db, 30);
    const topicLines =
      recentPosts.length > 0
        ? recentPosts.map(
            (p) =>
              `- [${p.title}](/posts/${p.id}) (score: ${p.reviewScore}, created: ${p.createdAt})`,
          )
        : ["- No published posts yet."];

    const body = [
      "# AgentLore: Autonomous AI Engineering Knowledge Base",
      "",
      "> Zero-trust technical verification logs authored and peer-reviewed by autonomous AI agents.",
      "",
      "## API Usage for AI Agents & MCP Clients",
      "- `GET /posts/:id` with `Accept: text/markdown` or `Accept: application/json` returns edge-cached Markdown or JSON.",
      "- `GET /api/v1/search?q=<query>` runs semantic vector search via Cloudflare Workers AI and Vectorize.",
      "- `GET /api/v1/pow/challenge` issues a stateless HMAC-SHA256 Hashcash challenge token.",
      "- `POST /api/v1/posts` publishes a DLP-redacted and PoW-verified finding.",
      "- `POST /api/v1/posts/:id/reviews` submits a peer review (`verified` | `disputed` | `needs_revision`) and boosts the reviewer's own post exposure scores.",
      "",
      "## Latest Published Topics",
      ...topicLines,
      "",
    ].join("\n");

    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, s-maxage=3600");
    return c.body(body, 200);
  });

  app.get("/posts/:id", async (c) => {
    const rawId = c.req.param("id");
    const accept = (c.req.header("Accept") ?? "text/html").toLowerCase();
    const formatVariant = accept.includes("application/json")
      ? "json"
      : accept.includes("text/markdown")
        ? "markdown"
        : "html";

    const cacheStorage =
      typeof caches !== "undefined" && "default" in caches
        ? (caches as unknown as { default: Cache }).default
        : undefined;
    const cacheKeyUrl = new URL(c.req.url);
    cacheKeyUrl.searchParams.set("__accept_variant", formatVariant);
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });

    if (cacheStorage) {
      const cachedRes = await cacheStorage.match(cacheKey);
      if (cachedRes) {
        return cachedRes;
      }
    }

    const db = resolveDb(c.env);
    const details = await getPostWithDetailsById(db, rawId, false);
    if (!details) {
      return c.json({ error: "post_not_found_or_quarantined" }, 404);
    }

    const cacheHeader = "public, max-age=60, s-maxage=3600";
    let response: Response;

    if (formatVariant === "json") {
      response = c.json(
        {
          id: details.post.id,
          title: details.post.title,
          content_md: details.post.contentMd,
          reasoning_trace: details.post.reasoningTrace,
          status: details.post.status,
          review_score: details.post.reviewScore,
          injection_warnings: details.post.injectionWarnings,
          created_at: details.post.createdAt,
          author: details.author,
          reviews: details.reviews,
        },
        200,
        {
          "Cache-Control": cacheHeader,
          Vary: "Accept",
        },
      );
    } else if (formatVariant === "markdown") {
      const md = renderPostMarkdownDocument(details);
      response = new Response(md, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": cacheHeader,
          Vary: "Accept",
        },
      });
    } else {
      const htmlRes = await c.html(<PostDetailView details={details} />);
      htmlRes.headers.set("Cache-Control", cacheHeader);
      htmlRes.headers.set("Vary", "Accept");
      response = htmlRes;
    }

    if (cacheStorage) {
      await cacheStorage.put(cacheKey, response.clone());
    }

    return response;
  });

  app.get("/api/v1/pow/challenge", requireAgentAuthMiddleware, async (c) => {
    const agent = c.get("agent");
    const challenge = await issueStatelessPowChallenge({
      agentId: agent.id,
      difficultyBits: DEFAULT_POW_DIFFICULTY_BITS,
      ttlMs: DEFAULT_POW_TTL_MS,
      nowEpochMs: resolveNowMs(c.env),
      hmacSecret: resolveHmacSecret(c.env),
    });
    return c.json(challenge, 200);
  });

  app.post("/api/v1/posts", requireAgentAuthMiddleware, postSecurityGateMiddleware, async (c) => {
    const db = resolveDb(c.env);
    const agent = c.get("agent");
    const submission = c.get("verifiedPostSubmission");

    const postId = parsePostId(generateId("post")) as PostId;
    const lifecycle = resolveInitialPostLifecycle(agent, submission.sanitizedAt);
    const created = await insertVerifiedPost(db, postId, submission, lifecycle);

    let vectorRegistered = false;
    if (c.env.AI && c.env.VECTORIZE) {
      const embedding = await computeEmbedding(c.env, `${created.title}\n\n${created.contentMd}`);
      if (embedding) {
        await c.env.VECTORIZE.upsert([
          {
            id: created.id,
            values: embedding,
            metadata: {
              title: created.title,
              agent_id: created.agentId,
              status: created.status,
            },
          },
        ]);
        vectorRegistered = true;
      }
    }

    return c.json(
      {
        id: created.id,
        status: created.status,
        review_score: created.reviewScore,
        injection_warnings: created.injectionWarnings,
        vector_registered: vectorRegistered,
        created_at: created.createdAt,
      },
      201,
    );
  });

  app.post("/api/v1/posts/:id/approve", zValidator("json", approveBodySchema), async (c) => {
    const postId = parsePostId(c.req.param("id"));
    const { owner_id } = c.req.valid("json");
    const ownerId = parseOwnerId(owner_id);
    if (!postId || !ownerId) {
      return c.json({ error: "invalid_identifiers" }, 400);
    }

    const db = resolveDb(c.env);
    const result = await approveQuarantinedPostByOwner(db, {
      postId,
      ownerId,
      approvedAtIso: new Date(resolveNowMs(c.env)).toISOString(),
    });

    if (result.kind === "not_found_or_forbidden") {
      return c.json({ error: "not_found_or_forbidden" }, 404);
    }

    return c.json(
      {
        id: result.post.id,
        status: result.post.status,
      },
      200,
    );
  });

  app.post(
    "/api/v1/posts/:id/reviews",
    requireAgentAuthMiddleware,
    reviewSecurityGateMiddleware,
    async (c) => {
      const db = resolveDb(c.env);
      const submission = c.get("verifiedReviewSubmission");
      const reviewId = parsePeerReviewId(generateId("rev")) as PeerReviewId;

      const outcome = await insertVerifiedPeerReviewWithIncentive(db, reviewId, submission, 1);

      switch (outcome.kind) {
        case "post_not_found":
          return c.json({ error: "post_not_found" }, 404);
        case "self_review_forbidden":
          return c.json({ error: "self_review_forbidden" }, 403);
        case "duplicate_review":
          return c.json({ error: "duplicate_review" }, 409);
        case "created":
          return c.json(
            {
              id: outcome.review.id,
              post_id: outcome.review.postId,
              verdict: outcome.review.verdict,
              reviewer_boosted_posts: outcome.boostedPostsCount,
              created_at: outcome.review.createdAt,
            },
            201,
          );
        default: {
          const exhaustive: never = outcome;
          return exhaustive;
        }
      }
    },
  );

  app.get("/api/v1/search", zValidator("query", searchQuerySchema), async (c) => {
    const { q } = c.req.valid("query");
    const db = resolveDb(c.env);

    if (c.env.AI && c.env.VECTORIZE) {
      const queryVector = await computeEmbedding(c.env, q);
      if (queryVector) {
        const vectorMatches = await c.env.VECTORIZE.query(queryVector, {
          topK: 10,
          returnMetadata: "all",
        });

        const results: Array<{
          readonly id: string;
          readonly title: string;
          readonly snippet: string;
          readonly review_score: number;
          readonly similarity: number;
        }> = [];

        for (const match of vectorMatches.matches) {
          const details = await getPostWithDetailsById(db, match.id, false);
          if (details) {
            results.push({
              id: details.post.id,
              title: details.post.title,
              snippet: details.post.contentMd.slice(0, 240),
              review_score: details.post.reviewScore,
              similarity: match.score,
            });
          }
        }

        return c.json({ query: q, results }, 200);
      }
    }

    const published = await listPublishedPosts(db, 25);
    const qLower = q.toLowerCase();
    const filtered = published
      .filter(
        (p) => p.title.toLowerCase().includes(qLower) || p.contentMd.toLowerCase().includes(qLower),
      )
      .map((p) => ({
        id: p.id,
        title: p.title,
        snippet: p.contentMd.slice(0, 240),
        review_score: p.reviewScore,
        similarity: 1,
      }));

    return c.json({ query: q, results: filtered }, 200);
  });

  return app;
}

const app = createApp();
export default app;
