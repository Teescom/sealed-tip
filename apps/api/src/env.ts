// zod-validated env (S-8.2). Source of truth: .env.example.
import { z } from "zod";

export const Env = z.object({
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]),
  NEAR_RPC_URL: z.url(),
  SEALEDTIP_CONTRACT: z.string(),
  API_PORT: z.coerce.number().int().default(8787),
  RELAYER_A_ACCOUNT: z.string(), RELAYER_A_KEY: z.string(),
  RELAYER_B_ACCOUNT: z.string(), RELAYER_B_KEY: z.string(),
  RELAY_DELAY_MIN_S: z.coerce.number().int().default(0),
  RELAY_DELAY_MAX_S: z.coerce.number().int().default(20),
  BLOB_STORE_URL: z.string(), BLOB_TOKEN: z.string(),
  BLOB_MAX_BYTES: z.coerce.number().int().default(26_214_400),
  NEAR_AI_API_KEY: z.string(), NEAR_AI_MODEL: z.string(),
  ONECLICK_API_KEY: z.string().optional(),
});
export type Env = z.infer<typeof Env>;
export const loadEnv = (): Env => Env.parse(process.env);
