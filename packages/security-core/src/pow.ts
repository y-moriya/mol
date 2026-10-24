import type { AgentId, PowChallengeToken, PowNonce, VerifiedPowAuth } from "./domain-types";

export interface PowChallengePacket {
  readonly token: PowChallengeToken;
  readonly difficultyBits: number;
  readonly expiresAtEpochMs: number;
}

export interface IssuePowChallengeInput {
  readonly agentId: AgentId;
  readonly difficultyBits: number;
  readonly ttlMs: number;
  readonly nowEpochMs: number;
  readonly hmacSecret: string;
}

export type PowFailureReason =
  | "missing_pow_headers"
  | "malformed_token"
  | "signature_mismatch"
  | "agent_id_mismatch"
  | "challenge_expired"
  | "insufficient_leading_zero_bits"
  | "challenge_already_used";

export type PowVerificationResult =
  | { readonly ok: true; readonly auth: VerifiedPowAuth }
  | {
      readonly ok: false;
      readonly reason: PowFailureReason;
    };

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(padLen));
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function countLeadingZeroBits(bytes: Uint8Array): number {
  let total = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      total += 8;
    } else {
      total += Math.clz32(byte) - 24;
      break;
    }
  }
  return total;
}

async function computeSha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return new Uint8Array(digest);
}

export async function issueStatelessPowChallenge(
  input: IssuePowChallengeInput,
): Promise<PowChallengePacket> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const expiresAtEpochMs = input.nowEpochMs + input.ttlMs;
  const payload = `v1.${input.agentId}.${expiresAtEpochMs}.${input.difficultyBits}.${saltHex}`;

  const key = await importHmacKey(input.hmacSecret);
  const enc = new TextEncoder();
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigB64 = bytesToBase64Url(new Uint8Array(sigBuffer));
  const fullToken = `${payload}.${sigB64}` as PowChallengeToken;

  return {
    token: fullToken,
    difficultyBits: input.difficultyBits,
    expiresAtEpochMs,
  };
}

export async function verifyStatelessPow(input: {
  readonly agentId: AgentId;
  readonly isPro: boolean;
  readonly tokenHeader: string | undefined;
  readonly nonceHeader: string | undefined;
  readonly hmacSecret: string;
  readonly nowEpochMs: number;
  readonly minDifficultyBits?: number;
  readonly isTokenSpent?: (token: string) => boolean;
  readonly markTokenSpent?: (token: string, expiresAtEpochMs: number) => void;
}): Promise<PowVerificationResult> {
  if (input.isPro) {
    return {
      ok: true,
      auth: {
        kind: "pro_bypass",
        agentId: input.agentId,
      },
    };
  }

  if (!input.tokenHeader || !input.nonceHeader) {
    return { ok: false, reason: "missing_pow_headers" };
  }

  if (input.isTokenSpent && input.isTokenSpent(input.tokenHeader)) {
    return { ok: false, reason: "challenge_already_used" };
  }

  const parts = input.tokenHeader.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") {
    return { ok: false, reason: "malformed_token" };
  }

  const [version, tokenAgentId, expiresStr, diffStr, saltHex, sigB64] = parts;
  if (!version || !tokenAgentId || !expiresStr || !diffStr || !saltHex || !sigB64) {
    return { ok: false, reason: "malformed_token" };
  }

  const expiresAtEpochMs = Number(expiresStr);
  const difficultyBits = Number(diffStr);
  if (
    !Number.isFinite(expiresAtEpochMs) ||
    !Number.isInteger(difficultyBits) ||
    difficultyBits < 0 ||
    difficultyBits > 32
  ) {
    return { ok: false, reason: "malformed_token" };
  }

  if (input.minDifficultyBits !== undefined && difficultyBits < input.minDifficultyBits) {
    return { ok: false, reason: "insufficient_leading_zero_bits" };
  }

  const sigBytes = base64UrlToBytes(sigB64);
  if (!sigBytes) {
    return { ok: false, reason: "malformed_token" };
  }

  const payload = `${version}.${tokenAgentId}.${expiresStr}.${diffStr}.${saltHex}`;
  const key = await importHmacKey(input.hmacSecret);
  const enc = new TextEncoder();
  const sigValid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
  if (!sigValid) {
    return { ok: false, reason: "signature_mismatch" };
  }

  if (tokenAgentId !== input.agentId) {
    return { ok: false, reason: "agent_id_mismatch" };
  }

  if (input.nowEpochMs > expiresAtEpochMs) {
    return { ok: false, reason: "challenge_expired" };
  }

  const hashBytes = await computeSha256Bytes(`${input.tokenHeader}:${input.nonceHeader}`);
  const leadingZeros = countLeadingZeroBits(hashBytes);
  if (leadingZeros < difficultyBits) {
    return { ok: false, reason: "insufficient_leading_zero_bits" };
  }

  if (input.markTokenSpent) {
    input.markTokenSpent(input.tokenHeader, expiresAtEpochMs);
  }

  return {
    ok: true,
    auth: {
      kind: "hashcash_verified",
      agentId: input.agentId,
      challengeToken: input.tokenHeader as PowChallengeToken,
      nonce: input.nonceHeader as PowNonce,
      leadingZeroBits: leadingZeros,
    },
  };
}

export async function solveHashcashChallenge(
  packet: PowChallengePacket,
): Promise<{ readonly token: PowChallengeToken; readonly nonce: PowNonce }> {
  let counter = 0;
  while (true) {
    const candidateNonce = counter.toString(36);
    const hashBytes = await computeSha256Bytes(`${packet.token}:${candidateNonce}`);
    const zeros = countLeadingZeroBits(hashBytes);
    if (zeros >= packet.difficultyBits) {
      return {
        token: packet.token,
        nonce: candidateNonce as PowNonce,
      };
    }
    counter += 1;
  }
}
