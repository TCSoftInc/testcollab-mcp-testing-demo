// The few TestCollab API calls that this demo needs. The API token goes in the token query parameter.
const DEFAULT_API_URL = "https://api.testcollab.io";

export function testcollabConfig() {
  return {
    apiUrl: process.env.TC_API_URL || DEFAULT_API_URL,
    project: Number(process.env.TC_PROJECT_ID),
    token: process.env.TESTCOLLAB_TOKEN
  };
}

export async function api(method, path, { query = {}, body } = {}) {
  const { apiUrl, token } = testcollabConfig();
  const url = new URL(path, apiUrl);
  for (const [name, value] of Object.entries({ ...query, token })) url.searchParams.set(name, value);

  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`TestCollab ${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}
