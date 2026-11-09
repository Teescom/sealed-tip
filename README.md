# Sealed Tip

**Pay whistleblowers without ever learning who they are — rewards locked in advance, evidence cleaned in the browser and in a verifiable enclave, payout to any chain, and a dead man's switch.**

> NEAR Hackathon 2026 · track **Privacy & Private AI** · deadline 14 Nov 2026, 23:59 UTC.
> Live plan and progress: [`ROADMAP.md`](ROADMAP.md) · decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md) §14 · product spec: [`PRD.md`](PRD.md).

**Status: mid-build, 14 / 103 Must tasks done** (the tally counts a task as done only once its GitHub
issues are closed, and closing them is the owner's call — a further 57 Must rows are code-complete and
tested behind that rule). Working and tested today: the tipster key model (24
words ↔ secret ↔ HKDF-derived ed25519/X25519 keys), the borsh + ed25519 action wire format — verified to
be byte-identical in Rust and TypeScript from one shared fixture — the contract's access guards, PoW
check, time scaling and NEP-297 events, programme accounting (open, fund over NEP-141, withdraw what is
not backing a live tip, close), panel appointment, the owner's relayer and keeper rotation, the paginated
views and their privacy boundary, the offline attestation verifier, the client-side bundle sealing
(XChaCha20-Poly1305 for the bundle, a sealed box for each recipient's copy of the key, `cidOf` for the
pointer) and the PoW solver that mines the nonce the contract then checks, the `tUSDC` test token, a
`near-sandbox` harness that boots a chain and drives both contracts, and the whole tip lifecycle
including the payout — `submit_tip` (PoW, signature, quorum and recusal refusals, reserving nothing),
`triage` (the only place a reservation is created), `resolve_tip` (DAO-only, reward ceiling, unused
reservation released) and the retry that promotes an `Unfunded` tip when money arrives, plus the
tipster-signed half: `retract`, `checkin`, `trigger` and the keeper's `post_released_keys` and
`heartbeat`, plus `claim` with the destination inside the signed action, the token's storage deposit,
the gas drip, and a rollback that restores the money and the tip when the token refuses. Every one of
them is tested against the deployed wasm rather than only in-process, including the four ways a signature
can be wrong (another key, another deployment, a spent nonce, a skipped nonce) and the switch's two
clocks. The API serves four things a browser can already use: the ciphertext-only blob store, the relay
queue, the AI redaction proxy with its attestation bundle, and a health endpoint. Not built yet: the web
UI (including the DOM canvas host that runs the cleaners in a browser), the keeper and the demo script.
The last column of the table
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

The right-hand column is the honest state of this repository as of 2026-11-09: what runs today, and what
is designed but not built yet. Task IDs point into [`ROADMAP.md`](ROADMAP.md).

| Threat | What the code does | State |
|---|---|---|
| "Who is the tipster?" | **No account.** The tipster holds 32 random bytes shown as 24 words. Every action is a borsh struct signed with an ed25519 key derived via HKDF from those bytes; a relayer submits it. The contract verifies the signature and never sees an identity. | words ↔ secret, HKDF, borsh + ed25519 encoding and `env::ed25519_verify` all implemented and cross-tested against each other; `submit_tip` checks that signature on-chain and `retract`/`checkin` check the per-action one. The sandbox proves the four ways a signature can be wrong are each refused: another key, another *deployment* (the contract account is inside the signed payload), a spent nonce, and a nonce that skips ahead — and that a tip refused for a bad signature is never stored (S-3.1, S-3.4, S-3.6) |
| Metadata in the evidence | Cleaning runs **in the browser** before anything is uploaded: PDFs are rasterised and rebuilt, images are re-encoded, EXIF/GPS, XMP, `Author`/`Producer` and incremental revisions are gone, and an optional scan mode suppresses printer tracking dots. DOCX and other types are refused. The tipster gets a report of exactly what was removed. | built and tested (S-6.7–S-6.12): 22 tests over four fictional dirty files, and the report is written only after `describeFile` re-opens the cleaned file and fails if any of its claims is untrue — the invoice fixture's older revision, which a PDF viewer never shows, is the case that test exists for. What is missing is the browser: the DOM `CanvasHost` and the upload UI are P10 |
| "The upload server has my address" | The API strips the nine forwarding headers (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, …) by rebuilding the request before any handler runs, no route may import a request logger or hand a request object to a console call, and the blob store keeps ciphertext only — keyed by `sha256(ciphertext)`, with the 25 MB cap counted off the stream instead of read from `Content-Length`. | written and tested (S-8.1–S-8.4, 106 `apps/api` tests): a live run wrote one startup line and no request to any of the five console sinks, and the same is now asserted about a signed action posted to `/relay` and about the passage posted to `/ai/redact`. Not yet in front of a tipster — P10 has to upload through it, and `/quote` is still 501 |
| "The relay is a server holding keys that can move money" | `POST /relay/:action` forwards exactly four methods — `submit_tip`, `checkin`, `retract`, `claim` — and every other name gets the same refusal whether or not the contract has it, so the endpoint is not an oracle for what a deployment runs. It validates the body against the same schemas that describe the deployed wasm and reads the tip off the chain, so a call naming a tip that does not exist is refused before anyone pays gas. It does **not** verify the signature: `env::ed25519_verify` does, and `project_structure.md` §5 keeps the client crypto package out of this process entirely. Rate limits are two token buckets keyed by claim pubkey plus one shared bucket — never an IP — and a refusal consumes nothing. | built and tested (S-8.4): the allow-list, the check order, what a refusal is allowed to say and what a log is allowed to contain are each covered, and the queue's delay is drawn uniformly from `RELAY_DELAY_MIN_S..MAX_S` with a relayer that fails costing one action rather than the rest of the queue. **Not yet run against a chain**: the two relayer keys are configured but `pnpm demo` (P11) is what will actually put a relayed `submit_tip` on testnet |
| "The AI read my text" | The optional AI redaction step can go **browser → attested NEAR AI Cloud TEE** directly over OHTTP with no server of ours in the path — proven in `spikes/ohttp-browser/`. The proxy stays for the API key, rate limiting and IP hiding, and the UI says plainly who can read the text. | the OHTTP/HPKE/BHTTP path is proven live from a Chromium tab with no library and no dependency. The proxy route is now built and tested (S-8.5): `POST /ai/redact` asks the enclave for a report binding a nonce **the tipster generated**, sends the completion, fetches the signature over those exact bytes and returns all of it as one bundle it keeps no copy of. The UI copy that says who read the text is P10 |
| Is that really the enclave? | `pnpm verify-attestation` re-verifies an attestation report offline: the TDX quote parses and its `report_data` binds *our* nonce and the signing address, RTMR0-2 replay from the event log, the dstack X.509 app-cert chain is walked and pins the compose hash, and the OHTTP key config carries a valid ed25519 signature. `--redaction <file> --nonce <hex32>` does the same over a whole bundle from `POST /ai/redact` and adds the rest: that the signed text is sha256 of the request and response bytes actually stored, that the signer is one of the attested addresses, that the model named in the bundle is the model the quote attests, and one `attestation_hash` to quote. What it still cannot prove is printed as gaps rather than scored: the Intel collateral chain over the quote, NVIDIA's GPU attestation, RTMR3, and the secp256k1 curve arithmetic behind the response signature. | works today (54 checks on a live report; the bundle checks on 16 fictional ones, `--redaction` on a live AI answer needs the API key the owner has not issued) |
| The outlet disappears | A **dead man's switch**: `checkin` keeps it armed; missing `deadline + grace` lets anyone `trigger` it, and the keeper releases the *cleaned* switch bundle key to non-recused panel members (raw files only on explicit opt-in). | built and tested through the sandbox: `time.rs` scaling, the arming at `submit_tip`, `checkin` restarting the clock from the block it lands in, `trigger` refusing until `deadline + grace` has passed and then accepting **any** account (the sandbox root, which holds no role, fires it in one test), one trigger per tip, and `post_released_keys` keeper-only. In demo mode a 1-day interval arms 1 minute out and the grace compresses with it. The keeper *service* that notices a `switch_triggered` event is P9 |
| A panel member is compromised | The tipster **recuses** members; recused members get no sealed key and are barred from triage. Every tip needs ≥2 sealed keys. | recusal guards implemented, unit-tested and proven through the sandbox (a recused member is refused at `triage`, E06, with the reservation left at zero; a released key naming a recused member is refused at `post_released_keys`, E13, even when it is posted by the keeper). Sealing to a per-member key set is built in `seal.ts` (S-6.5, sealed boxes on each member's X25519 key), so what is missing is the browser flow that calls it, not the crypto. The ≥2-key rule counts *distinct* members, so two entries naming one reviewer is one reviewer |
| Nobody pays | The programme's reward is **locked on-chain before tips arrive** and reserved only when a panel member marks a tip credible — so a dismissal never strands funds, and a funder cannot withdraw money that is already backing a live tip. | `mock-ft` is a real NEP-141 token; opening, funding, closing and `withdraw_unreserved` are implemented, and the ceiling that stops a funder taking reserved funds is tested through the sandbox with a rollback when the token itself refuses (S-2.6, S-2.10). The reservation is created by `triage` and released by `resolve_tip`, both tested through the sandbox: ten submissions leave the full balance withdrawable, one credible triage does not (S-3.2, S-3.3) |
| Payout to a bank/burner wallet | `Payout::Near{fresh implicit}` on testnet; on mainnet a 1Click Intents quote pays USDC on NEAR to any chain, and the destination is inside the signed `Claim`, so a relayer cannot redirect it. | built and tested through the sandbox (S-3.5, S-2.10, S-5.5): the payout is signed, so a relayer can neither move a reward to another account nor switch the same account onto the other rail; `claim` registers the destination, transfers, and answers for the transfer, and a transfer the token refuses rolls the money and the tip back so the next nonce can retry. An Intents payout gets its memo inside the NEP-141 memo, a NEAR payout gets a gas drip that makes the fresh implicit account spendable. **Still unverified:** the $1 mainnet check of the 1Click deposit method (S-0.6), which decides whether that memo is the right shape |
| "The server can show the panel whatever it likes" | A page reads tip and programme state **off the chain**, not off our API: `createViewClient` (`@sealedtip/core`) calls the five `sealedtip` views over JSON-RPC at `final` finality and validates each response against a zod mirror of the contract's own types, so the tip API is never in that read path and cannot rewrite what a reviewer is shown. The anonymous-facing view is `get_tip_public`, which carries no CID, no evidence hash and no key holder. | written and tested (S-6.1, S-6.2; 15 `packages/core` tests): the schemas are checked against `fixtures/views.json` — the five responses exactly as the deployed wasm returned them — and `contracts/sealedtip/tests/views_shape.rs` re-reads them from the chain, so a mirror that drifts goes red rather than a page quietly rendering `undefined`. Nothing here can spend: no key, no signer, no wallet in the file. The page that calls it is P10, and the CID-carrying `get_tip_for_panel` belongs to a panel member's own session, not to an anonymous tab (S-6.4) |

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
testnet credentials except the two testnet scripts below, and they read the chain without spending
unless you pass `-- --apply`. `pnpm demo` and `pnpm spam` are still placeholders that throw — see
[`ROADMAP.md`](ROADMAP.md) P11.

```bash
pnpm install
pnpm build:contract      # -> target/near/sealedtip/sealedtip.wasm, target/near/mock_ft/mock_ft.wasm
pnpm test                # Rust unit tests + sandbox integration smoke test + TS suites
pnpm lint                # fmt, clippy, eslint, tsc
```

Expected today:

| Do X | See Y |
|---|---|
| `pnpm build:contract` | two wasm files, 271,800 bytes (`sealedtip`) and 151,157 bytes (`mock_ft`), reported by `cargo-near` |
| `pnpm test` | 256 Rust tests + 261 TypeScript tests pass, and **no Rust test is skipped or ignored**: 174 `sealedtip` unit, 18 `mock-ft` unit, 9 wire-format parity, and **55 sandbox integration tests** — 11 claim, 9 signed-action, 8 programme, 7 switch, 6 submission, 6 reservation, 4 triage-and-resolve, 2 access-control, 1 smoke, 1 view-shape (`contracts/sealedtip/tests/{smoke,programmes,submission,reservations,triage_and_resolve,signed_actions,switch,claims,access_control,views_shape}.rs`), which boot a `near-sandbox` node, deploy both contracts and drive them over RPC — plus 73 `packages/crypto` tests for the key model, the action wire format, bundle sealing and sealed boxes, the PoW solver and the offline re-verification of a redaction bundle (what a signed answer binds, what it still cannot prove, and that a check detail never repeats the tipster's own words), 22 `packages/clean` tests for the gate, the PDF rebuild, image re-encoding, scan mode and the report, run against the four fictional dirty files in `fixtures/files/` through a Node canvas host that lives in `test/` precisely because the shipping package must not need it, 106 `apps/api` tests for the no-logs middleware, the fail-fast environment, the ciphertext-only blob store, the relay gate — the four-method allow-list, the order the checks run in, the two token buckets and the random-delay queue — and the AI proxy: the three upstream calls, the bytes that must match the signed ones, a model id that tries to add a query parameter, what an upstream that stops answering is allowed to say, and that the request cap is counted in bytes — 15 `packages/core` tests that parse `fixtures/views.json` — the five view responses as the deployed wasm actually returned them — and drive `createViewClient` over a fake transport, including its real JSON-RPC envelope against a local `node:http` stub, and 45 `scripts` tests for the deploy and seed plans — the amounts, the access-key check, the idempotence conditions and the Sputnik 2.0.0 JSON — over a fake `.env` and a fake chain snapshot, plus the verifier's own output order. Also reported rather than hidden: **1 TypeScript test is still a `todo` scaffold** — in `keeper` (P9). Nothing fails. |
| `pnpm relayer` | the API process boots on `API_PORT` (8787 by default; on the machine this was verified on, an unrelated local service already held 8787, so the run used `API_PORT=8791`, and a taken port fails with `EADDRINUSE` rather than quietly moving). It is what a browser talks to. `POST /blob` accepts ciphertext only: it returns `cid = sha256(ciphertext)`, refuses a body that begins with a PDF, JPEG, PNG or ZIP header (415), and enforces the 25 MB cap while the bytes stream rather than trusting `Content-Length` — measured on a live run, where a 27 MB upload was refused at 26,279,936 streamed bytes and nothing was stored. `GET /blob/:cid` hands the bytes back as `application/octet-stream`. `POST /relay/:action` is the relayer queue: four methods only (`submit_tip`, `checkin`, `retract`, `claim`), the body validated against the same schemas that describe the deployed wasm, the tip read off the chain so a call naming a tip that does not exist gets 404 instead of a spent transaction, two token buckets (per claim pubkey + one shared, never an IP) and a queue that answers `202 {queuedUntil}` with the delay drawn from `RELAY_DELAY_MIN_S..RELAY_DELAY_MAX_S`. It does not verify the signature — the contract does — and a full queue answers 503 rather than growing. `POST /ai/redact` is the AI step: it takes `{text, nonce, model?}` (the nonce is 32 bytes the tipster's own client generated, and nothing here invents it), asks the enclave for a report binding that nonce, sends the completion under our key, fetches the signature over those exact bytes and answers 200 with the suggestions plus the whole bundle and `cache-control: no-store`. It keeps nothing: no cache, no second chance to attest the same answer, and no log of the passage — a text over the 8 KiB cap, a body over the envelope, an unfilled key (503 before anything is spent), an upstream that 500s or stops answering, and a signature response that does not state what the spec says it states are each refused without repeating a word of the request. `/quote` still answers 501 until S-8.6. It writes one startup line and nothing else: the `noLogs` middleware strips nine forwarding headers before any handler runs, and a test fails the moment any route imports a request logger or passes a request object to a console call. A `.env` that is missing a required name, has an empty one, or asks for mainnet stops the start with names and reasons — never values, so a relayer key cannot appear in a deploy log. |
| `pnpm make:fixtures` | the four dirty files in `fixtures/files/` regenerated, each one re-opened and checked for the leak it is supposed to have (pdfjs reads the PDF's revision Info, exifr reads both images, the scan is counted dot pixel by pixel, the docx zip CRCs are verified), and deterministic — a second run prints `unchanged` for all four |
| `pnpm lint` | exit 0 — `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `eslint .` and `tsc -b` are all clean (S-5.9, 2026-11-06). The clippy step needs `--all-targets`: `near-sdk` 5.30 deliberately refuses a host build of a contract crate, so `cargo clippy --workspace -- -D warnings` errors inside the dependency before reaching our code and can never pass. `--all-targets` unifies the `unit-testing` dev-feature, which makes `near-sdk` host-compilable, so clippy actually lints the contracts and the tests. |
| `pnpm gen-vectors` then `pnpm test:vectors` | `fixtures/vectors.json` regenerated byte-for-byte, and the Rust tests confirm the TS and Rust borsh + ed25519 encodings agree *and* that the TypeScript PoW solver and the contract's `pow::check` hash the same 40-byte preimage and count the same bits |
| `pnpm deploy:testnet` and `pnpm seed` | **read-only by default** — each reads live testnet and prints the exact plan `-- --apply` would run, and sends nothing. Today the deploy dry run reports both accounts at `no code yet`, `tusdc` 1 of 2.01339 NEAR and `sealedtip` 2 of 3.21982 NEAR, 2.23321 NEAR to move, exit 0; `pnpm seed` stops one line later with `sealedtip.st-hack-f8d075.testnet has no code — run pnpm deploy:testnet -- --apply first`. The `--apply` runs are the project's only code that spends on a shared network, so they need a funded deployer root and an explicit owner go-ahead — until then P4 is the gate every on-chain row is waiting behind. |
| `pnpm verify-attestation -- --fetch <model>` | a live report fetched from `cloud-api.near.ai`, then every DCAP quote, X.509 app-cert chain, compose hash and OHTTP key-config signature checked — 54+ ✔ lines, exit 0, with the model's answer never requested. Add `--pin-ca <fingerprint>` to anchor the chain. |
| `pnpm verify-attestation -- --redaction <file> --nonce <hex32>` | the same checks over a bundle `POST /ai/redact` returned, plus the eight bundle-level ones, then `attestation_hash` and the list of what the bundle still cannot prove. The `--nonce` is the value **you** generated: the file's copy of it is the claim being tested, so a run that used it would verify nothing. Exit 0 only when every printed check passed. |

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
| `packages/crypto/` | Everything in it works now: 24 words ↔ secret, HKDF key derivation, borsh action encoding, ed25519 signing, attestation verification (including a whole redaction bundle: `verifyRedactionBundle` and the `attestationHashOf` the panel displays), XChaCha bundle sealing plus sealed boxes and `cidOf` (S-6.5), and the PoW solver that shares `fixtures/vectors.json` with the contract's `pow::check` (S-6.6). 73 tests, 0 failing. |
| `packages/core/` | The read path the web app and the keeper both bind against. `types.ts` is the zod mirror of the contract's own JSON — validated against `fixtures/views.json`, the five view responses captured from the deployed wasm, and kept honest from the Rust side by `contracts/sealedtip/tests/views_shape.rs` (S-6.1). `contract.ts` is `createViewClient(rpcUrl, contractId, { view?, finality? })`: the five views over JSON-RPC, `final` by default, reading only — no key, no signer, nothing that can spend — and the transport is injectable so tests never need a node (S-6.2). A failing view keeps the node's own text as the message, because a contract panic reason like `E01_PROGRAMME_NOT_FOUND` survives nowhere else. 15 tests, 0 failing. |
| `packages/clean/` | In-browser evidence cleaning and its report, and it all works: magic-byte gate that refuses anything but PDF/JPEG/PNG (S-6.7), PDF rasterised and rebuilt from its own pages (S-6.8), images re-encoded (S-6.9), optional scan mode that kills a tracking-dot grid (S-6.10), and a report that re-opens the cleaned file before it is allowed to claim anything (S-6.11). It talks to a canvas through a `CanvasHost` port so nothing in it needs the DOM or a native module — the browser host is P10's. 22 tests, 0 failing, against the four fictional dirty files in `fixtures/files/` (S-6.12). |
| `apps/web` · `apps/api` · `apps/keeper` | Tipster/panel UI (the strict CSP and privacy headers are configured; the pages are placeholders) · the tip API: `noLogs`, the fail-fast `env.ts`, the ciphertext-only blob store, the relay queue and the stateless AI redaction proxy with its attestation bundle are written and tested (S-8.1–S-8.5); the quote proxy is still a 501 stub (S-8.6) · keeper heartbeat and switch release (stubs). |
| `scripts/` | `gen-vectors`, `verify-attestation` (both `--fetch` for a live report and `--redaction` for a bundle the proxy returned), `deploy-testnet` and `seed` work today — the last two are read-only plans over live testnet unless you pass `-- --apply` (S-7.1, S-7.2). `spam`, `demo` and `sign-statement` are still placeholders that throw until P11 and S-6.13 land. The pure half of the testnet scripts and of the bundle verifier sits in `scripts/lib/` and is unit-tested in `scripts/test/` against a fake `.env` and a fake chain snapshot, because "would this spend" and "what did this tell the judge" both have to be checkable without spending or fetching. |
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
  writer, and the AI step only *suggests* edits — you make them. What the proxy now also gives you is the
  bundle that lets a third party check who answered (`pnpm verify-attestation -- --redaction`), with three
  honest gaps: the response signature is checked for *what it claims to bind*, not cryptographically
  validated — that needs a secp256k1 implementation, and `@noble/curves` is an ask-first dependency — the
  Intel collateral chain over each quote is not walked without DCAP, and RTMR3 is pinned by an allow-list
  rather than replayed. The bundle's own output names all three instead of scoring them as passes. The
  whole route is also unproven against the real service until someone issues `NEAR_AI_API_KEY`: without it
  `POST /ai/redact` answers 503 and spends nothing.
- **Timing leaks remain.** The relayer queue now delays each action uniformly at random (`RELAY_DELAY_MIN_S`
  to `RELAY_DELAY_MAX_S`: 0–20 s in demo, 1–24 h in production), but the delay is only privacy while the
  queue is not empty — one action alone fires on its own timer, and what hides it is everyone else's actions
  sharing that window. The queue is also in-process, so a restart drops what has not been sent yet; the
  tipster's page re-reads the chain and relays again, and the per-tip nonce means a duplicate of an action
  that did land is refused rather than paid twice. Long-run patterns can still link you. Use Tor; nothing
  here hides *when* you submitted.
- **Tracking dots are not guaranteed gone.** Scan mode (grayscale + threshold) is specified to suppress
  them and the cleaning report is specified to say so, but ARCHITECTURE §11 records the residual as "not
  guaranteed" — and neither is implemented yet (S-6.10, S-6.11).
- **The keeper is trusted** in the hackathon build (it holds `K_switch` sealed to it and performs the
  release). Production would run it inside a TEE with an audited policy. If the keeper is down, release
  is delayed, not lost — its heartbeat is public.
- The panel is a Sputnik DAO: a **recused member can still vote in the DAO**; only the contract's
  triage path enforces recusal.
- **A funder cannot renege, but the panel can still reject.** Reservations only ever block the funder's
  `withdraw_unreserved`; they do not guarantee a payout decision. Both halves are now built and tested:
  a withdrawal that reaches into reserved funds panics E16, one the token refuses is rolled back, and the
  reservation itself is created only by a credible `triage` and released by `resolve_tip` — including the
  case the rule exists for: accepting at 200 of a 500 reservation frees the unused 300, so the funder can
  withdraw 800 today while the 200 behind the claim is still held (S-2.6, S-2.10, S-3.2, S-3.3).
- **Paying a tip costs the programme NEAR as well as tokens.** Every `claim` spends a token storage deposit for the destination and a gas drip out of `ops_balance`, and nothing but the NEAR attached at `create_programme` ever puts NEAR there — there is no top-up call. So a programme can run out of the money that makes payouts legal: the claim after that refuses with E32 and moves no number at all, and in the last one the drip shrinks to zero, which still pays the reward but never creates the fresh implicit account, so the tipster has to fund it before they can spend it. With today's constants that is 1.25 mNEAR of storage deposit plus whatever gas drip the programme was opened with, per tip (S-3.5, S-5.5).
- Everything runs on **testnet** with a mock token. The mainnet payout path is designed
  (`Payout::Intents` from a 1Click quote) but unverified: the $1 on-chain check of the 1Click NEP-141
  deposit method (S-0.6) has not been run, because it spends real funds and needs your go-ahead. Until
  then treat "any chain" as intent, not fact.
- This code has not been externally audited. Do not use it for real secrets.

## Libraries and AI disclosure

**Rust (contracts):** `near-sdk` and `near-contract-standards` 5.30, `serde_json` 1 (dev),
`near-workspaces` 0.24 + `near-sandbox` 2.14 with `features = ["unstable"]` (dev, integration tests),
and `ed25519-dalek` 2.2 (dev, integration tests only — the tipster signs *messages*, and neither
`near-workspaces::types::SecretKey` nor `near_crypto::Signature` gives out the raw 64 bytes a
`Base64VecU8` argument needs; this is the same crate the chain's own `env::ed25519_verify` is built on,
already in the lockfile via `near-workspaces`, and a dev-dependency cannot reach the wasm).
Contracts build with `cargo-near`; nothing else.

**TypeScript, in use:** `@noble/hashes` 2.4 (HKDF-SHA256, sha256, keccak-256), `@noble/ed25519` 3.2,
`@scure/bip39` 2.4 (24 words ↔ entropy), `libsodium-wrappers` 0.8 (XChaCha20-Poly1305 and sealed boxes),
`zod` 4.6, `near-api-js` 7.4, `hono` 4.13 + `@hono/node-server` 2.1, `next` 16.4.4 (pinned), `react` 19.3,
`@near-wallet-selector/*` 10.1, `tailwindcss` 4.3, `vitest` 5.1, `pdf-lib` 1.17 + `pdfjs-dist` 6.5 +
`exifr` 7.1 (the cleaning package: rebuild the container, render and read the page, name what came off),
Node's built-in test runner, and dev tooling (`eslint` 10, `typescript-eslint` 8.72, `typescript` 5.9,
`tsx` 4.23, `prettier` 3.9). `@napi-rs/canvas` is **dev/test-only** and is only ever imported from
`packages/clean/test/`: it is how a Node test implements the same `CanvasHost` port the browser will
implement with a DOM canvas, and a native image module in that package's `dependencies` would make the
one thing this product must run inside — the tipster's browser — impossible to ship.

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
