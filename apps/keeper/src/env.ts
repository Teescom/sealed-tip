// zod-validated env for the keeper, failing fast and naming only the variables (S-9.1–S-9.3).
//
// Same rule as `apps/api/src/env.ts`, and it matters more here: this process holds the two secrets that
// can move a switch — the account key allowed to call `post_released_keys`, and the X25519 secret that
// opens `K_switch`. A startup log is exactly where neither may appear, so every complaint below is a name
// and a requirement, never a value.
//
// `.env.example` is the source of truth for the list (ARCHITECTURE §13); the two knobs added for P9 are
// the watch interval and the tip API's origin, because the keeper reads the switch off the chain and
// writes re-sealed keys to the same ciphertext store the panel reads from.
import { z } from "zod";

const Required = z.string().min(1);

/**
 * A 32-byte X25519 secret as 64 hex, which is the form `scripts/deploy-testnet.ts` writes into `.env`
 * after it generates one. The length is checked as text because the failure being described is a
 * half-pasted key, and the number of bytes a value decodes to is one step further from what the operator
 * can fix.
 */
const X25519Secret = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be 64 hex characters (a 32-byte X25519 secret, the form `pnpm deploy:testnet` writes)");

const Shape = z.object({
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]),
  NEAR_RPC_URL: z.url(),
  SEALEDTIP_CONTRACT: Required,

  KEEPER_ACCOUNT: Required,
  KEEPER_KEY: Required,
  KEEPER_X25519_SECRET: X25519Secret,

  KEEPER_HEARTBEAT_S: z.coerce.number().int().min(1).max(3600).default(300),

  // The ceiling is the promise: ARCHITECTURE §9 and ROADMAP S-9.2 say a triggered switch is noticed
  // within a minute, and an interval above 60 s would make that sentence false rather than slow.
  KEEPER_WATCH_S: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(60, "must be 60 or less: the switch promise is that a triggered release is noticed within a minute")
    .default(10),

  // The keeper reads and writes ciphertext through the tip API (S-8.3), which is the only party that
  // knows where the blobs live.
  KEEPER_API_URL: z.url(),
});

const issueName = (issue: z.core.$ZodIssue): string => issue.path.map(String).join(".") || "(root)";

interface Problem {
  readonly name: string;
  readonly reason: string;
}

const describe = (problems: readonly Problem[]): string =>
  problems.map(({ name, reason }) => `  - ${name}: ${reason}`).join("\n");

/**
 * Rules about two variables at once, run only on a config that fully parsed — the same reason as the
 * API's: a garbage value that failed the shape would otherwise be reported as a different variable's
 * problem, and a wrong reason sends whoever reads it to the wrong line.
 */
const crossChecks = (env: Env): Problem[] => {
  const problems: Problem[] = [];
  if (env.NEAR_NETWORK === "mainnet") {
    problems.push({
      name: "NEAR_NETWORK",
      reason: "is mainnet, and this repository only ever deploys to testnet without the owner's explicit go-ahead",
    });
  }
  if (!env.KEEPER_KEY.startsWith("ed25519:")) {
    problems.push({
      name: "KEEPER_KEY",
      reason: "is not an `ed25519:…` function-call key; the value itself is not printed here",
    });
  }
  return problems;
};

export type Env = z.infer<typeof Shape>;

const unusable = (problems: readonly Problem[]): never => {
  throw new Error(
    `keeper environment is not usable — ${problems.length} problem(s):\n${describe(problems)}\n` +
      `values are not printed here; the names and what they must satisfy are in .env.example`,
  );
};

export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const shape = Shape.safeParse(source);
  if (!shape.success) {
    unusable(shape.error.issues.map((issue) => ({ name: issueName(issue), reason: issue.message })));
  }
  const env = shape.data as Env;
  const problems = crossChecks(env);
  if (problems.length > 0) unusable(problems);
  return env;
};

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => parseEnv(source);
