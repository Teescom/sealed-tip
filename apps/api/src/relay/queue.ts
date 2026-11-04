// In-memory queue with random delay [RELAY_DELAY_MIN_S, RELAY_DELAY_MAX_S] per action (timing privacy) (S-8.4).
export const enqueue = (_action: { method: string; args: unknown }): { queuedUntil: number } => {
  throw new Error("not implemented: S-8.4");
};
