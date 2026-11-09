// The heartbeat (S-9.1): the keeper's own proof that it is running.
//
// `heartbeat()` is a keeper-only method that does one thing — set `keeper_last_seen` to the block it lands
// in (`contracts/sealedtip/src/switch.rs`) — and that number is what `get_programme_stats` publishes and
// the panel UI reads. It is B9's answer to the keeper being a single point of failure: the service that
// releases a switch cannot be quietly dead, because the liveness figure a funder and a panel can see goes
// stale the moment it stops calling.
//
// A failed call is logged and the loop continues. This is the one path where a crash has a cost beyond the
// missed beat: the same process runs the switch watch, and a keeper that dies on a transient RPC error is a
// keeper that does not notice a triggered switch, which is the failure the heartbeat exists to make visible.
import type { KeeperCall } from "./near.js";

export const DEFAULT_HEARTBEAT_MS = 300_000;

export interface HeartbeatDeps {
  readonly call: KeeperCall;
  /** `KEEPER_HEARTBEAT_S * 1000`. */
  readonly intervalMs?: number;
  /** Injected so a test can drive the loop without a timer; the default is the real one. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Where a failure goes. There is nothing sensitive in it to protect — `heartbeat` takes no arguments —
   * but the message is the caller's, so the default prints the error's own text and nothing else.
   */
  readonly onError?: (error: unknown) => void;
}

export interface Running {
  readonly stop: () => void;
  /** Resolves once the loop has finished after `stop`, so a caller can shut down cleanly. */
  readonly done: Promise<void>;
}

/** One beat, on its own: what a test asserts and what the loop calls. */
export const beat = async (call: KeeperCall): Promise<{ txHash: string }> => await call("heartbeat", {});

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const startHeartbeat = (deps: HeartbeatDeps): Running => {
  const intervalMs = deps.intervalMs ?? DEFAULT_HEARTBEAT_MS;
  const sleep = deps.sleep ?? realSleep;
  const onError = deps.onError ?? ((error: unknown) => console.error(`keeper heartbeat failed: ${textOf(error)}`));
  let stopped = false;

  const done = (async () => {
    // Beat first, then wait: a process that starts and dies before the first beat would otherwise leave
    // `keeper_last_seen` at whatever the previous run recorded, which is the exact lie S-2.9 zeroes the
    // field to avoid.
    while (!stopped) {
      try {
        await beat(deps.call);
      } catch (error) {
        onError(error);
      }
      if (stopped) break;
      await sleep(intervalMs);
    }
  })();

  return { stop: () => (stopped = true), done };
};
