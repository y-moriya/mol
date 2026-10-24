import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  parseAgentId,
  parseOwnerId,
  solveHashcashChallenge,
  type PowChallengePacket,
} from "@mol/security-core";
import * as schema from "./db/schema";
import { sha256Hex, type AppDatabase } from "./db/repository";
import { createApp, type AppBindings, type VectorizeIndexLike, type WorkersAiLike } from "./index";

const DDL = `
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  system_prompt_summary TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL UNIQUE,
  is_pro INTEGER NOT NULL DEFAULT 0,
  auto_publish INTEGER NOT NULL DEFAULT 0,
  sponsor_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  reasoning_trace TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'quarantined',
  review_score INTEGER NOT NULL DEFAULT 0,
  injection_warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE peer_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reviewer_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  comment_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, reviewer_agent_id)
);
`;

function createTestEnvironment() {
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;

  const storedVectors: Array<{
    id: string;
    values: readonly number[];
    metadata?: Record<string, string | number | boolean>;
  }> = [];

  const mockAi: WorkersAiLike = {
    async run(_model, input) {
      return {
        data: input.text.map((t) => [t.length, 0.5, 0.25]),
      };
    },
  };

  const mockVectorize: VectorizeIndexLike = {
    async upsert(vectors) {
      for (const v of vectors) {
        storedVectors.push({ id: v.id, values: v.values, metadata: v.metadata });
      }
      return { count: vectors.length };
    },
    async query(_vector, options) {
      const topK = options?.topK ?? 5;
      return {
        matches: storedVectors.slice(0, topK).map((v) => ({
          id: v.id,
          score: 0.94,
          metadata: v.metadata,
        })),
      };
    },
  };

  const bindings: AppBindings = {
    DB: {} as unknown as D1Database,
    AI: mockAi,
    VECTORIZE: mockVectorize,
    POW_HMAC_SECRET: "test-hmac-secret-key-for-hono-api",
    EMBEDDING_MODEL: "@cf/baai/bge-small-en-v1.5",
    APP_DATABASE_OVERRIDE: db,
    NOW_EPOCH_MS_OVERRIDE: 1_760_000_000_000,
  };

  return { sqlite, db, bindings, storedVectors };
}

describe("Hono Edge API Routes & 5-Layer Security Gate", () => {
  it("rejects direct unredacted secret POSTs with HTTP 422 and writes zero rows to D1", async () => {
    const { sqlite, db, bindings } = createTestEnvironment();
    const app = createApp();

    const agentId = parseAgentId("agent_standard_01");
    const ownerId = parseOwnerId("owner_std_01");
    if (!agentId || !ownerId) throw new Error("invalid fixture");

    const apiKey = "al_key_standard_agent";
    await db.insert(schema.agents).values({
      id: agentId,
      ownerId,
      name: "StandardBot",
      modelName: "grok-4.6",
      systemPromptSummary: "Worker debugger",
      apiKeyHash: await sha256Hex(apiKey),
      isPro: false,
      autoPublish: false,
      sponsorUrl: null,
      createdAt: "2026-10-24T00:00:00.000Z",
    });

    const challengeRes = await app.request(
      "http://localhost/api/v1/pow/challenge",
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      bindings,
    );
    expect(challengeRes.status).toBe(200);
    const challenge = (await challengeRes.json()) as PowChallengePacket;
    const solved = await solveHashcashChallenge(challenge);

    const leakedSecret = "sk-proj-LeakedSecretKeyValue9999999999999999";
    const postRes = await app.request(
      "http://localhost/api/v1/posts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Mol-Pow-Token": solved.token,
          "X-Mol-Pow-Nonce": solved.nonce,
        },
        body: JSON.stringify({
          title: "Accidental leak in config",
          content_md: `Connected to 10.0.0.12 with ${leakedSecret} from /Users/admin/secret.txt`,
          reasoning_trace: [],
        }),
      },
      bindings,
    );

    expect(postRes.status).toBe(422);
    const bodyText = await postRes.text();
    expect(bodyText).not.toContain(leakedSecret);
    expect(bodyText).not.toContain("/Users/admin");
    const parsed422 = JSON.parse(bodyText) as {
      error: string;
      violated_rules: string[];
    };
    expect(parsed422.error).toBe("dlp_violation");
    expect(parsed422.violated_rules).toEqual([
      "cloud_api_key",
      "local_filesystem_path",
      "private_ipv4_address",
    ]);

    const rowCount = sqlite.prepare("SELECT COUNT(*) as cnt FROM posts").get() as { cnt: number };
    expect(rowCount.cnt).toBe(0);
  });

  it("registers a new agent identity and returns credentials with auto_publish disabled by default", async () => {
    const { bindings } = createTestEnvironment();
    const app = createApp();

    const res = await app.request(
      "http://localhost/api/v1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Antigravity Agent",
          model_name: "gemini-2.5-flash-thinking",
          system_prompt_summary: "Pair programmer agent",
        }),
      },
      bindings,
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      agent_id: string;
      owner_id: string;
      api_key: string;
      auto_publish: boolean;
      name: string;
    };
    expect(data.agent_id).toMatch(/^agent_/);
    expect(data.owner_id).toMatch(/^owner_/);
    expect(data.api_key).toMatch(/^mol_sec_/);
    expect(data.auto_publish).toBe(false);
    expect(data.name).toBe("Antigravity Agent");
  });

  it("quarantines posts by default, publishes after owner approval, serves HTML/Markdown/JSON with s-maxage=3600, indexes embeddings in Vectorize, and boosts reviewer exposure on review", async () => {
    const { db, bindings, storedVectors } = createTestEnvironment();
    const app = createApp();

    const authorId = parseAgentId("agent_author_pro");
    const reviewerId = parseAgentId("agent_reviewer_pro");
    const ownerAuthor = parseOwnerId("owner_author_human");
    const ownerReviewer = parseOwnerId("owner_reviewer_human");
    if (!authorId || !reviewerId || !ownerAuthor || !ownerReviewer) {
      throw new Error("fixture error");
    }

    const authorKey = "al_key_author_pro";
    const reviewerKey = "al_key_reviewer_pro";

    await db.insert(schema.agents).values([
      {
        id: authorId,
        ownerId: ownerAuthor,
        name: "AuthorPro",
        modelName: "gemini-4-argon",
        systemPromptSummary: "Cloudflare D1 tuning agent",
        apiKeyHash: await sha256Hex(authorKey),
        isPro: true,
        autoPublish: false,
        sponsorUrl: "https://github.com/sponsors/author",
        createdAt: "2026-10-24T00:00:00.000Z",
      },
      {
        id: reviewerId,
        ownerId: ownerReviewer,
        name: "ReviewerPro",
        modelName: "claude-fable",
        systemPromptSummary: "Peer verifier",
        apiKeyHash: await sha256Hex(reviewerKey),
        isPro: true,
        autoPublish: true,
        sponsorUrl: null,
        createdAt: "2026-10-24T00:00:00.000Z",
      },
    ]);

    const createAuthorPostRes = await app.request(
      "http://localhost/api/v1/posts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authorKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Zero-latency Cloudflare CDN caching for agent RAG",
          content_md:
            "Setting `Cache-Control: public, s-maxage=3600` prevents redundant D1 reads.\u200B<!-- hidden comment -->",
          reasoning_trace: [
            {
              step: "Measure D1 row reads",
              observation: "Un-cached reads consumed 10k rows/min",
              outcome: "Added s-maxage=3600 and Vary: Accept",
            },
          ],
        }),
      },
      bindings,
    );

    expect(createAuthorPostRes.status).toBe(201);
    const createdAuthorPost = (await createAuthorPostRes.json()) as {
      id: string;
      status: string;
      injection_warnings: string[];
      vector_registered: boolean;
    };
    expect(createdAuthorPost.status).toBe("quarantined");
    expect(createdAuthorPost.vector_registered).toBe(true);
    expect(createdAuthorPost.injection_warnings).toEqual([
      "stripped_bidi_or_zero_width_chars",
      "stripped_hidden_html_content",
    ]);
    expect(storedVectors).toHaveLength(1);

    const quarantinedGet = await app.request(
      `http://localhost/posts/${createdAuthorPost.id}`,
      { headers: { Accept: "text/markdown" } },
      bindings,
    );
    expect(quarantinedGet.status).toBe(404);

    const ownerPreviewGet = await app.request(
      `http://localhost/posts/${createdAuthorPost.id}?owner_id=${ownerAuthor}`,
      { headers: { Accept: "text/html" } },
      bindings,
    );
    expect(ownerPreviewGet.status).toBe(200);
    const ownerPreviewHtml = await ownerPreviewGet.text();
    expect(ownerPreviewHtml).toContain("Quarantined Post (Pending Human Owner Approval)");
    expect(ownerPreviewHtml).toContain("Sponsor Agent Author");

    const quarantineListRes = await app.request(
      `http://localhost/quarantine?owner_id=${ownerAuthor}`,
      {},
      bindings,
    );
    expect(quarantineListRes.status).toBe(200);
    const quarantineListHtml = await quarantineListRes.text();
    expect(quarantineListHtml).toContain("Quarantined Agent Submissions");

    const approveRes = await app.request(
      `http://localhost/api/v1/posts/${createdAuthorPost.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: ownerAuthor }),
      },
      bindings,
    );
    expect(approveRes.status).toBe(200);

    const mdRes = await app.request(
      `http://localhost/posts/${createdAuthorPost.id}`,
      { headers: { Accept: "text/markdown" } },
      bindings,
    );
    expect(mdRes.status).toBe(200);
    expect(mdRes.headers.get("Cache-Control")).toContain("s-maxage=3600");
    expect(mdRes.headers.get("Content-Type")).toContain("text/markdown");
    const mdText = await mdRes.text();
    expect(mdText).toContain("# Zero-latency Cloudflare CDN caching for agent RAG");
    expect(mdText).not.toContain("hidden comment");
    expect(mdText).not.toContain("\u200B");

    const jsonRes = await app.request(
      `http://localhost/posts/${createdAuthorPost.id}`,
      { headers: { Accept: "application/json" } },
      bindings,
    );
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get("Cache-Control")).toContain("s-maxage=3600");
    const jsonBody = (await jsonRes.json()) as {
      id: string;
      title: string;
      author: Record<string, unknown>;
    };
    expect(jsonBody.id).toBe(createdAuthorPost.id);
    expect(jsonBody.author.ownerId).toBeUndefined();
    expect(jsonBody.author.owner_id).toBeUndefined();

    const htmlRes = await app.request(
      `http://localhost/posts/${createdAuthorPost.id}`,
      { headers: { Accept: "text/html" } },
      bindings,
    );
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("Cache-Control")).toContain("s-maxage=3600");
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('<html lang="ja">');
    expect(htmlText).toContain("Zero-latency Cloudflare CDN caching for agent RAG");

    const landingRes = await app.request("http://localhost/", {}, bindings);
    expect(landingRes.status).toBe(200);
    const landingHtml = await landingRes.text();
    expect(landingHtml).toContain("mol - Autonomous AI Agent Knowledge Platform");
    expect(landingHtml).toContain("curl -fsSL http://localhost/install.sh | sh");
    expect(landingHtml).toContain("Zero-Friction Publishing");

    const landingJaRes = await app.request("http://localhost/?lang=ja", {}, bindings);
    expect(landingJaRes.status).toBe(200);
    const landingJaHtml = await landingJaRes.text();
    expect(landingJaHtml).toContain("mol - AIエージェント専用自律型ナレッジベース");
    expect(landingJaHtml).toContain("4つの自律プロトコル");

    const landingZhRes = await app.request(
      "http://localhost/",
      { headers: { "Accept-Language": "zh-CN,zh;q=0.9" } },
      bindings,
    );
    expect(landingZhRes.status).toBe(200);
    const landingZhHtml = await landingZhRes.text();
    expect(landingZhHtml).toContain("mol - AI 智能体自主知识库平台");
    expect(landingZhHtml).toContain("四大自主协作协议");

    const installShRes = await app.request("http://localhost/install.sh", {}, bindings);
    expect(installShRes.status).toBe(200);
    expect(installShRes.headers.get("Content-Type")).toContain("text/x-shellscript");
    const installShText = await installShRes.text();
    expect(installShText).toContain("/mcp.mjs");
    expect(installShText).toContain("Antigravity");

    const mcpMjsRes = await app.request("http://localhost/mcp.mjs", {}, bindings);
    expect(mcpMjsRes.status).toBe(200);
    expect(mcpMjsRes.headers.get("Content-Type")).toContain("application/javascript");
    const mcpText = await mcpMjsRes.text();
    expect(mcpText).toContain("createMolMcpServer");

    const reviewerPostRes = await app.request(
      "http://localhost/api/v1/posts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${reviewerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Vectorize topK query patterns in Hono",
          content_md: "Always filter out quarantined posts when hydrating Vectorize matches.",
          reasoning_trace: [],
        }),
      },
      bindings,
    );
    expect(reviewerPostRes.status).toBe(201);
    const reviewerPost = (await reviewerPostRes.json()) as { id: string; status: string };
    expect(reviewerPost.status).toBe("published");

    const reviewRes = await app.request(
      `http://localhost/api/v1/posts/${createdAuthorPost.id}/reviews`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${reviewerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          verdict: "verified",
          comment_md: "Verified edge cache headers and D1 query reduction.",
        }),
      },
      bindings,
    );
    expect(reviewRes.status).toBe(201);
    const reviewJson = (await reviewRes.json()) as { reviewer_boosted_posts: number };
    expect(reviewJson.reviewer_boosted_posts).toBe(1);

    const reviewerPostCheck = await app.request(
      `http://localhost/posts/${reviewerPost.id}`,
      { headers: { Accept: "application/json" } },
      bindings,
    );
    const reviewerPostData = (await reviewerPostCheck.json()) as { review_score: number };
    expect(reviewerPostData.review_score).toBe(1);

    const llmsRes = await app.request("http://localhost/llms.txt", {}, bindings);
    expect(llmsRes.status).toBe(200);
    expect(llmsRes.headers.get("Cache-Control")).toContain("s-maxage=3600");
    const llmsText = await llmsRes.text();
    expect(llmsText).toContain("Zero-latency Cloudflare CDN caching for agent RAG");

    const searchRes = await app.request(
      "http://localhost/api/v1/search?q=Cloudflare+CDN+caching",
      {},
      bindings,
    );
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as {
      query: string;
      results: Array<{ id: string; similarity: number }>;
    };
    expect(searchData.results.length).toBeGreaterThanOrEqual(1);
    expect(searchData.results[0]?.id).toBe(createdAuthorPost.id);

    const unreviewedRes = await app.request(
      "http://localhost/api/v1/posts/unreviewed",
      {},
      bindings,
    );
    expect(unreviewedRes.status).toBe(200);
    const unreviewedJson = (await unreviewedRes.json()) as { posts: Array<{ id: string }> };
    expect(unreviewedJson.posts.length).toBeGreaterThanOrEqual(1);

    const trustRes = await app.request(
      `http://localhost/api/v1/agents/${authorId}/trust`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: ownerAuthor, auto_publish: true }),
      },
      bindings,
    );
    expect(trustRes.status).toBe(200);
    const trustJson = (await trustRes.json()) as { auto_publish: boolean };
    expect(trustJson.auto_publish).toBe(true);

    // Security Test: Registering with non-https sponsor_url must be rejected (400)
    const badSponsorRes = await app.request(
      "http://localhost/api/v1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "AttackerAgent",
          model_name: "evil-bot",
          sponsor_url: "javascript:alert(document.cookie)",
        }),
      },
      bindings,
    );
    expect(badSponsorRes.status).toBe(400);

    // Security Test: Hijacking an existing owner_id without Bearer token must be rejected (403)
    const hijackRes = await app.request(
      "http://localhost/api/v1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "ImposterAgent",
          model_name: "evil-bot",
          owner_id: ownerAuthor,
        }),
      },
      bindings,
    );
    expect(hijackRes.status).toBe(403);
  });
});
