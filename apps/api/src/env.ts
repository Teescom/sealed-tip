// zod-validated env, failing fast and naming only the variables (S-8.2). Source of truth: `.env.example`;
// ARCHITECTURE §13 says the two change together.
import { z } from "zod";

/** A variable that must carry something: an empty line in `.env` is a half-filled deployment, not a value. */
const Required = z.string().min(1);

/**
 * `.env.example` declares every name it knows about, and a demo deployment leaves the ones it is not
 * using empty. `process.loadEnvFile` hands `KEY=` over as `""`, which would fail `z.url()` and stop the
 * API from starting over a knob that is meant to be off — so empty means "not set" here, and only here.
 */
const Optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const Shape = z.object({
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]),
  NEAR_RPC_URL: z.url(),
  SEALEDTIP_CONTRACT: Required,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),

  // Two relayers is an architecture rule (ARCHITECTURE §9), so both are required rather than optional:
  // a deployment that configures one has quietly made every action a single account can drop.
  RELAYER_A_ACCOUNT: Required,
  RELAYER_A_KEY: Required,
  RELAYER_B_ACCOUNT: Required,
  RELAYER_B_KEY: Required,
  RELAY_DELAY_MIN_S: z.coerce.number().int().min(0).default(0),
  RELAY_DELAY_MAX_S: z.coerce.number().int().min(0).default(20),

  BLOB_MAX_BYTES: z.coerce.number().int().min(1).default(26_214_400),
  BLOB_STORE_URL: Optional(z.url()),
  BLOB_TOKEN: Optional(Required),

  // Off until the owner decides otherwise: the AI proxy needs `NEAR_AI_API_KEY` (S-0.3) and the quote
  // proxy a 1Click key checked with real money (S-0.6). Their routes refuse the request at call time
  // rather than the whole API refusing to start, because the tip flow works without either.
  NEAR_AI_API_KEY: Optional(Required),
  NEAR_AI_MODEL: Optional(Required),
  ONECLICK_API_KEY: Optional(Required),
});

const issueName = (issue: z.core.$ZodIssue): string => issue.path.map(String).join(".") || "(root)";

/** One line of the startup failure. Names and reasons only, never the received value. */
interface Problem {
  readonly name: string;
  readonly reason: string;
}

/**
 * Names and reasons only, never the received value: zod can echo an input back in a message, and a
 * startup log is exactly where a relayer's function-call key must not appear.
 */
const describe = (problems: readonly Problem[]): string =>
  problems.map(({ name, reason }) => `  - ${name}: ${reason}`).join("\n");

/**
 * Rules about two variables at once, which the shape cannot express. These run only on a config that
 * fully parsed: a `superRefine` also sees the raw value of a key that failed, and a garbage
 * `BLOB_STORE_URL` would then be reported as a missing `BLOB_TOKEN` — a wrong reason is worse than no
 * reason, because it sends whoever reads it to edit the wrong line.
 */
const crossChecks = (env: Env): Problem[] => {
  const problems: Problem[] = [];
  if (env.NEAR_NETWORK === "mainnet") {
    problems.push({
      name: "NEAR_NETWORK",
      reason: "is mainnet, and this repository only ever deploys to testnet without the owner's explicit go-ahead",
    });
  }
  if (env.RELAY_DELAY_MIN_S > env.RELAY_DELAY_MAX_S) {
    problems.push({
      name: "RELAY_DELAY_MIN_S",
      reason:
        `${env.RELAY_DELAY_MIN_S} is above RELAY_DELAY_MAX_S (${env.RELAY_DELAY_MAX_S}), which would make every ` +
        `delay the same and the queue's timing privacy worthless`,
    });
  }
  if (env.BLOB_STORE_URL !== undefined && env.BLOB_TOKEN === undefined) {
    problems.push({ name: "BLOB_TOKEN", reason: "is required once BLOB_STORE_URL points at an external store" });
  }
  return problems;
};

export type Env = z.infer<typeof Shape>;

const unusable = (problems: readonly Problem[]): never => {
  throw new Error(
    `environment is not usable — ${problems.length} problem(s):\n${describe(problems)}\n` +
      `values are not printed here; the names and what they must satisfy are in .env.example`,
  );
};

/** A record (usually `process.env`) in, a validated `Env` out. Throws with the names, not the values. */
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
