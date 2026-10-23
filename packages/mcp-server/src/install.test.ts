import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectClaudeDesktopConfigPath,
  detectCursorConfigPath,
  detectCodexConfigPath,
  mergeMcpConfig,
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
});
