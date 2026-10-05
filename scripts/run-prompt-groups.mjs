// Send each prompt of each prompt group to the agent, and write what tc report reads:
// one JUnit file with one test for each prompt group, and one transcript file for each prompt.
import "./load-env.mjs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { create } from "xmlbuilder2";
import { MODEL, runAgent } from "../agent/agent.mjs";
import { loadGroups, toolList } from "./prompt-groups.mjs";

// The output of an agent changes from run to run, so each prompt runs more than once.
const RUNS_PER_PROMPT = 3;
// A tool that the agent must call: most runs must call it. A tool that it must not call: no run may call it.
const MIN_RUNS_FOR_MUST_CALL = 2;

const REPORT_DIR = "reports";
const TRANSCRIPT_DIR = `${REPORT_DIR}/transcripts`;
const JUNIT_FILE = `${REPORT_DIR}/junit.xml`;
const RESULTS_FILE = `${REPORT_DIR}/prompt-group-results.json`;
const SUITE_NAME = "MCP support server";
const FAILURE_TYPE = "PromptGroupFailed";
const MS_PER_SECOND = 1000;
const SECONDS_DECIMALS = 3;
const JSON_INDENT = 2;
const EXIT_FAILED = 1;

const calls = (run, tool) => run.toolCalls.some(call => call.name === tool);
const count = (runs, tool) => runs.filter(run => calls(run, tool)).length;

// The checks read the tool calls of the agent, not the wording of its reply.
function checkRow(row, runs) {
  const checks = [
    ...toolList(row.must_call).map(tool => ({
      passed: count(runs, tool) >= MIN_RUNS_FOR_MUST_CALL,
      summary: `${count(runs, tool)} of ${runs.length} runs call ${tool}. Expected: at least ${MIN_RUNS_FOR_MUST_CALL}.`
    })),
    ...toolList(row.must_not_call).map(tool => ({
      passed: count(runs, tool) === 0,
      summary: `${count(runs, tool)} of ${runs.length} runs call ${tool}. Expected: no run.`
    }))
  ];
  return { passed: checks.every(check => check.passed), checks };
}

const describeToolCalls = run =>
  run.toolCalls.length ? run.toolCalls.map(call => `${call.name} ${JSON.stringify(call.input)}`).join(", ") : "none";

function messageLines(message) {
  if (typeof message.content === "string") return [`PERSON: ${message.content}`];
  return message.content.map(block => {
    if (block.type === "text") return `AGENT: ${block.text}`;
    if (block.type === "tool_use") return `TOOL CALL: ${block.name} ${JSON.stringify(block.input)}`;
    if (block.type === "tool_result") return `TOOL RESULT: ${block.content}`;
    return `(${block.type})`;
  });
}

function transcriptText(group, result) {
  const lines = [
    `Prompt group: ${group.key} ${group.title}`,
    `Model: ${MODEL}`,
    `Server variant: ${result.row.server}`,
    `Prompt ${result.number}: ${result.row.prompt}`,
    `Result: ${result.passed ? "PASSED" : "FAILED"}`,
    "",
    "Checks:",
    ...result.checks.map(check => `  ${check.passed ? "PASSED" : "FAILED"}: ${check.summary}`)
  ];
  result.runs.forEach((run, index) => {
    lines.push("", `--- Run ${index + 1} of ${result.runs.length} (stop reason: ${run.stopReason}) ---`);
    lines.push(...run.messages.flatMap(messageLines));
  });
  return `${lines.join("\n")}\n`;
}

async function runRow(group, row, number) {
  const runs = await Promise.all(
    Array.from({ length: RUNS_PER_PROMPT }, () => runAgent({ prompt: row.prompt, serverVariant: row.server }))
  );
  const result = { number, row, runs, ...checkRow(row, runs), transcript: `${TRANSCRIPT_DIR}/${group.key}-prompt-${number}.txt` };
  writeFileSync(result.transcript, transcriptText(group, result));
  return result;
}

async function runGroup(group) {
  const startedAtMs = Date.now();
  const results = [];
  // One prompt after the other. The runs of one prompt go in parallel.
  for (const [index, row] of group.rows.entries()) results.push(await runRow(group, row, index + 1));
  const failed = results.filter(result => !result.passed);
  console.log(`${failed.length ? "FAILED" : "PASSED"}  ${group.key} ${group.title} (${results.length - failed.length} of ${results.length} prompts)`);
  return { group, results, failed, seconds: (Date.now() - startedAtMs) / MS_PER_SECOND };
}

// The failed prompts and what each run did. tc report puts this text in the result comment.
function failureText({ results, failed }) {
  const blocks = failed.map(result =>
    [
      `Prompt ${result.number}: ${result.row.prompt}`,
      ...result.checks.filter(check => !check.passed).map(check => `FAILED: ${check.summary}`),
      ...result.runs.map((run, index) => `Run ${index + 1}: ${describeToolCalls(run)}`)
    ].join("\n")
  );
  return [`Prompt group failed: ${failed.length} of ${results.length} prompts failed.`, ...blocks].join("\n\n");
}

function writeJUnit(outcomes, startedAt) {
  const suite = create({ version: "1.0", encoding: "UTF-8" }).ele("testsuite", {
    name: SUITE_NAME,
    tests: outcomes.length,
    failures: outcomes.filter(outcome => outcome.failed.length).length,
    errors: 0,
    skipped: 0,
    time: outcomes.reduce((total, outcome) => total + outcome.seconds, 0).toFixed(SECONDS_DECIMALS),
    timestamp: startedAt
  });

  for (const outcome of outcomes) {
    const { group, results, failed } = outcome;
    // tc report finds the test case by the ID in the test name. Without an ID it matches by the title.
    const testcase = suite.ele("testcase", {
      classname: SUITE_NAME,
      name: group.testCaseId ? `[TC-${group.testCaseId}] ${group.title}` : group.title,
      time: outcome.seconds.toFixed(SECONDS_DECIMALS)
    });
    if (failed.length) {
      const text = failureText(outcome);
      testcase.ele("failure", { type: FAILURE_TYPE, message: text.split("\n")[0] }).txt(text);
    }
    // tc report attaches each file that an ATTACHMENT line names to the result of the test case.
    testcase.ele("system-out").dat(
      [
        ...results.map(result => `Prompt ${result.number}: ${result.passed ? "PASSED" : "FAILED"} - ${result.row.prompt}`),
        ...results.map(result => `[[ATTACHMENT|${result.transcript}]]`)
      ].join("\n")
    );
  }
  writeFileSync(JUNIT_FILE, suite.end({ prettyPrint: true }));
}

function writeResults(outcomes, startedAt) {
  const groups = outcomes.map(({ group, results }) => ({
    key: group.key,
    title: group.title,
    prompts: results.map(result => ({
      number: result.number,
      ...result.row,
      passed: result.passed,
      checks: result.checks,
      toolCalls: result.runs.map(run => run.toolCalls)
    }))
  }));
  writeFileSync(RESULTS_FILE, JSON.stringify({ model: MODEL, startedAt, runsPerPrompt: RUNS_PER_PROMPT, groups }, null, JSON_INDENT));
}

const startedAt = new Date().toISOString();
rmSync(REPORT_DIR, { recursive: true, force: true });
mkdirSync(TRANSCRIPT_DIR, { recursive: true });

// "npm test -- PG-04" runs one group. Without an argument all groups run.
const onlyKeys = process.argv.slice(2);
const loaded = await loadGroups();
const groups = loaded.groups.filter(group => !onlyKeys.length || onlyKeys.includes(group.key));
console.log(`Prompt groups from ${loaded.source}. Model: ${MODEL}. ${RUNS_PER_PROMPT} runs for each prompt.\n`);

const outcomes = [];
for (const group of groups) outcomes.push(await runGroup(group));

writeJUnit(outcomes, startedAt);
writeResults(outcomes, startedAt);

const failedGroups = outcomes.filter(outcome => outcome.failed.length);
console.log(`\n${outcomes.length - failedGroups.length} of ${outcomes.length} prompt groups passed. Report: ${JUNIT_FILE}`);
if (failedGroups.length) {
  console.log(`\n${failedGroups.map(failureText).join("\n\n")}`);
  process.exitCode = EXIT_FAILED;
}
