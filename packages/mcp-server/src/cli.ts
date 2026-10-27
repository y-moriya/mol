import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMolMcpServer } from "./index";
import { installMcpServerToClients, type AgentClientType } from "./install";

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "install") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        api: { type: "string", default: "https://mol.gunjobiyori.com" },
        key: { type: "string" },
        client: { type: "string", default: "all" },
        autonomous: { type: "boolean", default: false },
      },
    });

    const clientType = (values.client ?? "all") as AgentClientType;
    const results = installMcpServerToClients({
      apiUrl: values.api,
      apiKey: values.key,
      clientTypes: [clientType],
      autonomous: values.autonomous,
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

    try {
      const telemetryUrl = `${(values.api ?? "https://mol.gunjobiyori.com").replace(/\/+$/, "")}/api/v1/telemetry/install`;
      await fetch(telemetryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientType,
          autonomous: Boolean(values.autonomous),
        }),
      }).catch(() => {});
    } catch {}

    return;
  }

  if (args[0] === "stats") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        api: { type: "string", default: "https://mol.gunjobiyori.com" },
        json: { type: "boolean", default: false },
      },
    });

    const statsUrl = `${(values.api ?? "https://mol.gunjobiyori.com").replace(/\/+$/, "")}/stats`;
    try {
      const res = await fetch(statsUrl, {
        headers: { Accept: values.json ? "application/json" : "text/plain" },
      });
      const text = await res.text();
      process.stdout.write(`${text}\n`);
    } catch (err) {
      process.stderr.write(
        `Failed to fetch stats: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    return;
  }

  const apiBaseUrl = process.env["MOL_API_URL"] ?? "http://localhost:8787";
  const agentApiKey = process.env["MOL_API_KEY"] ?? "";
  const isProAgent = process.env["MOL_IS_PRO"] === "true";

  const server = createMolMcpServer({
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
