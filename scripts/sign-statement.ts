// Tipster signs an identity statement with the claim key (S-6.13, PRD F13).
// Verifiable proof that the whistleblower who submitted a tip is a specific person,
// without revealing the recovery phrase or spending any on-chain tokens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveKeys, sign, verify, wordsToSecret } from "@sealedtip/crypto";

export const STATEMENT_TAG = new TextEncoder().encode("sealedtip:statement:v1\n");

export const statementMessage = (statement: string): Uint8Array => {
  const textBytes = new TextEncoder().encode(statement);
  const msg = new Uint8Array(STATEMENT_TAG.length + textBytes.length);
  msg.set(STATEMENT_TAG, 0);
  msg.set(textBytes, STATEMENT_TAG.length);
  return msg;
};

export interface StatementSignature {
  statement: string;
  publicKey: Uint8Array;
  signature: Uint8Array;
  publicKeyHex: string;
  signatureHex: string;
}

export const signStatement = async (
  words: string | string[],
  statement: string,
  passphrase?: string,
): Promise<StatementSignature> => {
  const wordList = typeof words === "string" ? words.trim().split(/\s+/) : words;
  const secret = wordsToSecret(wordList);
  const keys = await deriveKeys(secret, passphrase);
  const msg = statementMessage(statement);
  const signature = sign(msg, keys.ed25519.secretKey);
  const publicKey = keys.ed25519.publicKey;
  return {
    statement,
    publicKey,
    signature,
    publicKeyHex: Buffer.from(publicKey).toString("hex"),
    signatureHex: Buffer.from(signature).toString("hex"),
  };
};

export const verifyStatement = (
  publicKey: Uint8Array | string,
  signature: Uint8Array | string,
  statement: string,
): boolean => {
  const pub = typeof publicKey === "string" ? Uint8Array.from(Buffer.from(publicKey.replace(/^0x/, ""), "hex")) : publicKey;
  const sig = typeof signature === "string" ? Uint8Array.from(Buffer.from(signature.replace(/^0x/, ""), "hex")) : signature;
  if (pub.length !== 32 || sig.length !== 64) {
    return false;
  }
  const msg = statementMessage(statement);
  return verify(sig, msg, pub);
};

export const parseArg = (argv: string[], name: string): string | undefined => {
  const idx = argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : argv[idx + 1];
};

export const hasFlag = (argv: string[], name: string): boolean => argv.includes(`--${name}`);

export const main = async (argv: string[] = process.argv.slice(2)): Promise<number> => {
  if (hasFlag(argv, "help") || hasFlag(argv, "h")) {
    console.log(`Usage:
  Sign statement:
    tsx sign-statement.ts --words "<24 words>" --statement "<statement text>" [--passphrase "<pass>"]
  Verify statement:
    tsx sign-statement.ts --verify --pubkey <hex> --signature <hex> --statement "<statement text>"
  Options:
    --words-file <path>       Read 24 recovery words from file
    --statement-file <path>   Read statement from file
    --json                    Output result as JSON`);
    return 0;
  }

  const isVerify = hasFlag(argv, "verify");
  let statement = parseArg(argv, "statement");
  const statementFile = parseArg(argv, "statement-file") ?? parseArg(argv, "file");
  if (!statement && statementFile) {
    statement = readFileSync(statementFile, "utf8").trim();
  }

  if (isVerify) {
    const pubkey = parseArg(argv, "pubkey") ?? parseArg(argv, "public-key");
    const signature = parseArg(argv, "signature") ?? parseArg(argv, "sig");
    if (!pubkey || !signature || statement === undefined) {
      console.error("Missing required verify flags: --pubkey, --signature, and --statement (or --file)");
      return 1;
    }
    const ok = verifyStatement(pubkey, signature, statement);
    if (ok) {
      console.log("Signature valid.");
      return 0;
    } else {
      console.error("Signature INVALID.");
      return 1;
    }
  }

  let words = parseArg(argv, "words") ?? process.env.WORDS;
  const wordsFile = parseArg(argv, "words-file");
  if (!words && wordsFile) {
    words = readFileSync(wordsFile, "utf8").trim();
  }

  if (!words || statement === undefined) {
    console.error("Missing required signing flags: --words (or WORDS env/--words-file) and --statement (or --file)");
    return 1;
  }

  const passphrase = parseArg(argv, "passphrase");
  const result = await signStatement(words, statement, passphrase);

  if (hasFlag(argv, "json")) {
    console.log(
      JSON.stringify(
        {
          statement: result.statement,
          public_key: result.publicKeyHex,
          signature: result.signatureHex,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Public key: ${result.publicKeyHex}`);
    console.log(`Signature:  ${result.signatureHex}`);
    console.log(`Statement:  ${result.statement}`);
  }
  return 0;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
