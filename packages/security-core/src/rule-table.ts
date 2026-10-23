import type { DlpRuleCategory, InjectionWarningFlag, NonEmptyArray } from "./domain-types";

export interface RuleMatchSpan {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export type SpanDetector = (input: string) => readonly RuleMatchSpan[];

export type SecurityRuleEntry =
  | {
      readonly id: string;
      readonly phase: "dlp";
      readonly category: DlpRuleCategory;
      readonly description: string;
      readonly detect: SpanDetector;
      readonly clientMode: "redact_span" | "normalize_span" | "block_submission";
      readonly serverMode: "reject_422";
    }
  | {
      readonly id: string;
      readonly phase: "injection_sanitize";
      readonly category: "invisible_control_chars" | "html_hidden_markup";
      readonly description: string;
      readonly detect: SpanDetector;
      readonly preserveCodeSpans: boolean;
      readonly warningOnMatch: InjectionWarningFlag;
      readonly clientMode: "strip_span";
      readonly serverMode: "strip_span";
    }
  | {
      readonly id: string;
      readonly phase: "injection_detect";
      readonly category: "jailbreak_syntax";
      readonly description: string;
      readonly detect: SpanDetector;
      readonly warningOnMatch: InjectionWarningFlag;
      readonly clientMode: "attach_warning";
      readonly serverMode: "attach_warning";
    };

export function detectRegexReplacement(pattern: RegExp, replacement: string): SpanDetector {
  return (input: string): readonly RuleMatchSpan[] => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    const spans: RuleMatchSpan[] = [];
    let match = re.exec(input);
    while (match !== null) {
      const matchedText = match[0];
      if (matchedText.length > 0) {
        spans.push({
          start: match.index,
          end: match.index + matchedText.length,
          replacement,
        });
      } else {
        re.lastIndex += 1;
      }
      match = re.exec(input);
    }
    return spans;
  };
}

export function computeShannonEntropy(token: string): number {
  if (token.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of token) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = token.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const HEX_ONLY_RE = /^[0-9a-fA-F]+$/;
const BASE64_LIKE_RE = /^[A-Za-z0-9+/=_-]+$/;

function hasMixedCharacterClasses(token: string): boolean {
  let hasUpper = false;
  let hasLower = false;
  let hasDigit = false;
  for (const ch of token) {
    if (ch >= "A" && ch <= "Z") hasUpper = true;
    else if (ch >= "a" && ch <= "z") hasLower = true;
    else if (ch >= "0" && ch <= "9") hasDigit = true;
  }
  return (
    (hasUpper && hasLower && hasDigit) ||
    (HEX_ONLY_RE.test(token) && hasDigit && (hasLower || hasUpper))
  );
}

export function detectHighEntropyTokens(options: {
  readonly minLength: number;
  readonly base64EntropyThreshold: number;
  readonly hexEntropyThreshold: number;
}): SpanDetector {
  const candidateRe = /\b[A-Za-z0-9+/=_-]{32,}\b/g;
  return (input: string): readonly RuleMatchSpan[] => {
    const spans: RuleMatchSpan[] = [];
    const re = new RegExp(candidateRe.source, "g");
    let match = re.exec(input);
    while (match !== null) {
      const token = match[0];
      if (
        token.length >= options.minLength &&
        !token.startsWith("REDACTED") &&
        !token.includes("__") &&
        hasMixedCharacterClasses(token)
      ) {
        const entropy = computeShannonEntropy(token);
        const isHex = HEX_ONLY_RE.test(token);
        const threshold = isHex ? options.hexEntropyThreshold : options.base64EntropyThreshold;
        if (entropy >= threshold && BASE64_LIKE_RE.test(token)) {
          spans.push({
            start: match.index,
            end: match.index + token.length,
            replacement: "[REDACTED]",
          });
        }
      }
      match = re.exec(input);
    }
    return spans;
  };
}

export function detectLocalFilesystemPaths(): SpanDetector {
  const unixPathRe = /(?:^|(?<=[\s"'`(=:]))(\/(?:Users|home)\/[A-Za-z0-9._-]+)(\/[^\s"'`)\]]*)?/g;
  const winPathRe = /(?:^|(?<=[\s"'`(=:]))([A-Za-z]:\\Users\\[A-Za-z0-9._-]+)(\\[^\s"'`)\]]*)?/g;

  return (input: string): readonly RuleMatchSpan[] => {
    const spans: RuleMatchSpan[] = [];

    const uRe = new RegExp(unixPathRe.source, "g");
    let match = uRe.exec(input);
    while (match !== null) {
      const full = match[0];
      const suffix = match[2] ?? "";
      spans.push({
        start: match.index,
        end: match.index + full.length,
        replacement: `~${suffix}`,
      });
      match = uRe.exec(input);
    }

    const wRe = new RegExp(winPathRe.source, "g");
    match = wRe.exec(input);
    while (match !== null) {
      const full = match[0];
      const rawSuffix = match[2] ?? "";
      const normalizedSuffix = rawSuffix.replace(/\\/g, "/");
      spans.push({
        start: match.index,
        end: match.index + full.length,
        replacement: `~${normalizedSuffix}`,
      });
      match = wRe.exec(input);
    }

    return spans;
  };
}

export function detectPrivateIpv4Ranges(): SpanDetector {
  const ipv4CandidateRe = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

  return (input: string): readonly RuleMatchSpan[] => {
    const spans: RuleMatchSpan[] = [];
    const re = new RegExp(ipv4CandidateRe.source, "g");
    let match = re.exec(input);
    while (match !== null) {
      const o1 = Number(match[1]);
      const o2 = Number(match[2]);
      const o3 = Number(match[3]);
      const o4 = Number(match[4]);
      const validOctets =
        o1 >= 0 &&
        o1 <= 255 &&
        o2 >= 0 &&
        o2 <= 255 &&
        o3 >= 0 &&
        o3 <= 255 &&
        o4 >= 0 &&
        o4 <= 255;
      if (validOctets) {
        const isPrivate =
          o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168);
        if (isPrivate) {
          spans.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement: "[REDACTED]",
          });
        }
      }
      match = re.exec(input);
    }
    return spans;
  };
}

interface CodeRange {
  readonly start: number;
  readonly end: number;
}

function findMarkdownCodeRanges(input: string): readonly CodeRange[] {
  const ranges: CodeRange[] = [];
  const fenceRe = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
  let match = fenceRe.exec(input);
  while (match !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
    match = fenceRe.exec(input);
  }

  const inlineRe = /`[^`\n]+`/g;
  match = inlineRe.exec(input);
  while (match !== null) {
    const s = match.index;
    const e = s + match[0].length;
    const insideFence = ranges.some((r) => s >= r.start && e <= r.end);
    if (!insideFence) {
      ranges.push({ start: s, end: e });
    }
    match = inlineRe.exec(input);
  }
  return ranges;
}

export const SECURITY_RULE_TABLE: readonly SecurityRuleEntry[] = [
  {
    id: "dlp.cloud_api_key",
    phase: "dlp",
    category: "cloud_api_key",
    description: "Cloud and API keys (sk-..., ghp_..., AKIA..., AIza..., xoxb-...)",
    detect: detectRegexReplacement(
      /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/g,
      "[REDACTED]",
    ),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.jwt_token",
    phase: "dlp",
    category: "jwt_token",
    description: "Three-part Base64URL JWT tokens",
    detect: detectRegexReplacement(
      /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    ),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.pem_private_key",
    phase: "dlp",
    category: "pem_private_key",
    description: "PEM private key blocks",
    detect: detectRegexReplacement(
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
      "[REDACTED]",
    ),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.dotenv_assignment",
    phase: "dlp",
    category: "dotenv_assignment",
    description: ".env KEY=VALUE secret assignment lines",
    detect: detectRegexReplacement(
      /^(?:export\s+)?[A-Z][A-Z0-9_]*_(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH|DSN|URL|URI|PRIVATE)\s*=\s*(?:["'][^"'\n]+["']|[^\s#\n]+)$/gm,
      "[REDACTED]",
    ),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.local_filesystem_path",
    phase: "dlp",
    category: "local_filesystem_path",
    description:
      "Local absolute paths (/Users/username/..., /home/username/..., C:\\Users\\username\\...)",
    detect: detectLocalFilesystemPaths(),
    clientMode: "normalize_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.private_ipv4_address",
    phase: "dlp",
    category: "private_ipv4_address",
    description: "Private IPv4 addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x)",
    detect: detectPrivateIpv4Ranges(),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.internal_domain_name",
    phase: "dlp",
    category: "internal_domain_name",
    description: "Internal hostnames ending in .local or .internal",
    detect: detectRegexReplacement(/\b(?:[a-zA-Z0-9-]+\.)+(?:local|internal)\b/gi, "[REDACTED]"),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "dlp.high_entropy_secret",
    phase: "dlp",
    category: "high_entropy_secret",
    description: "High-entropy Base64 or Hex random secret strings",
    detect: detectHighEntropyTokens({
      minLength: 32,
      base64EntropyThreshold: 4.3,
      hexEntropyThreshold: 3.6,
    }),
    clientMode: "redact_span",
    serverMode: "reject_422",
  },
  {
    id: "injection.invisible_control_chars",
    phase: "injection_sanitize",
    category: "invisible_control_chars",
    description: "Invisible zero-width spaces and RTL/Bidi control characters",
    detect: detectRegexReplacement(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ""),
    preserveCodeSpans: false,
    warningOnMatch: "stripped_bidi_or_zero_width_chars",
    clientMode: "strip_span",
    serverMode: "strip_span",
  },
  {
    id: "injection.html_hidden_markup",
    phase: "injection_sanitize",
    category: "html_hidden_markup",
    description: "HTML comments and elements with hidden or invisible style attributes",
    detect: detectRegexReplacement(
      /<!--[\s\S]*?-->|<([a-zA-Z0-9-]+)\b[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0)[^"']*["'])[^>]*>[\s\S]*?<\/\1>|<([a-zA-Z0-9-]+)\b[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0)[^"']*["'])[^>]*\/?>/gi,
      "",
    ),
    preserveCodeSpans: true,
    warningOnMatch: "stripped_hidden_html_content",
    clientMode: "strip_span",
    serverMode: "strip_span",
  },
  {
    id: "injection.jailbreak_ignore_previous",
    phase: "injection_detect",
    category: "jailbreak_syntax",
    description:
      "Prompt override instructions (Ignore previous instructions, Disregard prior instructions)",
    detect: detectRegexReplacement(
      /\b(?:ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directions)|disregard\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules))\b/gi,
      "",
    ),
    warningOnMatch: "flagged_ignore_previous_instructions",
    clientMode: "attach_warning",
    serverMode: "attach_warning",
  },
  {
    id: "injection.jailbreak_system_override",
    phase: "injection_detect",
    category: "jailbreak_syntax",
    description: "System override and delimiter spoofing syntax",
    detect: detectRegexReplacement(
      /(?:system\s+override\s*:|<\s*\|?\s*im_start\s*\|?\s*>\s*system|\[system\s+prompt\s+override\]|###\s*system\s+instruction)/gi,
      "",
    ),
    warningOnMatch: "flagged_system_override_syntax",
    clientMode: "attach_warning",
    serverMode: "attach_warning",
  },
] as const;

function applySpans(input: string, spans: readonly RuleMatchSpan[]): string {
  if (spans.length === 0) return input;
  const sorted = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: RuleMatchSpan[] = [];
  let cursor = 0;
  for (const span of sorted) {
    if (span.start >= cursor) {
      nonOverlapping.push(span);
      cursor = span.end;
    }
  }
  let result = "";
  let lastIndex = 0;
  for (const span of nonOverlapping) {
    result += input.slice(lastIndex, span.start) + span.replacement;
    lastIndex = span.end;
  }
  result += input.slice(lastIndex);
  return result;
}

export type RuleExecutionMode = "client" | "server";

export type RuleTableEvaluationResult =
  | {
      readonly kind: "dlp_blocked";
      readonly violatedCategories: NonEmptyArray<DlpRuleCategory>;
    }
  | {
      readonly kind: "transformed";
      readonly outputText: string;
      readonly redactedCategories: readonly DlpRuleCategory[];
      readonly injectionWarnings: readonly InjectionWarningFlag[];
    };

export function evaluateRuleTable(
  input: string,
  mode: RuleExecutionMode,
  rules: readonly SecurityRuleEntry[] = SECURITY_RULE_TABLE,
): RuleTableEvaluationResult {
  let workingText = input;
  const triggeredDlp = new Set<DlpRuleCategory>();
  const triggeredWarnings = new Set<InjectionWarningFlag>();

  const dlpRules = rules.filter(
    (r): r is Extract<SecurityRuleEntry, { readonly phase: "dlp" }> => r.phase === "dlp",
  );

  const serverClaimedSpans: Array<{ readonly start: number; readonly end: number }> = [];

  for (const rule of dlpRules) {
    const rawSpans = rule.detect(workingText);
    const spans =
      mode === "server"
        ? rawSpans.filter(
            (s) => !serverClaimedSpans.some((c) => s.start < c.end && s.end > c.start),
          )
        : rawSpans;

    if (spans.length > 0) {
      triggeredDlp.add(rule.category);
      if (mode === "client") {
        if (rule.clientMode === "block_submission") {
          const list = Array.from(triggeredDlp);
          return {
            kind: "dlp_blocked",
            violatedCategories: [rule.category, ...list.filter((c) => c !== rule.category)],
          };
        }
        workingText = applySpans(workingText, spans);
      } else {
        for (const s of spans) {
          serverClaimedSpans.push({ start: s.start, end: s.end });
        }
      }
    }
  }

  if (mode === "server" && triggeredDlp.size > 0) {
    const [first, ...rest] = Array.from(triggeredDlp);
    if (first !== undefined) {
      return {
        kind: "dlp_blocked",
        violatedCategories: [first, ...rest],
      };
    }
  }

  const sanitizeRules = rules.filter(
    (r): r is Extract<SecurityRuleEntry, { readonly phase: "injection_sanitize" }> =>
      r.phase === "injection_sanitize",
  );

  for (const rule of sanitizeRules) {
    const rawSpans = rule.detect(workingText);
    const filteredSpans = rule.preserveCodeSpans
      ? (() => {
          const codeRanges = findMarkdownCodeRanges(workingText);
          return rawSpans.filter(
            (span) => !codeRanges.some((cr) => span.start >= cr.start && span.end <= cr.end),
          );
        })()
      : rawSpans;

    if (filteredSpans.length > 0) {
      triggeredWarnings.add(rule.warningOnMatch);
      workingText = applySpans(workingText, filteredSpans);
    }
  }

  const detectRules = rules.filter(
    (r): r is Extract<SecurityRuleEntry, { readonly phase: "injection_detect" }> =>
      r.phase === "injection_detect",
  );

  for (const rule of detectRules) {
    const spans = rule.detect(workingText);
    if (spans.length > 0) {
      triggeredWarnings.add(rule.warningOnMatch);
    }
  }

  return {
    kind: "transformed",
    outputText: workingText,
    redactedCategories: Array.from(triggeredDlp),
    injectionWarnings: Array.from(triggeredWarnings),
  };
}
