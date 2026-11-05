# Sealed Tip — Roadmap to 100% readiness

> **This file is the live plan and status of the project.**
> **Every contribution (commit, PR or agent task) must update it in the same change.** See §1.

| | |
|---|---|
| **Last updated** | 2026-11-04 |
| **Current phase** | P1 — Scaffolding (toolchain installed, everything builds) |
| **Next task** | S-1.5 (mock-ft NEP-141), S-1.6 (sandbox smoke test), then P2 |
| **Must progress** | 14 / 103 Must tasks done (14%) |
| **Overall progress** | 14 / 109 tasks done (13%) — 103 Must · 5 Should · 1 Could |
| **Submission deadline** | 14 Nov 2026, 23:59 UTC (internal target: **14 Nov 18:00 UTC**) |
| **Days left** | 10 |

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
| S-0.3 | M | Spike: NEAR AI Cloud attestation + response signature verification end to end | Script verifies a real report + signature | — | ⬜ |  |  |
| S-0.4 | M | Spike: is E2EE to the model usable from the browser? | Decision recorded in ARCHITECTURE §14 (proxy stays if no) | S-0.3 | ✅ | 2026-11-05 | Yes, and with no dependency. `spikes/ohttp-browser/` implements HPKE (RFC 9180, DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM), BHTTP (RFC 9292) and OHTTP (RFC 9458) on `crypto.subtle` alone — the same module runs under Node and in a Chromium tab, and both completed a live round trip. Measured: X25519 is its own WebCrypto algorithm (`{name:"X25519"}`, not ECDH plus a namedCurve; public keys import with zero usages) and is available Chrome 133+, Edge, Firefox 130+, Safari 17+; `/.well-known/ohttp-gateway`, `POST /ohttp` and `GET /v1/attestation/report` all serve a browser origin (preflight `access-control-allow-methods: *`, `access-control-allow-headers: content-type`, and `access-control-expose-headers: *` on the key endpoint); the 45-byte published key config is byte-identical to the attested one and its first suite is AES-128-GCM, the only one of its two suites WebCrypto has. A no-key chat came back as HTTP 200 `message/ohttp-res` decrypting to inner status 401 `invalid_auth_header`, so the codec is proven in both directions and the bearer token stays inside the ciphertext. Decision in ARCHITECTURE §14.4: the AI redaction step talks browser → attested TEE directly. The proxy is **not** cut — it still holds our NEAR AI key and rate limits, and it is still the only thing that hides the tipster's IP, because posting straight to `cloud-api.near.ai` makes that host both gateway (it holds the receiver key and reads the plaintext, inside a TEE we verify) and the party that sees the IP. Two checks cannot run in a tab: keccak256 for the signing address and secp256k1 for the response signature are absent from WebCrypto, so attestation verification stays in the offline verifier. Chunked OHTTP (streaming) is unproven in the browser; redaction is one non-streaming call, so it does not gate this. |
| S-0.5 | M | Spike: TS↔Rust borsh + ed25519 vectors round-trip | One vector verifies in both | S-1.4 | 🟡 | 2026-11-05 | Done in substance: `pnpm test:vectors` green — 5 action + 2 submit + 3 key vectors in `fixtures/vectors.json`, re-encoded byte-identical by the Rust derive and accepted by `env::ed25519_verify` (dalek) over @noble signatures; HKDF-SHA256 recomputed in Rust matches too. Generator is deterministic (two runs, same sha256). Row stays 🟡 until issue #4 closes. |
| S-0.6 | M | $1 mainnet check of the 1Click NEP-141 deposit method | Result recorded; **only with explicit OK** | — | ⬜ |  |  |
| S-0.7 | M | Verify Sputnik factory + pin wasm | Recorded; wasm in `res/` | — | ✅ | 2026-11-05 | Factories live: testnet `sputnik-v2.testnet`, mainnet `sputnik-dao.near`. `res/sputnikdao2.wasm` (469,804 B, sha256 0844…dd56) taken from 6 independently owned testnet DAOs, all with code hash `ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq`; matches Admit A-0.4. `source_commit` is asserted from tag 2.0.0, not proven by reproducible build (no release assets upstream) — recorded in `res/SPUTNIK_VERSION.txt`. Issue #6 still open. |
| S-0.8 | M | Verify `cargo-near` build subcommand | Recorded | — | ✅ | 2026-11-04 | cargo-near 0.22.0: `cargo near build non-reproducible-wasm` confirmed; near-cli-rs installed |
| S-0.9 | M | Testnet accounts: deployer, sealedtip, tusdc, 2 relayers, keeper, funder, 3 panel members | In `.env` | — | ⬜ |  |  |
| S-0.10 | S | Check OutLayer as a TEE host for the keeper | Finding recorded | — | ⬜ |  |  |

### P1 — Scaffolding
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-1.1 | M | `git init`, ignores, LICENSE | No AI attribution | S-0.1 | ✅ | 2026-11-04 | git init; private repo Teescom/sealed-tip |
| S-1.2 | M | pnpm workspace + root scripts + config | `pnpm install` works | S-1.1 | ✅ | 2026-11-04 | pnpm 11.17 install OK; allowBuilds = esbuild only; next pinned 16.4.4 (release-age policy) |
| S-1.3 | M | Rust workspace | `cargo check --target wasm32` passes | S-1.1 | ✅ | 2026-11-04 | cargo check --target wasm32 passes |
| S-1.4 | M | `contracts/sealedtip` skeleton | `pnpm build:contract` produces wasm | S-0.8 | ✅ | 2026-11-04 | contract wasm builds with cargo-near |
| S-1.5 | M | `contracts/mock-ft` | Mint + transfer test | S-0.2 | 🟡 |  | stub compiles |
| S-1.6 | M | Sandbox harness | Smoke test | S-1.4, S-1.5, S-0.7 | 🟡 |  | harness + 32 named #[ignore] test skeletons |
| S-1.7 | M | packages (core, crypto, clean), apps (web, api, keeper), scripts skeletons | `pnpm build` + `pnpm -r test` pass | S-1.2 | ✅ | 2026-11-04 | tsc -b, eslint, next build, pnpm -r test all pass (tests are todo placeholders) |
| S-1.8 | M | `.env.example` (source of truth) | Matches code | S-1.2 | ✅ | 2026-11-04 |  |
| S-1.9 | M | CI workflow | Green on first push | S-1.6, S-1.7 | 🟡 |  | ci.yml drafted; manual-only (workflow_dispatch) until lockfile + cargo-near step exist |
| S-1.10 | M | README stub + Contributing (ROADMAP rule) | Present | S-1.1 | ✅ | 2026-11-04 |  |

### P2 — Contract core
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-2.1 | M | `types.rs` per ARCHITECTURE §4 | Compiles; mirrored in TS | S-1.4 | ✅ | 2026-11-04 | SealedKey struct instead of tuples; Base64VecU8 signatures; SwitchInput; TipPublic; ProgrammeStats |
| S-2.2 | M | `errors.rs`, `events.rs` | Event JSON test; no tipster data | S-2.1 | ⬜ |  |  |
| S-2.3 | M | `time.rs` | Unit tests | S-2.1 | ⬜ |  |  |
| S-2.4 | M | `actions.rs`: domain tag + borsh + ed25519 verify | Unit tests + vectors | S-0.5 | 🟡 | 2026-11-05 | `action_message`, `submit_message`, `assert_signature` implemented; 5 unit tests + the vectors suite green, wasm target type-checks. Issues #21 #22 #23 still open. |
| S-2.5 | M | `pow.rs` | Unit tests | S-2.1 | ⬜ |  |  |
| S-2.6 | M | Programmes: create (ops_balance), fund via ft_on_transfer, withdraw_unreserved, close | Integration tests | S-2.1, S-1.6 | ⬜ |  |  |
| S-2.7 | M | `access.rs` guards | Unit tests | S-2.1 | ⬜ |  |  |
| S-2.8 | M | `set_panel` (DAO only) | Test | S-2.6 | ⬜ |  |  |
| S-2.9 | M | Owner: set_relayers, set_keeper (no funds/tips) | Test | S-2.6 | ⬜ |  |  |
| S-2.10 | M | `token.rs` promises + `on_claim_paid` rollback | Failure test | S-2.6 | ⬜ |  |  |
| S-2.11 | M | Views (public view has no CIDs) | Tests | S-2.6 | ⬜ |  |  |
| S-2.12 | M | Unit-test state builders (`src/test_utils.rs`: make_programme, make_tip, signing keypair helpers) | Builders used by at least one unit test | S-2.1 | ⬜ |  |  |

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
| S-5.9 | M | clippy + fmt clean | Green | P2–P3 | ⬜ |  |  |

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
| S-12.1 | M | README: problem + sources, how it protects you, diagram | Reviewed vs PRD §1 | P11 | ⬜ |  |  |
| S-12.2 | M | README: "do X, see Y" quickstart | S-13.2 passes | S-11.9 | ⬜ |  |  |
| S-12.3 | M | README: trust assumptions + threat model (proxy, keeper, stylometry, Tor, cash-out) | Matches ARCHITECTURE §11 | S-12.1 | ⬜ |  |  |
| S-12.4 | M | README: library + AI disclosure; name the other entered project | Present | S-12.1 | ⬜ |  |  |
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
| 2026-11-05 | S-0.4 | E2EE from the browser is real, so B4's condition is met and ARCHITECTURE §14.4 records the decision. `spikes/ohttp-browser/` (new: `ohttp.js` the codec, `index.html` the page, `test.mjs` the Node harness, plus an `--offline` mode that checks every primitive against `node:crypto`) does HPKE base mode with DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM, BHTTP and OHTTP on `crypto.subtle` alone — no dependency added, and the same module runs in a tab and under Node. Three findings worth keeping: X25519 is its own WebCrypto algorithm, `{name:"X25519"}`, and ECDH-with-a-namedCurve throws `Unrecognized namedCurve` (my first version used it and failed in both runtimes); a public X25519 key must be imported with **zero** usages while the private key carries `deriveBits`, and Node refuses to import a raw *private* X25519 key at all, which HPKE senders never need; and of the gateway's two symmetric suites only AES-128-GCM has a WebCrypto binding, so ChaCha20-Poly1305 has to be pinned out. `keccak256` (signing address) and secp256k1 (response signature) stay impossible in WebCrypto, so attestation verification remains in the offline verifier. Proxy is **not** cut: it still holds the NEAR AI key and rate limits, and posting directly to `cloud-api.near.ai` makes that host both gateway — it holds the receiver key and reads the plaintext, in a TEE we verify — and the party that sees the tipster's IP. | live round trip from a Chromium tab (app webview, Chrome 150) ✅ and from `node spikes/ohttp-browser/test.mjs` ✅ — same module, both: 45-byte key config fetched (byte-identical to the attested one), 240-byte inner BHTTP request → 295-byte encapsulated request → `POST /ohttp` → HTTP 200 `message/ohttp-res` → decapsulated to inner status 401 `invalid_auth_header`, i.e. the codec verified in both directions with the bearer token inside the ciphertext (no `NEAR_AI_API_KEY`, so no model answer — that half is still task #5) · CORS measured from origin `http://127.0.0.1:8792`: preflight on `/ohttp` → `access-control-allow-methods: *`, `access-control-allow-headers: content-type`; `/.well-known/ohttp-gateway` and `/v1/attestation/report` → `access-control-allow-origin: <origin>`, `access-control-expose-headers: *` ✅ · support matrix from MDN browser-compat-data: Chrome 133+, Edge (mirror), Firefox 130+, Safari 17+ ✅ · `node spikes/ohttp-browser/test.mjs --offline` exit 0, 6 checks: the X25519 shared secret, HKDF-SHA256 and AES-128-GCM (ct+tag, in both directions) are each cross-verified against `node:crypto`, and BHTTP decodes in both framings — that block caught two wrong vectors of mine (a status written as 0x64, and field lines wrongly length-prefixed in the 0x03 framing), which is the evidence it has teeth ✅ · `eslint .` exit 0 with the new files in scope · `tsc -b --force` exit 0 · `pnpm -r test` exit 0 · `prettier --check spikes/` clean (the new files were written through `--write`); `prettier --check .` already warns on 48 tracked files on this branch and I confirmed each of the four docs I edited already warned on `main`, so nothing widened — prettier is not in the `lint` gate · edits are ARCHITECTURE, ARCHITECTURE_ESSENTIALS, ROADMAP, project_structure and the new `spikes/`; nothing in `packages/`, `apps/`, `contracts/` or any `package.json` was touched, and no dependency was added |
| 2026-11-05 | S-0.5, S-2.4, S-5.8, S-6.3, S-6.4 | Closed the borsh/ed25519 gap: `actions.rs` (`action_message`, `submit_message`, `assert_signature`), `packages/crypto` (`keys.ts`, `actions.ts`, new `borsh.ts` + `ed25519.ts`), `scripts/gen-vectors.ts` and `tests/vectors.rs`. `fixtures/vectors.json` now holds 5 action + 2 submit + 3 key vectors; the Rust derive re-encodes them byte-for-byte and dalek accepts the @noble signatures. `borsh` npm is unused (it cannot encode fieldless enum variants) and noble's `hashes.sha512` is bound in `ed25519.ts` so browser and Node sign identically. No dependency or Cargo.toml change. | `pnpm test:vectors` ✅ (crypto 19 pass / 0 fail / 2 todo, cargo 5 unit + 5 vectors pass) · `cargo test -p sealedtip` ✅ 0 failed (30 scaffold tests still `#[ignore]`) · `cargo check --target wasm32-unknown-unknown` ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `rustfmt --check` clean on both touched Rust files · generator deterministic (two runs, identical sha256) · pre-existing red: `pnpm lint` (clippy on host) and 10 fmt-dirty scaffold files, untouched |
| 2026-11-05 | S-0.7 | Pinned Sputnik DAO v2: `res/sputnikdao2.wasm` + provenance in `res/SPUTNIK_VERSION.txt` (sha256, on-chain code hash, 6-DAO cross-check). Cleared the **VERIFY** tags on the factory accounts in ARCHITECTURE §2, ARCHITECTURE_ESSENTIALS (moved to a new Confirmed section) and `.env.example`. Recorded that upstream publishes no release wasm, so `source_commit` is asserted from tag 2.0.0 rather than proven. | `shasum -a 256` on the installed file = the value computed from chain bytes ✅ · repo lint/test unchanged (docs + asset only) |
| 2026-11-04 | S-2.12 (new) | Created 163 GitHub issues covering every open roadmap task (milestone per phase; labels phase/area/size/wave/maintainer; index in docs/ISSUES.md). Repo interaction limited to collaborators. Header rule changed: contributions update their row + Changelog only; maintainer recomputes the header with tools/roadmap.py. Added S-2.12 (test-state builders) so wave issues stay independent. | n/a (docs and process) |
| 2026-11-04 | S-12.8 | Repo made public at github.com/Teescom/sealed-tip on the user's explicit OK. | n/a |
| 2026-11-04 | S-0.2, S-0.8, S-1.2, S-1.4, S-1.7 | Approved deps added (Vitest, near-contract-standards); installed cargo-near 0.22.0 + near-cli-rs; pnpm install with build-script allow-list; pinned next 16.4.4 to respect pnpm's minimum release age; ignored next-env.d.ts; docs updated (AGENTS toolchain, ARCHITECTURE §2, project_structure). | cargo near build ✅ (2 contracts) · cargo test ✅ 0 failed (scaffold tests ignored) · tsc -b ✅ · eslint ✅ · next build ✅ · pnpm -r test ✅ 0 failed (todo placeholders) |
| 2026-11-04 | S-0.1, S-1.1, S-1.9 | Git initialised; identity recorded in AGENTS.md; CI set to manual-only; first push to private repo Teescom/sealed-tip. | n/a (no code change) |
| 2026-11-04 | S-1.1–S-1.10, S-2.1, S-6.1, S-D.4, S-D.5 | Created ROADMAP.md and project_structure.md; scaffolded the repo (root config, Rust workspace, sealedtip data model + method stubs, mock-ft stub, 32 named integration-test skeletons, @sealedtip/core, crypto, clean packages, api with noLogs + strict-CSP web, keeper, scripts, fixtures). Added packages/core (not in v2 layout) for the zod mirror + view client. Added the ROADMAP rule to all docs. | `cargo check --target wasm32-unknown-unknown` ✅; TS not installed yet |
