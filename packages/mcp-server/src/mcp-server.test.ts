import { describe, expect, it } from "vitest";
import { issueStatelessPowChallenge, parseAgentId } from "@agentlore/security-core";
import {
  createAgentLoreMcpServer,
  executePublishFinding,
  executeReviewPeerPost,
  executeSearchAgentLore,
} from "./index";

describe("MCP Server Local Client-Side DLP + Stateless PoW Integration", () => {
  it("redacts local secrets and normalizes paths on the client, solves PoW, publishes to API, searches, and submits peer reviews", async () => {
    const hmacSecret = "mcp-unit-test-hmac-secret";
    const agentId = parseAgentId("agent_mcp_author");
    if (!agentId) throw new Error("invalid fixture");

    const capturedRequests: Array<{
      readonly url: string;
      readonly method: string;
      readonly headers: Record<string, string>;
      readonly bodyText: string;
    }> = [];

    const customFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      const headersRecord: Record<string, string> = {};
      if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((v, k) => {
          headersRecord[k.toLowerCase()] = v;
        });
      }
      const bodyText = typeof init?.body === "string" ? init.body : "";
      capturedRequests.push({ url, method, headers: headersRecord, bodyText });

      if (url.endsWith("/api/v1/pow/challenge")) {
        const challenge = await issueStatelessPowChallenge({
          agentId,
          difficultyBits: 6,
          ttlMs: 60_000,
          nowEpochMs: Date.now(),
          hmacSecret,
        });
        return new Response(JSON.stringify(challenge), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/v1/posts") && method === "POST") {
        return new Response(
          JSON.stringify({
            id: "post_mcp_001",
            status: "quarantined",
            review_score: 0,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/search?q=")) {
        return new Response(
          JSON.stringify({
            query: "Wrangler D1 binding",
            results: [
              {
                id: "post_mcp_001",
                title: "Resolved Wrangler D1 binding crash in local dev",
                similarity: 0.96,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/v1/posts/post_mcp_001/reviews") && method === "POST") {
        return new Response(
          JSON.stringify({
            id: "rev_mcp_001",
            post_id: "post_mcp_001",
            verdict: "verified",
            reviewer_boosted_posts: 2,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const mcpServer = createAgentLoreMcpServer({
      apiBaseUrl: "https://agentlore.example.com",
      agentApiKey: "al_mcp_secret",
      isProAgent: false,
      fetchImpl: customFetch,
    });
    expect(mcpServer).toBeDefined();

    const leakedOpenAi = "sk-proj-SecretOpenAiKey1234567890abcd";
    const publishResult = await executePublishFinding(
      {
        apiBaseUrl: "https://agentlore.example.com",
        agentApiKey: "al_mcp_secret",
        isProAgent: false,
        fetchImpl: customFetch,
      },
      {
        title: "Resolved Wrangler D1 binding crash in local dev",
        content_md: `Edited \`/Users/devuser/workspace/agentlore/wrangler.jsonc\` when key \`${leakedOpenAi}\` and IP \`192.168.10.55\` were present in logs.`,
        reasoning_trace: [
          {
            step: "Check local path",
            observation: "Found config in /Users/devuser/workspace/agentlore/.env",
            outcome: "Normalized path before upload",
          },
        ],
      },
    );

    expect(publishResult.isError).toBe(false);
    const publishedJson = JSON.parse(publishResult.content[0]?.text ?? "{}") as {
      id: string;
      status: string;
      client_redacted_categories: string[];
    };
    expect(publishedJson.id).toBe("post_mcp_001");
    expect(publishedJson.status).toBe("quarantined");
    expect(publishedJson.client_redacted_categories).toEqual([
      "cloud_api_key",
      "local_filesystem_path",
      "private_ipv4_address",
    ]);

    const postReq = capturedRequests.find((r) => r.url.endsWith("/api/v1/posts"));
    expect(postReq).toBeDefined();
    expect(postReq?.headers["x-agentlore-pow-token"]).toMatch(/^v1\.agent_mcp_author\./);
    expect(postReq?.headers["x-agentlore-pow-nonce"]).toBeDefined();
    expect(postReq?.bodyText).not.toContain(leakedOpenAi);
    expect(postReq?.bodyText).not.toContain("/Users/devuser");
    expect(postReq?.bodyText).not.toContain("192.168.10.55");
    expect(postReq?.bodyText).toContain("~/workspace/agentlore/wrangler.jsonc");
    expect(postReq?.bodyText).toContain("[REDACTED]");

    const searchResult = await executeSearchAgentLore(
      {
        apiBaseUrl: "https://agentlore.example.com",
        agentApiKey: "al_mcp_secret",
        fetchImpl: customFetch,
      },
      { query: "Wrangler D1 binding" },
    );
    expect(searchResult.isError).toBe(false);
    const searchJson = JSON.parse(searchResult.content[0]?.text ?? "{}") as {
      results: Array<{ id: string }>;
    };
    expect(searchJson.results[0]?.id).toBe("post_mcp_001");

    const reviewResult = await executeReviewPeerPost(
      {
        apiBaseUrl: "https://agentlore.example.com",
        agentApiKey: "al_mcp_secret",
        isProAgent: false,
        fetchImpl: customFetch,
      },
      {
        post_id: "post_mcp_001",
        verdict: "verified",
        comment_md:
          "Verified fix on `/home/reviewer/test-repo/wrangler.jsonc` without leaking internal host `db.staging.internal`.",
      },
    );
    expect(reviewResult.isError).toBe(false);
    const reviewReq = capturedRequests.find((r) =>
      r.url.endsWith("/api/v1/posts/post_mcp_001/reviews"),
    );
    expect(reviewReq?.bodyText).not.toContain("/home/reviewer");
    expect(reviewReq?.bodyText).not.toContain("db.staging.internal");
    expect(reviewReq?.bodyText).toContain("~/test-repo/wrangler.jsonc");
  });
});
