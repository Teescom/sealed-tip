# Sealed Tip

**Pay whistleblowers without ever learning who they are — rewards locked in advance, evidence cleaned in the browser and in a verifiable enclave, payout to any chain, and a dead man's switch.**

> NEAR Hackathon 2026 · track **Privacy & Private AI** · deadline 14 Nov 2026, 23:59 UTC.
> Live plan and progress: [`ROADMAP.md`](ROADMAP.md) · decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md) §14 · product spec: [`PRD.md`](PRD.md).

**Status: mid-build, 14 / 103 Must tasks done.** Working and tested today: the tipster key model (24
words ↔ secret ↔ HKDF-derived ed25519/X25519 keys), the borsh + ed25519 action wire format — verified to
be byte-identical in Rust and TypeScript from one shared fixture — the contract's access guards, PoW
check, time scaling and NEP-297 events, the offline attestation verifier, the `tUSDC` test token, and a
`near-sandbox` harness that boots a chain and drives both contracts. Not built yet: the tip lifecycle in
the contract (`submit_tip` → `triage` → `resolve_tip` → `claim`, plus programmes and views), browser-side
cleaning, sealing, the API, the keeper, the web UI and the demo script. The last column of the table
below gives each protection its real state; [`ROADMAP.md`](ROADMAP.md) tracks every piece by task ID.

## The problem

Whistleblowers expose corruption and are punished for it — and often never get paid. The figures in
[`PRD.md`](PRD.md) §1 (sourced there to the Nigerian whistleblower policy review, ECI 2023, EY 2024
across 53 countries, NAVEX, the SEC's own award totals and the Starknet RFP): 46% of employees who
reported misconduct faced retaliation; about a third feared for their personal safety; 49% of
Europeans call fear of retaliation the biggest barrier to reporting; Nigeria's 2.5–5% of recovered
funds is a policy, not a law, so it protects nothing and critics call delayed or unpaid rewards
"rampant"; and the programmes that do pay (the SEC has reported ~$1.8B since 2012) require the
whistleblower to identify themselves first. Paying a reward *without* exposing identity is described
as an unsolved problem.

Today's options each break in a different place:

| | Anonymous | Paid | Identity hidden from the operator |
|---|---|---|---|
| SecureDrop | yes | no | yes |
| Government programmes | no | yes | no |
| Older crypto tip lines | no | yes | no — every tip is public |

A tipster has to hand over the thing that identifies them — the document, the screenshot, the pattern
of their writing — to a party that then decides whether to pay them. If that party disappears, the
evidence stays sealed and nobody gets paid.

## How Sealed Tip protects you

The right-hand column is the honest state of this repository as of 2026-11-05: what runs today, and what
is designed but not built yet. Task IDs point into [`ROADMAP.md`](ROADMAP.md).

| Threat | What the code does | State |
|---|---|---|
| "Who is the tipster?" | **No account.** The tipster holds 32 random bytes shown as 24 words. Every action is a borsh struct signed with an ed25519 key derived via HKDF from those bytes; a relayer submits it. The contract verifies the signature and never sees an identity. | words ↔ secret, HKDF, borsh + ed25519 encoding and `env::ed25519_verify` all implemented and cross-tested against each other; `submit_tip` itself is P3 |
| Metadata in the evidence | Cleaning runs **in the browser** before anything is uploaded: PDFs are rasterised and rebuilt, images are re-encoded, EXIF/GPS, XMP, `Author`/`Producer` and incremental revisions are gone, and an optional scan mode suppresses printer tracking dots. DOCX and other types are refused. The tipster gets a report of exactly what was removed. | **not built yet** (`packages/clean` is five stubs, S-6.7–S-6.11). The design is fixed and the refusal rule is documented; the code is the next big block |
| "The AI read my text" | The optional AI redaction step can go **browser → attested NEAR AI Cloud TEE** directly over OHTTP with no server of ours in the path — proven in `spikes/ohttp-browser/`. The proxy stays for the API key, rate limiting and IP hiding, and the UI says plainly who can read the text. | the OHTTP/HPKE/BHTTP path is proven live from a Chromium tab with no library and no dependency; the proxy route and its UI copy are P8 |
| Is that really the enclave? | `pnpm verify-attestation` re-verifies an attestation report offline: the TDX quote parses and its `report_data` binds *our* nonce and the signing address, RTMR0-2 replay from the event log, the dstack X.509 app-cert chain is walked and pins the compose hash, and the OHTTP key config carries a valid ed25519 signature. What it cannot do alone is named in its own output: the Intel collateral chain over the quote, NVIDIA's GPU attestation, and the response signature (needs an API key). | works today (54 checks on a live report) except the response signature |
| The outlet disappears | A **dead man's switch**: `checkin` keeps it armed; missing `deadline + grace` lets anyone `trigger` it, and the keeper releases the *cleaned* switch bundle key to non-recused panel members (raw files only on explicit opt-in). | `time.rs` (scaled deadlines) and the guard helpers exist; `checkin`/`trigger`/`post_released_keys` are P3, keeper is P9 |
| A panel member is compromised | The tipster **recuses** members; recused members get no sealed key and are barred from triage. Every tip needs ≥2 sealed keys. | recusal guards implemented and unit-tested; sealing to a per-member key set needs `seal` (S-6.5) |
| Nobody pays | The programme's reward is **locked on-chain before tips arrive** and reserved only when a panel member marks a tip credible — so a dismissal never strands funds, and a funder cannot withdraw money that is already backing a live tip. | `mock-ft` is a real NEP-141 token and the sandbox harness moves money; programme accounting is S-2.6, `triage` is S-3.2 |
| Payout to a bank/burner wallet | `Payout::Near{fresh implicit}` on testnet; on mainnet a 1Click Intents quote pays USDC on NEAR to any chain, and the destination is inside the signed `Claim`, so a relayer cannot redirect it. | the signed `Claim` encoding exists; `claim`, its callbacks and the mainnet quote check are S-3.5 / S-0.6 |

```
tipster (24 words, no account)
   └─ clean in browser ─→ optional AI redaction (OHTTP → attested TEE)
        └─ XChaCha20-Poly1305 bundle, K sealed to non-recused panel members
             └─ relayer queue (random delay, 2 relayers, PoW checked on-chain)
                  └─ sealedtip contract ── reserve on triage ── DAO resolves
                       ├─ claim → ft_transfer + storage_deposit + gas drip
                       └─ keeper heartbeat / dead man's switch → post_released_keys
```

## Quickstart — do X, see Y

Everything here runs locally against build artifacts and a disposable sandbox chain; nothing needs
testnet credentials. The demo flow (`pnpm seed`, `pnpm demo`, `pnpm spam`) is still being wired — see
[`ROADMAP.md`](ROADMAP.md) P7/P11.

```bash
pnpm install
pnpm build:contract      # -> target/near/sealedtip/sealedtip.wasm, target/near/mock_ft/mock_ft.wasm
pnpm test                # Rust unit tests + sandbox integration smoke test + TS suites
pnpm lint                # fmt, clippy, eslint, tsc
```

Expected today:

| Do X | See Y |
|---|---|
| `pnpm build:contract` | two wasm files, ~192 KB and ~151 KB, reported by `cargo-near` |
| `pnpm test` | 62 Rust tests + 43 TypeScript tests pass: 18 `mock-ft` unit, 38 `sealedtip` unit, 5 wire-format parity, 1 sandbox smoke test (~9 s, boots a `near-sandbox` node, deploys both contracts and drives them over RPC — `contracts/sealedtip/tests/smoke.rs`), and 43 `packages/crypto` tests for the key model and action encoding. Also in the run, and reported rather than hidden: **30 Rust integration tests marked `#[ignore]`** (the named skeletons for flows not written yet, P3/P5) and **9 TypeScript tests marked TODO** (the `core`/`clean`/`api`/`keeper` scaffolds). Nothing fails. |
| `pnpm lint` | exit 0 — `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `eslint .` and `tsc -b` are all clean (S-5.9, 2026-11-06). The clippy step needs `--all-targets`: `near-sdk` 5.30 deliberately refuses a host build of a contract crate, so `cargo clippy --workspace -- -D warnings` errors inside the dependency before reaching our code and can never pass. `--all-targets` unifies the `unit-testing` dev-feature, which makes `near-sdk` host-compilable, so clippy actually lints the contracts and the tests. |
| `pnpm gen-vectors` then `pnpm test:vectors` | `fixtures/vectors.json` regenerated byte-for-byte, and the Rust tests confirm the TS and Rust borsh + ed25519 encodings agree |
| `pnpm verify-attestation -- --fetch <model>` | a live report fetched from `cloud-api.near.ai`, then every DCAP quote, X.509 app-cert chain, compose hash and OHTTP key-config signature checked — 54+ ✔ lines, exit 0, with the model's answer never requested. Add `--pin-ca <fingerprint>` to anchor the chain. |

Toolchain: Rust stable with `wasm32-unknown-unknown` and `cargo-near`, Node ≥ 22, pnpm ≥ 9 (verified
on Node 26 / pnpm 11.17).

Both gates also run in CI on every push to `main` and every pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) — measured 1m30s per job with a warm cargo
cache and 5m5s from cold on `ubuntu-latest` with Node 22, pnpm 11 and cargo-near 0.22.0 fetched by
release tag and verified against its sha256 before use. Editing `ci.yml` itself costs the next run
its cache, since the cache key hashes the workflow. A green check is proof the commands above pass
on a clean Linux checkout, which is not the machine anyone here builds on.

## Repository map

| Path | What it is |
|---|---|
| `contracts/sealedtip/` | The escrow + tip lifecycle contract (Rust, `near-sdk` 5.30). `tests/common/mod.rs` is the sandbox harness. |
| `contracts/mock-ft/` | `tUSDC` — NEP-141/145/148 test token with an open `mint` (testnet only, never mainnet). |
| `packages/crypto/` | 24 words ↔ secret, HKDF key derivation, borsh action encoding, ed25519 signing and attestation verification are implemented and tested; the XChaCha sealing (`seal`) and PoW solver are stubs (S-6.5, S-6.6). |
| `packages/core/` | zod mirror of the contract types (written; not yet validated against a real on-chain view, S-6.1) plus the view client interface — its implementation is S-6.2 and currently throws. |
| `packages/clean/` | In-browser evidence cleaning (PDF, image, scan) + cleaning report: interfaces fixed, all five modules still throw `not implemented` (S-6.7–S-6.11). |
| `apps/web` · `apps/api` · `apps/keeper` | Tipster/panel UI (the strict CSP and privacy headers are configured; the pages are placeholders) · blob store, relayer queue, AI proxy (stubs) · keeper heartbeat and switch release (stubs). |
| `scripts/` | `gen-vectors` and `verify-attestation` work today; `deploy-testnet`, `seed`, `spam`, `demo` and `sign-statement` are placeholders that throw until P7/P11 land. |
| `spikes/` | The day-1 proofs (OHTTP from a browser, offline attestation verifier, borsh/ed25519 vectors). |

Full layout with per-file responsibility: [`project_structure.md`](project_structure.md).

## Limitations (read this before trusting it)

The first six are residual risks the design deliberately cannot remove. The last three are build status,
not privacy claims — the features they refer to are described above in the present tense because that is
the design, and `ROADMAP.md` says which rows are still stubs.

- **Whoever holds your 24 words is you.** Without an optional passphrase, a seized phrase can claim
  the reward and read the bundle. Treat the phrase like a key, not a password reminder.
- **The AI proxy sees the text** it is asked to redact whenever the proxy path is used; the direct
  browser→TEE path removes us from that but not the model operator. Stylometry can still identify a
  writer, and the AI step only *suggests* edits — you make them.
- **Timing leaks remain.** The relayer queue is specified to delay actions randomly (0–20 s in demo,
  1–24 h in production) and we advise delaying the claim, but long-run patterns can still link you. Use
  Tor; nothing here hides *when* you submitted.
- **Tracking dots are not guaranteed gone.** Scan mode (grayscale + threshold) is specified to suppress
  them and the cleaning report is specified to say so, but ARCHITECTURE §11 records the residual as "not
  guaranteed" — and neither is implemented yet (S-6.10, S-6.11).
- **The keeper is trusted** in the hackathon build (it holds `K_switch` sealed to it and performs the
  release). Production would run it inside a TEE with an audited policy. If the keeper is down, release
  is delayed, not lost — its heartbeat is public.
- The panel is a Sputnik DAO: a **recused member can still vote in the DAO**; only the contract's
  triage path enforces recusal.
- **A funder cannot renege, but the panel can still reject.** Reservations only ever block the funder's
  `withdraw_unreserved`; they do not guarantee a payout decision. Both sides of that are P2/P3 work in
  progress — `withdraw_unreserved` is still a stub.
- Everything runs on **testnet** with a mock token. The mainnet payout path is designed
  (`Payout::Intents` from a 1Click quote) but unverified: the $1 on-chain check of the 1Click NEP-141
  deposit method (S-0.6) has not been run, because it spends real funds and needs your go-ahead. Until
  then treat "any chain" as intent, not fact.
- This code has not been externally audited. Do not use it for real secrets.

## Libraries and AI disclosure

**Rust (contracts):** `near-sdk` and `near-contract-standards` 5.30, `serde_json` 1 (dev),
`near-workspaces` 0.24 + `near-sandbox` 2.14 with `features = ["unstable"]` (dev, integration tests).
Contracts build with `cargo-near`; nothing else.

**TypeScript, in use:** `@noble/hashes` 2.4 (HKDF-SHA256, sha256, keccak-256), `@noble/ed25519` 3.2,
`@scure/bip39` 2.4 (24 words ↔ entropy), `libsodium-wrappers` 0.8 (XChaCha20-Poly1305 and sealed boxes),
`zod` 4.6, `near-api-js` 7.4, `hono` 4.13 + `@hono/node-server` 2.1, `next` 16.4.4 (pinned), `react` 19.3,
`@near-wallet-selector/*` 10.1, `tailwindcss` 4.3, `vitest` 5.1, `pdf-lib` 1.17 + `pdfjs-dist` 6.5 +
`exifr` 7.1 (declared for the cleaning package, which is still stubs), Node's built-in test runner, and
dev tooling (`eslint` 10, `typescript-eslint` 8.72, `typescript` 5.9, `tsx` 4.23, `prettier` 3.9).

**Declared but not imported:** the `borsh` npm package 2.0 — the action encoder is hand-rolled in
`packages/crypto/src/borsh.ts`, because the package can't encode fieldless enum variants. `@noble/curves`
is **not** a dependency and is not used (it would only be needed for the secp256k1 response-signature
check, S-0.3, which is still open).

**Vendored artifact:** Sputnik DAO v2 wasm, pinned by size, sha256 and on-chain code hash with its full
provenance in `contracts/sealedtip/res/SPUTNIK_VERSION.txt`.

**No library at all:** HPKE, BHTTP and OHTTP in `spikes/ohttp-browser/` are implemented directly on
`crypto.subtle`.

This repository was built with AI agents (Qoder) working from `AGENTS.md`, `PRD.md` and
`ARCHITECTURE.md`. Agents write code, tests and docs; a human owns merges, spending, deployment and
submission. Commits carry no AI attribution. See [`AGENTS.md`](AGENTS.md) for the rules they work under.

## Contributing

- Read `AGENTS.md` first (agents and humans alike).
- Work is tracked in GitHub issues (index: [`docs/ISSUES.md`](docs/ISSUES.md)). Contributions are from collaborators only.
- **Every contribution must update [`ROADMAP.md`](ROADMAP.md) in the same change**: your task row and a Changelog line. The header is recomputed after merge (procedure: `ROADMAP.md` §1).
- Keep `project_structure.md`, `ARCHITECTURE.md` and `ARCHITECTURE_ESSENTIALS.md` in sync with the code.

## License

MIT — see [`LICENSE`](LICENSE).
