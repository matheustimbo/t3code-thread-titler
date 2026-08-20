import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Same file the /handbook skill's tooling reads, so the token has one home and
// rotating it there is picked up without touching this project.
const CLICKUP_TOKEN_PATH = join(homedir(), ".config", "clickup", "token");

function readClickUpToken(): string | null {
  const fromEnv = process.env.CLICKUP_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = readFileSync(CLICKUP_TOKEN_PATH, "utf8").trim();
    return fromFile.length > 0 ? fromFile : null;
  } catch {
    return null;
  }
}

// Matches the format the team actually shares: app.clickup.com/t/<team_id>/<task_id>.
// Unanchored so a link surrounded by other text still counts; the trailing
// lookahead keeps the task id from swallowing a longer path.
const CLICKUP_LINK_RE =
  /https:\/\/app\.clickup\.com\/t\/(\d+)\/([a-zA-Z0-9]+)\/?(?![\w/-])/g;

export interface ClickUpTaskRef {
  readonly kind: "clickup";
  readonly key: string;
  readonly teamId: string;
  readonly taskId: string;
}

export function findClickUpTaskRefs(text: string): ClickUpTaskRef[] {
  const refs: ClickUpTaskRef[] = [];
  for (const match of text.matchAll(CLICKUP_LINK_RE)) {
    const [, teamId, taskId] = match;
    refs.push({ kind: "clickup", key: `clickup:${teamId}/${taskId}`, teamId, taskId });
  }
  return refs;
}

export async function resolveClickUpTitle(ref: ClickUpTaskRef): Promise<string | null> {
  const token = readClickUpToken();
  if (!token) {
    console.error(
      `[thread-titler] no ClickUp token (checked $CLICKUP_API_TOKEN and ${CLICKUP_TOKEN_PATH}); skipping lookup`,
    );
    return null;
  }

  const task =
    (await fetchClickUpTask(ref.taskId, token)) ??
    // Regular lookup failed (404) — could be a custom task id, retry with the team id
    // embedded in the link.
    (await fetchClickUpTask(ref.taskId, token, ref.teamId));
  if (task === null) return null;

  // ClickUp's equivalent of GitHub's "#172" is the task's own id — the human-readable
  // custom id when the space defines one, else the raw id (same value the repo's
  // `clickup-<id>` branch names use).
  return prefixWithId(task.customId ?? task.id, task.name);
}

interface ClickUpTask {
  readonly id: string;
  readonly customId: string | null;
  readonly name: string;
}

async function fetchClickUpTask(
  taskId: string,
  token: string,
  teamIdForCustomIds?: string,
): Promise<ClickUpTask | null> {
  const url = new URL(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`);
  if (teamIdForCustomIds) {
    url.searchParams.set("custom_task_ids", "true");
    url.searchParams.set("team_id", teamIdForCustomIds);
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: token } });
  } catch (err) {
    console.error("[thread-titler] ClickUp API request failed:", err);
    return null;
  }

  if (!response.ok) {
    if (response.status !== 404) {
      console.error(`[thread-titler] ClickUp API returned ${response.status} for task ${taskId}`);
    }
    return null;
  }

  const data = (await response.json()) as {
    id?: unknown;
    custom_id?: unknown;
    name?: unknown;
  };
  if (typeof data.name !== "string" || data.name.trim().length === 0) return null;
  return {
    id: typeof data.id === "string" && data.id.length > 0 ? data.id : taskId,
    customId: typeof data.custom_id === "string" && data.custom_id.length > 0 ? data.custom_id : null,
    name: data.name.trim(),
  };
}

/** "<id> - <name>", unless the name already leads with that id. */
function prefixWithId(id: string, name: string): string {
  return name.toLowerCase().startsWith(id.toLowerCase()) ? name : `${id} - ${name}`;
}
