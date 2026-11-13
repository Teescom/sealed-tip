// In-memory queue holding each signed action for a random delay before a relayer sends it (S-8.4).
//
// This is ARCHITECTURE §9's timing control, and the one privacy mechanism here that is about *when*
// rather than *what*: a tip that lands on chain 40 ms after its owner's browser finished uploading the
// evidence ties the two events together for anyone watching the block, which is exactly the linkage the
// 24-word identity is supposed to avoid. Production is 1–24 h, demo 0–20 s (`RELAY_DELAY_MIN_S` /
// `RELAY_DELAY_MAX_S`), and the range is what the env refuses to let collapse to a constant.
//
// Two honest limitations, both stated because they are properties of this design rather than bugs in it.
// The queue lives in the process, so a restart drops whatever has not been sent yet; the tipster's fix
// is the one the contract already supports — re-read the tip, and only relay again if it is not there,
// since the nonce makes a duplicate of an action that did land a refusal rather than a double payout.
// And the delay is only privacy while the queue is not empty: a single queued action fires on its own
// timer, so what hides a tipster is everyone else's actions sharing that window.

import { randomInt } from "node:crypto";

export interface QueuedAction {
  readonly method: string;
  readonly args: Record<string, unknown>;
}

/** Thrown when the queue is at its cap, so the route can answer 503 rather than grow memory. */
export class QueueFullError extends Error {
  constructor(readonly cap: number) {
    super(`relay queue is full (${cap} actions waiting)`);
    this.name = "QueueFullError";
  }
}

export interface QueueOptions {
  /** Called once per action. Uniform over the configured range is the point, so the range lives in env. */
  readonly delayMs: () => number;
  readonly send: (action: QueuedAction) => Promise<{ txHash: string }>;
  /** Waiting actions, including ones mid-send. This is the bound on what a flood can make us hold. */
  readonly maxPending?: number;
  /**
   * Where an action that could not be sent goes. It gets the method name and the error, never the args:
   * those carry a claim pubkey and a signature, and this sink writes to a log.
   */
  readonly onUndelivered?: (action: QueuedAction, error: unknown) => void;
  readonly now?: () => number;
}

export interface RelayQueue {
  /** Schedules the action and returns the chain-clock estimate of when it will have been sent. */
  enqueue(action: QueuedAction): Promise<{ queuedUntil: number }>;
  pending(): Promise<number>;
  /** Resolves once nothing is waiting. For the demo script, which must not read the chain too early. */
  idle(): Promise<void>;
}

/** A delay drawn uniformly from `[minS, maxS]`, both endpoints reachable. */
export const randomDelayMs = (minS: number, maxS: number): number => {
  if (!(minS >= 0 && maxS >= minS)) throw new RangeError(`relay delay range ${minS}..${maxS}s is not usable`);
  return 1000 * minS + randomInt(0, 1000 * (maxS - minS) + 1);
};

export const createQueue = (options: QueueOptions): RelayQueue => {
  const now = options.now ?? (() => Date.now());
  const maxPending = options.maxPending ?? 500;
  let waiting = 0;
  const quiet: (() => void)[] = [];

  const settle = () => {
    waiting -= 1;
    if (waiting === 0) for (const done of quiet.splice(0)) done();
  };

  const fire = async (action: QueuedAction) => {
    try {
      await options.send(action);
    } catch (error) {
      // An action the relayer could not send must not become an unhandled rejection, which in Node 22
      // is a crash: the queue would die mid-flood, taking every other tipster's pending action with it.
      // Nothing here retries — the tipster re-reads the chain and relays again, and the nonce means a
      // duplicate of an action that did land is refused rather than paid twice.
      options.onUndelivered?.(action, error);
    } finally {
      settle();
    }
  };

  return {
    enqueue: async (action) => {
      if (waiting >= maxPending) throw new QueueFullError(maxPending);
      const delay = options.delayMs();
      const queuedUntil = now() + delay;
      waiting += 1;
      setTimeout(() => void fire(action), delay);
      return { queuedUntil };
    },
    pending: async () => waiting,
    idle: () => (waiting === 0 ? Promise.resolve() : new Promise<void>((resolve) => quiet.push(resolve))),
  };
};
