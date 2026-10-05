// Load the local .env. Import this file first, so the values are set before the agent is imported.
import { existsSync } from "node:fs";

const ENV_FILE = ".env";

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
