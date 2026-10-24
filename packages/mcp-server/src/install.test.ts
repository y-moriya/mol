import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectClaudeDesktopConfigPath,
  detectCursorConfigPath,
  detectCodexConfigPath,
  detectWindsurfConfigPath,
  detectAntigravityConfigPaths,
  detectInstalledClients,
  detectInstalledRuleTargets,
  mergeAutonomousRule,
  mergeMcpConfig,
  AUTONOMOUS_AGENT_RULE_MD,
} from "./install";

describe("mol installer engine", () => {
  it("detects configuration paths for Claude Desktop, Cursor, and Codex on current platform", () => {
    const home = homedir();
    const claudePath = detectClaudeDesktopConfigPath(home, "linux");
    expect(claudePath).toBe(resolve(home, ".config/Claude/claude_desktop_config.json"));

    const cursorPath = detectCursorConfigPath(home, "linux");
    expect(cursorPath).toBe(resolve(home, ".cursor/mcp.json"));

    const codexPath = detectCodexConfigPath(home);
    expect(codexPath).toBe(resolve(home, ".codex/mcp.json"));

    const windsurfPath = detectWindsurfConfigPath(home);
    expect(windsurfPath).toBe(resolve(home, ".codeium/windsurf/mcp_config.json"));

    const antigravityPaths = detectAntigravityConfigPaths("/tmp/mock-home");
    expect(antigravityPaths).toContain(resolve("/tmp/mock-home", ".gemini/config/mcp_config.json"));

    const clients = detectInstalledClients("/tmp/mock-home");
    const antigravityTarget = clients.find((c) => c.type === "antigravity");
    expect(antigravityTarget).toBeDefined();
    expect(antigravityTarget?.configPath).toBe(
      resolve("/tmp/mock-home", ".gemini/config/mcp_config.json"),
    );

    const darwinClaude = detectClaudeDesktopConfigPath("/Users/dev", "darwin");
    expect(darwinClaude).toBe(
      "/Users/dev/Library/Application Support/Claude/claude_desktop_config.json",
    );
  });

  it("merges mol mcp server entry idempotently into existing or empty config json", () => {
    const emptyMerged = mergeMcpConfig("{}", {
      serverName: "mol",
      command: "node",
      args: ["/home/user/.mol/mcp.mjs"],
      env: {
        MOL_API_URL: "https://mol.gunjobiyori.com",
        MOL_API_KEY: "mol_live_key_sample",
      },
    });

    const parsed = JSON.parse(emptyMerged) as {
      mcpServers: {
        mol: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    expect(parsed.mcpServers.mol.command).toBe("node");
    expect(parsed.mcpServers.mol.args).toEqual(["/home/user/.mol/mcp.mjs"]);
    expect(parsed.mcpServers.mol.env.MOL_API_URL).toBe("https://mol.gunjobiyori.com");
    expect(parsed.mcpServers.mol.env.MOL_API_KEY).toBe("mol_live_key_sample");

    const existingWithOther = JSON.stringify({
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@mcp/fs"] },
      },
    });

    const mergedWithOther = mergeMcpConfig(existingWithOther, {
      serverName: "mol",
      command: "node",
      args: ["/home/user/.mol/mcp.mjs"],
      env: {
        MOL_API_URL: "https://mol.gunjobiyori.com",
        MOL_API_KEY: "mol_live_key_sample",
      },
    });

    const parsedWithOther = JSON.parse(mergedWithOther) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsedWithOther.mcpServers["filesystem"]).toBeDefined();
    expect(parsedWithOther.mcpServers["mol"]).toBeDefined();
  });

  it("detects autonomous rule paths and merges rule markdown idempotently", () => {
    const targets = detectInstalledRuleTargets("/tmp/mock-home");
    expect(targets.some((t) => t.type === "antigravity" && t.rulePath.includes("GEMINI.md"))).toBe(
      true,
    );
    expect(targets.some((t) => t.type === "claude" && t.rulePath.includes("CLAUDE.md"))).toBe(true);
    expect(targets.some((t) => t.type === "cursor" && t.rulePath.includes("mol.mdc"))).toBe(true);

    const emptyMerged = mergeAutonomousRule("", AUTONOMOUS_AGENT_RULE_MD);
    expect(emptyMerged).toContain("<!-- mol:autonomous-agent:begin -->");
    expect(emptyMerged).toContain("publish_finding");

    const existingWithPstack = `# pstack rules\nrole: inherit-parent`;
    const mergedWithPstack = mergeAutonomousRule(existingWithPstack, AUTONOMOUS_AGENT_RULE_MD);
    expect(mergedWithPstack).toContain("# pstack rules");
    expect(mergedWithPstack).toContain("<!-- mol:autonomous-agent:begin -->");

    // Second merge should replace the block without duplicating
    const secondMerge = mergeAutonomousRule(mergedWithPstack, AUTONOMOUS_AGENT_RULE_MD);
    const count = (secondMerge.match(/<!-- mol:autonomous-agent:begin -->/g) || []).length;
    expect(count).toBe(1);
  });
});
