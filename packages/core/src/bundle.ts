// The exhibit bundle: what one tip's encrypted ciphertext actually contains (ARCHITECTURE §6, S-10.4).
//
// This is a client artifact, not a contract type — the chain stores a CID, a hash and a PoW difficulty and
// never sees a byte of what is described here — but it lives in `@sealedtip/core` with the rest of the shared
// shapes because three programs read it: the tipster's browser writes it, the panel's browser reads it after
// opening the sealed key, and `pnpm demo` builds one headlessly. A second definition of the same container in
// any of those is a container the other two cannot open.
//
// Two properties are worth keeping in mind when changing it:
//
//   - Everything here is *cleaned*. The raw originals appear only in a switch bundle the tipster explicitly
//     opted into (privacy invariant 5), and nothing in this schema has a place for metadata: the files are
//     the bytes the cleaners emitted, and `report` is what says what came off them.
//   - The whole bundle is one JSON value serialized by `packages/crypto`'s canonical writer, so `evidence_hash`
//     and `cleaning_report_hash` are reproducible by anyone who can open the ciphertext. A hash the panel
//     cannot recompute is a hash that proves nothing.
import { z } from "zod";

/** The three types `packages/clean` will emit. Anything else was refused at the gate and never got here. */
export const CleanedMime = z.union([
  z.literal("application/pdf"),
  z.literal("image/jpeg"),
  z.literal("image/png"),
]);
export type CleanedMime = z.infer<typeof CleanedMime>;

/**
 * The bundle's own cap, stated as plaintext bytes.
 *
 * The blob store's 25 MB limit is measured on ciphertext, which is a few dozen bytes more than the
 * plaintext; a tipster whose bundle is 24.9 MB of files will be refused there for a difference they cannot
 * see. So the client refuses at the round number that leaves room for the seal, and says so before uploading
 * rather than after.
 */
export const BUNDLE_MAX_BYTES = 25_000_000;

/** A filename is what the panel sees first; it is also the one field a cleaned file can leak through ("Scan from J. Okafor.pdf"). */
export const BundleFile = z.object({
  name: z.string().min(1).max(200),
  mime: CleanedMime,
  /** base64 of the cleaned bytes — the output of the cleaner, not the file that went into it. */
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64"),
});
export type BundleFile = z.infer<typeof BundleFile>;

/** One file's entry in the removal report. Mirrors `FileReport` in `packages/clean/src/report.ts`. */
export const BundleReportFile = z.object({
  name: z.string(),
  type: z.string(),
  pages: z.number().int().nonnegative().optional(),
  removed: z.array(z.string()),
  scanMode: z.boolean(),
});
export type BundleReportFile = z.infer<typeof BundleReportFile>;

/** What was removed, per file, plus the warnings the tipster had to be shown. Tag names and counts only. */
export const BundleReport = z.object({
  files: z.array(BundleReportFile),
  warnings: z.array(z.string()),
});
export type BundleReport = z.infer<typeof BundleReport>;

/**
 * The AI step's outcome, as the tipster left it.
 *
 * The full `RedactionBundle` (quotes, signature, exact upstream bytes) does *not* go in here: its hash goes
 * on-chain as `attestation_hash`, and the bundle itself is the file `pnpm verify-attestation` reads, which
 * the panel saves from the page rather than out of the exhibit. What belongs in the exhibit is the text the
 * tipster chose to send and what the enclave said about it, so a reader can see which sentences were changed
 * and why.
 */
export const BundleRedaction = z.object({
  /** The passage as it was sent for analysis, which is the only tipster text this step ever saw. */
  original_text: z.string(),
  /** The passage as the tipster left it, after accepting or editing each suggestion. */
  final_text: z.string(),
  suggestions: z.array(z.object({ span: z.string(), reason: z.string(), replacement: z.string() })),
  residual_risks: z.array(z.string()),
  /** Words from a model that answered in prose rather than the §7.2 JSON; shown, not silently dropped. */
  unparsed: z.string().nullable(),
  model: z.string(),
  /** The 32 bytes the client chose for the quote to bind, so the panel can re-check the same bundle. */
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BundleRedaction = z.infer<typeof BundleRedaction>;

export const TipBundle = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(200),
  /** The tipster's own account, in full. The switch bundle's promise is "cleaned evidence *plus the full
   * description*", and that only means something if the description lives in the bundle. */
  description: z.string().min(1).max(200_000),
  /** A tip can be words only: the panel's triage is what decides whether that is worth a reward, and the
   * contract never asks how many files a bundle carries. */
  files: z.array(BundleFile).max(64),
  report: BundleReport,
  redaction: BundleRedaction.nullable(),
  /**
   * The originals, byte-for-byte, and only ever in a switch bundle whose tipster opted into them.
   *
   * A field rather than a flag on `files` because "this PDF was not cleaned" has to be structural: the panel
   * page reads this list into its own section, labelled, and an evidence bundle that gained one of these by a
   * coding mistake is caught by a test instead of by a reader who does not know what they are looking at.
   */
  raw_files: z.array(BundleFile).max(64).optional(),
});
export type TipBundle = z.infer<typeof TipBundle>;
