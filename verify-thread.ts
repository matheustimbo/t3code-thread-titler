/**
 * Smoke test for the whole path against a real thread:
 *   npx tsx verify-thread.ts <threadId> [--dry]
 *
 * Exists because the vendored Effect/contracts API drifts (a renamed
 * `Effect.catchAll` once broke thread watching silently while the connection
 * still looked healthy). Run this after re-vendoring.
 */
import * as Effect from "effect/Effect";

import {
  firstUserMessageText,
  makeWsRpcClient,
  watchThreadForFirstMessage,
  wsProtocolLayer,
} from "./src/client.ts";
import { readAuthToken, readServerRuntimeState, wsUrlFromOrigin } from "./src/config.ts";
import { resolveTitleFromFirstMessage } from "./src/resolvers/index.ts";
import { ORCHESTRATION_WS_METHODS } from "./vendor/contracts/src/index.ts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

const threadId = process.argv[2];
const dryRun = process.argv.includes("--dry");
if (!threadId) {
  console.error("usage: npx tsx verify-thread.ts <threadId> [--dry]");
  process.exit(2);
}

const wsUrl = wsUrlFromOrigin(readServerRuntimeState().origin);
const token = readAuthToken();

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeWsRpcClient;

      const head = yield* Stream.runHead(
        client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }).pipe(
          Stream.filter((item: any) => firstUserMessageText(item) !== null),
        ),
      );
      if (Option.isNone(head)) {
        console.log("no user message found on this thread");
        return;
      }
      const text = firstUserMessageText(head.value) ?? "";
      console.log(`first user message: ${JSON.stringify(text.slice(0, 120))}...`);
      console.log("resolved title:", yield* Effect.promise(() => resolveTitleFromFirstMessage(text)));

      if (dryRun) {
        console.log("--dry: skipping the rename");
        return;
      }
      yield* watchThreadForFirstMessage(client, threadId);
      console.log("rename path finished (see log line above if it renamed)");
    }),
  ).pipe(Effect.provide(wsProtocolLayer(wsUrl, token))) as Effect.Effect<void, unknown, never>,
);
