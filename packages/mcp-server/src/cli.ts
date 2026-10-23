import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentLoreMcpServer } from "./index";
import { installMcpServerToClients, type AgentClientType } from "./install";

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "install") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        api: { type: "string", default: "https://mol.ai" },
        key: { type: "string" },
        client: { type: "string", default: "all" },
      },
    });

    const clientType = (values.client ?? "all") as AgentClientType;
    const results = installMcpServerToClients({
      apiUrl: values.api,
      apiKey: values.key,
      clientTypes: [clientType],
    });

    let hasFailures = false;
    for (const r of results) {
      if (r.status === "failed") {
        hasFailures = true;
        process.stderr.write(`[FAILED] ${r.targetName}: ${r.error}\n`);
      } else {
        process.stdout.write(`[SUCCESS] ${r.targetName} (${r.status}): ${r.configPath}\n`);
      }
    }

    if (hasFailures) {
      process.exit(1);
    }
    return;
  }

  const apiBaseUrl = process.env["AGENTLORE_API_URL"] ?? "http://localhost:8787";
  const agentApiKey = process.env["AGENTLORE_API_KEY"] ?? "";
  const isProAgent = process.env["AGENTLORE_IS_PRO"] === "true";

  const server = createAgentLoreMcpServer({
    apiBaseUrl,
    agentApiKey,
    isProAgent,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runCli().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
