# Sealed Tip — Architecture (v2)

> Companion to `PRD.md`. Short version for agents: `ARCHITECTURE_ESSENTIALS.md`.
> v2 (4 Nov 2026) applies the hard-questions review; §14 is the decision log.
> Live task list and status: `ROADMAP.md`. **Update it in every contribution.** File layout: `project_structure.md`.
> Items marked **VERIFY** were not confirmed against live docs.

---

## 1. System overview

```
Tipster browser (no wallet, Tor recommended)           Panel browser (wallet)
 ├─ rasterise PDFs / re-encode images (local)           ├─ triage (credible?)
 ├─ AI redaction (TEE, attested) via stateless proxy    ├─ decrypt cleaned evidence
 ├─ encrypt bundle; seal K per panel member             └─ DAO proposal: resolve
 ├─ claim secret (24 words) → ed25519 + x25519 via HKDF            │
 ├─ proof-of-work                                                  ▼
 └─ sign borsh actions                                      ┌─────────────┐
        │                                                   │ Sputnik DAO │
        ▼                                                   └──────┬──────┘
 ┌──────────────────────┐   random delay, no logs                  │ FunctionCall
 │ tip-api (2 relayers) │ ───────────────────────────►  ┌──────────▼───────┐
 │ blobs (ciphertext)   │                               │ sealedtip        │
 │ AI proxy (stateless) │                               │ contract (Rust)  │
 │ 1Click quotes        │                               └──────────┬───────┘
 └──────────────────────┘                                          │ events
 ┌──────────────────────┐   heartbeat + post released keys         │
 │ keeper               │◄─────────────────────────────────────────┘
 └──────────────────────┘
```

### Key decisions
1. **The tipster has no account.** The claim secret is 32 random bytes, shown as 24 BIP39 words (entropy only, no HD paths). Keys come from `HKDF-SHA256(secret, salt = optional passphrase)`, using the labels `sealedtip/ed25519/v1` and `sealedtip/x25519/v1`.
2. **Every tipster action is a signed borsh struct** with the domain tag `sealedtip:v1`, a per-tip nonce, and the **payout destination inside the claim**. It's verified with `env::ed25519_verify`. The relayer can't forge or redirect an action.
3. **Anti-spam:**
   - The contract verifies a **proof-of-work** on submit: `sha256(evidence_hash ‖ pow_nonce)` must have ≥ `pow_bits` leading zero bits.
   - Relayers rate-limit.
   - **Funds are reserved only when a panel member triages a tip as credible**, not at submission.
4. **Cleaning is local and destructive.**
   - **PDFs are rasterised**: every page is rendered to an image and the PDF rebuilt. This kills incremental updates, embedded metadata, fonts and embedded-image EXIF.
   - **Images are re-encoded**; there's an optional grayscale-plus-threshold mode for scans, which suppresses printer tracking dots. That mode is a mitigation, not a guarantee.
   - **DOCX and other types are refused** with the message "export as PDF".
5. **AI redaction goes through a stateless proxy to NEAR AI Cloud** (decision taken). The proxy holds the API key, logs nothing, and keeps nothing after the response. The UI and README say plainly that the proxy sees the text the tipster *chooses* to send for analysis. If E2EE to the model is confirmed usable from the browser, it replaces the proxy (**VERIFY**, a day-1 spike).
6. **The dead man's switch releases a tipster-chosen "switch bundle"** (default: cleaned evidence plus the full description) to non-recused panel members, through the keeper. Raw originals are included only by explicit opt-in, with a warning.
7. **Recusal:** the tipster can exclude panel members at submission. They get no sealed key for the evidence or the switch bundle. Each tip needs ≥2 non-recused panel keys.
8. **Payout works:** `claim` calls `storage_deposit` for the destination and can send a small NEAR gas drip from the programme's NEAR `ops_balance`.
9. **Timing privacy:** relayers queue submissions and check-ins with a random delay (1–24 h in production; 0–20 s in demo mode).

## 2. Tech stack

| Layer | Choice |
|---|---|
| Contract | Rust, `near-sdk` 5.30 (`env::ed25519_verify`, `env::sha256`), `cargo-near`, borsh |
| Tests | `near-workspaces`, unit tests; shared borsh + signature vectors with TS. Sandbox tests sign tipster messages with `ed25519-dalek` 2.2 (dev-dependency only): `near-workspaces::types::SecretKey` has no `sign` and `near_crypto::Signature` gives out no raw bytes, and the crate is already in the tree via `near-crypto`, which is what the runtime's own `env::ed25519_verify` uses — so the tests verify with the same implementation the chain will, and a dev-dependency cannot reach the wasm. |
| Approved extra deps (2026-11-04) | `near-contract-standards` 5.30 (mock-ft NEP-141/145) · Vitest 5.1 (web tests) · `ed25519-dalek` 2.2 (2026-11-06, **dev/test only**, rationale in the Tests row above; flag to the owner if a non-test use is ever proposed) |
| Token | Mock NEP-141 `tusdc.<you>.testnet` (NEP-145 storage); mainnet USDC **VERIFY** id |
| Panel | Sputnik DAO v2 — testnet factory `sputnik-v2.testnet`, mainnet `sputnik-dao.near`; wasm pinned in `contracts/sealedtip/res/` (S-0.7, verified 2026-11-05) |
| Frontend | Next.js 16, TypeScript, Tailwind; wallet-selector for panel/funders only. `apps/web` also declares `zod` (the same `^4.6.7` the other packages use — it is already in the browser bundle through `@sealedtip/core`) and `pdfjs-dist` (the same range as `packages/clean`, because the browser canvas host has to point the *same* pdfjs module at its worker). Neither is a new package in the tree. |
| Client crypto | `libsodium-wrappers` (sealed boxes, XChaCha20-Poly1305), `@noble/ed25519`, `@noble/hashes` (HKDF, sha256), `@scure/bip39` (entropy ↔ words), `@dao-xyz/borsh` or hand-rolled borsh encoder |
| Client cleaning | `pdfjs-dist` (render pages), `pdf-lib` (rebuild PDF from images), canvas re-encode, `exifr` (show what's removed). The package talks to a canvas through its own `CanvasHost` port, never to a DOM: `apps/web` (P10) supplies the browser host, and `@napi-rs/canvas` is a **dev/test-only** dependency of `packages/clean` so a Node test can implement the same port — a cleaning package with a native image module in `dependencies` cannot be shipped to a tipster's browser. (pdfjs's own Node canvas factory lazily requires that same package, so nothing new enters the tree; supplying a partial factory from outside is what breaks it, which is why the host hands pdfjs no `CanvasFactory` at all and renders with `{ canvas, viewport }`.) |
| Backend | Node 22 + Hono `tip-api` (relayer queue, blobs, AI proxy, quotes); `keeper` worker |
| Storage | Ciphertext blobs (Vercel Blob / S3-compatible), `cid = sha256(ciphertext)`, 25 MB cap per tip |
| AI | NEAR AI Cloud `https://cloud-api.near.ai/v1` |
| Cross-chain payout | 1Click `https://1click.chaindefuser.com/v0` (mainnet; dry-run on testnet) |
| Monorepo | pnpm workspaces |

## 3. Repository layout
See `project_structure.md` for the full tree, module responsibilities, dependency direction and where new code goes.

## 4. Data model

```rust
pub struct Programme {
    id: ProgrammeId, funder: AccountId,
    title: String, scope_uri: String, scope_hash: [u8; 32],   // scope defines lawful channels + duplicate-tip rule
    panel_dao: AccountId,
    panel: Vec<PanelMember>,          // set only by panel_dao
    token: AccountId,
    max_reward: U128,                 // panel picks any amount ≤ this
    balance: U128, reserved: U128,
    ops_balance: NearToken,           // storage_deposit + gas drips
    gas_drip: NearToken,              // e.g. 0.05 NEAR
    pow_bits: u8,                     // e.g. 20 (demo 12)
    open: bool, time_scale: u32,
}

pub struct PanelMember { account: AccountId, x25519_pub: [u8; 32] }

pub enum TipStatus { Submitted, Dismissed, UnderReview, Unfunded, Accepted { reward: U128 }, Rejected, Retracted, Paid }

pub struct Switch {
    interval: u64, grace: u64, next_deadline: u64,
    bundle_keys_for_keeper: String,   // CID: K_switch sealed to keeper x25519
    includes_raw: bool,               // explicit opt-in, shown on tip page
    triggered: bool,
}

pub struct Tip {
    id: TipId, programme_id: ProgrammeId,
    claim_pubkey: [u8; 32],
    nonce: u64,
    evidence_cid: String, evidence_hash: [u8; 32],
    sealed_keys: Vec<(AccountId, String)>,     // non-recused panel members only (≥2)
    recused: Vec<AccountId>,
    cleaning_report_hash: [u8; 32],
    attestation_hash: Option<[u8; 32]>,        // None if tipster skipped the AI step
    switch: Option<Switch>,
    status: TipStatus,
    submitted_at: u64,                         // relayer-delayed
    triaged_by: Option<AccountId>,
    released_keys: Vec<(AccountId, String)>,
}

pub struct Contract {
    programmes: IterableMap<ProgrammeId, Programme>,
    tips: IterableMap<TipId, Tip>,
    relayers: Vec<AccountId>,                  // allow-listed (≥2)
    keeper: AccountId, keeper_x25519_pub: [u8; 32],
    keeper_last_seen: u64,
    owner: AccountId,                          // can rotate relayers/keeper only
}

// Signed actions (borsh). Message bytes = b"sealedtip:v1" ‖ borsh(SignedAction)
pub struct SignedAction { contract: AccountId, tip_id: TipId, nonce: u64, action: Action }
pub enum Action {
    Checkin,
    Retract,
    Claim { payout: Payout },
}
pub enum Payout {
    Near { account: AccountId },                         // fresh implicit account
    Intents { deposit_address: AccountId, memo: Option<String> },   // 1Click deposit (mainnet)
}
```
`submit` is signed over `b"sealedtip:v1:submit" ‖ borsh(programme_id, evidence_hash, claim_pubkey)`. This proves the tipster holds the key. The tip id doesn't exist yet at that point.

## 5. Contract interface

**Funder**
- `create_programme(title, scope_uri, scope_hash, panel_dao, token, max_reward, gas_drip, pow_bits, time_scale)`, with NEAR attached for `ops_balance`.
- `ft_on_transfer(msg={"fund": programme_id})`.
- `withdraw_unreserved(programme_id, amount)`: only up to `balance − reserved`.
- `close_programme(programme_id)`: blocks new tips; reservations stay until each tip is resolved.

**Relayer (allow-listed) on behalf of the tipster**
- `submit_tip(programme_id, claim_pubkey, evidence_cid, evidence_hash, sealed_keys, recused, cleaning_report_hash, attestation_hash, switch, pow_nonce, sig)`.
  - Checks the PoW, the signature, that ≥2 sealed keys exist, and that none of them belong to recused members.
  - Status → `Submitted`. No funds are reserved yet.
- `checkin(tip_id, nonce, sig)`, `retract(tip_id, nonce, sig)` (retract works before a decision).
- `claim(tip_id, payout, nonce, sig)`:
  - Requires status `Accepted`.
  - Calls `token.storage_deposit(dest)` and then `ft_transfer(dest, reward)`.
  - For `Payout::Near`, it also transfers `gas_drip` NEAR.
  - Status → `Paid`.

**Panel member (direct, non-recused)**
- `triage(tip_id, credible: bool)`:
  - Credible: reserve `max_reward` → `UnderReview`. If the balance is short → `Unfunded`, which is retried automatically on `fund`.
  - Not credible → `Dismissed`.

**Panel DAO only**
- `set_panel(programme_id, members)`.
- `resolve_tip(tip_id, accept, reward)`:
  - Accept: `reward ≤ max_reward`; the unused reservation is released.
  - Reject: the reservation is released.

**Switch / keeper**
- `trigger(tip_id)`: anyone, after `next_deadline + grace`.
- `post_released_keys(tip_id, keys)`: keeper only, after a trigger, and only for non-recused members.
- `heartbeat()`: keeper only; sets `keeper_last_seen`.

**Owner**
- `set_relayers`, `set_keeper`. These can't touch funds or tips.

**Views**
- `get_programme`, `list_programmes`, `get_programme_stats` → `{balance, reserved, submitted, under_review, accepted, rejected, paid, keeper_last_seen}`.
- `get_tip_public(id)` → status, age, switch deadline; no CIDs.
- `get_tip_for_panel(id)` → CIDs.
- `get_keeper_info()` → `{keeper, keeper_x25519_pub, keeper_last_seen}`. Read-only, and it adds no fact the chain was not already publishing — `set_keeper` makes the keeper's X25519 key rotatable state, so this is the only source a tipster's browser can seal a switch key against.

## 6. Client pipeline (tipster)
```
files ─► clean (rasterise PDF | re-encode image | optional scan mode) ─► cleaning_report (removed fields, pages)
     ─► [optional] AI redaction: tipster selects text ─► proxy ─► NEAR AI Cloud ─► suggestions ─► accept/edit
     ─► bundle = cleaned files + redacted description (≤25 MB)
     ─► K = rand32; ct = XChaCha20-Poly1305(K, bundle) ─► upload ─► evidence_cid/hash
     ─► for each non-recused panel member: sealed_box(K, x25519_pub) ─► upload
     ─► [switch] K_switch for switch bundle (default = same bundle; raw only if opted in) ─► sealed to keeper
     ─► PoW ─► sign submit ─► relayer queue (random delay) ─► submit_tip
```
**Status checks and claims:** the tipster enters their 24 words (plus the optional passphrase) on `/status` or `/claim`. Keys are re-derived locally and the browser signs the action.

## 7. AI redaction (NEAR AI Cloud)

Built in `apps/api/src/ai/` (S-8.5), with the verification half in `packages/crypto/src/attestation.ts` and
the offline verifier in `scripts/verify-attestation.ts`. The five steps are the contract with the service;
what follows each one is what was measured or decided when the route was written.

1. **Preflight:** `GET /v1/attestation/report?model=<id>&nonce=<hex32>&signing_algo=ecdsa` with header
   `x-no-aliasing: true`. **Measured:** the endpoint is public on `cloud-api.near.ai` — it answers with no
   `Authorization` at all — so the bearer key is not sent to it. Fewer places a key appears is the rule. The
   model id is percent-encoded into one query parameter, which a test proves cannot smuggle a second `nonce`
   or `signing_algo` past us. This call runs **before** anything is paid for: an answer that cannot be
   attested is not worth an inference credit.
2. **Completion:** `POST /v1/chat/completions` (canonical model id) with the system prompt asking for JSON
   `{suggestions:[{span, reason, replacement}], residual_risks:[…]}`, focused on content that could identify
   the tipster. **The request body is serialized once by the caller and forwarded as those exact bytes**,
   because step 3 signs sha256 of them; re-shaping the JSON — even the same object — changes the hash and
   breaks the only binding that says *this* answer is for *this* ask. A model that answers in prose is not
   refused: its bytes are still attestable, so the words come back marked `unparsed` and the tipster's page
   shows them.
3. **Signature:** `GET /v1/signature/<chat_id>?signing_algo=ecdsa`. Check `text == "<model>:<sha256(req)>:<sha256(resp)>"`
   — recomputed from the stored bytes, never taken from what the response claims — and that the signer equals
   an attested `signing_address`. Measured against the live NEAR AI Cloud service on 2026-11-10: the 65 bytes
   are r‖s‖v over the standard EIP-191 `personal_sign` digest of `<model>:<sha256(req)>:<sha256(resp)>` (without
   a trailing newline after the message length), verified with `@noble/curves` secp256k1 recovery to the attested
   `signing_address`.
4. **Bundle:** the version, the nonce the client chose, the model, the exact request and response bytes, the
   report and the signature become one `RedactionBundle`; `attestation_hash` is sha256 over its canonical
   JSON (sorted keys, `undefined` dropped), so the hash is reproducible from the file alone. The bundle is
   shown in the "Verified enclave" panel (P10) and re-verified offline with
   `pnpm verify-attestation -- --redaction <file> --nonce <hex32>`, which prints its verdicts, the hash, and
   the two things it cannot prove: the **Intel DCAP collateral chain** over each quote, and **RTMR3**, which
   is pinned by an app/os allow-list rather than replayed from the event
   log. They are listed as `unchecked` on purpose: a bundle this tool cannot fully grade must not print
   "verified". The response signature is no longer one of those gaps: the 65 bytes are r‖s‖v over the
   EIP-191 `personal_sign` digest of the same `<model>:<sha256(req)>:<sha256(resp)>` text, and the address
   they recover to must be the attested `signing_address`, with `@noble/curves` as the curve
   implementation the owner approved on 2026-11-10. Verified and proven against live hardware TEE
   completions from NEAR AI Cloud.
5. **Proxy:** stateless, holds the key, mounted behind `noLogs`, keeps no copy of the request or the response,
   and sends `cache-control: no-store` so the bundle is not resident in a CDN either. A text over 8 KiB is a
   413 that names bytes only, and with no `NEAR_AI_API_KEY` the route answers 503 before it spends anything.
   **It assembles evidence and does not grade it** — the same split S-8.4 chose, for the same reason: §5 of
   `project_structure.md` keeps `packages/crypto` out of this process, and a proxy scoring its own work would
   be evidence of nothing. The graders are the tipster's client and the offline script.

## 8. Payout
- **Testnet:** `Payout::Near` to a fresh implicit account generated at claim time. The contract calls `storage_deposit` and sends the gas drip.
- **Mainnet:** a 1Click quote via `POST /v0/quote`, proxied by `tip-api` as `POST /quote` (S-8.6):
  - `originAsset`: USDC on NEAR; `destinationAsset`: e.g., USDT on Tron. Both are 1Click asset ids
    (`nep141:…`), taken from `GET /v0/tokens`; the proxy maps the four labels the claim page offers and
    passes a canonical id straight through.
  - `depositType` and `refundType`: `INTENTS`; `recipientType`: `DESTINATION_CHAIN`.
  - `swapType`: `EXACT_INPUT`, plus `slippageTolerance` (basis points), `amount` in base units as an
    integer string, `refundTo` (a NEAR account; the proxy defaults it to the contract that paid out), and
    `deadline` (an ISO timestamp the proxy sets to ten minutes out).

  **Measured 2026-11-10, which corrected this section.** The live API's own 400 lists the required fields,
  and it answered a NEAR origin with `depositType: "ORIGIN_CHAIN"` — what this section said before — with
  `400 {"message":"Internal server error"}`. The same request with `INTENTS` answered `201`. A quote with
  `dry: false` carries `quote.depositAddress` (a 64-hex intents account, no memo); a `dry: true` quote
  carries no address at all. The proxy therefore always asks for a real quote, flattens the answer into
  `{depositAddress, memo, estimatedAmount, destinationAsset}`, and refuses a reply without an address
  instead of filling one in. The tipster signs `Payout::Intents`; track progress with
  `GET /v0/status?depositAddress=…`. The cheapest live quote measured was **$100** (a $50 request was
  refused with "Temporary swap limits: minimum swap amount is $100"), which a 500 tUSDC demo reward clears.
- **VERIFY with $1 on day 2** that a plain `ft_transfer` to the deposit address is the correct NEP-141 deposit. If not, mainnet payout falls back to `Payout::Near`, followed by a swap the tipster does themselves.

## 9. Services
**tip-api**
| Endpoint | Purpose |
|---|---|
| `POST /blob`, `GET /blob/:cid` | Ciphertext only; 25 MB cap |
| `POST /relay/:action` | Queue signed actions; random delay; per-IP-less rate limit (token bucket keyed by claim pubkey + global) |
| `POST /ai/redact` | Stateless proxy plus attestation bundle (built, S-8.5); answers 503 with no API key and keeps nothing |
| `POST /quote` | 1Click quote proxy (built, S-8.6); answers 503 with no API key, 502 on an upstream failure, and caches nothing |

- Run **2 relayer instances** with separate accounts, both allow-listed.
- The `noLogs` middleware drops IPs and bodies; a test asserts it.
- **What `POST /relay/:action` checks, and what it does not.** It forwards only `submit_tip`, `checkin`, `retract` and `claim`; validates the body against the same zod schemas that describe the deployed wasm; and for an action, reads the tip so a call naming a tip that does not exist is refused for free instead of costing relayer gas. It does **not** verify the signature: that is `env::ed25519_verify`'s job (ESSENTIALS #15), a second copy of the signed-message format in TypeScript is a copy that goes stale, and §5 of `project_structure.md` keeps `packages/crypto` out of this process. The cost of that choice is one failed relayer transaction per well-formed forgery, which is what the global token bucket bounds.
- **Rate limit is two token buckets, never an IP.** Per-claim-pubkey is fairness against one misbehaving page and cannot be a defence, since a pubkey is either caller-supplied or public on the tip; the shared bucket is what a flood actually runs into. A refusal consumes nothing.
- **`POST /ai/redact` is the one endpoint that holds a secret and reads plaintext, and that is the documented exception to §5 of `project_structure.md`, not a breach of it.** It holds `NEAR_AI_API_KEY` (which is why the browser cannot be told to call the service directly) and it sees the passage the tipster chose to send for analysis — never a tipster key, never an exhibit, never anything the cleaners produced. What it does not do is check the attestation it fetched: the bundle is assembled here and graded by a client or a script that holds `packages/crypto`, per §7.5. Its limits are about our inference credit rather than identity, because at this step of the flow there is no claim pubkey to key on and an IP is a name this service must not keep: 8 KiB of text per request, 6 requests at once, 2 a minute. An upstream failure is a 502 that names the endpoint and the status and repeats no word of the request, and nothing about a redaction request reaches a log — a test asserts that on a request that succeeds.

- **`POST /quote` is the one endpoint that sends a tipster's address to a third party, and it says so.** A
  cross-chain quote means 1Click learns the destination address and the amount; there is no way to ask a
  swap service what it would pay without telling it where the money goes. The proxy keeps that to the one
  request, sends the key from `ONECLICK_API_KEY` only to `1click.chaindefuser.com`, keeps no cache
  (`no-store`, because a deposit address with a deadline must never reach the next caller), and never
  repeats a request field in an error. It does not check the address shape — 1Click validates the address
  for its own chain and its 400 goes back as a 400.
- **keeper** (`apps/keeper`, built and tested offline in P9)
- Calls `heartbeat` every `KEEPER_HEARTBEAT_S` (5 minutes by default), and takes the first beat *before* the first sleep: a process that starts and dies inside one interval would otherwise leave `keeper_last_seen` at whatever the previous run recorded, which is the lie `set_keeper` zeroes the field to avoid (S-2.9).
- Watches for `switch_triggered`, opens `K_switch`, re-seals it to the non-recused panel members, and calls `post_released_keys`.
- **It watches the view, not the event.** `switch_triggered` is also a NEP-297 event (§10), and following it needs an indexer subscription (`next_follow`) that this repository has not deployed and cannot test offline. `get_tip_public` carries `switch_deadline` and `switch_triggered` — the same fact one hop further from the receipt — so a pass is a read per tip it is still watching. Detection is the interval plus one finality wait: `KEEPER_WATCH_S` defaults to 10 s and `env.ts` refuses more than 60, because a promise about a minute is only a promise if the config cannot break it.
- **Discovery uses the contract's own invariant**, since there is no `list_tips` view: tip ids are handed out contiguously from `next_tip_id` and no code path removes a tip, so probing upward until a read answers `null` enumerates every tip there is. The probe is capped at 50 new ids per pass so a flood of submissions cannot turn one poll into an unbounded scan, and a tip with no `switch_deadline` never joins the read set — `trigger` on a disarmed tip is E19, so a tip that cannot fire can never need releasing.
- **Its blob round trip goes through the tip API**, not a bucket: `GET /blob/:cid` and `POST /blob` (S-8.3) are the party that knows where ciphertext lives, already refuse a body that opens as a container magic, and already key by `sha256(ciphertext)`. `put` re-hashes the bytes locally and refuses a store that recorded a different cid, because that cid is the only name the panel has for the exhibit.
- **The release refuses before it spends anything**: a tip with no switch, a switch that has not fired, or a tip that already carries `released_keys` (so a keeper restarted mid-release costs a read and no transaction), and a panel whose every member the tipster recused — an empty key set would satisfy the contract and mark the tip answered, which is the opposite of what the switch promised.
- **Its write surface is a type.** `KEEPER_METHODS` is the union `heartbeat | post_released_keys`, both at 100 TGas and 0 deposit (the amounts the contract's own sandbox suite runs green at), the transport lives in `src/near.ts` as the only file in the package that names a node, and a test scans every source file for a call outside that union.
- Production plan, verified 2026-11-09 and recorded in §14.8: a TEE can take the keeper's **release step**, not the process. OutLayer runs one-shot WASI components capped at 60-180 seconds and has no scheduler, so this Node daemon cannot be lifted in; the shape that works is their untrusted external scheduler triggering a measured Rust worker that reads the switch with `view()`, re-seals inside the module, and sends `post_released_keys` with `call()` using the existing method-scoped function-call key handed in as a TEE secret. The hackathon keeper is trusted, and the README says so. What that costs in this build is stated rather than argued: the process holds the X25519 secret that opens `K_switch` *and* a function-call key, both from `.env`, so it is the one service here that can read a bundle and write a release.

## 10. Events (NEP-297, `sealedtip` v1.0.0)
`programme_created, programme_funded, programme_closed, tip_submitted, tip_triaged, tip_dismissed, tip_unfunded, tip_retracted, checkin, switch_triggered, keys_released, tip_resolved, tip_paid, panel_set, keeper_heartbeat`

## 11. Threat model
| Threat | Control | Residual |
|---|---|---|
| File metadata | Rasterise/re-encode; show what was removed | None for supported types |
| Printer tracking dots | Scan mode (grayscale + threshold) plus warning | Not guaranteed |
| Content clues | AI suggestions; the tipster edits | Stylometry, insider knowledge |
| Proxy sees analysed text | Optional step; tipster chooses the text; stateless proxy | Proxy trust (unless E2EE) |
| IP linkage | Tor guidance; no logs | User error |
| Timing linkage | Random relayer delay; advice to delay the claim | Long-run patterns |
| Spam DoS on rewards | PoW plus rate limit plus reserve-on-triage | Panel triage workload |
| Relayer redirects or forges | Signed borsh actions; nonce | None |
| Funder reneges | Reservations; withdraw only unreserved | Panel can still reject |
| Implicated panel member | Recusal (no sealed keys) | They can still vote in the DAO (documented) |
| Switch exposes the tipster | Cleaned bundle by default; raw opt-in | Panel leak |
| Keeper down | Heartbeat shown publicly | Delayed release |
| Keeper is malicious, not merely down | It cannot post a release before a trigger (E20) or name a recused member (E13); its key is scoped to two methods (`set_keeper`'s allow-list, S-2.9) and, in this build, to a union type in `src/near.ts` a test scans; a restarted keeper re-posts nothing the chain already answered | **Real and stated:** the keeper's X25519 public half is chosen at submission and its secret is static, so every tip's `K_switch` is sealed to a key one account holds — the switch bounds *when the keeper must* release, not *what it can* open. A malicious keeper reads a bundle the day it is uploaded. This is why the production plan is a TEE, and why the README calls the keeper trusted rather than neutral |
| Recovery words seized | Optional passphrase | Without a passphrase, the attacker can claim |
| Unusable payout account | `storage_deposit` plus gas drip | None |

## 12. Tests (must pass)
- **Cleaning fixtures:** no Author/Producer/XMP/incremental revisions after rasterising; no EXIF GPS after re-encoding; DOCX refused.
- **Vectors:** HKDF keys, borsh bytes and signatures are identical in TS and Rust.
- **Signatures:** a wrong key, a changed payout, or a replayed nonce all fail.
- **PoW:** submit fails below `pow_bits`.
- **Reservations:** submission reserves nothing; triage reserves; dismiss and reject release; withdrawing reserved funds fails; an `Unfunded` tip is reserved when the programme is funded.
- **Recusal:** a recused member can't triage, and no sealed key exists for them.
- **Access control:** `resolve_tip` from anyone except the DAO fails.
- **Switch:** can't trigger before `deadline + grace`; only the keeper can post keys.
- **Release:** every non-recused member gets a box that opens to the switch key, and a recused member gets nothing their own secret can open — the second half is proved by walking the blob store with the recused key, not by reading back a list of names. The keeper's own transactions are exactly `heartbeat` and `post_released_keys`, and none of its key material appears in what it logs.
- **Claim:** `storage_deposit` and gas drip happen; a transfer failure rolls back to `Accepted`.
- **Logging:** the `noLogs` test passes.
- **Attestation:** `verify-attestation.ts` passes on the stored bundle.

## 13. Env
The full list lives in `.env.example` (source of truth). Change both together.

---

## 14. Hard questions — decision log

### 14.1 What would break → decision
| # | Issue | Decision | Status |
|---|---|---|---|
| B1 | Spam reserves all rewards | PoW verified by the contract, relayer rate limits, reserve on triage | Applied |
| B2 | Switch releases the identifying raw files | Cleaned switch bundle by default; raw only by explicit opt-in | Applied |
| B3 | Cleaning gaps (incremental PDF updates, embedded EXIF, rsid, printer dots) | Rasterise PDFs; re-encode images; scan mode; refuse DOCX | Applied |
| B4 | E2EE availability | Decision: stateless proxy, optional AI step, honest UI copy; E2EE replaces it if the day-1 spike succeeds | Applied — spike succeeded, see §14.4 |
| B5 | Fresh payout account unusable | `storage_deposit` plus `gas_drip` from `ops_balance` | Applied |
| B6 | 1Click NEP-141 deposit method | $1 mainnet test on day 2; fall back to `Payout::Near` | Pending verification |
| B7 | Timestamp linkage | Random relayer delay | Applied |
| B8 | Canonical JSON fragility | Borsh plus domain tag; shared vectors | Applied |
| B9 | Relayer/keeper single point of failure | 2 relayers; keeper heartbeat shown publicly | Applied |
| B10 | Lost panel keys | ≥2 sealed keys per tip; rotation affects only future tips | Applied |

### 14.2 Edge cases → decision
| Edge case | Decision |
|---|---|
| Implicated panel member | Recusal at submission (no sealed keys); they can still vote in the DAO (documented) |
| Duplicate tips | The programme scope defines the rule; the panel may accept several with separate rewards ≤ max |
| Funder is the reported organisation | Funder sees only aggregate stats (already true) |
| Tipster later reveals their identity | `scripts/sign-statement.ts`: the tipster signs a statement with the claim key |
| Programme closes with pending tips | Reservations stay until resolved |
| Recovery words seized | Optional passphrase (HKDF salt) |
| Partially true tip | Panel picks a reward ≤ max |
| Tipster arrested or dies | Switch fires a cleaned bundle |
| Lawful channels | Defined in the programme scope; README disclaimer |
| Huge files | 25 MB cap |

### 14.3 Cuts
| Cut | Status |
|---|---|
| Encrypted Q&A thread | Removed (stretch) |
| Tiered rewards | Removed (any amount ≤ max) |
| Overdue/expiry events | Removed (show tip age) |
| DOCX support | Removed (refused) |
| Keeper sealing to a single shared panel key | **Not adopted.** Per-member sealing is kept, because recusal needs it |
| BIP39 HD derivation | Replaced by BIP39 entropy plus HKDF |
| `.onion` static export | README guidance only |
| Dual E2EE and proxy paths | **Adopted, with the proxy kept for a different job.** The browser can speak OHTTP on its own (§14.4), so the AI step no longer needs a server of ours to keep the content confidential. The proxy stays for key custody, rate limits and — the part OHTTP cannot do — hiding the tipster's IP |

### 14.4 S-0.4 result: browser-side OHTTP works (spike, 2026-11-05)
`spikes/ohttp-browser/` speaks HPKE (RFC 9180 base mode, DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 +
AES-128-GCM), BHTTP (RFC 9292) and OHTTP (RFC 9458) using **`crypto.subtle` only** — no bundler, no npm
package. The same `ohttp.js` passes under Node and in a Chromium tab.

Measured today, not assumed:
- X25519 in WebCrypto is its own algorithm (`{name:"X25519"}`), not ECDH with a `namedCurve`; a public key
  imports with no usages and the private key does the derivation. Chrome 133+, Edge, Firefox 130+, Safari 17+.
- `/.well-known/ohttp-gateway`, `POST /ohttp` and `GET /v1/attestation/report` all answer a browser origin:
  preflight returns `access-control-allow-methods: *` and `access-control-allow-headers: content-type`, and the
  key endpoint sends `access-control-allow-origin: <origin>` with `access-control-expose-headers: *`.
- The 45-byte published key config is byte-identical to the one the TEE attests. Its first symmetric suite is
  AES-128-GCM — the one WebCrypto has. The second (ChaCha20-Poly1305) has no WebCrypto binding, so pin suite 1.
- One live round trip to `deepseek-ai/DeepSeek-V4.1-Flash-1017`: 240-byte inner BHTTP request → 295-byte
  encapsulated request → `POST /ohttp` → HTTP 200 `message/ohttp-res` → decapsulated to inner **status 401,
  `invalid_auth_header`**. A request with no key still proves both directions of the codec, and the bearer token
  travels inside the ciphertext rather than on the wire.

**Decision.** The optional AI redaction step goes browser → attested TEE directly. B4's condition is met, so the
stateless proxy is no longer the confidentiality path.

**What this does not buy.** OHTTP separates *who asked* from *what was asked* only when the forwarder is not also
the gateway. A browser that posts straight to `cloud-api.near.ai` makes that host both: it holds the receiver key,
so it reads the plaintext (inside a TEE whose measurements `pnpm verify-attestation` checks — S-0.3), and it sees
the tipster's IP. For a tipster whose IP matters, the proxy or a Tor hop in front of the relay stays mandatory, and
the proxy is where our NEAR AI key and rate limits live — handing a key to every browser is not an option.
Neither of the two checks that WebCrypto cannot do — `keccak256` for the signing address, secp256k1 for the
response signature — is a reason to keep verification out of a tab any more, because `packages/crypto` ships
both in JS (`@noble/hashes`, and `@noble/curves` since 2026-11-10) and `apps/web` already runs
`verifyRedactionBundle` there. What keeps the offline verifier authoritative is not a missing primitive: a
browser's verdict on evidence the proxy assembled for it is a tipster checking their own work, and only
`pnpm verify-attestation` is a check somebody else can repeat. Chunked OHTTP (streaming) is implemented by
the relay but unproven in the browser — irrelevant here, because redaction is one non-streaming call.

### 14.5 S-3 tip-lifecycle decisions (2026-11-06)

Five decisions that a reader of `tip.rs` would otherwise have to re-derive, each now carried by a test:

- **Refusals run cheapest-first.** `submit_tip` checks relayer, programme, openness, PoW, recusal and
  quorum before it verifies the ed25519 signature, because signature verification is the most expensive
  refusal on the path and `submit_tip` is the only method an anonymous caller can reach at volume. The
  order is proven by a test that gets all the way to E09 with everything else honest.
- **"Not enough money" is not "not credible".** A credible `triage` on a short programme yields
  `Unfunded`, keeps the judgement, and is retried by the next `fund` in ascending tip-id order. A panel
  that has to re-vote when a funder tops up would be a panel that gets asked again under pressure.
- **The ≥2 sealed-key quorum counts distinct members.** Duplicate entries naming one reviewer are one
  reviewer, matching E28 in `set_panel`. Without this, "sealed to two keys" describes a tip sealed to one
  person and the whole recusal model quietly becomes single-handed.
- **`resolve_tip` with `reward: None` means the maximum.** The funder committed `max_reward` per tip at
  `triage`, so "accept at the cap" is the answer that needs no number, and no number can exceed the cap
  that was already reserved (E15). A reward attached to a *reject* is refused outright (E31) rather than
  ignored, because silently dropping a payment instruction is how a DAO's intent gets lost.
- **Tests sign with `ed25519-dalek`, contracts do not.** A dev-dependency only, chosen because the two
  near-rs types reachable from a test expose no raw signature bytes; the crate is already in the tree via
  `near-crypto`, which is what the runtime's own `env::ed25519_verify` is built on, so a test that passes
  is a signature the chain would also accept. Verified by measuring the artifact: 266 623 bytes of wasm,
  built from a target that has no test code in it.

### 14.6 S-3 signed actions and the switch (2026-11-06)

- **The deployment name is inside every signed action.** `SignedAction` carries `contract`, so the
  bytes a tipster signs are only valid against *this* contract. Without it, a signature captured from
  one testnet copy would authorise the same action on any other — a cloned front end, a malicious
  fork, or the same code redeployed under a new account. `tests/signed_actions.rs` signs a real retract
  against the sandbox root account and shows this contract refuses it (E09).
- **The nonce must be exactly last + 1, not merely larger.** A tipster that could skip ahead could
  pre-authorise a batch of actions and let a relayer spend them in any order it chose, which is the
  same liveness problem the switch exists to solve. `saturating_add` is deliberately not used: at
  `u64::MAX` it would let the final nonce replay itself forever.
- **A refused action consumes nothing.** `assert_signed` checks and never writes; the caller stores
  `tip.nonce = nonce` only after its own guards have passed. So a relayer that forwards a valid action
  and trips some other rule costs the tipster nothing, and the same bytes can be re-forwarded — proven
  in the sandbox by a panel member's refused call followed by a relayer's accepted one, same signature.
- **`trigger` has no role guard, on purpose.** Every other entry point on this contract has an
  allow-list, and the one that releases the evidence bundle does not — because the switch is the
  tipster's protection *against* those parties. What makes the open endpoint safe is that it is only
  reachable after `next_deadline + grace`, and all it can do is record that it has been.
- **The grace is scaled by the same `time_scale` as the interval.** Compressing the deadline while
  leaving the grace in real nanoseconds would hand a demo tipster a four-hour protection window against
  a one-minute clock, and a live tipster would see the opposite. The ratio the tipster chose at
  submission is what survives into the compressed clock.
- **Recusal is re-checked at release, not taken on trust from submission.** `submit_tip` already
  refuses a sealed key naming a recused member (E13), and `post_released_keys` applies the same rule to
  the released set. The reason is that `get_tip_for_panel` serves those CIDs to whoever proves a panel
  seat, so the disclosure point is the release, and the party holding the bundle key is the one this
  build treats as trusted-but-verifiable (ARCHITECTURE §11).
- **A released key set replaces rather than appends.** The keeper can post a wrong set and correct it
  without the tip being permanently mis-released; what the contract can check is *whose name* each entry
  carries, not that the ciphertext under it really is `K_switch` re-sealed — only the keeper ever held
  `K_switch`, so that half stays the keeper's obligation and the UI reads it as such.
- **`E20_NOT_TRIGGERED` is separate from `E18_SWITCH_NOT_DUE`.** Both mean "too early" and the
  difference matters to whoever is debugging: E18 is a watcher whose clock is wrong, E20 is the keeper
  answering a release the switch never asked for.
- **The keeper's release condition is `switch.triggered` and nothing else — no status filter.** The
  switch is an instruction about the *bundle*, not about the reward: a tip that was dismissed, rejected
  or retracted still has a fired switch, and the panel still gets what the tipster said to release when
  the outlet disappeared. The contract enforces exactly this — `post_released_keys` refuses before a
  trigger (E20) and names no status — so a keeper that filtered on status would be inventing a rule the
  tipster never agreed to, and would turn the dead man's switch into a second way to bury evidence.
  The same reasoning is why an all-recused panel throws instead of posting an empty key set: silence an
  operator can see beats a release that looks answered. (P9, `apps/keeper/src/release.ts`.)

### 14.7 P10 client decisions (2026-11-09)

- **`evidence_hash` is `sha256(ciphertext)` — the same bytes as the CID — and not a hash of the
  plaintext.** A content hash is cheap to compute and would let the panel verify what it decrypted, but it
  is a permanent, chain-visible fingerprint of the document itself: two tipsters who both leak the same
  invoice would be linked by their `evidence_hash` even though their ciphertexts differ. What the client
  does instead is hash the *canonical serialization* of the bundle it is about to encrypt
  (`packages/crypto/src/bundle.ts::sealBundle`), so the panel can recompute it after opening and still get
  the check, and nobody who cannot open the box gets anything. Locked by the crypto test "the evidence hash
  is the cid, in bytes — and neither is a fingerprint of the content".
- **There is one bundle, so `K_switch == K` unless the tipster opts into raw.** The contract's `Switch`
  stores a CID for *the key sealed to the keeper* and no CID for a second ciphertext, and the keeper
  re-seals whatever `openSealed` hands back without looking at it (`apps/keeper/src/release.ts`). The
  reading that fits both is that the switch releases the same exhibit the panel already holds the key to,
  with the tipster's full description, and `includes_raw` is a flag on that one bundle rather than a
  pointer to another. The consequence is stated instead of hidden: **a tipster who opts into raw originals
  gives the panel those files at triage, not only if the switch fires** — which is what the switch settings
  screen has to say out loud.
- **The keeper's X25519 public key is read from the chain (`get_keeper_info`), never from a build
  variable.** `set_keeper` rotates it, so a `NEXT_PUBLIC_` value is a snapshot of a decision the owner can
  make later; and a switch sealed to the wrong key does not fail when the tipster arms it, it fails when
  they are already in trouble. Adding a read-only view was a §5 change, so it is written down there: no new
  mutating method, no new secret, and every field the view returns was already public.
- **The bundle schema lives in `@sealedtip/core`, its serialization and hashing in `@sealedtip/crypto`.**
  Three programs read the container — the tipster's browser, the panel's browser, and `pnpm demo` — and a
  second definition of it is a container the other two cannot open. Neither move adds a dependency edge:
  `project_structure.md` §5 keeps crypto out of `apps/api`, and the schema is a value the web tier already
  imports from core.
- **`apps/web` reaches the DOM through three injected primitives, so the web tests are Node tests.** A
  jsdom dependency would be a new one (§2), and the arithmetic worth testing in a canvas host — pixels
  round trip, a decode sizes from the image, quality passes through unmangled — does not need a DOM to
  prove. What stays untested is whether `HTMLCanvasElement` behaves like the fake; that is the browser's
  answer. The one thing a reader has to keep true: `pdfjs-dist` is a dependency of both `packages/clean`
  and `apps/web`, and it must be the same version in both, because `GlobalWorkerOptions` is a module
  singleton and the worker port has to be set on the instance the cleaner actually reads.
- **Privacy invariant 3 is enforced by a per-request nonce, and that decides two other things.** The App
  Router ships each page's routing payload in inline `<script>` tags, so a `script-src` that names only
  `'self'` refuses them and nothing hydrates — measured on `main`, where four routes sat on their
  "Loading…" shells with six console violations while the CSP test passed, because the test asserted the
  config string rather than a served page. So `lib/csp.ts` builds the policy and `apps/web/proxy.ts` is the
  one place it is set, on the **request** as well as the response: the render reads the nonce off
  `req.headers` and stamps its own scripts from there, and a response-only header admits scripts that carry
  no nonce. Two consequences whoever continues should not "fix": every route is `force-dynamic`, because
  HTML written at build time cannot contain a nonce it does not know yet; and `'unsafe-inline'` stays out of
  `script-src`, because that is the half of the invariant the header exists to hold.
- **`apps/web` type-checks against package *source*, so it declares no TypeScript project references.**
  Every package's `build` is `tsc --noEmit`, which produces nothing for a reference to point at, so a
  reference resolves to whatever `dist/` an older full build left behind — gitignored, and on `main` two
  days stale. `next build` then reported that `@sealedtip/core` exports no `KeeperInfo` four commits after
  it started to, while `pnpm lint` stayed green because `tsc -b` rebuilds references first. `main`/`types`
  in each package.json point at `src/index.ts`, which is what `transpilePackages` bundles and what vitest
  imports, so type check, bundle and test read one file.


### 14.8 S-0.10 result: OutLayer is not a host for the keeper, and is one for its release step (research, 2026-11-09)

PRD §"Keeper is a trust point" and §9 of this document both said *run the keeper in a TEE (OutLayer or similar)* and marked it **VERIFY**. This is that verification. Every statement below is from OutLayer's own pages, read on 2026-11-09: `app.outlayer.ai/docs/{getting-started,wasi,near-integration,https-api,secrets,signing-keys,encryption-keys,storage,tasks,tee-attestation,trust-verification,pricing}`, `outlayer.ai/platform`, and `github.com/out-layer/outlayer` (its README and `docs/NON_CUSTODIAL.md`) plus `github.com/out-layer/self-hosted-scheduler`. Two housekeeping facts first: the domain is **outlayer.ai** — `outlayer.com` is registered and sits on Cloudflare but answers no A record (checked over DNS-over-HTTPS, so this is not the local resolver lying), and the docs pages are server-rendered HTML, so a judge can read them without a browser session.

**Verdict: this Node process cannot run there, and the part of it that matters most is the part that can.**

Why the keeper as built does not fit:

- **A run is one-shot and capped.** Execution is requested by a NEAR call (`request_execution` on `outlayer.near` / `outlayer.testnet`, resumed by yield/callback) or by `POST https://api.outlayer.ai/call/{owner}/{project}` with an `X-Payment-Key`, and takes `max_execution_seconds`: *"default: 60s, max: 180s"*. The keeper's shape is a process that sleeps 300 seconds between beats and never returns. Nothing on the platform waits or repeats: the words *cron*, *schedule* and *timer* appear on none of the pages above, and the one page called *Tasks* is not a scheduler but an approval inbox for a human owner, which says so itself — *"Nothing waits inside the enclave. A task is a record."* Their own answer to the gap is a separate, untrusted process, below.
- **Compute is a WASI component, named by its sha256.** *"Any language that compiles to WASM with WASI support: Rust, C/C++, Go, AssemblyScript, and more. Rust is recommended."* WASI P2 is required for the HTTP client and the host interfaces, and a run has *"no files and no raw sockets: a run keeps its data in memory"*. `apps/keeper` is Node 22 with `node:crypto`, `fetch`, a `.env`, and a state file; it cannot be lifted in as it is. Hosting any of it means rewriting that path in Rust.

Why the release step fits better than expected:

- **The chain surface is host functions, not sockets.** `view(contract_id, method_name, args_json)` and `call(signer_id, signer_key, receiver_id, method_name, args_json, deposit_yocto, gas) → (tx_hash, status)` run over *"private NEAR RPC endpoints (powered by Fastnear)"*, and the docs state the custody rule outright: *"Your code passes signer_key from secrets — worker never uses its own keys."* So a release is two host calls — read the switch, then `post_released_keys` — with the keeper's **existing** method-scoped function-call key handed in as an OutLayer secret (*"encrypted and stored on-chain, then decrypted inside TEE"*), and no transaction encoding or ed25519 signing implemented in our module at all. `KEEPER_METHODS` (`heartbeat | post_released_keys`) needs no change to be the key's scope.
- **Their own scheduler is the untrusted-trigger pattern, which is the whole point.** `out-layer/self-hosted-scheduler` runs *"on your server, outside TEE"*, decides *"when to call your agent and what input to pass"*, and is described as *"the same design as `cron` in Linux: a simple, untrusted process that invokes kernel-protected processes"*; the README adds *"It never handles sensitive data — secrets, signing keys, and execution all stay inside the Intel TDX enclave."* Triggers are config-driven (interval, storage diff, webhook). That is exactly the downgrade this design wanted: today's keeper is one machine that both holds the key and decides *what*; under this shape the machine outside decides only *when*, and cannot move *what* because the code that answers is the measured build.
- **The re-seal stays our code, and only the signing can be delegated.** Their `encryption_keys` are 32-byte symmetric keys where *"which algorithm uses them is the platform's choice"* — that cannot be pinned to the X25519 → HKDF-SHA256 → AES-256-GCM form `packages/crypto` and the contract already fix, so re-sealing to the non-recused panel members has to happen inside the module (`x25519-dalek`, `hkdf`, `aes-gcm` in Rust, matching the parity vectors already in `fixtures/vectors.json`). The `signing_keys` interface is genuinely ed25519 and genuinely TEE-held, but *"The caller is part of every key"*: the derived public key changes with whoever triggers the run, so it cannot be the one access key we install once on-chain. Passing the key through `call(...)` sidesteps that, which is why the derived-key route is not the one to use.
- **Two trust residuals, both in their own writing, both decision-grade.** `docs/NON_CUSTODIAL.md` says that at this stage the DAO account gating the default keystore master *"carries a full-access key… so its holder can obtain the shared master secret outside any enclave"*, that measurement approval is *"the DAO owner alone, and the DAO has one member"*, and that the policy, DAO and worker-registration contracts *"are each redeployed with a full-access key, without a vote or a delay"*. Their own answer to that is a per-project MPC vault contract that *"has no full-access key from the moment it is deployed"*, whose only key is restricted to the MPC derivation call, checkable with `outlayer vault verify <vault_id>`, with a readable exit window. So a production keeper would use a vault, not the default master, or it would have traded a VPS operator for OutLayer's.
- **Attestation is real and offline-checkable.** Every execution produces an Intel TDX quote over five SHA-384 measurements (MRTD + RTMR0-3) binding the wasm sha256, the input and the output; worker registration verifies the quote chain on-chain *"with Intel DCAP QVL"* and whitelists the five measurements; a failed call carries no attestation; and third-party checking is published as `outlayer-verify … --offline`, with no account and no API key, with their own caveat that it *"does not prove the approved build came from the published source"*.
- **Cost is per execution, which decides the split.** *"Execution cost = base_fee + (instructions × instruction_rate) + (time_ms × time_rate)"*, refunded to `payer_account_id` on success, *"A failed execution is charged for the resources it used"*, `estimate_execution_cost` queryable first. A 5-minute poll is 288 paid calls a day forever; a release-only worker is paid once, when a tipster is actually in trouble. That is the economic reason the watcher stays outside and the release goes in.

**What this build does with it: nothing, and that is the answer PRD §135 asked for.** The hackathon keeper remains a trusted service and the README still says so; §9's bullet is rewritten to this finding rather than to a plan we cannot ship in the time. For production the shape is settled: untrusted external scheduler → measured WASI-P2 Rust worker → `view()` the switch, re-seal in-module, `call()` `post_released_keys` with the method-scoped key from a **project vault's** secrets. The privacy invariant that must survive the move is invariant 3: the worker may hold `K_switch`, and must never hold the tipster's identity, so the re-seal path stays key-only and the worker gets no blob plaintext beyond the sealed bundle it is designed to re-encrypt.

**One finding for S-0.3, out of proportion to this task.** Their registration contract does on-chain Intel DCAP QVL verification of a TDX quote against five approved measurements. That is precisely the mechanism our attestation gap is missing: `packages/crypto/src/attestation.ts` anchors its chain by trust-on-first-use (`--pin-ca`) because each VM mints its own KMS CA, and the alternative needs `@phala/dcap-qvl-node`, a dependency the maintainer has not approved. A NEAR contract that already verifies quotes is a third way, and it adds no dependency to this repository. Recorded here so the next person searching for a DCAP verifier does not start from scratch; it does not close #2.
