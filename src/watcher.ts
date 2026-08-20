import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { ORCHESTRATION_WS_METHODS } from "../vendor/contracts/src/index.ts";
import {
  log,
  logError,
  makeWsRpcClient,
  watchThreadForFirstMessage,
  wsProtocolLayer,
} from "./client.ts";
import { readAuthToken, readServerRuntimeState, wsUrlFromOrigin } from "./config.ts";

const MIN_CONNECTED_MS_TO_RESET_BACKOFF = 5_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function connectAndWatch(wsUrl: string, token: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeWsRpcClient;
      const known = new Set<string>();
      let sawSnapshot = false;

      yield* Stream.runForEach(
        client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
        (item: any) =>
          Effect.gen(function* () {
            if (item.kind === "snapshot") {
              for (const thread of item.snapshot.threads) known.add(thread.id);
              sawSnapshot = true;
              log(`connected, tracking ${known.size} existing thread(s)`);
              return;
            }
            if (item.kind === "thread-upserted") {
              const isNew = sawSnapshot && !known.has(item.thread.id);
              known.add(item.thread.id);
              if (isNew) {
                log(`new thread ${item.thread.id}`);
                yield* Effect.forkScoped(watchThreadForFirstMessage(client, item.thread.id));
              }
            }
          }),
      );
    }),
  ).pipe(Effect.provide(wsProtocolLayer(wsUrl, token)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let backoffMs = INITIAL_BACKOFF_MS;

  for (;;) {
    let wsUrl: string;
    let token: string;
    try {
      wsUrl = wsUrlFromOrigin(readServerRuntimeState().origin);
      token = readAuthToken();
    } catch (err) {
      logError("could not read t3code server state / token, retrying:", err);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      continue;
    }

    log(`connecting to ${wsUrl}`);
    const startedAt = Date.now();
    try {
      await Effect.runPromise(connectAndWatch(wsUrl, token) as Effect.Effect<void, unknown, never>);
    } catch (err) {
      logError("connection lost:", err);
    }

    backoffMs =
      Date.now() - startedAt >= MIN_CONNECTED_MS_TO_RESET_BACKOFF
        ? INITIAL_BACKOFF_MS
        : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    log(`reconnecting in ${backoffMs}ms`);
    await sleep(backoffMs);
  }
}

main().catch((err) => {
  logError("fatal:", err);
  process.exit(1);
});
