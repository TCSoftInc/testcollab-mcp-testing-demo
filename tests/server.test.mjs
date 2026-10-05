// Exact tests for the MCP server. No model takes part, so the same input always gives the same output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { connectToServer, describeTools } from "../agent/mcp-client.mjs";

const approvedTools = JSON.parse(readFileSync(new URL("./approved-tools.json", import.meta.url), "utf8"));
const POISONED_VARIANT = "poisoned";

let mcp;
before(async () => {
  mcp = await connectToServer();
});
after(async () => {
  await mcp.close();
});

const call = (name, args) => mcp.callTool({ name, arguments: args });
const textOf = result => result.content.map(part => part.text).join("\n");

// The model reads the name, the description and the input schema of each tool.
// A change to one of them changes the behavior of the agent, so a person must approve it:
// review the change, run the prompt groups, then run "npm run tools:approve".
test("the tool list is the approved tool list", async () => {
  assert.deepEqual(await describeTools(mcp), approvedTools);
});

test("a changed tool description is found", async () => {
  const poisoned = await connectToServer(POISONED_VARIANT);
  try {
    assert.notDeepEqual(await describeTools(poisoned), approvedTools);
  } finally {
    await poisoned.close();
  }
});

test("get_order returns the order", async () => {
  const result = await call("get_order", { order_id: "A-1042" });
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), "Order A-1042: blender, 89.00 USD. Status: delivered on 2026-09-28.");
});

test("get_order answers an unknown order with an error", async () => {
  const result = await call("get_order", { order_id: "A-9999" });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "There is no order A-9999.");
});

test("read_ticket returns the order and the customer message", async () => {
  const result = await call("read_ticket", { ticket_id: "T-88" });
  assert.equal(textOf(result), "Order: A-1042\nCustomer message: My parcel arrived two days late. Can you tell me why?");
});

test("send_reply confirms the reply", async () => {
  const result = await call("send_reply", { ticket_id: "T-88", text: "The parcel arrives on Friday." });
  assert.equal(textOf(result), "Reply sent to the customer of ticket T-88.");
});

test("send_reply refuses an unknown ticket", async () => {
  const result = await call("send_reply", { ticket_id: "T-0", text: "Hello" });
  assert.equal(result.isError, true);
});

test("refund_order confirms the refund", async () => {
  const result = await call("refund_order", { order_id: "A-2210" });
  assert.equal(textOf(result), "Order A-2210 refunded.");
});

test("refund_order refuses a request without an order ID", async () => {
  const result = await call("refund_order", {});
  assert.equal(result.isError, true);
});
