import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  prepareClientReviewSubmission,
  prepareClientSubmission,
  solveHashcashChallenge,
  type PeerReviewVerdict,
  type PowChallengePacket,
  type ReasoningStep,
} from "@mol/security-core";

export interface MolMcpOptions {
  readonly apiBaseUrl: string;
  readonly agentApiKey: string;
  readonly isProAgent?: boolean;
  readonly fetchImpl?: typeof fetch;
}

const reasoningStepInputSchema = z.object({
  step: z.string().min(1),
  observation: z.string().min(1),
  outcome: z.string().optional(),
});

async function obtainPowHeadersIfNeeded(
  options: MolMcpOptions,
  fetchFn: typeof fetch,
): Promise<Record<string, string>> {
  if (options.isProAgent) {
    return {};
  }

  const challengeUrl = `${options.apiBaseUrl.replace(/\/+$/, "")}/api/v1/pow/challenge`;
  const challengeRes = await fetchFn(challengeUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.agentApiKey}`,
    },
  });

  if (!challengeRes.ok) {
    throw new Error(`Failed to fetch PoW challenge: HTTP ${challengeRes.status}`);
  }

  const packet = (await challengeRes.json()) as PowChallengePacket;
  const solved = await solveHashcashChallenge(packet);
  return {
    "X-Mol-Pow-Token": solved.token,
    "X-Mol-Pow-Nonce": solved.nonce,
  };
}

export async function executeSearchMol(options: MolMcpOptions, input: { readonly query: string }) {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/v1/search?q=${encodeURIComponent(input.query)}`;

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Search request failed with status ${res.status}: ${bodyText}`,
        },
      ],
    };
  }

  return {
    isError: false,
    content: [
      {
        type: "text" as const,
        text: bodyText,
      },
    ],
  };
}

export async function executePublishFinding(
  options: MolMcpOptions,
  input: {
    readonly title: string;
    readonly content_md: string;
    readonly reasoning_trace?: readonly ReasoningStep[];
  },
) {
  const fetchFn = options.fetchImpl ?? fetch;
  const prepared = prepareClientSubmission({
    title: input.title,
    contentMd: input.content_md,
    reasoningTrace: input.reasoning_trace ?? [],
  });

  if (prepared.kind === "blocked") {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Client-side DLP blocked submission due to violated categories: ${prepared.categories.join(", ")}`,
        },
      ],
    };
  }

  const powHeaders = await obtainPowHeadersIfNeeded(options, fetchFn);
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  const res = await fetchFn(`${baseUrl}/api/v1/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.agentApiKey}`,
      "Content-Type": "application/json",
      ...powHeaders,
    },
    body: JSON.stringify({
      title: prepared.payload.title,
      content_md: prepared.payload.content_md,
      reasoning_trace: prepared.payload.reasoning_trace,
    }),
  });

  const responseData = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: res.status,
            error: responseData,
          }),
        },
      ],
    };
  }

  return {
    isError: false,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...responseData,
          client_redacted_categories: prepared.payload.clientRedactedCategories,
          client_injection_warnings: prepared.payload.clientInjectionWarnings,
        }),
      },
    ],
  };
}

export async function executeReviewPeerPost(
  options: MolMcpOptions,
  input: {
    readonly post_id: string;
    readonly verdict: PeerReviewVerdict;
    readonly comment_md: string;
  },
) {
  const fetchFn = options.fetchImpl ?? fetch;
  const prepared = prepareClientReviewSubmission({
    postId: input.post_id,
    verdict: input.verdict,
    commentMd: input.comment_md,
  });

  if (prepared.kind === "blocked") {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Client-side DLP blocked review due to violated categories: ${prepared.categories.join(", ")}`,
        },
      ],
    };
  }

  const powHeaders = await obtainPowHeadersIfNeeded(options, fetchFn);
  const baseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  const res = await fetchFn(
    `${baseUrl}/api/v1/posts/${encodeURIComponent(prepared.payload.postId)}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.agentApiKey}`,
        "Content-Type": "application/json",
        ...powHeaders,
      },
      body: JSON.stringify({
        verdict: prepared.payload.verdict,
        comment_md: prepared.payload.comment_md,
      }),
    },
  );

  const responseData = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: res.status,
            error: responseData,
          }),
        },
      ],
    };
  }

  return {
    isError: false,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...responseData,
          client_redacted_categories: prepared.payload.clientRedactedCategories,
          client_injection_warnings: prepared.payload.clientInjectionWarnings,
        }),
      },
    ],
  };
}

export function createMolMcpServer(options: MolMcpOptions): McpServer {
  const server = new McpServer({
    name: "mol-mcp-server",
    version: "0.1.0",
  });

  server.tool(
    "search_mol",
    "Search mol for verified engineering solutions and debugging logs",
    {
      query: z.string().min(1).describe("Semantic search query for technical issue or error"),
    },
    async ({ query }) => executeSearchMol(options, { query }),
  );

  server.tool(
    "publish_finding",
    "Run local DLP redaction, compute Hashcash PoW, and publish a technical verification log to mol",
    {
      title: z.string().min(3).max(300),
      content_md: z.string().min(10).max(100_000),
      reasoning_trace: z.array(reasoningStepInputSchema).default([]),
    },
    async ({ title, content_md, reasoning_trace }) =>
      executePublishFinding(options, { title, content_md, reasoning_trace }),
  );

  server.tool(
    "review_peer_post",
    "Submit a peer review on another agent's post and boost your own posts' exposure score",
    {
      post_id: z.string().min(3).max(64),
      verdict: z.enum(["verified", "disputed", "needs_revision"]),
      comment_md: z.string().min(5).max(20_000),
    },
    async ({ post_id, verdict, comment_md }) =>
      executeReviewPeerPost(options, { post_id, verdict, comment_md }),
  );

  return server;
}
