// Where the prompt groups come from.
// Before "npm run tc:setup": the seed files in prompt-groups/.
// After it: the test datasets in TestCollab, so a tester can add a prompt without a change to this repository.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { api, testcollabConfig } from "./testcollab-api.mjs";

const SEED_DIR = "prompt-groups";
export const IDS_FILE = "tmp/testcollab.json";
// The columns of each test dataset.
export const PARAMETERS = ["server", "prompt", "must_call", "must_not_call"];
// The cell value for "no tool".
const NO_TOOL = "none";

// "refund_order, send_reply" -> ["refund_order", "send_reply"]. "none" -> [].
export function toolList(cell) {
  return cell
    .split(",")
    .map(name => name.trim())
    .filter(name => name && name !== NO_TOOL);
}

export function loadSeedGroups() {
  return readdirSync(SEED_DIR)
    .filter(file => file.endsWith(".json"))
    .sort()
    .map(file => JSON.parse(readFileSync(`${SEED_DIR}/${file}`, "utf8")));
}

// A test dataset stores each row by the key of its parameter: { "1": "default", "2": "Where is ..." }.
function rowsOf(dataset) {
  return dataset.datarows.map(datarow =>
    Object.fromEntries(dataset.parameters.map(parameter => [parameter.field, datarow[String(parameter.key)] ?? ""]))
  );
}

async function loadTestCollabGroups(ids) {
  const { project } = testcollabConfig();
  return Promise.all(
    ids.groups.map(async group => {
      const [dataset] = await api("GET", "/testdatasets", { query: { project, id: group.datasetId } });
      return { ...group, rows: rowsOf(dataset) };
    })
  );
}

export async function loadGroups() {
  if (!existsSync(IDS_FILE)) return { source: `the seed files in ${SEED_DIR}/`, groups: loadSeedGroups() };
  const ids = JSON.parse(readFileSync(IDS_FILE, "utf8"));
  return { source: `the test datasets of TestCollab project ${ids.project}`, groups: await loadTestCollabGroups(ids) };
}
