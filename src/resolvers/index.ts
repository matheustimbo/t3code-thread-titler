import { findClickUpTaskRefs, resolveClickUpTitle, type ClickUpTaskRef } from "./clickup.ts";
import { findGithubIssueRefs, resolveGithubIssueTitle, type GithubIssueRef } from "./github.ts";

type TrackerRef = ClickUpTaskRef | GithubIssueRef;

/**
 * Fires when the message references exactly one card/issue, wherever the link sits
 * in the text. Two or more distinct cards is ambiguous, so the thread keeps
 * t3code's own LLM title. The same link repeated (markdown, quoting) counts once.
 */
export async function resolveTitleFromFirstMessage(text: string): Promise<string | null> {
  const found: TrackerRef[] = [...findClickUpTaskRefs(text), ...findGithubIssueRefs(text)];

  const byKey = new Map<string, TrackerRef>();
  for (const ref of found) byKey.set(ref.key, ref);
  if (byKey.size !== 1) return null;

  const ref = [...byKey.values()][0];
  return ref.kind === "clickup" ? resolveClickUpTitle(ref) : resolveGithubIssueTitle(ref);
}
