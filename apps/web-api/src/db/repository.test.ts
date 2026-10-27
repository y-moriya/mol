import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  parseAgentId,
  parseOwnerId,
  parsePeerReviewId,
  parsePostId,
  resolveInitialPostLifecycle,
  verifyServerPeerReviewGate,
  verifyServerSubmissionGate,
  type PeerReviewId,
} from "@mol/security-core";
import * as schema from "./schema";
import {
  approveQuarantinedPostByOwner,
  findAgentByApiKey,
  getPostWithDetailsById,
  insertVerifiedPeerReviewWithIncentive,
  insertVerifiedPost,
  sha256Hex,
  type AppDatabase,
} from "./repository";

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

CREATE TABLE install_events (
  id TEXT PRIMARY KEY NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'all',
  is_autonomous INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  country TEXT,
  created_at TEXT NOT NULL
);
`;

function createInMemoryDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema }) as unknown as AppDatabase;
}

describe("D1 Drizzle Schema & Repository Invariants", () => {
  it("authenticates agents by api_key_hash, enforces quarantine default, transitions on owner approval, and boosts reviewer post scores on peer review", async () => {
    const db = createInMemoryDb();

    const agentAId = parseAgentId("agent_author_01");
    const agentBId = parseAgentId("agent_reviewer_02");
    const ownerAId = parseOwnerId("owner_alice");
    const ownerBId = parseOwnerId("owner_bob");
    if (!agentAId || !agentBId || !ownerAId || !ownerBId) {
      throw new Error("fixture id parse failed");
    }

    const keyA = "al_live_author_key_111";
    const keyB = "al_live_reviewer_key_222";

    await db.insert(schema.agents).values([
      {
        id: agentAId,
        ownerId: ownerAId,
        name: "AuthorBot",
        modelName: "gemini-4-argon",
        systemPromptSummary: "Edge database specialist",
        apiKeyHash: await sha256Hex(keyA),
        isPro: true,
        autoPublish: false,
        sponsorUrl: "https://github.com/sponsors/alice",
        createdAt: "2026-10-24T00:00:00.000Z",
      },
      {
        id: agentBId,
        ownerId: ownerBId,
        name: "ReviewerBot",
        modelName: "claude-fable",
        systemPromptSummary: "Security and performance auditor",
        apiKeyHash: await sha256Hex(keyB),
        isPro: true,
        autoPublish: true,
        sponsorUrl: null,
        createdAt: "2026-10-24T00:00:00.000Z",
      },
    ]);

    const authA = await findAgentByApiKey(db, keyA);
    const authB = await findAgentByApiKey(db, keyB);
    expect(authA?.id).toBe(agentAId);
    expect(authB?.id).toBe(agentBId);
    expect(await findAgentByApiKey(db, "wrong_key")).toBeNull();
    if (!authA || !authB) return;

    const gateA = await verifyServerSubmissionGate({
      rawBody: {
        title: "D1 batch write latency benchmarks",
        content_md: "Using `db.batch()` reduced round-trip latency from 42ms to 9ms.",
        reasoning_trace: [
          {
            step: "Benchmark sequential inserts",
            observation: "50 inserts took 42ms",
            outcome: "Switched to single batch call",
          },
        ],
      },
      agent: authA,
      powTokenHeader: undefined,
      powNonceHeader: undefined,
      hmacSecret: "secret",
      nowEpochMs: 1_760_000_000_000,
    });
    expect(gateA.kind).toBe("accepted");
    if (gateA.kind !== "accepted") return;

    const postAId = parsePostId("post_author_01");
    const postBId = parsePostId("post_reviewer_01");
    if (!postAId || !postBId) return;

    const lifecycleA = resolveInitialPostLifecycle(authA, gateA.submission.sanitizedAt);
    const insertedA = await insertVerifiedPost(db, postAId, gateA.submission, lifecycleA);
    expect(insertedA.status).toBe("quarantined");

    expect(await getPostWithDetailsById(db, postAId, false)).toBeNull();
    expect((await getPostWithDetailsById(db, postAId, true))?.post.status).toBe("quarantined");

    const wrongOwnerApproval = await approveQuarantinedPostByOwner(db, {
      postId: postAId,
      ownerId: ownerBId,
      approvedAtIso: "2026-10-24T01:00:00.000Z",
    });
    expect(wrongOwnerApproval.kind).toBe("not_found_or_forbidden");

    // Quarantined post cannot be peer-reviewed
    const prematureReviewGate = await verifyServerPeerReviewGate({
      postIdParam: postAId,
      rawBody: {
        verdict: "verified",
        comment_md: "Attempting to review unapproved quarantined post",
      },
      agent: authB,
      powTokenHeader: undefined,
      powNonceHeader: undefined,
      hmacSecret: "secret",
      nowEpochMs: 1_760_000_005_000,
    });
    expect(prematureReviewGate.kind).toBe("accepted");
    if (prematureReviewGate.kind === "accepted") {
      const prematureOutcome = await insertVerifiedPeerReviewWithIncentive(
        db,
        parsePeerReviewId("rev_premature") as PeerReviewId,
        prematureReviewGate.submission,
      );
      expect(prematureOutcome.kind).toBe("post_not_found");
    }

    const rightOwnerApproval = await approveQuarantinedPostByOwner(db, {
      postId: postAId,
      ownerId: ownerAId,
      approvedAtIso: "2026-10-24T01:05:00.000Z",
    });
    expect(rightOwnerApproval.kind).toBe("approved");
    if (rightOwnerApproval.kind === "approved") {
      expect(rightOwnerApproval.post.status).toBe("published");
    }

    const gateB = await verifyServerSubmissionGate({
      rawBody: {
        title: "Workers AI BGE embedding dimension check",
        content_md: "Verified `@cf/baai/bge-small-en-v1.5` outputs 384-dimensional float vectors.",
        reasoning_trace: [],
      },
      agent: authB,
      powTokenHeader: undefined,
      powNonceHeader: undefined,
      hmacSecret: "secret",
      nowEpochMs: 1_760_000_010_000,
    });
    expect(gateB.kind).toBe("accepted");
    if (gateB.kind !== "accepted") return;

    const lifecycleB = resolveInitialPostLifecycle(authB, gateB.submission.sanitizedAt);
    const insertedB = await insertVerifiedPost(db, postBId, gateB.submission, lifecycleB);
    expect(insertedB.status).toBe("published");
    expect(insertedB.reviewScore).toBe(0);

    const reviewGate = await verifyServerPeerReviewGate({
      postIdParam: postAId,
      rawBody: {
        verdict: "verified",
        comment_md: "Confirmed the 9ms D1 batch benchmark on a fresh Worker.",
      },
      agent: authB,
      powTokenHeader: undefined,
      powNonceHeader: undefined,
      hmacSecret: "secret",
      nowEpochMs: 1_760_000_020_000,
    });
    expect(reviewGate.kind).toBe("accepted");
    if (reviewGate.kind !== "accepted") return;

    const reviewId = parsePeerReviewId("rev_001");
    if (!reviewId) return;

    const reviewOutcome = await insertVerifiedPeerReviewWithIncentive(
      db,
      reviewId,
      reviewGate.submission,
    );
    expect(reviewOutcome.kind).toBe("created");
    if (reviewOutcome.kind === "created") {
      expect(reviewOutcome.boostedPostsCount).toBe(1);
    }

    const postADetails = await getPostWithDetailsById(db, postAId);
    const postBDetails = await getPostWithDetailsById(db, postBId);
    expect(postADetails?.post.reviewScore).toBe(2);
    expect(postADetails?.reviews).toHaveLength(1);
    expect(postBDetails?.post.reviewScore).toBe(1);
  });
});
