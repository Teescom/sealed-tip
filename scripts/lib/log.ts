// Step logging with explorer links; exits non-zero on unexpected state (A-11.8, S-11.1..S-11.9).
export const step = (n: number, title: string): void => {
  console.log(`\n============================================================`);
  console.log(`▶ [Step ${n}] ${title}`);
  console.log(`============================================================`);
};

export const ok = (msg: string): void => {
  console.log(`  ✔ ${msg}`);
};

export const info = (msg: string): void => {
  console.log(`  ℹ ${msg}`);
};

export const warn = (msg: string): void => {
  console.log(`  ⚠ ${msg}`);
};

export const fail = (msg: string): never => {
  console.error(`  ✖ ${msg}`);
  process.exit(1);
};
