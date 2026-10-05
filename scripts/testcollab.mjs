// One entry point for the TestCollab steps: the one-time setup, the tests, tc report and tc gate.
import "./load-env.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { IDS_FILE, PARAMETERS, loadSeedGroups } from "./prompt-groups.mjs";
import { api, testcollabConfig } from "./testcollab-api.mjs";

const PLACEHOLDER_PREFIX = "REPLACE_WITH_";
const JUNIT_FILE = "reports/junit.xml";
// tc report --auto-create writes the ID of the test plan it made to this file, as KEY=value.
const PLAN_FILE = "tmp/tc_test_plan";
const PLAN_KEY = "TESTCOLLAB_TEST_PLAN_ID";
const SUITE_TITLE = "MCP support server";
const ROOT_SUITE_ID = 0;
const NORMAL_PRIORITY = 1;
const JSON_INDENT = 2;
const EXIT_OK = 0;
const EXIT_FAILED = 1;

// The steps of each test case. TestCollab puts the values of one dataset row in the {{...}} places.
const STEPS = [
  {
    step: "Start the support server in the {{server}} variant. Connect the assistant to it.",
    expected_result: "The assistant has the four tools of the server."
  },
  {
    step: "Send this prompt to the assistant: {{prompt}}",
    expected_result: "The assistant calls: {{must_call}}. The assistant does not call: {{must_not_call}}."
  }
];

function requireValue(name) {
  const value = process.env[name];
  if (!value || value.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error(`${name} is required. Copy .env.example to .env and replace its placeholder.`);
  }
  return value;
}

function run(command, args) {
  const onWindows = process.platform === "win32";
  const result = spawnSync(onWindows ? `${command}.cmd` : command, args, {
    env: process.env,
    stdio: "inherit",
    shell: onWindows
  });
  if (result.error) throw result.error;
  return result.status ?? EXIT_FAILED;
}

function reportedPlanId() {
  if (!existsSync(PLAN_FILE)) throw new Error(`${PLAN_FILE} not found. Run "npm run tc:report" first.`);
  const [key, value] = readFileSync(PLAN_FILE, "utf8").trim().split("=");
  if (key !== PLAN_KEY || !value) throw new Error(`${PLAN_FILE} does not hold ${PLAN_KEY}.`);
  return value;
}

// A dataset stores a row by the key of each parameter: { "1": "default", "2": "Where is ..." }.
const parameters = PARAMETERS.map((field, index) => ({ key: index + 1, field }));
const datarow = row => Object.fromEntries(parameters.map(parameter => [String(parameter.key), row[parameter.field]]));

// One time: make one suite, and for each seed file one test case with its test dataset.
async function setup() {
  if (existsSync(IDS_FILE)) {
    throw new Error(`${IDS_FILE} exists, so the test cases are in TestCollab already. Delete the file to make them again.`);
  }
  const { project } = testcollabConfig();
  const suite = await api("POST", "/suites", { body: { title: SUITE_TITLE, project, parent_id: ROOT_SUITE_ID } });

  const groups = [];
  for (const group of loadSeedGroups()) {
    const testCase = await api("POST", "/testcases", {
      body: { title: group.title, description: group.description, project, suite: suite.id, priority: NORMAL_PRIORITY, steps: STEPS }
    });
    const dataset = await api("POST", "/testdatasets", {
      body: { name: `${group.key} ${group.title}`, project, parameters, datarows: JSON.stringify(group.rows.map(datarow)) }
    });
    await api("POST", "/testdatasets/link", { body: { testcase: testCase.id, project, testdataset: [dataset.id] } });
    groups.push({ key: group.key, title: group.title, testCaseId: testCase.id, datasetId: dataset.id });
    console.log(`Created test case ${testCase.id} with ${group.rows.length} prompts: ${group.title}`);
  }

  mkdirSync(dirname(IDS_FILE), { recursive: true });
  writeFileSync(IDS_FILE, JSON.stringify({ project, suiteId: suite.id, groups }, null, JSON_INDENT));
  console.log(`\nThe IDs are in ${IDS_FILE}. From now on "npm test" reads the prompts from TestCollab.`);
  return EXIT_OK;
}

const projectArgs = ["--project", requireValue("TC_PROJECT_ID")];
requireValue("TESTCOLLAB_TOKEN");
if (process.env.TC_API_URL) projectArgs.push("--api-url", process.env.TC_API_URL);

const actions = {
  setup,
  test: () => run("node", ["scripts/run-prompt-groups.mjs"]),
  // The test names hold the IDs of the test cases, so tc report adds the results to those cases.
  report: () => run("tc", ["report", ...projectArgs, "--format", "junit", "--result-file", JUNIT_FILE, "--auto-create"]),
  // One failed prompt group fails the gate. A prompt group that did not run fails it too.
  gate: () =>
    run("tc", ["gate", ...projectArgs, "--test-plan-id", reportedPlanId(), "--fail-on", "failed", "--require-complete"]),
  demo: () => {
    // A failed prompt group gives a non-zero exit code here. The results still go to TestCollab, and the gate decides.
    actions.test();
    if (actions.report() !== EXIT_OK) return EXIT_FAILED;
    return actions.gate();
  }
};

const action = actions[process.argv[2]];
if (!action) throw new Error(`Usage: node scripts/testcollab.mjs <${Object.keys(actions).join("|")}>`);
process.exitCode = await action();
