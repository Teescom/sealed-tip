// JSON this service passes through without understanding (S-8.5).
//
// The attestation report and the response signature belong to somebody else's schema, and the party that
// reads them is the tipster's client, not this process. Typing them as `Json` rather than inventing an
// interface is the honest version of "we are a relay for these bytes": the day NEAR AI Cloud renames a
// field, nothing here needs to be told.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

/** Parse without throwing: an upstream that answers in prose is a refused request, not a 500 of ours. */
export const readJson = (value: string): Json | undefined => {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return undefined;
  }
};

/** Field access that does not care whether the upstream shaped its answer the way the docs say. */
export const field = (value: Json | undefined, name: string): Json | undefined =>
  value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    ? value[name]
    : undefined;

export const asString = (value: Json | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
