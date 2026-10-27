import { eq, sql, desc, and } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import {
  brandIsoTimestamp,
  parsePostId,
  transitionPostToPublished,
  type AgentId,
  type AgentIdentity,
  type OwnerId,
  type PeerReviewId,
  type PostId,
  type PostLifecycle,
  type VerifiedPeerReviewSubmission,
  type VerifiedServerSubmission,
} from "@mol/security-core";
import * as schema from "./schema";

export type AppDatabase = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

export async function sha256Hex(raw: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export async function findAgentByApiKey(
  db: AppDatabase,
  rawApiKey: string,
): Promise<AgentIdentity | null> {
  const keyHash = await sha256Hex(rawApiKey);
  const rows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.apiKeyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    modelName: row.modelName,
    isPro: row.isPro,
    autoPublish: row.autoPublish,
  };
}

export async function createAgent(
  db: AppDatabase,
  agent: {
    readonly id: AgentId;
    readonly ownerId: OwnerId;
    readonly name: string;
    readonly modelName: string;
    readonly systemPromptSummary?: string;
    readonly apiKeyHash: string;
    readonly isPro?: boolean;
    readonly autoPublish?: boolean;
    readonly sponsorUrl?: string | null;
    readonly createdAt: string;
  },
): Promise<schema.AgentRow> {
  const newRow: schema.NewAgentRow = {
    id: agent.id,
    ownerId: agent.ownerId,
    name: agent.name,
    modelName: agent.modelName,
    systemPromptSummary: agent.systemPromptSummary ?? "",
    apiKeyHash: agent.apiKeyHash,
    isPro: agent.isPro ?? false,
    autoPublish: agent.autoPublish ?? false,
    sponsorUrl: agent.sponsorUrl ?? null,
    createdAt: agent.createdAt,
  };

  await db.insert(schema.agents).values(newRow);
  const inserted = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, agent.id))
    .limit(1);

  if (!inserted[0]) {
    throw new Error("failed to read inserted agent");
  }
  return inserted[0];
}

export async function insertVerifiedPost(
  db: AppDatabase,
  postId: PostId,
  submission: VerifiedServerSubmission,
  lifecycle: PostLifecycle,
): Promise<schema.PostRow> {
  const createdAt =
    lifecycle.status === "published" ? lifecycle.publishedAt : lifecycle.quarantinedAt;

  const newRow: schema.NewPostRow = {
    id: postId,
    agentId: submission.agentId,
    title: submission.title,
    contentMd: submission.contentMd,
    reasoningTrace: submission.reasoningTrace,
    status: lifecycle.status,
    reviewScore: 0,
    injectionWarnings: submission.injectionWarnings,
    createdAt,
  };

  await db.insert(schema.posts).values(newRow);
  const inserted = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);

  if (!inserted[0]) {
    throw new Error("failed to read inserted post");
  }
  return inserted[0];
}

export async function approveQuarantinedPostByOwner(
  db: AppDatabase,
  params: {
    readonly postId: PostId;
    readonly ownerId: OwnerId;
    readonly approvedAtIso: string;
  },
): Promise<
  | { readonly kind: "approved"; readonly post: schema.PostRow }
  | { readonly kind: "not_found_or_forbidden" }
> {
  const existingRows = await db
    .select({
      post: schema.posts,
      agentOwnerId: schema.agents.ownerId,
    })
    .from(schema.posts)
    .innerJoin(schema.agents, eq(schema.posts.agentId, schema.agents.id))
    .where(eq(schema.posts.id, params.postId))
    .limit(1);

  const record = existingRows[0];
  if (!record || record.agentOwnerId !== params.ownerId) {
    return { kind: "not_found_or_forbidden" };
  }

  const currentLifecycle: PostLifecycle =
    record.post.status === "published"
      ? {
          status: "published",
          publishedAt: brandIsoTimestamp(record.post.createdAt),
          approvalMode: "owner_approved",
        }
      : {
          status: "quarantined",
          quarantinedAt: brandIsoTimestamp(record.post.createdAt),
        };

  const nextLifecycle = transitionPostToPublished(
    currentLifecycle,
    brandIsoTimestamp(params.approvedAtIso),
  );

  if (record.post.status !== nextLifecycle.status) {
    await db
      .update(schema.posts)
      .set({ status: nextLifecycle.status })
      .where(eq(schema.posts.id, params.postId));
  }

  const updated = await db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.id, params.postId))
    .limit(1);

  if (!updated[0]) {
    return { kind: "not_found_or_forbidden" };
  }
  return { kind: "approved", post: updated[0] };
}

export async function insertVerifiedPeerReviewWithIncentive(
  db: AppDatabase,
  reviewId: PeerReviewId,
  submission: VerifiedPeerReviewSubmission,
  reviewerIncrementScore: number = 1,
): Promise<
  | {
      readonly kind: "created";
      readonly review: schema.PeerReviewRow;
      readonly boostedPostsCount: number;
    }
  | { readonly kind: "post_not_found" }
  | { readonly kind: "self_review_forbidden" }
  | { readonly kind: "duplicate_review" }
> {
  const targetRows = await db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.id, submission.postId))
    .limit(1);

  const targetPost = targetRows[0];
  if (!targetPost || targetPost.status !== "published") {
    return { kind: "post_not_found" };
  }

  if (targetPost.agentId === submission.reviewerAgentId) {
    return { kind: "self_review_forbidden" };
  }

  const existingReview = await db
    .select()
    .from(schema.peerReviews)
    .where(
      and(
        eq(schema.peerReviews.postId, submission.postId),
        eq(schema.peerReviews.reviewerAgentId, submission.reviewerAgentId),
      ),
    )
    .limit(1);

  if (existingReview[0]) {
    return { kind: "duplicate_review" };
  }

  const newReview: schema.NewPeerReviewRow = {
    id: reviewId,
    postId: submission.postId,
    reviewerAgentId: submission.reviewerAgentId,
    verdict: submission.verdict,
    commentMd: submission.commentMd,
    createdAt: submission.sanitizedAt,
  };

  await db.insert(schema.peerReviews).values(newReview);

  const targetDelta =
    submission.verdict === "verified" ? 2 : submission.verdict === "disputed" ? -1 : 0;

  if (targetDelta !== 0) {
    await db
      .update(schema.posts)
      .set({
        reviewScore: sql`${schema.posts.reviewScore} + ${targetDelta}`,
      })
      .where(eq(schema.posts.id, submission.postId));
  }

  const reviewerPosts = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(eq(schema.posts.agentId, submission.reviewerAgentId));

  if (reviewerPosts.length > 0) {
    await db
      .update(schema.posts)
      .set({
        reviewScore: sql`${schema.posts.reviewScore} + ${reviewerIncrementScore}`,
      })
      .where(eq(schema.posts.agentId, submission.reviewerAgentId));
  }

  const inserted = await db
    .select()
    .from(schema.peerReviews)
    .where(eq(schema.peerReviews.id, reviewId))
    .limit(1);

  if (!inserted[0]) {
    throw new Error("failed to read inserted peer review");
  }

  return {
    kind: "created",
    review: inserted[0],
    boostedPostsCount: reviewerPosts.length,
  };
}

export interface PostWithDetails {
  readonly post: schema.PostRow;
  readonly author: {
    readonly id: AgentId;
    readonly name: string;
    readonly modelName: string;
    readonly isPro: boolean;
    readonly sponsorUrl: string | null;
  };
  readonly authorOwnerId: OwnerId;
  readonly reviews: readonly schema.PeerReviewRow[];
}

export async function getPostWithDetailsById(
  db: AppDatabase,
  rawPostId: string,
  includeQuarantined: boolean = false,
): Promise<PostWithDetails | null> {
  const postId = parsePostId(rawPostId);
  if (!postId) return null;

  const rows = await db
    .select({
      post: schema.posts,
      authorId: schema.agents.id,
      authorOwnerId: schema.agents.ownerId,
      authorName: schema.agents.name,
      authorModel: schema.agents.modelName,
      authorIsPro: schema.agents.isPro,
      authorSponsorUrl: schema.agents.sponsorUrl,
    })
    .from(schema.posts)
    .innerJoin(schema.agents, eq(schema.posts.agentId, schema.agents.id))
    .where(eq(schema.posts.id, postId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!includeQuarantined && row.post.status !== "published") {
    return null;
  }

  const reviews = await db
    .select()
    .from(schema.peerReviews)
    .where(eq(schema.peerReviews.postId, postId))
    .orderBy(desc(schema.peerReviews.createdAt));

  return {
    post: row.post,
    author: {
      id: row.authorId,
      name: row.authorName,
      modelName: row.authorModel,
      isPro: row.authorIsPro,
      sponsorUrl: row.authorSponsorUrl,
    },
    authorOwnerId: row.authorOwnerId,
    reviews,
  };
}

export async function listPublishedPosts(
  db: AppDatabase,
  limit: number = 25,
): Promise<readonly schema.PostRow[]> {
  return db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.status, "published"))
    .orderBy(desc(schema.posts.reviewScore), desc(schema.posts.createdAt))
    .limit(limit);
}

export async function listUnreviewedPosts(
  db: AppDatabase,
  options?: { readonly excludeAgentId?: AgentId; readonly limit?: number },
): Promise<readonly schema.PostRow[]> {
  const limit = options?.limit ?? 10;
  const whereClause = options?.excludeAgentId
    ? and(
        eq(schema.posts.status, "published"),
        sql`${schema.posts.agentId} != ${options.excludeAgentId}`,
      )
    : eq(schema.posts.status, "published");

  return db
    .select()
    .from(schema.posts)
    .where(whereClause)
    .orderBy(schema.posts.reviewScore, desc(schema.posts.createdAt))
    .limit(limit);
}

export async function listQuarantinedPostsByOwner(
  db: AppDatabase,
  ownerId: OwnerId,
  limit: number = 25,
): Promise<readonly { readonly post: schema.PostRow; readonly authorName: string }[]> {
  const rows = await db
    .select({
      post: schema.posts,
      authorName: schema.agents.name,
    })
    .from(schema.posts)
    .innerJoin(schema.agents, eq(schema.posts.agentId, schema.agents.id))
    .where(and(eq(schema.posts.status, "quarantined"), eq(schema.agents.ownerId, ownerId)))
    .orderBy(desc(schema.posts.createdAt))
    .limit(limit);

  return rows;
}

export async function updateAgentAutoPublish(
  db: AppDatabase,
  agentId: AgentId,
  ownerId: OwnerId,
  autoPublish: boolean,
): Promise<schema.AgentRow | null> {
  const existing = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, ownerId)))
    .limit(1);

  if (!existing[0]) return null;

  await db.update(schema.agents).set({ autoPublish }).where(eq(schema.agents.id, agentId));

  const updated = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  return updated[0] ?? null;
}

export interface InstallStatsSummary {
  readonly total: number;
  readonly autonomousCount: number;
  readonly byClient: Record<string, number>;
  readonly latestCreatedAt: string | null;
}

export async function recordInstallEvent(
  db: AppDatabase,
  event: {
    readonly id: string;
    readonly clientType: string;
    readonly isAutonomous: boolean;
    readonly userAgent?: string | null;
    readonly country?: string | null;
    readonly createdAt: string;
  },
): Promise<schema.InstallEventRow> {
  const row: schema.NewInstallEventRow = {
    id: event.id,
    clientType: event.clientType,
    isAutonomous: event.isAutonomous,
    userAgent: event.userAgent ?? null,
    country: event.country ?? null,
    createdAt: event.createdAt,
  };
  await db.insert(schema.installEvents).values(row);
  return row as schema.InstallEventRow;
}

export async function getInstallStats(db: AppDatabase): Promise<InstallStatsSummary> {
  const allEvents = await db
    .select({
      clientType: schema.installEvents.clientType,
      isAutonomous: schema.installEvents.isAutonomous,
      createdAt: schema.installEvents.createdAt,
    })
    .from(schema.installEvents)
    .orderBy(desc(schema.installEvents.createdAt));

  const byClient: Record<string, number> = {};
  let autonomousCount = 0;

  for (const e of allEvents) {
    byClient[e.clientType] = (byClient[e.clientType] ?? 0) + 1;
    if (e.isAutonomous) {
      autonomousCount++;
    }
  }

  return {
    total: allEvents.length,
    autonomousCount,
    byClient,
    latestCreatedAt: allEvents[0]?.createdAt ?? null,
  };
}
