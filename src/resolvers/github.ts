import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Unanchored, same reasoning as the ClickUp pattern.
const GITHUB_ISSUE_LINK_RE =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?![\w/-])/g;

export interface GithubIssueRef {
  readonly kind: "github";
  readonly key: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: string;
}

export function findGithubIssueRefs(text: string): GithubIssueRef[] {
  const refs: GithubIssueRef[] = [];
  for (const match of text.matchAll(GITHUB_ISSUE_LINK_RE)) {
    const [, owner, repo, number] = match;
    refs.push({
      kind: "github",
      key: `github:${owner}/${repo}#${number}`,
      owner,
      repo,
      number,
    });
  }
  return refs;
}

// Uses the `gh` CLI's already-authenticated session instead of a separate token.
export async function resolveGithubIssueTitle(ref: GithubIssueRef): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "view",
      ref.number,
      "--repo",
      `${ref.owner}/${ref.repo}`,
      "--json",
      "title",
      "-q",
      ".title",
    ]);
    const title = stdout.trim();
    if (title.length === 0) return null;
    const tag = `#${ref.number}`;
    return title.startsWith(tag) ? title : `${tag} - ${title}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[thread-titler] gh issue view failed for ${ref.owner}/${ref.repo}#${ref.number}:`,
      message,
    );
    return null;
  }
}
