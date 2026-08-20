import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const T3_USERDATA = join(homedir(), ".t3", "userdata");
const SERVER_RUNTIME_PATH = join(T3_USERDATA, "server-runtime.json");
const TOKEN_PATH = join(T3_USERDATA, "secrets", "thread-titler.token");

export interface ServerRuntimeState {
  readonly port: number;
  readonly origin: string;
}

export function readServerRuntimeState(): ServerRuntimeState {
  const raw = readFileSync(SERVER_RUNTIME_PATH, "utf8");
  const parsed = JSON.parse(raw) as { port?: unknown; origin?: unknown };
  if (typeof parsed.port !== "number" || typeof parsed.origin !== "string") {
    throw new Error(`${SERVER_RUNTIME_PATH} is missing port/origin`);
  }
  return { port: parsed.port, origin: parsed.origin };
}

export function readAuthToken(): string {
  const raw = readFileSync(TOKEN_PATH, "utf8").trim();
  if (raw.length === 0) {
    throw new Error(`${TOKEN_PATH} is empty`);
  }
  return raw;
}

export function wsUrlFromOrigin(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

export const TOKEN_PATH_FOR_DISPLAY = TOKEN_PATH;
export const SERVER_RUNTIME_PATH_FOR_DISPLAY = SERVER_RUNTIME_PATH;
