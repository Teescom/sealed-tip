// The durable relay queue (S-8.4): the same `RelayQueue` surface, but the action is written to Redis with
// a "not before" time and a cron drains what is due. The in-process `setTimeout` in `queue.ts` cannot
// survive a serverless cold start, so this is what a deployment runs instead; the demo keeps the in-memory
// one. The random delay is preserved exactly — it decides the score, not the timing of a timer.
import { randomUUID } from "node:crypto";

import type { Kv } from "./kv.js";
import type { QueuedAction, RelayQueue } from "./queue.js";

export interface DurableQueueOptions {
  readonly kv: Kv;
  readonly delayMs: () => number;
  readonly send: (action: QueuedAction) => Promise<{ txHash: string }>;
  /** Same contract as `queue.ts`: method name and the error, never the args (they carry a signature). */
  readonly onUndelivered?: (action: QueuedAction, error: unknown) => void;
  readonly maxPending?: number;
  readonly now?: () => number;
}

export interface DurableRelayQueue extends RelayQueue {
  /** Send every action whose `notBefore` has passed, and remove it from the set. Returns how many were sent. */
  drainDue(): Promise<number>;
}

const DUE_KEY = "relay:due";
const actionKey = (id: string): string => `relay:action:${id}`;
/** Longer than the 24 h max delay, so an action cannot expire out from under its own timer. */
const ACTION_TTL_SECONDS = 26 * 3600;

interface StoredAction extends QueuedAction {
  readonly notBefore: number;
}

export const kvRelayQueue = (options: DurableQueueOptions): DurableRelayQueue => {
  const now = options.now ?? (() => Date.now());
  const maxPending = options.maxPending ?? 500;
  const { kv } = options;

  return {
    enqueue: async (action) => {
      // The cap is best-effort across cold starts: this read cannot be atomic with the writes that follow,
      // and a flood that arrives from many lambdas at once may briefly overshoot. The shared rate-limit
      // bucket in the route is the real bound; this is a second, coarse one.
      if ((await kv.zcard(DUE_KEY)) >= maxPending) {
        // Reuse the in-memory queue's error type so the route keeps one catch for both queues.
        const { QueueFullError } = await import("./queue.js");
        throw new QueueFullError(maxPending);
      }
      const id = randomUUID();
      const delay = options.delayMs();
      const notBefore = now() + delay;
      const stored: StoredAction = { ...action, notBefore };
      await kv.set(actionKey(id), stored, ACTION_TTL_SECONDS);
      await kv.zadd(DUE_KEY, notBefore, id);
      return { queuedUntil: notBefore };
    },

    pending: async () => kv.zcard(DUE_KEY),

    idle: async () => {
      // The demo script awaits this; a deployment's cron does not. Poll until empty, bounded so a stuck
      // action cannot hang the demo forever.
      for (let i = 0; i < 60; i++) {
        if ((await kv.zcard(DUE_KEY)) === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },

    drainDue: async () => {
      const due = await kv.zrangebyscore(DUE_KEY, 0, now());
      let sent = 0;
      for (const id of due) {
        const stored = await kv.get<StoredAction>(actionKey(id));
        if (stored === null) {
          // Another cron claimed it first, or it expired. Either way it must not sit in the set.
          await kv.zrem(DUE_KEY, id);
          continue;
        }
        // get-then-send-then-del is not atomic, so two overlapping crons can both see the action. That is
        // acceptable and documented: a duplicate of an action that already landed is refused by the
        // contract's nonce, never paid twice, and the tipster re-reads the chain and re-relays anyway.
        // `notBefore` is deliberately not forwarded: the relayer signs only the two fields the gate made.
        const action: QueuedAction = { method: stored.method, args: stored.args };
        try {
          await options.send(action);
          sent += 1;
        } catch (error) {
          options.onUndelivered?.(action, error);
        } finally {
          await kv.del(actionKey(id));
          await kv.zrem(DUE_KEY, id);
        }
      }
      return sent;
    },
  };
};
