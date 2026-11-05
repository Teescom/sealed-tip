// S-0.4 spike: talk to an attested NEAR AI Cloud model straight from the client, with no dependency.
// HPKE (RFC 9180) + BHTTP (RFC 9292) + OHTTP (RFC 9458) built on WebCrypto alone, so the same file
// runs in a browser tab (spikes/ohttp-browser/index.html) and under Node (spikes/ohttp-browser/test.mjs).

const u8 = (bytes) => Uint8Array.from(bytes);

const concat = (parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const ascii = (text) => new TextEncoder().encode(text);
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// WebCrypto's HKDF always extracts before expanding, and HPKE needs expand on its own,
// so both halves are built from HMAC-SHA256 instead.
const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

const hmac = async (secret, data) =>
  new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), data));

export const hkdfExtract = (salt, ikm) => hmac(salt.length ? salt : new Uint8Array(32), ikm);

export const hkdfExpand = async (prk, info, length) => {
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let off = 0;
  for (let counter = 1; off < length; counter++) {
    prev = await hmac(prk, concat([prev, info, u8([counter])]));
    const take = Math.min(prev.length, length - off);
    out.set(prev.subarray(0, take), off);
    off += take;
  }
  return out;
};

// HPKE's labeled variants (RFC 9180 §4) salt the key material with the suite id and label.
const labeledExtract = (suiteId, label, ikm, salt) =>
  hkdfExtract(salt ?? new Uint8Array(32), concat([ascii("HPKE-v1"), suiteId, ascii(label), ikm]));

const labeledExpand = (suiteId, label, prk, info, length) =>
  hkdfExpand(
    prk,
    concat([
      u8([(length >> 8) & 0xff, length & 0xff]),
      ascii("HPKE-v1"),
      suiteId,
      ascii(label),
      info,
    ]),
    length,
  );

// BHTTP counts fields with QUIC's variable-length integers (RFC 9000 §16).
const quicEncode = (n) => {
  if (n < 64) return u8([n]);
  if (n < 16384) return u8([(n >> 8) | 0x40, n & 0xff]);
  if (n < 1073741824) {
    const v = (n | 0x80000000) >>> 0;
    return u8([v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
  const big = BigInt(n) | 0xc000000000000000n;
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = Number((big >> BigInt(56 - 8 * i)) & 0xffn);
  return out;
};

const quicDecode = (data, off) => {
  const prefix = data[off] >> 6;
  if (prefix === 0) return [data[off] & 0x3f, off + 1];
  if (prefix === 1) return [((data[off] & 0x3f) << 8) | data[off + 1], off + 2];
  if (prefix === 2) {
    let n = 0;
    for (let i = 0; i < 4; i++) n = (n << 8) | data[off + i];
    return [n & 0x3fffffff, off + 4];
  }
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(data[off + i]);
  return [Number(n & 0x3fffffffffffffffn), off + 8];
};

const qstr = (bytes) => concat([quicEncode(bytes.length), bytes]);

export const bhttpEncodeRequest = (method, scheme, authority, path, headers, body) => {
  const fields = concat(
    headers.map(([name, value]) => concat([qstr(ascii(name)), qstr(ascii(value))])),
  );
  return concat([
    u8([0x00]),
    qstr(ascii(method)),
    qstr(ascii(scheme)),
    qstr(ascii(authority)),
    qstr(ascii(path)),
    quicEncode(fields.length),
    fields,
    quicEncode(body.length),
    body,
    quicEncode(0),
  ]);
};

export const bhttpDecodeResponse = (data) => {
  const framing = data[0];
  if (framing !== 0x01 && framing !== 0x03)
    throw new Error(`unsupported BHTTP response framing 0x${framing.toString(16)}`);
  let off = 1;
  let status = 0;
  for (;;) {
    [status, off] = quicDecode(data, off);
    if (framing === 0x01 || status >= 200) break;
    for (;;) {
      let n;
      [n, off] = quicDecode(data, off);
      if (n === 0) break;
      off += n;
      [n, off] = quicDecode(data, off);
      off += n;
    }
  }

  const headers = {};
  const readField = () => {
    let n;
    [n, off] = quicDecode(data, off);
    if (n === 0) return false;
    const name = new TextDecoder().decode(data.subarray(off, off + n));
    off += n;
    [n, off] = quicDecode(data, off);
    headers[name] = new TextDecoder().decode(data.subarray(off, off + n));
    off += n;
    return true;
  };

  let body;
  if (framing === 0x01) {
    let len;
    [len, off] = quicDecode(data, off);
    const end = off + len;
    while (off < end) readField();
    off = end;
    [len, off] = quicDecode(data, off);
    body = data.subarray(off, off + len);
  } else {
    for (;;) {
      if (!readField()) break;
    }
    const parts = [];
    for (;;) {
      let n;
      [n, off] = quicDecode(data, off);
      if (n === 0) break;
      parts.push(data.subarray(off, off + n));
      off += n;
    }
    body = concat(parts);
  }
  return { status, headers, body };
};

const aesKey = (key, usage) => crypto.subtle.importKey("raw", key, "AES-GCM", false, [usage]);

const aesEncrypt = async (key, nonce, plaintext) =>
  new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      await aesKey(key, "encrypt"),
      plaintext,
    ),
  );

const aesDecrypt = async (key, nonce, ciphertext) =>
  new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      await aesKey(key, "decrypt"),
      ciphertext,
    ),
  );

/** key_config = key_id ‖ kem_id ‖ 32-byte X25519 pk (no length prefix) ‖ suite-list length ‖ suites */
export const parseKeyConfig = (kc) => ({
  keyId: kc[0],
  kemId: (kc[1] << 8) | kc[2],
  receiverPk: kc.subarray(3, 35),
  // bytes 35-36 hold the symmetric-suite list length, so the first suite starts at 37
  kdfId: (kc[37] << 8) | kc[38],
  aeadId: (kc[39] << 8) | kc[40],
});

const hpkeSetupSender = async (receiverPk, kemId, kdfId, aeadId, info) => {
  const kemSuiteId = concat([ascii("KEM"), u8([(kemId >> 8) & 0xff, kemId & 0xff])]);
  const hpkeSuiteId = concat([
    ascii("HPKE"),
    u8([
      (kemId >> 8) & 0xff,
      kemId & 0xff,
      (kdfId >> 8) & 0xff,
      kdfId & 0xff,
      (aeadId >> 8) & 0xff,
      aeadId & 0xff,
    ]),
  ]);

  // X25519 is its own WebCrypto algorithm (WICG secure-curves), not ECDH with a namedCurve.
  const eph = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const enc = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const receiver = await crypto.subtle.importKey("raw", receiverPk, { name: "X25519" }, false, []);
  const dh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: receiver }, eph.privateKey, 256),
  );

  const eaePrk = await labeledExtract(kemSuiteId, "eae_prk", dh);
  const sharedSecret = await labeledExpand(
    kemSuiteId,
    "shared_secret",
    eaePrk,
    concat([enc, receiverPk]),
    32,
  );

  const pskIdHash = await labeledExtract(
    hpkeSuiteId,
    "psk_id_hash",
    new Uint8Array(0),
    new Uint8Array(32),
  );
  const infoHash = await labeledExtract(hpkeSuiteId, "info_hash", info, new Uint8Array(32));
  const ksContext = concat([u8([0x00]), pskIdHash, infoHash]);
  const prkKs = await labeledExtract(hpkeSuiteId, "secret", new Uint8Array(0), sharedSecret);

  return {
    enc,
    key: await labeledExpand(hpkeSuiteId, "key", prkKs, ksContext, 16),
    baseNonce: await labeledExpand(hpkeSuiteId, "base_nonce", prkKs, ksContext, 12),
    exporterSecret: await labeledExpand(hpkeSuiteId, "exp", prkKs, ksContext, 32),
    hpkeSuiteId,
  };
};

export const ohttpEncapsulate = async (kc, bhttpRequest) => {
  const { keyId, kemId, receiverPk, kdfId, aeadId } = parseKeyConfig(kc);
  const header = u8([
    keyId,
    (kemId >> 8) & 0xff,
    kemId & 0xff,
    (kdfId >> 8) & 0xff,
    kdfId & 0xff,
    (aeadId >> 8) & 0xff,
    aeadId & 0xff,
  ]);
  const info = concat([ascii("message/bhttp request\u0000"), header]);
  const ctx = await hpkeSetupSender(receiverPk, kemId, kdfId, aeadId, info);
  const ct = await aesEncrypt(ctx.key, ctx.baseNonce, bhttpRequest);
  return { message: concat([header, ctx.enc, ct]), ctx };
};

export const ohttpDecapsulateResponse = async (encResponse, ctx) => {
  const nk = 16;
  const nn = 12;
  const span = Math.max(nk, nn);
  const responseNonce = encResponse.subarray(0, span);
  const ct = encResponse.subarray(span);
  const secret = await labeledExpand(
    ctx.hpkeSuiteId,
    "sec",
    ctx.exporterSecret,
    ascii("message/bhttp response"),
    span,
  );
  // RFC 9458 §4.4 derives the response AEAD with plain HKDF, not HPKE's labeled variant.
  const prk = await hkdfExtract(concat([ctx.enc, responseNonce]), secret);
  return aesDecrypt(
    await hkdfExpand(prk, ascii("key"), nk),
    await hkdfExpand(prk, ascii("nonce"), nn),
    ct,
  );
};

/** One chat call, encapsulated on the way in and decapsulated on the way out. */
export const ohttpChat = async (
  { base, model, apiKey = "", prompt = "Say hi in exactly one word." },
  log = () => {},
) => {
  const authority = base.replace(/^https?:\/\//, "");
  const keyResponse = await fetch(`${base}/.well-known/ohttp-gateway`);
  if (!keyResponse.ok) throw new Error(`key config fetch → HTTP ${keyResponse.status}`);
  const kc = new Uint8Array(await keyResponse.arrayBuffer());
  log(
    `GET /.well-known/ohttp-gateway → ${keyResponse.status} ${keyResponse.headers.get("content-type")}, ${kc.length} bytes`,
  );
  log(`key config ${toHex(kc)}`);

  const inner = bhttpEncodeRequest(
    "POST",
    "https",
    authority,
    "/v1/chat/completions",
    [
      ["authorization", `Bearer ${apiKey}`],
      ["content-type", "application/json"],
    ],
    ascii(JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 10 })),
  );
  log(`inner BHTTP request ${inner.length} bytes — the bearer token is inside the ciphertext`);

  const { message, ctx } = await ohttpEncapsulate(kc, inner);
  log(
    `encapsulated request ${message.length} bytes (${toHex(message).length} hex chars), no plaintext in it`,
  );

  const response = await fetch(`${base}/ohttp`, {
    method: "POST",
    headers: { "content-type": "message/ohttp-req" },
    body: message,
  });
  log(`POST /ohttp → HTTP ${response.status} ${response.headers.get("content-type")}`);
  if (response.status !== 200)
    throw new Error(`transport refused: ${(await response.text()).slice(0, 300)}`);

  const decoded = bhttpDecodeResponse(
    await ohttpDecapsulateResponse(new Uint8Array(await response.arrayBuffer()), ctx),
  );
  log(
    `decapsulated BHTTP response: status ${decoded.status}, headers ${JSON.stringify(decoded.headers)}`,
  );
  log(`inner body ${new TextDecoder().decode(decoded.body)}`);
  return decoded;
};

/** What this environment's WebCrypto can actually do for us, checked rather than assumed. */
export const supportsWebCryptoOhttp = async () => {
  const missing = [];
  try {
    const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    const other = await crypto.subtle.importKey("raw", raw, { name: "X25519" }, false, []);
    await crypto.subtle.deriveBits({ name: "X25519", public: other }, pair.privateKey, 256);
  } catch (error) {
    missing.push(`X25519 (${error})`);
  }
  try {
    await aesEncrypt(new Uint8Array(16), new Uint8Array(12), new Uint8Array(4));
  } catch (error) {
    missing.push(`AES-128-GCM (${error})`);
  }
  try {
    await hmac(new Uint8Array(32), ascii("x"));
  } catch (error) {
    missing.push(`HMAC-SHA-256 (${error})`);
  }
  return {
    ok: missing.length === 0,
    detail: missing.length ? missing.join("; ") : "X25519 deriveBits, AES-128-GCM, HMAC-SHA-256",
  };
};
