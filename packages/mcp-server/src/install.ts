import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type AgentClientType = "claude" | "cursor" | "codex" | "windsurf" | "all";

export interface McpServerConfigEntry {
  readonly serverName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

export function detectClaudeDesktopConfigPath(
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "darwin") {
    return resolve(home, "Library/Application Support/Claude/claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appData = process.env["APPDATA"] ?? resolve(home, "AppData/Roaming");
    return resolve(appData, "Claude/claude_desktop_config.json");
  }
  return resolve(home, ".config/Claude/claude_desktop_config.json");
}

export function detectCursorConfigPath(
  home: string = homedir(),
  _platform: NodeJS.Platform = process.platform,
): string {
  return resolve(home, ".cursor/mcp.json");
}

export function detectCodexConfigPath(home: string = homedir()): string {
  return resolve(home, ".codex/mcp.json");
}

export function detectWindsurfConfigPath(home: string = homedir()): string {
  return resolve(home, ".codeium/windsurf/mcp_config.json");
}

export interface ClientTarget {
  readonly name: string;
  readonly type: AgentClientType;
  readonly configPath: string;
}

export function detectInstalledClients(home: string = homedir()): readonly ClientTarget[] {
  const targets: ClientTarget[] = [
    {
      name: "Claude Code / Claude Desktop",
      type: "claude",
      configPath: detectClaudeDesktopConfigPath(home),
    },
    {
      name: "Cursor",
      type: "cursor",
      configPath: detectCursorConfigPath(home),
    },
    {
      name: "Codex",
      type: "codex",
      configPath: detectCodexConfigPath(home),
    },
    {
      name: "Windsurf",
      type: "windsurf",
      configPath: detectWindsurfConfigPath(home),
    },
  ];

  return targets;
}

export function mergeMcpConfig(existingJson: string, entry: McpServerConfigEntry): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(existingJson) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const mcpServers = (
    typeof parsed["mcpServers"] === "object" && parsed["mcpServers"] !== null
      ? parsed["mcpServers"]
      : {}
  ) as Record<string, unknown>;

  mcpServers[entry.serverName] = {
    command: entry.command,
    args: [...entry.args],
    ...(entry.env ? { env: entry.env } : {}),
  };

  parsed["mcpServers"] = mcpServers;
  return JSON.stringify(parsed, null, 2);
}

export interface InstallResult {
  readonly targetName: string;
  readonly configPath: string;
  readonly status: "updated" | "created" | "failed";
  readonly error?: string;
}

export function installMcpServerToClients(options: {
  readonly clientTypes?: readonly AgentClientType[];
  readonly apiUrl?: string;
  readonly apiKey?: string;
  readonly home?: string;
}): readonly InstallResult[] {
  const home = options.home ?? homedir();
  const allTargets = detectInstalledClients(home);
  const selectedTypes = options.clientTypes ?? ["all"];

  const filteredTargets = selectedTypes.includes("all")
    ? allTargets
    : allTargets.filter((t) => selectedTypes.includes(t.type));

  const installDir = resolve(home, ".mol");
  const scriptPath = resolve(installDir, "mcp.mjs");

  const entry: McpServerConfigEntry = {
    serverName: "mol",
    command: "node",
    args: [scriptPath],
    env: {
      AGENTLORE_API_URL: options.apiUrl ?? "https://mol.gunjobiyori.com",
      ...(options.apiKey ? { AGENTLORE_API_KEY: options.apiKey } : {}),
    },
  };

  const results: InstallResult[] = [];

  for (const target of filteredTargets) {
    try {
      const dir = dirname(target.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      let existing = "{}";
      let status: "updated" | "created" = "created";
      if (existsSync(target.configPath)) {
        existing = readFileSync(target.configPath, "utf-8");
        status = "updated";
      }

      const merged = mergeMcpConfig(existing, entry);
      writeFileSync(target.configPath, merged, "utf-8");
      results.push({
        targetName: target.name,
        configPath: target.configPath,
        status,
      });
    } catch (err) {
      results.push({
        targetName: target.name,
        configPath: target.configPath,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
