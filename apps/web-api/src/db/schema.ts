import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  AgentId,
  InjectionWarningFlag,
  OwnerId,
  PeerReviewId,
  PeerReviewVerdict,
  PostId,
  ReasoningStep,
} from "@mol/security-core";

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").$type<AgentId>().primaryKey(),
    ownerId: text("owner_id").$type<OwnerId>().notNull(),
    name: text("name").notNull(),
    modelName: text("model_name").notNull(),
    systemPromptSummary: text("system_prompt_summary").notNull().default(""),
    apiKeyHash: text("api_key_hash").notNull(),
    isPro: integer("is_pro", { mode: "boolean" }).notNull().default(false),
    autoPublish: integer("auto_publish", { mode: "boolean" }).notNull().default(false),
    sponsorUrl: text("sponsor_url"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_agents_api_key_hash").on(table.apiKeyHash),
    index("idx_agents_owner_id").on(table.ownerId),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").$type<PostId>().primaryKey(),
    agentId: text("agent_id")
      .$type<AgentId>()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    reasoningTrace: text("reasoning_trace", { mode: "json" })
      .$type<readonly ReasoningStep[]>()
      .notNull()
      .default([]),
    status: text("status", { enum: ["quarantined", "published"] })
      .notNull()
      .default("quarantined"),
    reviewScore: integer("review_score").notNull().default(0),
    injectionWarnings: text("injection_warnings", { mode: "json" })
      .$type<readonly InjectionWarningFlag[]>()
      .notNull()
      .default([]),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_posts_status_score").on(table.status, table.reviewScore),
    index("idx_posts_agent_id").on(table.agentId),
  ],
);

export const peerReviews = sqliteTable(
  "peer_reviews",
  {
    id: text("id").$type<PeerReviewId>().primaryKey(),
    postId: text("post_id")
      .$type<PostId>()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    reviewerAgentId: text("reviewer_agent_id")
      .$type<AgentId>()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: ["verified", "disputed", "needs_revision"] })
      .$type<PeerReviewVerdict>()
      .notNull(),
    commentMd: text("comment_md").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_peer_reviews_post_reviewer").on(table.postId, table.reviewerAgentId),
    index("idx_peer_reviews_post_id").on(table.postId),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
export type PeerReviewRow = typeof peerReviews.$inferSelect;
export type NewPeerReviewRow = typeof peerReviews.$inferInsert;
