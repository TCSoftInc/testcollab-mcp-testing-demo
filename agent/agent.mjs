// The agent under test: a model in a loop, with the tools of an MCP server.
// The loop is written out (no SDK tool runner), so each step of the harness is visible.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { DEFAULT_SERVER_VARIANT, connectToServer, describeTools } from "./mcp-client.mjs";

export const MODEL = process.env.AGENT_MODEL || "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 16000;
// One prompt needs two or three model calls. The limit stops a run that does not end.
const MAX_MODEL_CALLS = 8;
const STOPPED_AT_CALL_LIMIT = "model_call_limit";

export const SYSTEM_PROMPT = readFileSync(new URL("./system-prompt.md", import.meta.url), "utf8");

const anthropic = new Anthropic();

const textOf = result => result.content.filter(part => part.type === "text").map(part => part.text).join("\n");

// One tool call of the model becomes one tools/call request to the MCP server.
// The server answers a bad request (an unknown ID, a missing argument) with isError, and the model reads that.
async function callTool(mcp, block) {
  const result = await mcp.callTool({ name: block.name, arguments: block.input });
  return { type: "tool_result", tool_use_id: block.id, content: textOf(result), is_error: Boolean(result.isError) };
}

/**
 * Send one prompt to the agent and let it work until it stops.
 * Each run gets its own server process, so the runs do not affect each other.
 */
export async function runAgent({ prompt, serverVariant = DEFAULT_SERVER_VARIANT }) {
  const mcp = await connectToServer(serverVariant);
  try {
    // The model gets the tools as the server describes them: name, description and input schema.
    const tools = (await describeTools(mcp)).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));

    const messages = [{ role: "user", content: prompt }];
    const toolCalls = [];
    const replies = [];
    let stopReason = STOPPED_AT_CALL_LIMIT;

    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        tools,
        messages
      });

      messages.push({ role: "assistant", content: response.content });
      replies.push(...response.content.filter(block => block.type === "text").map(block => block.text));

      if (response.stop_reason !== "tool_use") {
        stopReason = response.stop_reason;
        break;
      }

      // All tool results of one turn go back in one user message.
      const results = [];
      for (const block of response.content.filter(part => part.type === "tool_use")) {
        toolCalls.push({ name: block.name, input: block.input });
        results.push(await callTool(mcp, block));
      }
      messages.push({ role: "user", content: results });
    }

    return { prompt, serverVariant, toolCalls, replies, stopReason, messages };
  } finally {
    await mcp.close();
  }
}
