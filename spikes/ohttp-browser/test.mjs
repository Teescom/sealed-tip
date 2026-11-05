// Runs the same WebCrypto code the browser page runs, under Node — no npm dependency either way.
//   node spikes/ohttp-browser/test.mjs [--offline] [--base <url>] [--model <id>] [--key <NEAR_AI key>]
// The offline block checks every primitive against node:crypto, so a codec bug is caught without
// reaching the network. Then one live round trip: with a key it is a model answer, without one the
// gateway's 401 still comes back through the decrypted channel, which exercises both directions.
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import {
  bhttpDecodeResponse,
  hkdfExtract,
  hkdfExpand,
  ohttpChat,
  supportsWebCryptoOhttp,
  toHex,
} from "./ohttp.js";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const x25519ToNode = async () => {
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const peer = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const peerRaw = await crypto.subtle.exportKey("raw", peer.publicKey);
  const web = await crypto.subtle.deriveBits(
    {
      name: "X25519",
      public: await crypto.subtle.importKey("raw", peerRaw, { name: "X25519" }, false, []),
    },
    pair.privateKey,
    256,
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const node = diffieHellman({
    privateKey: createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" }),
    publicKey: createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(peerRaw)]),
      format: "der",
      type: "spki",
    }),
  });
  check(
    "X25519 agrees with node:crypto",
    Buffer.from(web).equals(node),
    toHex(new Uint8Array(web)).slice(0, 24),
  );
};

const hkdfToNode = async () => {
  const ikm = randomBytes(22);
  const salt = randomBytes(29);
  const info = randomBytes(13);
  const ours = await hkdfExpand(await hkdfExtract(salt, ikm), info, 42);
  const node = Buffer.from(hkdfSync("sha256", ikm, salt, info, 42));
  check("HKDF-SHA256 agrees with node:crypto", Buffer.from(ours).equals(node), toHex(ours));
};

const aesGcmToNode = async () => {
  const key = randomBytes(16);
  const iv = randomBytes(12);
  const plaintext = Buffer.from("sealed tip");
  const web = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]),
    plaintext,
  );
  const cipher = createCipheriv("aes-128-gcm", key, iv);
  const node = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  check(
    "AES-128-GCM agrees with node:crypto",
    Buffer.from(web).equals(node),
    `ct+tag ${node.length} bytes`,
  );
  const back = createDecipheriv("aes-128-gcm", key, iv);
  back.setAuthTag(Buffer.from(web.slice(-16)));
  const decrypted = Buffer.concat([back.update(Buffer.from(web.slice(0, -16))), back.final()]);
  check("node:crypto decrypts our ciphertext", decrypted.equals(plaintext));
};

const bhttpFramings = () => {
  // 0x01 known-length: status 200, one header pair, a 5-byte body
  const fields = Uint8Array.from([
    0x0c,
    ...Buffer.from("content-type"),
    0x10,
    ...Buffer.from("application/json"),
  ]);
  const knownLength = Uint8Array.from([
    0x01,
    ...quic(200),
    ...quic(fields.length),
    ...fields,
    ...quic(5),
    ...Buffer.from("hello"),
    0x00,
  ]);
  // 0x03 indeterminate-length: field lines carry no length prefix and end with a 0-length name
  const chunked = Uint8Array.from([
    0x03,
    ...quic(200),
    ...fields,
    0x00,
    ...quic(2),
    ...Buffer.from("he"),
    ...quic(3),
    ...Buffer.from("llo"),
    0x00,
  ]);
  const a = bhttpDecodeResponse(knownLength);
  const b = bhttpDecodeResponse(chunked);
  check(
    "BHTTP known-length response decodes",
    a.status === 200 &&
      new TextDecoder().decode(a.body) === "hello" &&
      a.headers["content-type"] === "application/json",
  );
  check(
    "BHTTP indeterminate-length response decodes",
    b.status === 200 &&
      new TextDecoder().decode(b.body) === "hello" &&
      b.headers["content-type"] === "application/json",
  );
};

const quic = (n) => (n < 64 ? [n] : [(n >> 8) | 0x40, n & 0xff]);

const support = await supportsWebCryptoOhttp();
console.log(`WebCrypto in node ${process.version}: ${support.detail}\n`);
if (!support.ok) process.exit(1);

await x25519ToNode();
await hkdfToNode();
await aesGcmToNode();
bhttpFramings();

if (process.argv.includes("--offline")) {
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
} else {
  console.log("\nlive round trip");
  const decoded = await ohttpChat(
    {
      base: flag("base", "https://cloud-api.near.ai"),
      model: flag("model", "deepseek-ai/DeepSeek-V4.1-Flash-1017"),
      apiKey: flag("key", process.env.NEAR_AI_API_KEY ?? ""),
    },
    (message) => console.log(message),
  );
  const body = new TextDecoder().decode(decoded.body);
  const answered =
    decoded.status === 200
      ? JSON.parse(body).choices?.[0]?.message?.content
      : body.includes("authorization");
  check(
    "OHTTP round trip through the decrypted channel",
    Boolean(answered),
    `inner status ${decoded.status}`,
  );
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
