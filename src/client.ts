import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

import { ORCHESTRATION_WS_METHODS, WsRpcGroup } from "../vendor/contracts/src/index.ts";
import { resolveTitleFromFirstMessage } from "./resolvers/index.ts";

export const log = (...args: unknown[]) => console.log("[thread-titler]", ...args);
export const logError = (...args: unknown[]) => console.error("[thread-titler]", ...args);

export function wsProtocolLayer(wsUrl: string, token: string) {
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) =>
      new NodeSocket.NodeWS.WebSocket(socketUrl, protocols, {
        headers: { Authorization: `Bearer ${token}` },
      }) as unknown as globalThis.WebSocket,
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export const makeWsRpcClient = RpcClient.make(WsRpcGroup);
export type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

const isSettledUserMessage = (message: any) =>
  message?.role === "user" && message?.streaming !== true;

/** The text of the thread's first user message, from either stream frame shape. */
export function firstUserMessageText(item: any): string | null {
  if (item?.kind === "snapshot") {
    const message = (item.snapshot?.thread?.messages ?? []).find(isSettledUserMessage);
    return message ? message.text : null;
  }
  if (
    item?.kind === "event" &&
    item.event?.type === "thread.message-sent" &&
    isSettledUserMessage(item.event.payload)
  ) {
    return item.event.payload.text;
  }
  return null;
}

/**
 * Watches one thread until its first user message lands, renames it if that
 * message points at a single card/issue, then lets the subscription end —
 * nothing stays subscribed per thread.
 */
export function watchThreadForFirstMessage(client: WsRpcClient, threadId: string) {
  return Effect.gen(function* () {
    const firstMessage = yield* Stream.runHead(
      client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }).pipe(
        Stream.filter((item: any) => firstUserMessageText(item) !== null),
      ),
    );
    if (Option.isNone(firstMessage)) return;

    const text = firstUserMessageText(firstMessage.value);
    if (text === null) return;

    const title = yield* Effect.tryPromise({
      try: () => resolveTitleFromFirstMessage(text),
      catch: (error) => error,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logError("resolver failed:", cause);
          return null;
        }),
      ),
    );
    if (!title) return;

    log(`renaming thread ${threadId} -> "${title}"`);
    yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
      type: "thread.meta.update",
      commandId: crypto.randomUUID(),
      threadId,
      title,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => logError(`failed to rename thread ${threadId}:`, cause)),
      ),
    );
  }).pipe(
    // catchCause, not catch: a defect in one thread's watcher must not take down
    // the shared connection (this is exactly how the Effect.catchAll bug surfaced).
    Effect.catchCause((cause) =>
      Effect.sync(() => logError(`watcher for thread ${threadId} crashed:`, cause)),
    ),
  );
}
