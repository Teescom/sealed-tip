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
| Frontend | Next.js 16, TypeScript, Tailwind; wallet-selector for panel/funders only |
| Client crypto | `libsodium-wrappers` (sealed boxes, XChaCha20-Poly1305), `@noble/ed25519`, `@noble/hashes` (HKDF, sha256), `@scure/bip39` (entropy ↔ words), `@dao-xyz/borsh` or hand-rolled borsh encoder |
| Client cleaning | `pdfjs-dist` (render pages), `pdf-lib` (rebuild PDF from images), canvas re-encode, `exifr` (show what's removed) |
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
1. **Preflight:** `GET /v1/attestation/report?model=<id>&provider=near&signing_algo=ecdsa&nonce=<hex32>` with headers `x-no-aliasing: true` and `Authorization: Bearer`. Verify the TDX quote with DCAP, check that the nonce and `signing_address` are bound in the report data, and replay the event log to RTMR3. Start from `near-examples/nearai-cloud-verification-example`.
2. **Completion:** `POST /v1/chat/completions` (canonical model id). The system prompt asks for JSON `{suggestions:[{span, reason, replacement}], residual_risks:[…]}`, focused on content that could identify the tipster.
3. **Signature:** `GET /v1/signature/<chat_id>?signing_algo=ecdsa`. Check `text == "<model>:<sha256(req)>:<sha256(resp)>"` and that the signer equals the attested `signing_address`.
4. **Bundle:** the attestation, verification result and signature (no PII) become `attestation_hash`. The bundle is shown in the "Verified enclave" panel and can be re-verified with `scripts/verify-attestation.ts`.
5. **Proxy:** stateless, holds the key, uses the `noLogs` middleware, and keeps no copy of the request or response.

## 8. Payout
- **Testnet:** `Payout::Near` to a fresh implicit account generated at claim time. The contract calls `storage_deposit` and sends the gas drip.
- **Mainnet:** a 1Click quote via `POST /v0/quote`:
  - `originAsset`: USDC on NEAR; `destinationAsset`: e.g., USDT on Tron.
  - `depositType` and `refundType`: `ORIGIN_CHAIN`; `recipientType`: `DESTINATION_CHAIN`.
  - `swapType`: `EXACT_INPUT`, plus `slippageTolerance` and `deadline`.

  The quote returns a `depositAddress` (and a memo if needed). The tipster signs `Payout::Intents`. Track progress with `GET /v0/status?depositAddress=…`.
- **VERIFY with $1 on day 2** that a plain `ft_transfer` to the deposit address is the correct NEP-141 deposit. If not, mainnet payout falls back to `Payout::Near`, followed by a swap the tipster does themselves.

## 9. Services
**tip-api**
| Endpoint | Purpose |
|---|---|
| `POST /blob`, `GET /blob/:cid` | Ciphertext only; 25 MB cap |
| `POST /relay/:action` | Queue signed actions; random delay; per-IP-less rate limit (token bucket keyed by claim pubkey + global) |
| `POST /ai/redact` | Stateless proxy plus attestation bundle |
| `POST /quote` | 1Click quote proxy |

- Run **2 relayer instances** with separate accounts, both allow-listed.
- The `noLogs` middleware drops IPs and bodies; a test asserts it.

**keeper**
- Calls `heartbeat` every 5 minutes.
- Watches for `switch_triggered`, opens `K_switch`, re-seals it to the non-recused panel members, and calls `post_released_keys`.
- Production plan: run it in a TEE (OutLayer or similar, **VERIFY**). The hackathon keeper is trusted, and the README says so.

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
the proxy is where our NEAR AI key and rate limits live — handing a key to every browser is not an option. Two
checks cannot run in a tab: `keccak256` for the signing address and secp256k1 for the response signature are absent
from WebCrypto, so attestation verification stays in the offline verifier and in-browser pinning would need a
dependency. Chunked OHTTP (streaming) is implemented by the relay but unproven in the browser — irrelevant here,
because redaction is one non-streaming call.

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
