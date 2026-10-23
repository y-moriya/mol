export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type AgentId = Brand<string, "AgentId">;
export type OwnerId = Brand<string, "OwnerId">;
export type PostId = Brand<string, "PostId">;
export type PeerReviewId = Brand<string, "PeerReviewId">;
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

export type SanitizedMarkdown = Brand<string, "SanitizedMarkdown">;
export type SanitizedTitle = Brand<string, "SanitizedTitle">;
export type PowChallengeToken = Brand<string, "PowChallengeToken">;
export type PowNonce = Brand<string, "PowNonce">;

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type DlpRuleCategory =
  | "cloud_api_key"
  | "jwt_token"
  | "pem_private_key"
  | "high_entropy_secret"
  | "dotenv_assignment"
  | "local_filesystem_path"
  | "private_ipv4_address"
  | "internal_domain_name";

export type InjectionRuleCategory =
  | "invisible_control_chars"
  | "html_hidden_markup"
  | "jailbreak_syntax";

export type SecurityRuleCategory = DlpRuleCategory | InjectionRuleCategory;

export type InjectionWarningFlag =
  | "flagged_ignore_previous_instructions"
  | "flagged_system_override_syntax"
  | "flagged_roleplay_delimiter_escape"
  | "stripped_bidi_or_zero_width_chars"
  | "stripped_hidden_html_content";

export type PeerReviewVerdict = "verified" | "disputed" | "needs_revision";

export interface ReasoningStep {
  readonly step: string;
  readonly observation: string;
  readonly outcome?: string;
}

export interface AgentIdentity {
  readonly id: AgentId;
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly modelName: string;
  readonly isPro: boolean;
  readonly autoPublish: boolean;
}

export interface RawPostDraft {
  readonly title: string;
  readonly contentMd: string;
  readonly reasoningTrace: readonly ReasoningStep[];
}

export interface RawPeerReviewDraft {
  readonly postId: string;
  readonly verdict: PeerReviewVerdict;
  readonly commentMd: string;
}

export type PostLifecycle =
  | {
      readonly status: "quarantined";
      readonly quarantinedAt: IsoTimestamp;
    }
  | {
      readonly status: "published";
      readonly publishedAt: IsoTimestamp;
      readonly approvalMode: "auto_publish" | "owner_approved";
    };

export type VerifiedPowAuth =
  | {
      readonly kind: "pro_bypass";
      readonly agentId: AgentId;
    }
  | {
      readonly kind: "hashcash_verified";
      readonly agentId: AgentId;
      readonly challengeToken: PowChallengeToken;
      readonly nonce: PowNonce;
      readonly leadingZeroBits: number;
    };

export interface VerifiedServerSubmission {
  readonly __brand: "VerifiedServerSubmission";
  readonly agentId: AgentId;
  readonly title: SanitizedTitle;
  readonly contentMd: SanitizedMarkdown;
  readonly reasoningTrace: readonly ReasoningStep[];
  readonly injectionWarnings: readonly InjectionWarningFlag[];
  readonly powAuth: VerifiedPowAuth;
  readonly sanitizedAt: IsoTimestamp;
}

export interface VerifiedPeerReviewSubmission {
  readonly __brand: "VerifiedPeerReviewSubmission";
  readonly postId: PostId;
  readonly reviewerAgentId: AgentId;
  readonly verdict: PeerReviewVerdict;
  readonly commentMd: SanitizedMarkdown;
  readonly injectionWarnings: readonly InjectionWarningFlag[];
  readonly powAuth: VerifiedPowAuth;
  readonly sanitizedAt: IsoTimestamp;
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

export function parseAgentId(raw: unknown): AgentId | null {
  if (typeof raw === "string" && ID_PATTERN.test(raw)) {
    return raw as AgentId;
  }
  return null;
}

export function parseOwnerId(raw: unknown): OwnerId | null {
  if (typeof raw === "string" && ID_PATTERN.test(raw)) {
    return raw as OwnerId;
  }
  return null;
}

export function parsePostId(raw: unknown): PostId | null {
  if (typeof raw === "string" && ID_PATTERN.test(raw)) {
    return raw as PostId;
  }
  return null;
}

export function parsePeerReviewId(raw: unknown): PeerReviewId | null {
  if (typeof raw === "string" && ID_PATTERN.test(raw)) {
    return raw as PeerReviewId;
  }
  return null;
}

export function brandIsoTimestamp(iso: string): IsoTimestamp {
  return iso as IsoTimestamp;
}
