// The switch watch (S-9.2): notice a triggered dead man's switch within a minute.
//
// ARCHITECTURE §9 says the keeper "watches for `switch_triggered`", and the contract writes that fact into
// `TipPublic.switch_triggered` — `get_tip_public` maps it straight off the switch, which is why a watcher
// can be built on reads rather than on the event log. Following the `switch_triggered` *event* would mean
// an indexer subscription (`next_follow`) that this repository has not deployed and cannot test offline.
// Polling the view is the same fact one hop further from the receipt, and it is the version a demo can
// show. That trade is recorded in ARCHITECTURE §9 so it is a decision and not an oversight.
//
// Two properties this module is responsible for:
//   · discovery — tip ids are handed out from 0 and never removed (`lib.rs` `next_tip_id`, `tip.rs:126`),
//     so probing upward until a read comes back `null` enumerates every tip there is. The probe is capped
//     per pass so a flood of submissions cannot turn one poll into an unbounded scan.
//   · the minute — a trigger is seen at the next pass, so `DEFAULT_WATCH_MS` is 10 s and `env.ts` refuses a
//     `KEEPER_WATCH_S` above 60. Detection is the interval plus one finality wait, not the interval times
//     anything.
import type { ViewClient } from "@sealedtip/core";

import type { Running } from "./heartbeat.js";

export const DEFAULT_WATCH_MS = 10_000;

/** New tips discovered per pass. A submission costs the keeper one read; this bounds what a flood costs. */
export const MAX_NEW_TIPS_PER_POLL = 50;

export interface WatchDeps {
  /** Read-only, and only the public view: the watcher never needs a CID or a recusal list to know it has work. */
  readonly views: Pick<ViewClient, "getTipPublic">;
  /**
   * What to do about a tip whose switch has fired. Resolving means "this tip needs no more watching" —
   * including when the answer was that somebody already released it. Throwing means retry at the next
   * pass, because an unreleased switch is the one state this process exists to leave behind.
   */
  readonly onTriggered: (tipId: number) => Promise<void>;
  readonly intervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

/**
 * What the watcher remembers between passes. `open` is every tip that could still trigger; `waiting` is
 * the subset whose switch has fired and whose release has not yet succeeded, which is what a restart of
 * the loop needs to be able to retry and what an operator needs to be able to ask about.
 */
export interface WatchState {
  nextUnseenId: number;
  readonly open: Set<number>;
  readonly waiting: Set<number>;
}

export const newWatchState = (): WatchState => ({ nextUnseenId: 0, open: new Set(), waiting: new Set() });

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One pass over the chain, returned rather than acted on so the detection is testable without a timer.
 * The ids it hands back are the ones this pass saw fire; `state` carries them into `waiting` until
 * `startWatch`'s release resolves.
 */
export const pollOnce = async (deps: WatchDeps, state: WatchState): Promise<number[]> => {
  for (let probed = 0; probed < MAX_NEW_TIPS_PER_POLL; probed += 1) {
    const found = await deps.views.getTipPublic(state.nextUnseenId);
    if (found === null) break;
    // A tip with no switch has no deadline and `trigger` panics E19 on it, so it can never need a release.
    // Without this the read list grows with every submission on the programme, forever.
    if (found.switch_deadline !== null) state.open.add(found.id);
    state.nextUnseenId = found.id + 1;
  }

  const flagged: number[] = [];
  for (const tipId of [...state.open]) {
    const tip = await deps.views.getTipPublic(tipId);
    if (tip?.switch_triggered !== true) continue;
    state.waiting.add(tipId);
    flagged.push(tipId);
  }
  return flagged;
};

export const startWatch = (deps: WatchDeps): Running => {
  const state = newWatchState();
  const intervalMs = deps.intervalMs ?? DEFAULT_WATCH_MS;
  const sleep = deps.sleep ?? realSleep;
  const onError = deps.onError ?? ((error: unknown) => console.error(`keeper: ${textOf(error)}`));
  let stopped = false;

  const done = (async () => {
    while (!stopped) {
      let flagged: number[] = [];
      try {
        flagged = await pollOnce(deps, state);
      } catch (error) {
        // A failed pass is a missed pass, not a dead process: the next one re-reads the same ids.
        onError(error);
      }

      for (const tipId of flagged) {
        if (stopped) break;
        try {
          await deps.onTriggered(tipId);
          state.open.delete(tipId);
          state.waiting.delete(tipId);
        } catch (error) {
          onError(error);
        }
      }

      if (stopped) break;
      await sleep(intervalMs);
    }
  })();

  return { stop: () => void (stopped = true), done };
};
