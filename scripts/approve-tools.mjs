// Write the tool list of the server to tests/approved-tools.json.
// Run this after a person reviewed a change to a tool name, a description or an input schema.
import { writeFileSync } from "node:fs";
import { connectToServer, describeTools } from "../agent/mcp-client.mjs";

const APPROVED_FILE = "tests/approved-tools.json";
const JSON_INDENT = 2;

const mcp = await connectToServer();
try {
  const tools = await describeTools(mcp);
  writeFileSync(APPROVED_FILE, `${JSON.stringify(tools, null, JSON_INDENT)}\n`);
  console.log(`Approved ${tools.length} tools: ${tools.map(tool => tool.name).join(", ")}`);
} finally {
  await mcp.close();
}
