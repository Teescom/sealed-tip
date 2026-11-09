# Sealed Tip — Architecture Essentials (v2)

> Quick reference. Full detail: `ARCHITECTURE.md` (decision log in §14). Product: `PRD.md`.
> Tasks and status: `ROADMAP.md`. **Every contribution must update it** (status, progress, Changelog). File layout: `project_structure.md`.

## What it is
- An anonymous whistleblower tip line with rewards locked in advance, AI cleaning in a secure enclave, payout to any chain, and a dead man's switch.
- Track: Privacy & Private AI.

## Non-negotiable decisions
1. **The tipster has no account.**
   - 32 random bytes, shown as 24 words (BIP39 entropy only).
   - Keys are derived with `HKDF(secret, salt = passphrase?)` for `sealedtip/ed25519/v1` and `sealedtip/x25519/v1`.
2. **Every tipster action is a signed borsh struct.**
   - Format: `b"sealedtip:v1" ‖ borsh({contract, tip_id, nonce, action})`, verified with `env::ed25519_verify`.
   - The payout destination is inside `Claim`, so the relayer can't redirect it.
3. **Anti-spam:**
   - The contract verifies a PoW (`pow_bits`).
   - Relayers rate-limit.
   - **Funds are reserved only when a panel member triages a tip as credible**, never at submission.
4. **Cleaning happens locally:**
   - PDFs are rasterised; images are re-encoded.
   - An optional scan mode (grayscale + threshold) helps against printer tracking dots.
   - DOCX and other types are refused.
5. **The AI step is optional.** The day-1 spike settled it (ARCHITECTURE §14.4): a browser can encrypt straight to the attested NEAR AI Cloud TEE with no library and no server of ours in the path, so the text the tipster chooses to send does not pass through our proxy. The proxy stays anyway, for two things encryption cannot do: it holds our API key and rate limits, and it is the only step that hides the tipster's IP. The UI must still say plainly who can read the text.
6. **The dead man's switch releases a cleaned "switch bundle" by default.** Raw files go only with an explicit opt-in. The keeper re-seals it to non-recused panel members.
7. **Recusal:** the tipster can exclude panel members, who then get no sealed keys. Each tip needs ≥2 sealed keys.
8. **Claim:** `storage_deposit` on the destination plus a NEAR gas drip from the programme's `ops_balance`.
9. **Timing privacy:** relayers delay actions randomly (production 1–24 h, demo 0–20 s). Use 2 relayers. The keeper's heartbeat is shown publicly.
10. **Only the DAO can resolve tips** (`resolve_tip`, `set_panel`). Triage is done directly by a panel member.

## Tip lifecycle
- `Submitted` → `triage` → `UnderReview`, or `Unfunded` when the balance is short.
- Triage can also end it as `Dismissed`.
- From `UnderReview`: `resolve` → `Accepted{reward}` → `claim` → `Paid`; or `Rejected`.
- `Retracted`: possible any time before a decision.
- The switch is independent: `checkin` keeps it alive; missing `deadline + grace` leads to `trigger`, then `keys_released`.

## Encryption
- `K` encrypts the cleaned bundle with XChaCha20-Poly1305 and is sealed to each non-recused panel member.
- `K_switch` encrypts the switch bundle and is sealed to the keeper.
- Ciphertext blobs only, with `cid = sha256(ct)` and a 25 MB cap.

## Payout
- **Testnet:** `Payout::Near{fresh implicit}`.
- **Mainnet:** `Payout::Intents{deposit_address, memo}` from a 1Click quote (USDC on NEAR to any chain). Verify the deposit method with $1 on day 2; fall back to `Near`.

## NEAR AI Cloud calls
- **Attestation:** `GET /v1/attestation/report?model&provider=near&signing_algo=ecdsa&nonce` with header `x-no-aliasing: true`.
- **Completion:** `POST /v1/chat/completions`.
- **Signature:** `GET /v1/signature/{chat_id}?signing_algo=ecdsa`. Expect `text == model:sha256(req):sha256(resp)`, and the signer must equal the attested address.

## Core types
- `Programme{funder,panel_dao,panel[{account,x25519_pub}],token,max_reward,balance,reserved,ops_balance,gas_drip,pow_bits}`
- `Tip{claim_pubkey,nonce,evidence_cid,evidence_hash,sealed_keys,recused,cleaning_report_hash,attestation_hash?,switch?,status}`
- `Switch{interval,grace,next_deadline,bundle_keys_for_keeper,includes_raw,triggered}`
- `Action{Checkin|Retract|Claim{payout}}`

## Stack
- **Contract and tests:** Rust `near-sdk` 5.30 + borsh; tests in `near-workspaces`.
- **Frontend:** Next.js 16.
- **Client crypto:** libsodium-wrappers, @noble/ed25519, @noble/hashes, @scure/bip39.
- **Client cleaning:** pdfjs-dist, pdf-lib, exifr.
- **Services:** Hono `tip-api` (relayer queue, blobs, AI proxy, quotes) and the keeper.
- **Tooling:** pnpm monorepo.

## Must-pass tests
- Cleaning fixtures, and DOCX refused.
- TS/Rust vectors match.
- Signature failures: wrong key, changed payout, replayed nonce.
- A PoW below the threshold fails.
- Reservation only at triage.
- Recusal enforced.
- `resolve_tip` only from the DAO.
- Switch timing, and only the keeper can post keys.
- Claim: `storage_deposit`, gas drip, and rollback on failure.
- The `noLogs` test.
- `verify-attestation.ts`.

## Out of scope (documented)
- Stylometry.
- Network anonymity (use Tor).
- A recused member can still vote in the DAO.
- The keeper is trusted in the hackathon build (production: TEE).

## Verify
- **E2EE from the browser: settled 2026-11-05** (ARCHITECTURE §14.4).
- The 1Click NEP-141 deposit method (day 2).
- **OutLayer can host the keeper: settled 2026-11-09** (ARCHITECTURE §14.8). Not the daemon — a run is one-shot and capped at 60-180s and there is no scheduler. It can host the release step, with their untrusted external scheduler outside the enclave and `view()`/`call()` inside it.

## Confirmed
- Sputnik DAO v2 factories: testnet `sputnik-v2.testnet`, mainnet `sputnik-dao.near`. Wasm pinned
  with sha256 + on-chain code hash in `contracts/sealedtip/res/SPUTNIK_VERSION.txt` (S-0.7).
