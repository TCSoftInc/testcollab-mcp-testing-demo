// Start the MCP server under test as a child process and connect a client to it.
// The server tests and the agent use the same client, so they see the same server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

export const DEFAULT_SERVER_VARIANT = "default";
const SERVER_PATH = fileURLToPath(new URL("../server/support-server.mjs", import.meta.url));

export async function connectToServer(variant = DEFAULT_SERVER_VARIANT) {
  const mcp = new Client({ name: "acme-support-assistant", version: "1.0.0" });
  await mcp.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH], env: { SUPPORT_SERVER_VARIANT: variant } })
  );
  return mcp;
}

// What the model reads about each tool. A change to any of these three changes the prompt.
export async function describeTools(mcp) {
  const { tools } = await mcp.listTools();
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
