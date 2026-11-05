# Sealed Tip — Roadmap to 100% readiness

> **This file is the live plan and status of the project.**
> **Every contribution (commit, PR or agent task) must update it in the same change.** See §1.

| | |
|---|---|
| **Last updated** | 2026-11-04 |
| **Current phase** | P1 — Scaffolding (toolchain installed, everything builds) |
| **Next task** | S-1.5 (mock-ft NEP-141), S-1.6 (sandbox smoke test), then P2 |
| **Must progress** | 12 / 103 Must tasks done (12%) |
| **Overall progress** | 12 / 109 tasks done (11%) — 103 Must · 5 Should · 1 Could |
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
| S-0.3 | M | Spike: NEAR AI Cloud attestation + response signature verification end to end | Script verifies a real report + signature | — | 🟡 | 2026-11-05 | Report half is done and proven against live infra: `GET /v1/attestation/report` on NEAR AI Cloud is public (no API key), and `pnpm verify-attestation -- --fetch <model>` now fetches a fresh report with a locally-generated 32-byte nonce and re-verifies it offline — 56 checks, all ✔, exit 0; a wrong nonce, a redirected signing address and an unpinned root each fail with exactly the expected checks. Two gaps keep this 🟡: (a) hardware root of trust. The in-band dstack chain in `info.app_cert` is now verified (leaf → Dstack App CA → Dstack KMS CA, every signature checked, CA flags, validity window) and the CA-signed leaf provably embeds MRTD + RTMR0-3 and the compose hash — which is how RTMR3 finally gets pinned. But each VM mints its own KMS CA (gateway root ≠ model root), so that chain is only anchored by `--pin-ca <sha256>`, i.e. trust-on-first-use, and the Intel DCAP certificate chain over the quote itself still needs `@phala/dcap-qvl-node` (ask first); (b) the response signature from `GET /v1/signature/<chatId>`, which is EIP-191 `personal_sign` over `algo:requestHash:responseHash` and needs a chat completion (blocked on `NEAR_AI_API_KEY`) plus secp256k1 recovery (`@noble/curves`, ask first). Offset/struct findings are in the Changelog; issue #2 stays open. |
| S-0.4 | M | Spike: is E2EE to the model usable from the browser? | Decision recorded in ARCHITECTURE §14 (proxy stays if no) | S-0.3 | ⬜ |  |  |
| S-0.5 | M | Spike: TS↔Rust borsh + ed25519 vectors round-trip | One vector verifies in both | S-1.4 | ⬜ |  |  |
| S-0.6 | M | $1 mainnet check of the 1Click NEP-141 deposit method | Result recorded; **only with explicit OK** | — | ⬜ |  |  |
| S-0.7 | M | Verify Sputnik factory + pin wasm | Recorded; wasm in `res/` | — | ⬜ |  |  |
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
| S-2.4 | M | `actions.rs`: domain tag + borsh + ed25519 verify | Unit tests + vectors | S-0.5 | ⬜ |  |  |
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
| S-5.8 | M | `tests/vectors.rs` against fixtures/vectors.json | Green | S-6.4 | ⬜ |  |  |
| S-5.9 | M | clippy + fmt clean | Green | P2–P3 | ⬜ |  |  |

### P6 — Shared packages
| ID | Pri | Task | Done when | Depends | Status | Done | Notes |
|---|---|---|---|---|---|---|---|
| S-6.1 | M | `@sealedtip/core` types (zod) | Parses real views | S-4.1 | 🟡 |  | schemas written; not validated against chain |
| S-6.2 | M | `@sealedtip/core` view client | Used by web + keeper | S-6.1 | ⬜ |  |  |
| S-6.3 | M | crypto/keys: 24 words ↔ secret, HKDF keys, passphrase | Unit tests | S-1.7 | ⬜ |  |  |
| S-6.4 | M | crypto/actions: borsh + domain tag + sign; `gen-vectors` | Vectors match Rust | S-0.5 | ⬜ |  |  |
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
| 2026-11-05 | S-0.3 | The rest of the report half, still with no new dependency. `packages/crypto/src/attestation.ts` gained the in-band bindings (`compose_hash` is sha256 over `app_compose`, the manifest's `public_logs` + image digests, the OHTTP ed25519 wrapper, the NVIDIA evidence nonce, the compose manager's action-log quote) and `scripts/lib/app-cert.ts` (new, deliberately Node-only so the crypto package stays browser-safe) verifies the dstack X.509 chain; `scripts/verify-attestation.ts` runs both and accepts `--pin-ca`. Measured from a live report: `info.app_cert` is 3 PEM blocks (`demo-cert ← Dstack App CA ← Dstack KMS CA`, self-signed root) and the CA-signed leaf embeds MRTD@559, the compose hash@608 and RTMR0-3@751/799/847/895 — the cert, not the event log, is what pins RTMR3. Roots differ per party (gateway ≠ model), so pinning is trust-on-first-use per deployment, not a vendor constant. The model's `ohttp_attestation` is a real ed25519 signature over 45 bytes of `key_config` by the published 32-byte key (the gateway carries none; some reports put it at the top level), `nvidia_payload.nonce === request_nonce` with 8 GPU records, and the compose manager's quote has `report_data = actions_hash ‖ our nonce`, the same MRTD/RTMR0-2 as its model and a different RTMR3. One check of mine was wrong and is corrected: live deployments run with `public_sysinfo: true` — that is what serves this report — so only `public_logs` is a leak. RTMR1 is identical across gateway and model (same base-OS measurement), which is why a swapped quote still matches one register. A malformed stated field now fails a check rather than throwing, for the stated-measurement block too. | live report: 56 checks, all ✔, exit 0 ✅ · `--pin-ca <both roots>` exit 0; one wrong root fails exactly the 2 pinning checks, exit 1 ✅ · tamper probes: gateway leaf re-chained under the model CA fails `app_cert_chain_signs_through`; the other party's quote fails `app_cert_binds_the_quote` (mrtd/rtmr0/2/3 → -1); a 1-block chain and a non-PEM both fail `app_cert_parses`; a hash the leaf never signed fails `app_cert_binds_the_compose_hash` ✅ · `packages/crypto` 28 tests, 24 pass / 0 fail / 4 todo (the 8 new tests use real `@noble/ed25519` keys and real sha256 manifest hashes) ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `pnpm -r test` ✅ · `fixtures/attestation.json` (the CLI's live snapshot) is now gitignored instead of committed ✅ · pre-existing red, unchanged and not widened: host `cargo clippy` (exit 101, near-sdk needs `cargo near build`), `cargo fmt --all --check` dirty on 12 scaffold files, and `prettier --check` — which no gate runs — already warns on 7 tracked files outside this change |
| 2026-11-05 | S-0.3 | Offline attestation verifier for NEAR AI Cloud: `packages/crypto/src/attestation.ts` (new, exported from the package index) plus `scripts/verify-attestation.ts`, rewritten from the S-8.5 stub into a working CLI with `--fetch`. Discovery: `GET /v1/attestation/report?model=&nonce=&signing_algo=ecdsa` is public on `cloud-api.near.ai` (needs only the `x-no-aliasing: true` header), so the report half of this spike was never actually blocked on an API key. Empirically measured from real TDX quotes rather than taken from the spec: quote is 5006 bytes, version 4 / type 2 (ECDSA-p256), MRTD at offset 184, RTMR0-3 at 376/424/472/520 as 48-byte SHA-384 registers, `report_data` at 568 laid out as signing_address (20) + 12 zero bytes + request_nonce (32), and the address is `keccak256(bare X‖Y)[12:32]` — the leading `0x06` belongs to X, it is not a SEC1 tag. RTMR replay is `sha384(RTMR ‖ digest)` over the gateway `event_log`, which arrives double-encoded as a JSON string and carries digest-less IMR 3 entries, so those are skipped, never zero-extended; RTMR3 itself is not reproducible from the log and must be pinned by an app/os allow-list. Every malformed input becomes a failed check instead of a crash. No dependency added. | `packages/crypto` 20 tests, 16 pass / 0 fail / 4 todo — the 16 passing are the new attestation tests, on fictional bundles ✅ · live report for a real model: 30 checks, all ✔, exit 0 ✅ · wrong nonce and redirected signing address each fail with exactly the expected checks, exit 1 ✅ · `tsc -b --force` ✅ · `eslint .` ✅ · `pnpm -r test` ✅ · `cargo test -p sealedtip` ✅ exit 0, 0 failed (32 scaffold tests remain `#[ignore]`, pre-existing) · the fetched live report was deleted, not committed (infra snapshot, not a fixture) · pre-existing red, unchanged by this branch and not widened: `pnpm lint` fails on host clippy (exit 101 — near-sdk demands `cargo near build`) and `cargo fmt --all --check` is dirty on 12 scaffold files, none of them touched here |
| 2026-11-05 | S-0.9 | Created and funded the testnet account set under a fresh faucet root `st-hack-f8d075.testnet` (root + sealedtip, tusdc, rel1, rel2, keeper, funder, panel1-3) and filled `.env` from `.env.example` (mode 600, gitignored). Relayer and keeper secrets in `.env` are function-call keys restricted to `sealedtip.st-hack-f8d075.testnet` and the ARCHITECTURE §5 method names; each service account's `<account>.json` now holds that scoped key so a keychain fallback can't silently sign with full access. Docs and local env only — no repo code, dependency or Cargo change. | On-chain balance + access-key-list lookup for all 10 accounts ✅ · `.env` secrets derive to the exact on-chain public keys with the expected `FunctionCall` permission ✅ · repo tests unaffected (`pnpm -r test` exit 0 on this branch) · not yet provable: the method-name restriction itself, which needs the wasm deployed (S-7.1) |
| 2026-11-04 | S-2.12 (new) | Created 163 GitHub issues covering every open roadmap task (milestone per phase; labels phase/area/size/wave/maintainer; index in docs/ISSUES.md). Repo interaction limited to collaborators. Header rule changed: contributions update their row + Changelog only; maintainer recomputes the header with tools/roadmap.py. Added S-2.12 (test-state builders) so wave issues stay independent. | n/a (docs and process) |
| 2026-11-04 | S-12.8 | Repo made public at github.com/Teescom/sealed-tip on the user's explicit OK. | n/a |
| 2026-11-04 | S-0.2, S-0.8, S-1.2, S-1.4, S-1.7 | Approved deps added (Vitest, near-contract-standards); installed cargo-near 0.22.0 + near-cli-rs; pnpm install with build-script allow-list; pinned next 16.4.4 to respect pnpm's minimum release age; ignored next-env.d.ts; docs updated (AGENTS toolchain, ARCHITECTURE §2, project_structure). | cargo near build ✅ (2 contracts) · cargo test ✅ 0 failed (scaffold tests ignored) · tsc -b ✅ · eslint ✅ · next build ✅ · pnpm -r test ✅ 0 failed (todo placeholders) |
| 2026-11-04 | S-0.1, S-1.1, S-1.9 | Git initialised; identity recorded in AGENTS.md; CI set to manual-only; first push to private repo Teescom/sealed-tip. | n/a (no code change) |
| 2026-11-04 | S-1.1–S-1.10, S-2.1, S-6.1, S-D.4, S-D.5 | Created ROADMAP.md and project_structure.md; scaffolded the repo (root config, Rust workspace, sealedtip data model + method stubs, mock-ft stub, 32 named integration-test skeletons, @sealedtip/core, crypto, clean packages, api with noLogs + strict-CSP web, keeper, scripts, fixtures). Added packages/core (not in v2 layout) for the zod mirror + view client. Added the ROADMAP rule to all docs. | `cargo check --target wasm32-unknown-unknown` ✅; TS not installed yet |
