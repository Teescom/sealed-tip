# Sealed Tip — Roadmap to 100% readiness

> **This file is the live plan and status of the project.**
> **Every contribution (commit, PR or agent task) must update it in the same change.** See §1.

| | |
|---|---|
| **Last updated** | 2026-11-06 |
| **Current phase** | P2 — Contract core (P1 is done bar issue-closure: both contracts, harness, and `pnpm lint`/`pnpm test` green, now run on every push and PR by CI) |
| **Next task** | S-2.6 programmes + S-2.8 panel + S-2.9 owner ops + S-2.11 views (in progress on `feat/programme-core`) → S-2.10 → P3 |
| **Must progress** | 14 / 103 Must tasks done (14%) |
| **Overall progress** | 14 / 109 tasks done (13%) — 103 Must · 5 Should · 1 Could |
| **Submission deadline** | 14 Nov 2026, 23:59 UTC (internal target: **14 Nov 18:00 UTC**) |
| **Days left** | 8 |

---

## 1. How to update this file (mandatory on every contribution)

Every commit or PR that changes code, tests, config or docs must also update `ROADMAP.md` **in the same change**. A contribution without a roadmap update isn't done.

1. **Tick and date the task.** Set its status (see legend) and add the date in the `Done` column, e.g. `2026-11-05`.
2. **Partial work:** set the status to 🟡 and add a short note in `Notes` saying what's left.
3. **New work discovered:** add a task with the next free ID in the right phase. Never reuse IDs.
4. **Cut or deferred work:** never delete a row. Set ⛔ (cut) or ⏸ (deferred) and give the reason in `Notes`. Cutting a **Must** task needs the user's approval; record it in ARCHITECTURE §14 too.
5. **Blocked:** set 🔴 and name what blocks it.
6. **Don't edit the header in a contribution.** After each merge the maintainer runs `python3 tools/roadmap.py ROADMAP.md` (recomputes Must and overall progress) and updates `Last updated`, `Current phase`, `Next task` and `Days left`. This keeps parallel PRs from conflicting.
7. **Add one line to the Changelog (§6)**, newest first: date, task IDs, what changed, test result.
8. **Never tick a task whose "Done when" isn't fully met.** Never tick a task that has failing or skipped tests.
9. **Work comes from GitHub issues.** Each issue names its phase (milestone), wave and roadmap ID; the index is `docs/ISSUES.md`. Mark a row ✅ only when its last open issue closes, otherwise 🟡.

**Status legend:** ⬜ todo · 🟡 in progress · ✅ done · 🔴 blocked · ⏸ deferred · ⛔ cut
**Priority:** M = Must · S = Should · C = Could (from PRD §6)

## 2. Definition of 100% readiness

Sealed Tip is **100% ready** when all of these are true:

1. Every **Must** task in §4 is ✅, and every Should task is ✅ or ⏸ with a reason.
2. **Every privacy invariant in AGENTS.md has a passing test or check:**
   - noLogs.
   - CSP with no third-party loads.
   - Cleaning fixtures.
   - Reserve-on-triage.
   - Recusal.
   - Switch default bundle.
3. `pnpm lint` and `pnpm test` pass on a **fresh clone**, following only the README. `pnpm verify-attestation` re-verifies a stored bundle.
4. The contracts are on testnet. `pnpm seed`, `pnpm demo` and `pnpm spam` run the PRD §8 story with no manual steps and exit 0.
5. The web app is deployed (Vercel), with the tipster flow working from a phone.
6. The README meets the hackathon checklist and states the trust assumptions plainly:
   - The proxy sees the text sent for AI analysis.
   - The keeper is trusted.
   - Stylometry can still identify someone.
   - Use Tor.
7. An **independent AI-judge dry run** passes (S-12.3).
8. The video and X post are published, the repo is public, and the form is submitted. **Each needs the user's explicit OK.** If two projects are entered, each README names the other.

## 3. Timeline

| Date (Nov) | Phases | Exit criterion |
|---|---|---|
| 4 | P0, P1 | Decisions; day-1 spikes (attestation, E2EE, vectors); skeleton builds |
| 5–6 | P2, P3 | Contract complete: programmes, reserve-on-triage, signed actions, PoW, recusal, claim, switch |
| 7 | P5, P6 (clean) | Integration tests green; cleaning fixtures green; $1 1Click check (with OK) |
| 8 | P6 (crypto), P8 | Crypto package + vectors; blob store + relayer queue + noLogs |
| 9 | P8 (AI) | AI redaction via proxy + attestation panel |
| 10 | P10 | Tipster, panel, claim, programme pages |
| 11 | P9, P11 | Keeper; `pnpm demo` + `pnpm spam` pass |
| 12 | P12, P13 | README; Vercel; fresh-clone + AI-judge dry run |
| 13 | P12 | Video + X post (with OK); buffer |
| 14 | P12 | Submit by 18:00 UTC (with OK) |

**Cut order if behind schedule** (each needs the user's OK):
1. Could tasks.
2. Mainnet 1Click payout (keep testnet `Payout::Near`).
3. Scan mode.
4. The `/programmes/new` UI (the seed script covers it).

## 4. Phases and tasks

### P0 — Decisions & verification (day-1 spikes)
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-0.1 | M | Confirm git identity | Recorded in AGENTS.md | — | ✅ | 2026-11-04 | Teescom <317993064+Teescom@users.noreply.github.com>; GitHub Teescom |
| S-0.2 | M | Approve extra deps: Vitest, `near-contract-standards` | User approves | — | ✅ | 2026-11-04 | Vitest 5.1 + near-contract-standards 5.30 approved and added |
| S-0.3 | M | Spike: NEAR AI Cloud attestation + response signature verification end to end | Script verifies a real report + signature | — | 🟡 | 2026-11-05 | Report half is done and proven against live infra: `GET /v1/attestation/report` on NEAR AI Cloud is public (no API key), and `pnpm verify-attestation -- --fetch <model>` now fetches a fresh report with a locally-generated 32-byte nonce and re-verifies it offline — 56 checks, all ✔, exit 0; a wrong nonce, a redirected signing address and an unpinned root each fail with exactly the expected checks. Two gaps keep this 🟡: (a) hardware root of trust. The in-band dstack chain in `info.app_cert` is now verified (leaf → Dstack App CA → Dstack KMS CA, every signature checked, CA flags, validity window) and the CA-signed leaf provably embeds MRTD + RTMR0-3 and the compose hash — which is how RTMR3 finally gets pinned. But each VM mints its own KMS CA (gateway root ≠ model root), so that chain is only anchored by `--pin-ca <sha256>`, i.e. trust-on-first-use, and the Intel DCAP certificate chain over the quote itself still needs `@phala/dcap-qvl-node` (ask first); (b) the response signature from `GET /v1/signature/<chatId>`, which is EIP-191 `personal_sign` over `algo:requestHash:responseHash` and needs a chat completion (blocked on `NEAR_AI_API_KEY`) plus secp256k1 recovery (`@noble/curves`, ask first). Offset/struct findings are in the Changelog; issue #2 stays open. |
| S-0.4 | M | Spike: is E2EE to the model usable from the browser? | Decision recorded in ARCHITECTURE §14 (proxy stays if no) | S-0.3 | ✅ | 2026-11-05 | Yes, and with no dependency. `spikes/ohttp-browser/` implements HPKE (RFC 9180, DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM), BHTTP (RFC 9292) and OHTTP (RFC 9458) on `crypto.subtle` alone — the same module runs under Node and in a Chromium tab, and both completed a live round trip. Measured: X25519 is its own WebCrypto algorithm (`{name:"X25519"}`, not ECDH plus a namedCurve; public keys import with zero usages) and is available Chrome 133+, Edge, Firefox 130+, Safari 17+; `/.well-known/ohttp-gateway`, `POST /ohttp` and `GET /v1/attestation/report` all serve a browser origin (preflight `access-control-allow-methods: *`, `access-control-allow-headers: content-type`, and `access-control-expose-headers: *` on the key endpoint); the 45-byte published key config is byte-identical to the attested one and its first suite is AES-128-GCM, the only one of its two suites WebCrypto has. A no-key chat came back as HTTP 200 `message/ohttp-res` decrypting to inner status 401 `invalid_auth_header`, so the codec is proven in both directions and the bearer token stays inside the ciphertext. Decision in ARCHITECTURE §14.4: the AI redaction step talks browser → attested TEE directly. The proxy is **not** cut — it still holds our NEAR AI key and rate limits, and it is still the only thing that hides the tipster's IP, because posting straight to `cloud-api.near.ai` makes that host both gateway (it holds the receiver key and reads the plaintext, inside a TEE we verify) and the party that sees the IP. Two checks cannot run in a tab: keccak256 for the signing address and secp256k1 for the response signature are absent from WebCrypto, so attestation verification stays in the offline verifier. Chunked OHTTP (streaming) is unproven in the browser; redaction is one non-streaming call, so it does not gate this. |
| S-0.5 | M | Spike: TS↔Rust borsh + ed25519 vectors round-trip | One vector verifies in both | S-1.4 | 🟡 | 2026-11-05 | Done in substance: `pnpm test:vectors` green — 5 action + 2 submit + 3 key vectors in `fixtures/vectors.json`, re-encoded byte-identical by the Rust derive and accepted by `env::ed25519_verify` (dalek) over @noble signatures; HKDF-SHA256 recomputed in Rust matches too. Generator is deterministic (two runs, same sha256). Row stays 🟡 until issue #4 closes. |
| S-0.6 | M | $1 mainnet check of the 1Click NEP-141 deposit method | Result recorded; **only with explicit OK** | — | ⬜ |  |  |
| S-0.7 | M | Verify Sputnik factory + pin wasm | Recorded; wasm in `res/` | — | ✅ | 2026-11-05 | Factories live: testnet `sputnik-v2.testnet`, mainnet `sputnik-dao.near`. `res/sputnikdao2.wasm` (469,804 B, sha256 0844…dd56) taken from 6 independently owned testnet DAOs, all with code hash `ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq`; matches Admit A-0.4. `source_commit` is asserted from tag 2.0.0, not proven by reproducible build (no release assets upstream) — recorded in `res/SPUTNIK_VERSION.txt`. Issue #6 still open. |
| S-0.8 | M | Verify `cargo-near` build subcommand | Recorded | — | ✅ | 2026-11-04 | cargo-near 0.22.0: `cargo near build non-reproducible-wasm` confirmed; near-cli-rs installed |
| S-0.9 | M | Testnet accounts: deployer, sealedtip, tusdc, 2 relayers, keeper, funder, 3 panel members | In `.env` | — | 🟡 | 2026-11-05 | All 10 accounts exist on testnet under a fresh faucet root `st-hack-f8d075.testnet` and are in `.env` (0600, gitignored — never committed). Balances verified on chain: root 1.436 · sealedtip 2 · tusdc/keeper/funder/rel1/rel2 1 each · panel1-3 0.5 each. Relayers and keeper sign with **function-call keys scoped to `sealedtip.*`** (`submit_tip,checkin,retract,claim` / `heartbeat,post_released_keys,trigger`, unlimited allowance) and those keys replace `<account>.json` in the legacy keychain, so a script that falls back to the keychain can't pick up a full-access key; the FA keys remain in `~/.near-credentials/testnet/<account>/` for admin use. Row stays 🟡 until issue #7 closes. `PANEL_DAO` is still empty — the DAO itself is S-7.2. Faucet gives 10 NEAR per root, so the whole deployment fits in one root only if wasm storage deposits stay under ~1.4 NEAR; if not, create a second faucet root and transfer in. Two toolchain findings: near-cli-rs 0.30.1 needs the trailing choice spelled out to run without a TTY (`… network-config testnet create`, and for `fund-myself`/`add-key` `… sign-with-legacy-keychain send`; `add-key` also needs `--allowance`), and testnet RPC no longer serves `view_account` — only `query` with `request_type` (near-api-js 7 is unaffected). |
| S-0.10 | S | Check OutLayer as a TEE host for the keeper | Finding recorded | — | ⬜ |  |  |

### P1 — Scaffolding
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-1.1 | M | `git init`, ignores, LICENSE | No AI attribution | S-0.1 | ✅ | 2026-11-04 | git init; private repo Teescom/sealed-tip |
| S-1.2 | M | pnpm workspace + root scripts + config | `pnpm install` works | S-1.1 | ✅ | 2026-11-04 | pnpm 11.17 install OK; allowBuilds = esbuild only; next pinned 16.4.4 (release-age policy) |
| S-1.3 | M | Rust workspace | `cargo check --target wasm32` passes | S-1.1 | ✅ | 2026-11-04 | cargo check --target wasm32 passes |
| S-1.4 | M | `contracts/sealedtip` skeleton | `pnpm build:contract` produces wasm | S-0.8 | ✅ | 2026-11-04 | contract wasm builds with cargo-near |
| S-1.5 | M | `contracts/mock-ft` | Mint + transfer test | S-0.2 | 🟡 |  | #8 open: NEP-141/145/148 on near-contract-standards + open mint; 18 unit tests (mint, transfer, events, storage bounds, 8 rejection paths) |
| S-1.6 | M | Sandbox harness | Smoke test | S-1.4, S-1.5, S-0.7 | 🟡 |  | #11 open: harness live (sandbox boot, both contracts deployed+init, mint/register/transfer/views, `advance` time travel); smoke ✅ 8.6 s; 32 named #[ignore] skeletons still to write; `panel_dao` is a plain account — the pinned `sputnikdao2.wasm` is on `main` (#164, merged) and the harness doesn't deploy it yet |
| S-1.7 | M | packages (core, crypto, clean), apps (web, api, keeper), scripts skeletons | `pnpm build` + `pnpm -r test` pass | S-1.2 | ✅ | 2026-11-04 | tsc -b, eslint, next build, pnpm -r test all pass (tests are todo placeholders) |
| S-1.8 | M | `.env.example` (source of truth) | Matches code | S-1.2 | ✅ | 2026-11-04 |  |
| S-1.9 | M | CI workflow | Green on first push | S-1.6, S-1.7, S-5.9 | 🟡 | 2026-11-06 | Live on push to main and on every PR, plus workflow_dispatch. Three PR runs, all green. Run 1 cold: job wall clock 5m5s, lint 1m37s, test 2m47s. Run 2 also a cargo-cache MISS because the key hashes ci.yml and both edits touched it: 4m6s, lint 1m17s, test 2m3s. Run 3 was a docs-only commit that left ci.yml alone and hit the cache — "Cache restored from key: cargo-Linux-39bc58b7..." — job 1m30s: cache restore 30s, lint 9s, test 30s, with both contract builds finishing in 7s and 3s. So a warm rebuild is 1m30s against 5m5s cold, roughly 3.4x, and the cache key excluding the commit SHA is what buys it. (ubuntu-latest, Node 22, pnpm 11, cargo-near 0.22.0 fetched by tag and sha256-verified, sandbox node downloaded by the near-sandbox crate.) Was blocked on S-5.9, merged as #171. Stays 🟡 for issue #10 (rule 9). Run 2 deleted the ~/.near sandbox cache step because near-sandbox 0.4.0 unpacks into OUT_DIR under target/, never ~/.near, so that step could only ever miss. |
| S-1.10 | M | README stub + Contributing (ROADMAP rule) | Present | S-1.1 | ✅ | 2026-11-04 |  |

### P2 — Contract core
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-2.1 | M | `types.rs` per ARCHITECTURE §4 | Compiles; mirrored in TS | S-1.4 | ✅ | 2026-11-04 | SealedKey struct instead of tuples; Base64VecU8 signatures; SwitchInput; TipPublic; ProgrammeStats |
| S-2.2 | M | `errors.rs`, `events.rs` | Event JSON test; no tipster data | S-2.1 | 🟡 | 2026-11-05 | events.rs implemented with near-sdk's native `#[near(event_json)]` derive (real `EVENT_JSON:` NEP-297 lines), plus the `tip_dismissed` variant §10 lists but the stub omitted; 6 unit tests pin the 15 documented names, the per-event field allow-list, U128-as-string amounts and one log line per change. errors.rs gained E25_INVALID_TIME_SCALE. Row stays 🟡 until #19 closes. |
| S-2.3 | M | `time.rs` | Unit tests | S-2.1 | 🟡 | 2026-11-05 | `scaled` (integer division, rounds down, E25 on scale 0) + `deadline` (checked_add, never wraps); 7 unit tests incl. day→minute at 1440. Row stays 🟡 until #20 closes. |
| S-2.4 | M | `actions.rs`: domain tag + borsh + ed25519 verify | Unit tests + vectors | S-0.5 | 🟡 | 2026-11-05 | `action_message`, `submit_message`, `assert_signature` implemented; 5 unit tests + the vectors suite green, wasm target type-checks. Issues #21 #22 #23 still open. |
| S-2.5 | M | `pow.rs` | Unit tests | S-2.1 | 🟡 | 2026-11-05 | `leading_zero_bits` + `check` over `sha256(evidence_hash ‖ u64le(nonce))`; 6 unit tests, pinned wherever the layout matters to hashes computed outside the contract (node crypto) so a layout change fails loudly — the 32×0x11/nonce-9 vector has 2 zero bits little-endian and 7 big-endian, so `the_nonce_is_u64_little_endian` catches an endianness flip. Boundary mutation (`>=`→`>`) was caught. Row stays 🟡 until #24 and #32 close. |
| S-2.6 | M | Programmes: create (ops_balance), fund via ft_on_transfer, withdraw_unreserved, close | Integration tests | S-2.1, S-1.6 | ⬜ |  |  |
| S-2.7 | M | `access.rs` guards | Unit tests | S-2.1 | 🟡 | 2026-11-05 | The three stub guards implemented, plus `assert_relayer` / `assert_keeper` / `assert_owner` (AGENTS: one helper per role; E04/E07/E08 had no helper). 14 unit tests, one per role per direction, incl. recused-member rejection and "recusal bars triage, not the rest of the panel". Dropping the recusal check failed exactly the intended test. Row stays 🟡 until #25, #26, #27 close. |
| S-2.8 | M | `set_panel` (DAO only) | Test | S-2.6 | ⬜ |  |  |
| S-2.9 | M | Owner: set_relayers, set_keeper (no funds/tips) | Test | S-2.6 | ⬜ |  |  |
| S-2.10 | M | `token.rs` promises + `on_claim_paid` rollback | Failure test | S-2.6 | ⬜ |  |  |
| S-2.11 | M | Views (public view has no CIDs) | Tests | S-2.6 | ⬜ |  |  |
| S-2.12 | M | Unit-test state builders (`src/test_utils.rs`: make_programme, make_tip, signing keypair helpers) | Builders used by at least one unit test | S-2.1 | 🟡 | 2026-11-05 | `src/test_utils.rs` added (`#[cfg(test)]`, so no wasm cost): fictional `.testnet` accounts, `make_programme`, `make_tip`, `make_contract`, `as_caller(account)` for the predecessor, and byte constants for the panel/keeper/claim keys. Used by all 14 access tests, 4 of the 6 event tests and the 7 time tests (`HOUR_NS`). Signing keypair helpers are the remaining piece — the contract only ever *verifies*, and the (message, signature, pubkey) triples come from `fixtures/vectors.json`, which is still empty on `main` (#164). Row stays 🟡 until #18 closes. |

### P3 — Tips, claims, switch
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-3.1 | M | `submit_tip` (relayer, PoW, signature, ≥2 sealed keys, none to recused; reserves nothing) | Tests | S-2.4, S-2.5 | ⬜ |  |  |
| S-3.2 | M | `triage` (non-recused member; reserve or Unfunded; dismiss) | Tests | S-3.1 | ⬜ |  |  |
| S-3.3 | M | `resolve_tip` (DAO; reward ≤ max; release unused) | Tests | S-3.2 | ⬜ |  |  |
| S-3.4 | M | `retract` (signed; before decision) | Tests | S-3.1 | ⬜ |  |  |
| S-3.5 | M | `claim` (signed payout; storage_deposit + gas drip; rollback) | Tests | S-3.3, S-2.10 | ⬜ |  |  |
| S-3.6 | M | `checkin` (signed) | Tests | S-3.1 | ⬜ |  |  |
| S-3.7 | M | `trigger` (after deadline + grace) | Tests | S-3.6 | ⬜ |  |  |
| S-3.8 | M | `post_released_keys` + `heartbeat` (keeper only; non-recused only) | Tests | S-3.7 | ⬜ |  |  |
| S-3.9 | M | Unfunded tips reserved automatically when the programme is funded | Test | S-3.2 | ⬜ |  |  |

### P4 — Testnet
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-4.1 | M | Deploy contracts (S-7.1 script) + panel DAO | Explorer links | P5 | ⬜ |  |  |

### P5 — Integration test suite
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-5.1 | M | `tests/reservations.rs` | Green | S-3.2, S-3.3 | ⬜ |  |  |
| S-5.2 | M | `tests/submission.rs` | Green | S-3.1 | ⬜ |  |  |
| S-5.3 | M | `tests/signed_actions.rs` | Green | S-3.4–S-3.6 | ⬜ |  |  |
| S-5.4 | M | `tests/triage_and_resolve.rs` | Green | S-3.2, S-3.3 | ⬜ |  |  |
| S-5.5 | M | `tests/claims.rs` | Green | S-3.5 | ⬜ |  |  |
| S-5.6 | M | `tests/switch.rs` | Green | S-3.6–S-3.8 | ⬜ |  |  |
| S-5.7 | M | `tests/access_control.rs` | Green | S-2.9 | ⬜ |  |  |
| S-5.8 | M | `tests/vectors.rs` against fixtures/vectors.json | Green | S-6.4 | 🟡 | 2026-11-05 | 5 tests green (bytes, signatures, tamper/replay/wrong-contract negatives, submit, HKDF). Fixture read with `near_sdk::serde` + the already-present `serde_json` dev-dep, so no new dependency. Issues #79 #80 still open. |
| S-5.9 | M | clippy + fmt clean | Green | P2–P3 | 🟡 | 2026-11-06 | `pnpm lint` exit 0 for the first time. Done: `cargo fmt --all` applied — 15 hunks across **8** files in `contracts/sealedtip/src/` (the "12 files" counted on 2026-11-05 was wrong: it double-counted the `Diff in` header lines; recounted from a clean checkout of `main`, the distinct file list is 8), the `types.rs:8` doc-continuation indent, the two dead `pub(crate) ft_transfer`/`storage_deposit` stubs in `token.rs` **deleted** rather than `#[allow]`-ed (nothing can call them until `claim` exists — S-2.10/S-3.5 — and silencing it would hide a real ordering fact), and the gate itself: `lint` now runs `cargo clippy --workspace --all-targets -- -D warnings`, because the old form can never pass (near-sdk 5.30 refuses a host build of a contract crate and errors before reaching our code; `--all-targets` unifies the `unit-testing` dev-feature so it compiles on the host). Stays 🟡 per rule 9 — issue #81 is open and closing issues is the maintainer's call. What is left: nothing in the gate; the row can go ✅ when #81 closes. NOTE: this column must contain no pipe characters — `tools/roadmap.py` matches task rows with a notes field that excludes them, so one pipe silently drops the row from the progress tally (it read 102 Must instead of 103 until this note was rewritten). |

### P6 — Shared packages
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-6.1 | M | `@sealedtip/core` types (zod) | Parses real views | S-4.1 | 🟡 |  | schemas written; not validated against chain |
| S-6.2 | M | `@sealedtip/core` view client | Used by web + keeper | S-6.1 | ⬜ |  |  |
| S-6.3 | M | crypto/keys: 24 words ↔ secret, HKDF keys, passphrase | Unit tests | S-1.7 | 🟡 | 2026-11-05 | `newSecret`, `secretToWords`, `wordsToSecret`, `deriveKeys` implemented; 10 tests green incl. absent==empty passphrase, label separation, tampered-checksum refusal. noble HKDF cross-checked against Node/OpenSSL. Issues #88 #89 #90 #91 still open. |
| S-6.4 | M | crypto/actions: borsh + domain tag + sign; `gen-vectors` | Vectors match Rust | S-0.5 | 🟡 | 2026-11-05 | Hand-rolled `BorshWriter` (the `borsh` npm package can't encode fieldless enum variants); 9 tests green against the fixture. `pnpm gen-vectors` is deterministic. Issues #92 #93 #94 #105 still open. |
| S-6.5 | M | crypto/seal: XChaCha bundles, sealed boxes, cid | Round-trip tests | S-1.7 | ⬜ |  |  |
| S-6.6 | M | crypto/pow: solve + check (matches Rust) | Tests | S-2.5 | ⬜ |  |  |
| S-6.7 | M | clean/gate: magic-byte sniff, refuse non PDF/JPEG/PNG | DOCX fixture refused | S-6.12 | ⬜ |  |  |
| S-6.8 | M | clean/pdf: rasterise + rebuild | No Author/Producer/XMP/incremental revisions in output | S-6.12 | ⬜ |  |  |
| S-6.9 | M | clean/image: re-encode | No EXIF GPS in output | S-6.12 | ⬜ |  |  |
| S-6.10 | S | clean/scan: grayscale + threshold | Dots fixture visibly suppressed | S-6.12 | ⬜ |  |  |
| S-6.11 | M | clean/report: what was removed | Snapshot test | S-6.8, S-6.9 | ⬜ |  |  |
| S-6.12 | M | Fictional fixtures (invoice with metadata + revision, GPS photo, dotted scan, docx) | Files committed | — | ⬜ |  |  |
| S-6.13 | S | `sign-statement` script (identity reveal later) | Verifiable signature | S-6.4 | ⬜ |  |  |

### P7 — Scripts & seed
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-7.1 | M | `deploy-testnet.ts` | Idempotent | S-0.9 | ⬜ |  |  |
| S-7.2 | M | `seed.ts` (funder, programme, DAO, 3 panel members with X25519 keys) | `pnpm seed` exits 0 | S-7.1 | ⬜ |  |  |

### P8 — API
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-8.1 | M | `noLogs` middleware on every route | no-logs test passes | S-1.7 | ⬜ |  |  |
| S-8.2 | M | `env.ts` | Fails fast | S-1.7 | ⬜ |  |  |
| S-8.3 | M | Blob store (ciphertext only, 25 MB cap) | Tests | S-8.1 | ⬜ |  |  |
| S-8.4 | M | Relayer queue: random delay, 2 relayers, limits keyed by claim pubkey | Submit + checkin + claim via queue on testnet | S-8.1, S-4.1 | ⬜ |  |  |
| S-8.5 | M | AI redaction proxy (stateless) + attestation bundle + `verify-attestation` script | Bundle re-verifies offline | S-0.3 | ⬜ |  |  |
| S-8.6 | C | 1Click quote proxy | Real dry-run quote | S-0.6 | ⬜ |  |  |

### P9 — Keeper
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-9.1 | M | Heartbeat | `keeper_last_seen` updates | S-3.8 | ⬜ |  |  |
| S-9.2 | M | Watch `switch_triggered` | Detects within 1 min | S-3.7 | ⬜ |  |  |
| S-9.3 | M | Release: re-seal K_switch to non-recused members, post keys | Test: recused never receives | S-6.5 | ⬜ |  |  |

### P10 — Web app
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-10.1 | M | Strict CSP + no third-party loads verified | Browser devtools shows only self + RPC + API | S-1.7 | ⬜ |  |  |
| S-10.2 | M | Landing + Tor guidance | Renders | S-10.1 | ⬜ |  |  |
| S-10.3 | M | `/p/[id]` programme page (stats, keeper status, tip ages) | Matches chain | S-6.2 | ⬜ |  |  |
| S-10.4 | M | `/submit/[programme]`: clean → report → optional AI → recusal → switch → 24 words → PoW → relay | Fictional tip submitted from a phone | P6, S-8.4, S-8.5 | ⬜ |  |  |
| S-10.5 | M | `/status`: re-enter words, status, check-in | Works | S-10.4 | ⬜ |  |  |
| S-10.6 | M | `/claim`: fresh payout account, signed claim (+ mainnet quote display) | Paid on testnet | S-3.5 | ⬜ |  |  |
| S-10.7 | M | `/panel`: triage, local decryption, DAO proposal | Works | S-6.5 | ⬜ |  |  |
| S-10.8 | S | `/programmes/new` funder setup | Works | S-6.2 | ⬜ |  |  |
| S-10.9 | M | Accessibility + mobile pass | Checklist in Notes | S-10.2–S-10.7 | ⬜ |  |  |
| S-10.10 | S | Web tests (Vitest) | Green | S-0.2 | ⬜ |  |  |

### P11 — Demo (PRD §8 = acceptance test)
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-11.1 | M | Step 1: programme created + funded | Asserted | S-7.2 | ⬜ |  |  |
| S-11.2 | M | Step 2: fictional uploads | Asserted | S-6.12 | ⬜ |  |  |
| S-11.3 | M | Step 3: cleaning report, AI redaction, attestation, recusal | Asserted | S-10.4 | ⬜ |  |  |
| S-11.4 | M | Step 4: relay with delay; `pnpm spam` reserves nothing | Asserted | S-8.4 | ⬜ |  |  |
| S-11.5 | M | Step 5: triage reserves 1,000; funder withdraw fails; recused has no key | Asserted | S-3.2 | ⬜ |  |  |
| S-11.6 | M | Step 6: DAO accept, reward 800 | Asserted | S-3.3 | ⬜ |  |  |
| S-11.7 | M | Step 7: claim to fresh account; mainnet quote shown | Asserted | S-3.5 | ⬜ |  |  |
| S-11.8 | M | Step 8: switch trigger → keeper releases cleaned bundle key | Asserted | P9 | ⬜ |  |  |
| S-11.9 | M | `pnpm demo` exits non-zero on unexpected state; < 6 min | Two clean runs | S-11.1–S-11.8 | ⬜ |  |  |

### P12 — Documentation, deployment, submission
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-12.1 | M | README: problem + sources, how it protects you, diagram | Reviewed vs PRD §1 | P11 | 🟡 | 2026-11-05 | Written: the PRD §1 figures with their attributions, a SecureDrop / government tip line / crypto tip-line comparison, a threat→control table and an ASCII lifecycle diagram. Not ✅ until a human reads it against PRD §1 wording, and its "Done when" names P11, which is not built. |
| S-12.2 | M | README: "do X, see Y" quickstart | S-13.2 passes | S-11.9 | 🟡 | 2026-11-05 | Quickstart lists the four commands that work today (`pnpm install / build:contract / test / lint`) with what each actually does. The demo-run "see Y" half waits on S-11.9 — the current text would go stale if it promised a tip-to-payout run. |
| S-12.3 | M | README: trust assumptions + threat model (proxy, keeper, stylometry, Tor, cash-out) | Matches ARCHITECTURE §11 | S-12.1 | 🟡 | 2026-11-05 | Limitations section states each §11 residual plainly (24 words without the passphrase, proxy reads the text, stylometry, timing, tracking dots not guaranteed, keeper trust, recused member still votes, testnet + mock token, unaudited). Needs a pass against §11's exact wording for ✅. |
| S-12.4 | M | README: library + AI disclosure; name the other entered project | Present | S-12.1 | 🟡 | 2026-11-05 | Library list and AI-usage disclosure are in. "Name the other entered project" is the one line I can't write — that's the maintainer's. |
| S-12.5 | M | Deploy web to Vercel | Works on a phone | P10 | ⬜ |  | Ask before deploying |
| S-12.6 | M | Demo video (≤ 2 min) | Ready for review | S-11.9 | ⬜ |  |  |
| S-12.7 | M | X post draft | **Posted only with explicit OK** | S-12.6 | ⬜ |  |  |
| S-12.8 | M | Make repo public | **Only with explicit OK** | S-13.4 | ✅ | 2026-11-04 | made public on user's explicit OK (2026-11-04); secrets scan clean |
| S-12.9 | M | Submit hackathon form | **Only with explicit OK** | S-12.7, S-12.8 | ⬜ |  |  |

### P13 — Final QA
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-13.1 | M | `pnpm lint && pnpm test` green; no skipped tests | Output in Changelog | All M | ⬜ |  |  |
| S-13.2 | M | Fresh-clone test using only the README | Works | S-12.2 | ⬜ |  |  |
| S-13.3 | M | AI-judge dry run | No failed claims | S-13.2 | ⬜ |  |  |
| S-13.4 | M | Secrets + privacy audit (git history, logs, CSP, fixtures fictional) | Clean | S-13.1 | ⬜ |  |  |
| S-13.5 | M | Docs consistency check | Checklist in Notes | S-13.1 | ⬜ |  |  |
| S-13.6 | M | Commit history check (no AI attribution) | Clean | S-13.1 | ⬜ |  |  |

## 5. Already done (pre-code)
| ID | Task | Done |
|---|---|---|
| S-D.1 | PRD.md | 2026-11-03 |
| S-D.2 | ARCHITECTURE.md v2 + ESSENTIALS v2 | 2026-11-04 |
| S-D.3 | AGENTS.md + CLAUDE.md | 2026-11-04 |
| S-D.4 | project_structure.md | 2026-11-04 |
| S-D.5 | ROADMAP.md | 2026-11-04 |

(Pre-code docs are not counted in the progress totals.)

## 6. Changelog (newest first)
| Date | Tasks | Change | Tests |
|---|---|---|---|
| 2026-11-06 | S-1.9, `.github/workflows/ci.yml`, ROADMAP header | Turned the drafted `ci.yml` on: `on: push` to `main` + `pull_request` + `workflow_dispatch`, 45-minute timeout. Two commits. (1) The toolchain is pinned by measurement, not taste — pnpm 11 before `setup-node` (its pnpm cache needs the binary to find the store), Node 22, `rust-toolchain` stable with the wasm32 target plus rustfmt/clippy, and cargo-near 0.22.0 downloaded by release tag and verified against sha256 `9429064e…47d1a` before it goes on PATH, because the artifact comes from a GitHub release asset rather than a signed registry. v0.23.0 shipped the day this was written and was deliberately not adopted: a hackathon repo should not change its build tool mid-stretch. The job runs exactly the two commands AGENTS.md tells a contributor to run locally (`pnpm lint`, `pnpm test`), so a green check is proof the README quickstart works on a clean Linux checkout — the one environment no one on this team has. (2) Removed the `~/.near` near-sandbox cache step. It was written on the assumption that `near-sandbox` 0.4.0 installs into `~/.near`; reading the crate shows it unpacks to `OUT_DIR/.near/near-sandbox-2.14.0/`, i.e. under `target/`, which the cargo cache already covers, so the step could only ever report a miss and save nothing. Left the `NEAR_SANDBOX_VERSION` env comment out of the file with it. Not loosened: no step was made `continue-on-error`, nothing was moved off the PR path, and `--all-targets` stays because the plain clippy form is unsatisfiable (see the S-5.9 row). | First run (cold, #172 commit 1) job wall clock **5m5s** — lint 1m37s, test 2m47s. Second run (after removing the dead cache step) **4m6s** — lint 1m17s, test 2m3s. Third run, a docs-only commit that did not edit `ci.yml`, **1m30s** — cache restore 30s, lint 9s, test 30s; `Cache restored from key: cargo-Linux-39bc58b7…` in the job log, and the two contract rebuilds finished in 7s and 3s. All three `success`, all on `ubuntu-latest`, timings read from the Actions jobs API per step and the cache line from the downloaded run logs, not from the run summary. The first two were cache **misses** (the key hashes `ci.yml` and both commits edited it), which is why the warm number needed a third, workflow-untouched run before anyone claimed it. Cache archive for `target` at 4.6 GB local scale sits inside GitHub's 10 GB repo cache, and the key excludes the commit SHA so a rebuild cannot evict its own cache every push. |
| 2026-11-06 | S-5.9, README `pnpm lint` + `pnpm test` rows, AGENTS.md commands table | Made `pnpm lint` pass, and fixed the gate rather than the code the gate was wrong about. Four changes: (1) `cargo fmt --all` — 15 hunks across 8 files in `contracts/sealedtip/src/`, no logic touched; (2) `types.rs:8` — the PRIVACY line was a doc comment at column 0 directly under a `-` bullet, which clippy reads as a malformed list, so it is now indented under the bullet; (3) `token.rs` — deleted the two dead `pub(crate)` promise builders instead of `#[allow(dead_code)]`-ing them: they were unreachable until `claim` exists (S-2.10/S-3.5), a suppression would have hidden a real ordering fact, and the module doc now says why they were removed; (4) `package.json` — `lint` runs `cargo clippy --workspace --all-targets -- -D warnings`. The old command could never go green: near-sdk 5.30 deliberately fails a host build of a contract crate, so `cargo clippy --workspace -- -D warnings` exits on 2 guard errors inside the dependency before reaching our code. `--all-targets` pulls the `unit-testing` dev-feature, which makes near-sdk host-compilable, and only then does clippy report *our* 2 errors — which is exactly what it did. This is the S-1.9 prerequisite: a CI that runs `pnpm lint` on a red-by-construction gate would only teach everyone to ignore CI. Two numbers in the README were also wrong and are corrected against measurements: fmt wanted 8 files, not 12 (the old count included the duplicated `Diff in` headers), and the workspace has 30 `#[ignore]` integration tests, not 32. AGENTS.md's commands table now lists the real `pnpm lint` composition and why `--all-targets` is required — an agent following the old row would run the unsatisfiable form and conclude the repo is broken. One trap found while writing this row: `tools/roadmap.py` matches task rows with a notes field that cannot contain a pipe character, so a single pipe in `Notes` silently drops that row from the progress tally (the header read 102 Must until the note was reworded); the counter now agrees with the file again. | `cargo fmt --all --check` ✅ clean · `cargo clippy --workspace --all-targets -- -D warnings` ✅ clean · **`pnpm lint` ✅ exit 0 — the first time this has passed on `main` or any branch** · `pnpm test` ✅ exit 0: 62 Rust (18 mock-ft unit + 38 sealedtip unit + 5 vectors + 1 smoke at 8.73 s) + 43 TS crypto, 0 failed, 30 `#[ignore]` skeletons (recounted: `grep -rn '#\[ignore' contracts/*/tests \| wc -l` = 30, matching the per-target `ignored` sums in the run), 9 TS todo scaffolds · mutation check on the gate itself: re-running the old `cargo clippy --workspace -- -D warnings` on this branch still stops inside `near-sdk` on its "Use `cargo near build` instead of `cargo build` to compile your contract" guard, then `could not compile near-sdk` — it never reaches our code, so the `--all-targets` flag is load-bearing, not cosmetic · the sweep is formatting-only outside the two intentional fixes: read every hunk — 6 files are rustfmt line-wrapping (a `git diff -w` check is not enough here, because rustfmt also breaks long argument lists across lines, which `-w` does not ignore), `types.rs` adds the doc indent, `token.rs` deletes the stubs; the 62 Rust + 43 TS tests passing unchanged is the behavioural check |
| 2026-11-05 | S-12.1, S-12.2, S-12.3, S-12.4, S-5.9 (note), header | First real `README.md` replaces the "To be written (A-13.x)" placeholders: the problem with the PRD §1 figures and where each comes from (46% retaliation — ECI 2023; ~⅓ feared for their safety — EY 2024; 49% — NAVEX; ~$1.8B in SEC awards; the Starknet RFP's "unsolved problem"), a comparison against SecureDrop / government tip lines / crypto tip lines, a threat→control table **with a State column that says which protection is built and which is only designed**, an ASCII lifecycle diagram, a "do X, see Y" table for the commands that work today, a repository map, a Limitations section that states the ARCHITECTURE §11 residuals instead of hiding them, and the library + AI disclosure. Every command in it was run first, which produced three corrections: `scripts/{seed,spam,demo,deploy-testnet,sign-statement}` throw `not implemented` so the README says so, `fixtures/attestation.json` is gitignored so the quickstart uses `--fetch`, and `cargo clippy --workspace -- -D warnings` can never pass because near-sdk 5.30 refuses a host build of a contract crate — `--all-targets` is the form that reaches our code, recorded on S-5.9. Also fixed a stale comment in `tests/common/mod.rs` (it claimed `sputnikdao2.wasm` wasn't on `main`; #164 merged it) and the same claim in the S-1.6 row. Header refreshed for P2; four P12 rows set 🟡. No behaviour change: two doc comments and docs only. | commands measured, not assumed: `pnpm build:contract` ✅ 191.7 KB + 151.2 KB · `cargo test -p sealedtip vectors` ✅ 4 passed · `pnpm test:vectors` ✅ (TS + Rust agree on the fixture) · `npx tsx scripts/gen-vectors.ts` re-run leaves `fixtures/vectors.json` byte-identical (sha256 `607da58b…`, `git status` clean) ✅ · `pnpm verify-attestation -- --fetch deepseek-ai/DeepSeek-V4.1-Flash-1017` ✅ live, and the stored bundle re-verifies at 54 ✔ / exit 0 — while a wrong nonce fails 7 checks, which is the proof the nonce binding has teeth · `cargo fmt --all --check` → 15 hunks / 12 files, `cargo clippy --workspace` → 2 near-sdk host-guard errors, `--all-targets` → exactly our 2 errors, `eslint .` ✅ 0, `tsc -b` ✅ 0 · `pnpm test` ✅ exit 0: 62 Rust (18 mock-ft + 38 sealedtip + 5 vectors + 1 smoke at 8.49 s) + 43 TS crypto tests, 0 failures, with 32 `#[ignore]` integration skeletons and 9 TS TODO scaffolds counted in the README rather than hidden · `python3 tools/roadmap.py ROADMAP.md` ✅ unchanged at `Must 14/103 · overall 14/109` — 🟡 doesn't count, so this docs change moves no progress number |
| 2026-11-05 | S-1.6 | `tests/common/mod.rs` replaced the stub with a working sandbox harness: each test boots its own `near-sandbox` node, creates 11 named subaccounts under `test.near` (owner, 2 relayers, keeper, funder, panel DAO, 3 members, plus the two contracts), deploys the built wasm of both, initialises sealedtip with owner/relayers/keeper + keeper X25519 key, and exposes `mint` / `register` (at the NEP-145 minimum) / `transfer` (1 yoctoNEAR) / balance + supply views / NEAR balance / `advance(ns)` time travel / a fixed ed25519 tipster key so signatures stay reproducible. `tests/smoke.rs` gates it. `panel_dao` is still a plain account: the pinned `sputnikdao2.wasm` is on `main` (#164 merged) but the harness doesn't deploy it yet. | `cargo test -p sealedtip --test smoke` ✅ 1 passed in 8.6 s (was 237 s while it jumped a full hour of chain time — a sandbox block costs 9–16 ms wall, so 1 h = 14 400 blocks = 2–4 min; measured boot 0.58 s warm, `Env::setup()` 6.0 s, view 2.9 ms) · run against #168 applied: `cargo test --workspace` ✅ 19 passed, 32 skeletons still `#[ignore]` · `pnpm test` ✅ exit 0 (191.7 KB + 151.2 KB wasm) · mutation check: 6 harness edits (no-op `advance`, `transfer` without 1 yoctoNEAR, zero storage deposit, mock-ft pointed at the sealedtip wasm, `mint` ignoring `UNIT`, re-init against a non-existent method) each fail the smoke test; the first pass proved the sandbox mints its own blocks every 250 ms, so the time assertion now demands 120 blocks, not 1 s · `rustfmt --check` clean on both files · `cargo clippy -p sealedtip --all-targets` reports nothing from the harness (its two `-D warnings` errors are pre-existing in `src/token.rs:10`, `src/types.rs:8`) · on `main` alone the smoke test fails at `mint` (`not yet implemented: A-1.5`) — merge #168 first |
| 2026-11-05 | S-1.5 | `contracts/mock-ft` implemented for real: NEP-141 core + resolver, NEP-145 storage management, NEP-148 metadata, and an open testnet-only `mint` that registers the receiver if it is missing (a faucet can't assume a prior `storage_deposit`). Delegates to `near-contract-standards` `FungibleToken`; metadata kept inline instead of `LazyOption`. Added the `unit-testing` near-sdk dev-dependency. | `cargo test -p mock-ft` ✅ 18 passed (mint + transfer, supply, both event logs, storage bounds, 8 rejection paths) · mutation-checked mint guard, auto-register and mint event · clippy `-D warnings` ✅ · `cargo near build` ✅ 151.2 KB wasm, ABI exposes 14 methods · `cargo test --workspace` ✅ 0 failed |
| 2026-11-05 | S-2.2, S-2.3, S-2.5, S-2.7, S-2.12 | First P2 contract implementation on `main`, test-first. `events.rs` moved to near-sdk's native NEP-297 derive so the log line is the real `EVENT_JSON:` format indexers parse, and gained the `tip_dismissed` variant that ARCHITECTURE §10 lists but the stub enum omitted; `time.rs` got `scaled` plus a `deadline` helper so no caller does raw duration math; `pow.rs` verifies the leading-zero-bit gate; `access.rs` now has one guard per role (funder, panel DAO, non-recused member, relayer, keeper, owner) where the stub had three; `errors.rs` gained E25_INVALID_TIME_SCALE; `src/test_utils.rs` added as the shared fictional state builders (`#[cfg(test)]`, so nothing extra lands in the wasm). `actions.rs` deliberately untouched — it is PR #164's. No dependency added. Five rows set 🟡, not ✅, because rule 9 ties the tick to their GitHub issues (#18, #19, #20, #24, #25, #26, #27, #32) and closing those needs the maintainer. | `cargo test -p sealedtip --lib` ✅ 33 passed, 0 failed (28 of them ran red against `todo!()` first) · `cargo check -p sealedtip --target wasm32-unknown-unknown --release` ✅ · clippy on the wasm target: only the two pre-existing warnings (`types.rs` doc continuation, `token.rs` dead code) · rustfmt clean on the five files written here; repo-wide fmt is S-5.9 · two mutations proved the tests bite: deleting the recusal check failed `member_guard_rejects_a_recused_member`, and `>=`→`>` in `pow::check` failed two PoW tests · PoW vectors cross-checked against `node:crypto`, not against the contract's own hash |
| 2026-11-05 | S-0.4 | E2EE from the browser is real, so B4's condition is met and ARCHITECTURE §14.4 records the decision. `spikes/ohttp-browser/` (new: `ohttp.js` the codec, `index.html` the page, `test.mjs` the Node harness, plus an `--offline` mode that checks every primitive against `node:crypto`) does HPKE base mode with DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM, BHTTP and OHTTP on `crypto.subtle` alone — no dependency added, and the same module runs in a tab and under Node. Three findings worth keeping: X25519 is its own WebCrypto algorithm, `{name:"X25519"}`, and ECDH-with-a-namedCurve throws `Unrecognized namedCurve` (my first version used it and failed in both runtimes); a public X25519 key must be imported with **zero** usages while the private key carries `deriveBits`, and Node refuses to import a raw *private* X25519 key at all, which HPKE senders never need; and of the gateway's two symmetric suites only AES-128-GCM has a WebCrypto binding, so ChaCha20-Poly1305 has to be pinned out. `keccak256` (signing address) and secp256k1 (response signature) stay impossible in WebCrypto, so attestation verification remains in the offline verifier. Proxy is **not** cut: it still holds the NEAR AI key and rate limits, and posting directly to `cloud-api.near.ai` makes that host both gateway — it holds the receiver key and reads the plaintext, in a TEE we verify — and the party that sees the tipster's IP. | live round trip from a Chromium tab (app webview, Chrome 150) ✅ and from `node spikes/ohttp-browser/test.mjs` ✅ — same module, both: 45-byte key config fetched (byte-identical to the attested one), 240-byte inner BHTTP request → 295-byte encapsulated request → `POST /ohttp` → HTTP 200 `message/ohttp-res` → decapsulated to inner status 401 `invalid_auth_header`, i.e. the codec verified in both directions with the bearer token inside the ciphertext (no `NEAR_AI_API_KEY`, so no model answer — that half is still task #5) · CORS measured from origin `http://127.0.0.1:8792`: preflight on `/ohttp` → `access-control-allow-methods: *`, `access-control-allow-headers: content-type`; `/.well-known/ohttp-gateway` and `/v1/attestation/report` → `access-control-allow-origin: <origin>`, `access-control-expose-headers: *` ✅ · support matrix from MDN browser-compat-data: Chrome 133+, Edge (mirror), Firefox 130+, Safari 17+ ✅ · `node spikes/ohttp-browser/test.mjs --offline` exit 0, 6 checks: the X25519 shared secret, HKDF-SHA256 and AES-128-GCM (ct+tag, in both directions) are each cross-verified against `node:crypto`, and BHTTP decodes in both framings — that block caught two wrong vectors of mine (a status written as 0x64, and field lines wrongly length-prefixed in the 0x03 framing), which is the evidence it has teeth ✅ · `eslint .` exit 0 with the new files in scope · `tsc -b --force` exit 0 · `pnpm -r test` exit 0 · `prettier --check spikes/` clean (the new files were written through `--write`); `prettier --check .` already warns on 48 tracked files on this branch and I confirmed each of the four docs I edited already warned on `main`, so nothing widened — prettier is not in the `lint` gate · edits are ARCHITECTURE, ARCHITECTURE_ESSENTIALS, ROADMAP, project_structure and the new `spikes/`; nothing in `packages/`, `apps/`, `contracts/` or any `package.json` was touched, and no dependency was added |
| 2026-11-05 | S-0.3 | The rest of the report half, still with no new dependency. `packages/crypto/src/attestation.ts` gained the in-band bindings (`compose_hash` is sha256 over `app_compose`, the manifest's `public_logs` + image digests, the OHTTP ed25519 wrapper, the NVIDIA evidence nonce, the compose manager's action-log quote) and `scripts/lib/app-cert.ts` (new, deliberately Node-only so the crypto package stays browser-safe) verifies the dstack X.509 chain; `scripts/verify-attestation.ts` runs both and accepts `--pin-ca`. Measured from a live report: `info.app_cert` is 3 PEM blocks (`demo-cert ← Dstack App CA ← Dstack KMS CA`, self-signed root) and the CA-signed leaf embeds MRTD@559, the compose hash@608 and RTMR0-3@751/799/847/895 — the cert, not the event log, is what pins RTMR3. Roots differ per party (gateway ≠ model), so pinning is trust-on-first-use per deployment, not a vendor constant. The model's `ohttp_attestation` is a real ed25519 signature over 45 bytes of `key_config` by the published 32-byte key (the gateway carries none; some reports put it at the top level), `nvidia_payload.nonce === request_nonce` with 8 GPU records, and the compose manager's quote has `report_data = actions_hash ‖ our nonce`, the same MRTD/RTMR0-2 as its model and a different RTMR3. One check of mine was wrong and is corrected: live deployments run with `public_sysinfo: true` — that is what serves this report — so only `public_logs` is a leak. RTMR1 is identical across gateway and model (same base-OS measurement), which is why a swapped quote still matches one register. A malformed stated field now fails a check rather than throwing, for the stated-measurement block too. | live report: 56 checks, all ✔, exit 0 ✅ · `--pin-ca <both roots>` exit 0; one wrong root fails exactly the 2 pinning checks, exit 1 ✅ · tamper probes: gateway leaf re-chained under the model CA fails `app_cert_chain_signs_through`; the other party's quote fails `app_cert_binds_the_quote` (mrtd/rtmr0/2/3 → -1); a 1-block chain and a non-PEM both fail `app_cert_parses`; a hash the leaf never signed fails `app_cert_binds_the_compose_hash` ✅ · `packages/crypto` 28 tests, 24 pass / 0 fail / 4 todo (the 8 new tests use real `@noble/ed25519` keys and real sha256 manifest hashes) ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `pnpm -r test` ✅ · `fixtures/attestation.json` (the CLI's live snapshot) is now gitignored instead of committed ✅ · pre-existing red, unchanged and not widened: host `cargo clippy` (exit 101, near-sdk needs `cargo near build`), `cargo fmt --all --check` dirty on 12 scaffold files, and `prettier --check` — which no gate runs — already warns on 7 tracked files outside this change |
| 2026-11-05 | S-0.3 | Offline attestation verifier for NEAR AI Cloud: `packages/crypto/src/attestation.ts` (new, exported from the package index) plus `scripts/verify-attestation.ts`, rewritten from the S-8.5 stub into a working CLI with `--fetch`. Discovery: `GET /v1/attestation/report?model=&nonce=&signing_algo=ecdsa` is public on `cloud-api.near.ai` (needs only the `x-no-aliasing: true` header), so the report half of this spike was never actually blocked on an API key. Empirically measured from real TDX quotes rather than taken from the spec: quote is 5006 bytes, version 4 / type 2 (ECDSA-p256), MRTD at offset 184, RTMR0-3 at 376/424/472/520 as 48-byte SHA-384 registers, `report_data` at 568 laid out as signing_address (20) + 12 zero bytes + request_nonce (32), and the address is `keccak256(bare X‖Y)[12:32]` — the leading `0x06` belongs to X, it is not a SEC1 tag. RTMR replay is `sha384(RTMR ‖ digest)` over the gateway `event_log`, which arrives double-encoded as a JSON string and carries digest-less IMR 3 entries, so those are skipped, never zero-extended; RTMR3 itself is not reproducible from the log and must be pinned by an app/os allow-list. Every malformed input becomes a failed check instead of a crash. No dependency added. | `packages/crypto` 20 tests, 16 pass / 0 fail / 4 todo — the 16 passing are the new attestation tests, on fictional bundles ✅ · live report for a real model: 30 checks, all ✔, exit 0 ✅ · wrong nonce and redirected signing address each fail with exactly the expected checks, exit 1 ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `pnpm -r test` ✅ · `cargo test -p sealedtip` ✅ exit 0, 0 failed (32 scaffold tests remain `#[ignore]`, pre-existing) · the fetched live report was deleted, not committed (infra snapshot, not a fixture) · pre-existing red, unchanged by this branch and not widened: `pnpm lint` fails on host clippy (exit 101 — near-sdk demands `cargo near build`) and `cargo fmt --all --check` is dirty on 12 scaffold files, none of them touched here |
| 2026-11-05 | S-0.9 | Created and funded the testnet account set under a fresh faucet root `st-hack-f8d075.testnet` (root + sealedtip, tusdc, rel1, rel2, keeper, funder, panel1-3) and filled `.env` from `.env.example` (mode 600, gitignored). Relayer and keeper secrets in `.env` are function-call keys restricted to `sealedtip.st-hack-f8d075.testnet` and the ARCHITECTURE §5 method names; each service account's `<account>.json` now holds that scoped key so a keychain fallback can't silently sign with full access. Docs and local env only — no repo code, dependency or Cargo change. | On-chain balance + access-key-list lookup for all 10 accounts ✅ · `.env` secrets derive to the exact on-chain public keys with the expected `FunctionCall` permission ✅ · repo tests unaffected (`pnpm -r test` exit 0 on this branch) · not yet provable: the method-name restriction itself, which needs the wasm deployed (S-7.1) |
| 2026-11-05 | S-0.5, S-2.4, S-5.8, S-6.3, S-6.4 | Closed the borsh/ed25519 gap: `actions.rs` (`action_message`, `submit_message`, `assert_signature`), `packages/crypto` (`keys.ts`, `actions.ts`, new `borsh.ts` + `ed25519.ts`), `scripts/gen-vectors.ts` and `tests/vectors.rs`. `fixtures/vectors.json` now holds 5 action + 2 submit + 3 key vectors; the Rust derive re-encodes them byte-for-byte and dalek accepts the @noble signatures. `borsh` npm is unused (it cannot encode fieldless enum variants) and noble's `hashes.sha512` is bound in `ed25519.ts` so browser and Node sign identically. No dependency or Cargo.toml change. | `pnpm test:vectors` ✅ (crypto 19 pass / 0 fail / 2 todo, cargo 5 unit + 5 vectors pass) · `cargo test -p sealedtip` ✅ 0 failed (30 scaffold tests still `#[ignore]`) · `cargo check --target wasm32-unknown-unknown` ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `rustfmt --check` clean on both touched Rust files · generator deterministic (two runs, identical sha256) · pre-existing red: `pnpm lint` (clippy on host) and 10 fmt-dirty scaffold files, untouched |
| 2026-11-05 | S-0.7 | Pinned Sputnik DAO v2: `res/sputnikdao2.wasm` + provenance in `res/SPUTNIK_VERSION.txt` (sha256, on-chain code hash, 6-DAO cross-check). Cleared the **VERIFY** tags on the factory accounts in ARCHITECTURE §2, ARCHITECTURE_ESSENTIALS (moved to a new Confirmed section) and `.env.example`. Recorded that upstream publishes no release wasm, so `source_commit` is asserted from tag 2.0.0 rather than proven. | `shasum -a 256` on the installed file = the value computed from chain bytes ✅ · repo lint/test unchanged (docs + asset only) |
| 2026-11-04 | S-2.12 (new) | Created 163 GitHub issues covering every open roadmap task (milestone per phase; labels phase/area/size/wave/maintainer; index in docs/ISSUES.md). Repo interaction limited to collaborators. Header rule changed: contributions update their row + Changelog only; maintainer recomputes the header with tools/roadmap.py. Added S-2.12 (test-state builders) so wave issues stay independent. | n/a (docs and process) |
| 2026-11-04 | S-12.8 | Repo made public at github.com/Teescom/sealed-tip on the user's explicit OK. | n/a |
| 2026-11-04 | S-0.2, S-0.8, S-1.2, S-1.4, S-1.7 | Approved deps added (Vitest, near-contract-standards); installed cargo-near 0.22.0 + near-cli-rs; pnpm install with build-script allow-list; pinned next 16.4.4 to respect pnpm's minimum release age; ignored next-env.d.ts; docs updated (AGENTS toolchain, ARCHITECTURE §2, project_structure). | cargo near build ✅ (2 contracts) · cargo test ✅ 0 failed (scaffold tests ignored) · tsc -b ✅ · eslint ✅ · next build ✅ · pnpm -r test ✅ 0 failed (todo placeholders) |
| 2026-11-04 | S-0.1, S-1.1, S-1.9 | Git initialised; identity recorded in AGENTS.md; CI set to manual-only; first push to private repo Teescom/sealed-tip. | n/a (no code change) |
| 2026-11-04 | S-1.1–S-1.10, S-2.1, S-6.1, S-D.4, S-D.5 | Created ROADMAP.md and project_structure.md; scaffolded the repo (root config, Rust workspace, sealedtip data model + method stubs, mock-ft stub, 32 named integration-test skeletons, @sealedtip/core, crypto, clean packages, api with noLogs + strict-CSP web, keeper, scripts, fixtures). Added packages/core (not in v2 layout) for the zod mirror + view client. Added the ROADMAP rule to all docs. | `cargo check --target wasm32-unknown-unknown` ✅; TS not installed yet |
