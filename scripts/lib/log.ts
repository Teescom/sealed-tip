// Step logging with explorer links; exits non-zero on unexpected state (A-11.8).
export const step = (_n: number, _title: string): void => {
  throw new Error("not implemented: S-11.1");
};
export const fail = (msg: string): never => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
