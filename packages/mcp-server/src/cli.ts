import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentLoreMcpServer } from "./index";

export async function startStdioMcpServer(): Promise<void> {
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
