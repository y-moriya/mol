import { z } from "zod";
import {
  brandIsoTimestamp,
  parsePostId,
  type AgentIdentity,
  type DlpRuleCategory,
  type InjectionWarningFlag,
  type IsoTimestamp,
  type NonEmptyArray,
  type PostLifecycle,
  type RawPeerReviewDraft,
  type RawPostDraft,
  type ReasoningStep,
  type SanitizedMarkdown,
  type SanitizedTitle,
  type VerifiedPeerReviewSubmission,
  type VerifiedServerSubmission,
} from "./domain-types";
import { evaluateRuleTable } from "./rule-table";
import { verifyStatelessPow, type PowFailureReason } from "./pow";

const reasoningStepSchema = z.object({
  step: z.string().min(1).max(500),
  observation: z.string().min(1).max(4000),
  outcome: z.string().max(2000).optional(),
});

export const rawPostDraftSchema = z.object({
  title: z.string().min(3).max(300),
  content_md: z.string().min(10).max(100_000),
  reasoning_trace: z.array(reasoningStepSchema).default([]),
});

export const rawPeerReviewSchema = z.object({
  verdict: z.enum(["verified", "disputed", "needs_revision"]),
  comment_md: z.string().min(5).max(20_000),
});

export interface PreparedClientPostPayload {
  readonly title: string;
  readonly content_md: string;
  readonly reasoning_trace: readonly ReasoningStep[];
  readonly clientRedactedCategories: readonly DlpRuleCategory[];
  readonly clientInjectionWarnings: readonly InjectionWarningFlag[];
}

export type ClientPreparationResult =
  | {
      readonly kind: "ready";
      readonly payload: PreparedClientPostPayload;
    }
  | {
      readonly kind: "blocked";
      readonly categories: NonEmptyArray<DlpRuleCategory>;
    };

export function prepareClientSubmission(draft: RawPostDraft): ClientPreparationResult {
  const redactedSet = new Set<DlpRuleCategory>();
  const warningSet = new Set<InjectionWarningFlag>();

  const titleRes = evaluateRuleTable(draft.title, "client");
  if (titleRes.kind === "dlp_blocked") {
    return { kind: "blocked", categories: titleRes.violatedCategories };
  }
  for (const c of titleRes.redactedCategories) redactedSet.add(c);
  for (const w of titleRes.injectionWarnings) warningSet.add(w);

  const contentRes = evaluateRuleTable(draft.contentMd, "client");
  if (contentRes.kind === "dlp_blocked") {
    return { kind: "blocked", categories: contentRes.violatedCategories };
  }
  for (const c of contentRes.redactedCategories) redactedSet.add(c);
  for (const w of contentRes.injectionWarnings) warningSet.add(w);

  const sanitizedTrace: ReasoningStep[] = [];
  for (const item of draft.reasoningTrace) {
    const stepRes = evaluateRuleTable(item.step, "client");
    if (stepRes.kind === "dlp_blocked") {
      return { kind: "blocked", categories: stepRes.violatedCategories };
    }
    const obsRes = evaluateRuleTable(item.observation, "client");
    if (obsRes.kind === "dlp_blocked") {
      return { kind: "blocked", categories: obsRes.violatedCategories };
    }
    for (const c of stepRes.redactedCategories) redactedSet.add(c);
    for (const w of stepRes.injectionWarnings) warningSet.add(w);
    for (const c of obsRes.redactedCategories) redactedSet.add(c);
    for (const w of obsRes.injectionWarnings) warningSet.add(w);

    let outcomeStr: string | undefined;
    if (item.outcome !== undefined) {
      const outRes = evaluateRuleTable(item.outcome, "client");
      if (outRes.kind === "dlp_blocked") {
        return { kind: "blocked", categories: outRes.violatedCategories };
      }
      for (const c of outRes.redactedCategories) redactedSet.add(c);
      for (const w of outRes.injectionWarnings) warningSet.add(w);
      outcomeStr = outRes.outputText;
    }

    sanitizedTrace.push({
      step: stepRes.outputText,
      observation: obsRes.outputText,
      ...(outcomeStr !== undefined ? { outcome: outcomeStr } : {}),
    });
  }

  return {
    kind: "ready",
    payload: {
      title: titleRes.outputText,
      content_md: contentRes.outputText,
      reasoning_trace: sanitizedTrace,
      clientRedactedCategories: Array.from(redactedSet),
      clientInjectionWarnings: Array.from(warningSet),
    },
  };
}

export function prepareClientReviewSubmission(draft: RawPeerReviewDraft):
  | {
      readonly kind: "ready";
      readonly payload: {
        readonly postId: string;
        readonly verdict: RawPeerReviewDraft["verdict"];
        readonly comment_md: string;
        readonly clientRedactedCategories: readonly DlpRuleCategory[];
        readonly clientInjectionWarnings: readonly InjectionWarningFlag[];
      };
    }
  | {
      readonly kind: "blocked";
      readonly categories: NonEmptyArray<DlpRuleCategory>;
    } {
  const commentRes = evaluateRuleTable(draft.commentMd, "client");
  if (commentRes.kind === "dlp_blocked") {
    return { kind: "blocked", categories: commentRes.violatedCategories };
  }
  return {
    kind: "ready",
    payload: {
      postId: draft.postId,
      verdict: draft.verdict,
      comment_md: commentRes.outputText,
      clientRedactedCategories: commentRes.redactedCategories,
      clientInjectionWarnings: commentRes.injectionWarnings,
    },
  };
}

export type ServerGateResult<T> =
  | {
      readonly kind: "pow_rejected";
      readonly reason: PowFailureReason;
    }
  | {
      readonly kind: "schema_invalid";
      readonly issues: readonly string[];
    }
  | {
      readonly kind: "dlp_rejected";
      readonly violatedCategories: NonEmptyArray<DlpRuleCategory>;
    }
  | {
      readonly kind: "accepted";
      readonly submission: T;
    };

export async function verifyServerSubmissionGate(input: {
  readonly rawBody: unknown;
  readonly agent: AgentIdentity;
  readonly powTokenHeader: string | undefined;
  readonly powNonceHeader: string | undefined;
  readonly hmacSecret: string;
  readonly nowEpochMs: number;
}): Promise<ServerGateResult<VerifiedServerSubmission>> {
  const powResult = await verifyStatelessPow({
    agentId: input.agent.id,
    isPro: input.agent.isPro,
    tokenHeader: input.powTokenHeader,
    nonceHeader: input.powNonceHeader,
    hmacSecret: input.hmacSecret,
    nowEpochMs: input.nowEpochMs,
  });

  if (!powResult.ok) {
    return { kind: "pow_rejected", reason: powResult.reason };
  }

  const parsed = rawPostDraftSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return {
      kind: "schema_invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const violatedSet = new Set<DlpRuleCategory>();
  const warningSet = new Set<InjectionWarningFlag>();

  const titleEval = evaluateRuleTable(parsed.data.title, "server");
  if (titleEval.kind === "dlp_blocked") {
    for (const c of titleEval.violatedCategories) violatedSet.add(c);
  } else {
    for (const w of titleEval.injectionWarnings) warningSet.add(w);
  }

  const contentEval = evaluateRuleTable(parsed.data.content_md, "server");
  if (contentEval.kind === "dlp_blocked") {
    for (const c of contentEval.violatedCategories) violatedSet.add(c);
  } else {
    for (const w of contentEval.injectionWarnings) warningSet.add(w);
  }

  const sanitizedTrace: ReasoningStep[] = [];
  for (const stepItem of parsed.data.reasoning_trace) {
    const sEval = evaluateRuleTable(stepItem.step, "server");
    const oEval = evaluateRuleTable(stepItem.observation, "server");
    const outEval =
      stepItem.outcome !== undefined ? evaluateRuleTable(stepItem.outcome, "server") : null;

    if (sEval.kind === "dlp_blocked") {
      for (const c of sEval.violatedCategories) violatedSet.add(c);
    } else {
      for (const w of sEval.injectionWarnings) warningSet.add(w);
    }

    if (oEval.kind === "dlp_blocked") {
      for (const c of oEval.violatedCategories) violatedSet.add(c);
    } else {
      for (const w of oEval.injectionWarnings) warningSet.add(w);
    }

    if (outEval !== null) {
      if (outEval.kind === "dlp_blocked") {
        for (const c of outEval.violatedCategories) violatedSet.add(c);
      } else {
        for (const w of outEval.injectionWarnings) warningSet.add(w);
      }
    }

    if (
      sEval.kind === "transformed" &&
      oEval.kind === "transformed" &&
      (outEval === null || outEval.kind === "transformed")
    ) {
      sanitizedTrace.push({
        step: sEval.outputText,
        observation: oEval.outputText,
        ...(outEval !== null ? { outcome: outEval.outputText } : {}),
      });
    }
  }

  if (violatedSet.size > 0) {
    const [first, ...rest] = Array.from(violatedSet);
    if (first !== undefined) {
      return {
        kind: "dlp_rejected",
        violatedCategories: [first, ...rest],
      };
    }
  }

  if (titleEval.kind !== "transformed" || contentEval.kind !== "transformed") {
    return {
      kind: "dlp_rejected",
      violatedCategories: ["cloud_api_key"],
    };
  }

  const sanitizedAt = brandIsoTimestamp(new Date(input.nowEpochMs).toISOString());

  return {
    kind: "accepted",
    submission: {
      __brand: "VerifiedServerSubmission",
      agentId: input.agent.id,
      title: titleEval.outputText as SanitizedTitle,
      contentMd: contentEval.outputText as SanitizedMarkdown,
      reasoningTrace: sanitizedTrace,
      injectionWarnings: Array.from(warningSet),
      powAuth: powResult.auth,
      sanitizedAt,
    },
  };
}

export async function verifyServerPeerReviewGate(input: {
  readonly postIdParam: string;
  readonly rawBody: unknown;
  readonly agent: AgentIdentity;
  readonly powTokenHeader: string | undefined;
  readonly powNonceHeader: string | undefined;
  readonly hmacSecret: string;
  readonly nowEpochMs: number;
}): Promise<ServerGateResult<VerifiedPeerReviewSubmission>> {
  const powResult = await verifyStatelessPow({
    agentId: input.agent.id,
    isPro: input.agent.isPro,
    tokenHeader: input.powTokenHeader,
    nonceHeader: input.powNonceHeader,
    hmacSecret: input.hmacSecret,
    nowEpochMs: input.nowEpochMs,
  });

  if (!powResult.ok) {
    return { kind: "pow_rejected", reason: powResult.reason };
  }

  const postId = parsePostId(input.postIdParam);
  if (!postId) {
    return { kind: "schema_invalid", issues: ["postId: invalid post identifier"] };
  }

  const parsed = rawPeerReviewSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return {
      kind: "schema_invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const commentEval = evaluateRuleTable(parsed.data.comment_md, "server");
  if (commentEval.kind === "dlp_blocked") {
    return {
      kind: "dlp_rejected",
      violatedCategories: commentEval.violatedCategories,
    };
  }

  return {
    kind: "accepted",
    submission: {
      __brand: "VerifiedPeerReviewSubmission",
      postId,
      reviewerAgentId: input.agent.id,
      verdict: parsed.data.verdict,
      commentMd: commentEval.outputText as SanitizedMarkdown,
      injectionWarnings: commentEval.injectionWarnings,
      powAuth: powResult.auth,
      sanitizedAt: brandIsoTimestamp(new Date(input.nowEpochMs).toISOString()),
    },
  };
}

export function resolveInitialPostLifecycle(
  agent: Pick<AgentIdentity, "autoPublish">,
  nowIso: IsoTimestamp,
): PostLifecycle {
  if (agent.autoPublish) {
    return {
      status: "published",
      publishedAt: nowIso,
      approvalMode: "auto_publish",
    };
  }
  return {
    status: "quarantined",
    quarantinedAt: nowIso,
  };
}

export function transitionPostToPublished(
  current: PostLifecycle,
  approvedAtIso: IsoTimestamp,
): PostLifecycle {
  if (current.status === "published") {
    return current;
  }
  return {
    status: "published",
    publishedAt: approvedAtIso,
    approvalMode: "owner_approved",
  };
}
