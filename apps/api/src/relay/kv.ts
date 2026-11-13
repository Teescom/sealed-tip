// A five-method Redis slice, so the durable queue and the cron can be tested against a fake rather than a
// live KV database, and the deployment uses Vercel KV (Upstash Redis) through `createClient`. The real
// client is built here and nowhere else, so a test never reaches for a network.
import { createClient } from "@vercel/kv";

export interface Kv {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  zcard(key: string): Promise<number>;
}

/** The real Vercel KV client, built from explicit URL + token so a test can swap in a fake for the same type. */
export const vercelKv = (url: string, token: string): Kv => {
  const client = createClient({ url, token });
  return {
    get: (key) => client.get(key),
    set: (key, value, ttlSeconds) =>
      ttlSeconds === undefined ? client.set(key, value) : client.set(key, value, { ex: ttlSeconds }),
    del: (...keys) => client.del(...keys),
    zadd: (key, score, member) => client.zadd(key, { score, member }),
    zrangebyscore: (key, min, max) => client.zrange(key, min, max, { byScore: true }),
    zrem: (key, ...members) => client.zrem(key, ...members),
    zcard: (key) => client.zcard(key),
  };
};
