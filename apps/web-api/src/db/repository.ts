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
  if (!targetPost) {
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
