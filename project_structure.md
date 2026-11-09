# Sealed Tip — Project Structure

> This is where every file lives and what it's responsible for. Read it before creating a file.
> If you add, move or rename a file, update this document in the same change.
> Every contribution must also update `ROADMAP.md` (your task row + Changelog line). See `ROADMAP.md` §1.
> **Privacy is the product.** The "browser-only" and "ciphertext-only" labels below are invariants, not suggestions.

---

## 1. Top-level tree

```
sealed-tip/
├── AGENTS.md  CLAUDE.md          # agent rules (read first; privacy invariants)
├── PRD.md  ARCHITECTURE.md  ARCHITECTURE_ESSENTIALS.md
├── project_structure.md          # this file
├── ROADMAP.md                    # live task list + status — UPDATE IN EVERY CONTRIBUTION
├── tools/roadmap.py              # updates ROADMAP rows; recomputes the header after merges
├── docs/ISSUES.md                # index of GitHub issues by phase, wave and roadmap ID
├── README.md  LICENSE
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  tsconfig.json
├── eslint.config.mjs  .prettierrc  .editorconfig  .nvmrc  .gitignore
├── .env.example                  # source of truth for env vars
├── Cargo.toml  rust-toolchain.toml  rustfmt.toml
├── .github/workflows/ci.yml
├── contracts/
│   ├── sealedtip/                # the product contract
│   └── mock-ft/                  # testnet tUSDC — NEP-141/145/148 via near-contract-standards + open mint
├── packages/
│   ├── core/                     # @sealedtip/core — zod mirror of contract types, view client
│   ├── crypto/                   # @sealedtip/crypto — keys, borsh actions, sealing, PoW (browser-only secrets)
│   └── clean/                    # @sealedtip/clean — file gate, PDF rasterise, image re-encode, scan mode, report
├── apps/
│   ├── web/                      # Next.js (strict CSP; no third-party loads)
│   ├── api/                      # Hono: blobs (ciphertext only), relayer queue, AI proxy, quotes — noLogs everywhere
│   └── keeper/                   # switch keeper: heartbeat, view-polled trigger watch, re-seal to non-recused, release
├── scripts/                      # deploy, seed, demo, spam, verify-attestation, sign-statement, gen-vectors
├── spikes/                       # day-1 verification (ohttp-browser: WebCrypto OHTTP), hand-run, in no workspace
├── fixtures/                     # vectors.json (TS↔Rust), fictional files
└── docs/screenshots/
```

## 2. Contract `contracts/sealedtip/`
```
src/
├── lib.rs        # state (programmes, tips, relayers, keeper, keeper_last_seen, owner), init, ft_on_transfer {"fund": id}
├── types.rs      # PanelMember, Programme, TipStatus, SealedKey, Switch, Tip, SwitchInput, Payout, SignedAction,
│                 # Action, FtMessage, TipPublic, ProgrammeStats
├── errors.rs     # E01…E25 (messages never include tipster data)
├── events.rs     # NEP-297 `sealedtip` events, native `event_json` derive (no tipster data)
├── time.rs       # scaled / deadline — the only place durations are computed
├── actions.rs    # DOMAIN_TAG ‖ borsh(SignedAction); submit message; ed25519 verification
├── pow.rs        # leading-zero-bit check
├── access.rs     # assert_funder / assert_panel_dao / assert_panel_member (non-recused) / assert_relayer / assert_keeper / assert_owner
├── programme.rs  # create_programme, withdraw_unreserved, close_programme, set_panel (DAO)
├── tip.rs        # submit_tip (relayer), triage (panel member), resolve_tip (DAO), retract (signed)
├── claim.rs      # claim (signed; storage_deposit + gas drip + ft_transfer)
├── switch.rs     # checkin (signed), trigger (anyone), post_released_keys + heartbeat (keeper)
├── admin.rs      # owner: set_relayers, set_keeper — never funds or tips
├── token.rs      # promises + on_claim_paid rollback
├── views.rs      # get_programme, list_programmes, get_programme_stats, get_tip_public (no CIDs), get_tip_for_panel, get_keeper_info
└── test_utils.rs # #[cfg(test)] only: fictional make_programme / make_tip / make_contract + as_caller (S-2.12)
tests/
├── common/mod.rs  # S-1.6 sandbox harness: boots a node, deploys both contracts, mint/register/transfer/views/advance
├── smoke.rs       # S-1.6 — the harness gate every other integration test runs on
├── reservations.rs      # S-5.1
├── submission.rs        # S-5.2
├── signed_actions.rs    # S-5.3
├── triage_and_resolve.rs# S-5.4
├── claims.rs            # S-5.5
├── switch.rs            # S-5.6
├── access_control.rs    # S-5.7
└── vectors.rs           # S-5.8 — reads ../../fixtures/vectors.json
res/                     # pinned sputnikdao2.wasm + SPUTNIK_VERSION.txt
```
**Rules**
- **Funds are never reserved in `submit_tip`.** Reservation happens only in `triage(credible=true)`.
- **Changing `SignedAction` or `Action`** means running `pnpm gen-vectors` and updating `actions.rs` and `packages/crypto/src/actions.ts` in the same change. Changing `keys.ts` derivation means re-running `pnpm gen-vectors` too: `fixtures/vectors.json` carries the HKDF/BIP39 key vectors that `tests/vectors.rs` and `packages/crypto/test/fixture.ts` both read.
- **Signatures are passed as `Base64VecU8`**, because serde can't handle `[u8; 64]`.

## 3. TypeScript workspace

| Path | Responsibility | Privacy label |
|---|---|---|
| `packages/core/src/types.ts` | zod mirror of `types.rs` | — |
| `packages/core/src/contract.ts` | view client; the only place with method names | — |
| `packages/core/src/bundle.ts` | the exhibit bundle schema: what one tip's ciphertext contains, shared by the tipster's browser, the panel's browser and `pnpm demo` | cleaned bytes only — there is no field for metadata, and an unknown key is stripped rather than stored |
| `packages/crypto/src/keys.ts` | 24-word secret, HKDF → ed25519 + x25519 | **browser-only** |
| `packages/crypto/src/actions.ts` | borsh SignedAction + domain tag, signing | **browser-only** (keys) |
| `packages/crypto/src/borsh.ts` | minimal borsh writer; must match the Rust derive, checked by `fixtures/vectors.json` | — |
| `packages/crypto/src/ed25519.ts` | @noble/ed25519 with `hashes.sha512` bound (browser and Node must sign identically) | — |
| `packages/crypto/src/seal.ts` | XChaCha20-Poly1305 bundles, sealed boxes, cid | **browser-only** (plaintext) |
| `packages/crypto/src/bundle.ts` | the bundle's canonical serialization, seal/open, and the report hash — the wire half of `core`'s schema | **browser-only** (plaintext); `evidence_hash` is `sha256(ciphertext)`, deliberately not a fingerprint of the content (§14.7) |
| `packages/crypto/src/pow.ts` | PoW solve/check | — |
| `packages/crypto/src/attestation.ts` | offline re-verify of a NEAR AI Cloud attestation bundle (nonce + signing-address bindings, TDX quote v4 register offsets, RTMR replay from the event log, compose-manifest hash, OHTTP ed25519 wrapper, GPU evidence nonce, compose-manager action-log quote) and of a whole `RedactionBundle` from the proxy (`verifyRedactionBundle`, `responseSignatureText`, `canonicalJson`, `attestationHashOf`) | no network, no new deps; malformed input becomes a failed check, never a throw; the secp256k1 validity, Intel collateral and RTMR3 gaps are returned as an `unchecked` list instead of scored as passes |
| `packages/clean/src/gate.ts` | magic-byte sniff; PDF/JPEG/PNG only; everything else refused | **browser-only** |
| `packages/clean/src/{pdf,image,scan,report}.ts` | rasterise, re-encode, scan mode, removal report | **browser-only** |
| `packages/clean/src/host.ts` | the `CanvasHost` port: the one seam through which the cleaners touch pixels, so the package needs neither the DOM nor a native image module | DOM host is `apps/web` (P10), Node host is `packages/clean/test/node_host.ts` |
| `packages/clean/src/index.ts` | `cleanFile`: gate → clean → optional scan, in the one call the UI makes | the only entry `apps/web` imports |
| `packages/clean/tools/make-fixtures.ts` | writes the four fictional dirty files in `fixtures/files/`, then re-opens each one and demands the leak it planted | `pnpm make:fixtures`; byte-deterministic |
| `apps/web/lib/config.ts` | the four `NEXT_PUBLIC_*` coordinates, validated into sentences rather than a stack trace; `daysToNs` for a switch interval | no secret is readable: nothing outside that prefix is ever looked at, and a placeholder contract id is refused by name |
| `apps/web/lib/api.ts` | the tip API's four calls (`/blob` put+get, `/relay/:action`, `/ai/redact`) with the server's caps mirrored locally | the refusal happens before an upload, so plaintext never leaves the browser for a blob the store would reject anyway |
| `apps/web/lib/dom-canvas-host.ts` | the browser `CanvasHost`: `OffscreenCanvas` where present, `createImageBitmap` to decode, `toBlob`/`convertToBlob` to encode, pdfjs on a module worker | the DOM is reached through three injected primitives, so the web tests are Node tests and the cleaning arithmetic is the same one `packages/clean` was vouched for |
| `apps/web/lib/csp.ts` | the one builder of the `Content-Security-Policy`, given that request's nonce; the two default origins come from `lib/config.ts` so the policy and the client cannot disagree | a `connect-src` that disagrees with the client is a page whose every network call is blocked; an env value cannot append a directive |
| `apps/web/proxy.ts` | sets that policy per request, on the request headers (so the render can stamp its nonce) and on the response (so the browser can enforce it) | the only place the header is set — two copies on one response are enforced as both, and a nonceless second copy re-blocks the app |
| `apps/web/lib/submit-flow.ts` | the complete submit and signed-action pipeline (`submitTipFlow`, `checkinFlow`, `retractFlow`, `claimFlow`) | **browser-only** plaintext and keys; 9-step atomic flow |
| `apps/web/app/page.tsx` | landing + Tor guidance | no third-party loads |
| `apps/web/app/p/[id]` | public programme page | no tipster data |
| `apps/web/app/submit/[programme]` | tipster flow | **browser-only** plaintext |
| `apps/web/app/{status,claim}` | 24-word re-entry, check-in, claim | **browser-only** keys |
| `apps/web/app/panel` | triage, local decryption, DAO proposal | panel keys local |
| `apps/web/app/programmes/new` | funder setup | — |
| `apps/web/components/*` | CleaningReportView, RedactionReview, AttestationPanel, RecoveryWords, RecusalPicker, SwitchSettings, KeeperStatus | — |
| `apps/web/next.config.ts` | strict CSP + no-referrer headers | enforces invariant 3 |
| `apps/api/src/middleware/no-logs.ts` | applied to every route | enforces invariant 2 |
| `apps/api/src/routes/blob.ts` | ciphertext store, 25 MB cap | **ciphertext-only** |
| `apps/api/src/routes/relay.ts`, `relay/{gate,queue,submit,ratelimit}.ts` | allow-list of four actions, random-delay queue, 2 relayers, limits keyed by claim pubkey | no IP keys; `gate.ts` validates shape and existence and leaves signature verification to the chain |
| `apps/api/src/routes/ai.ts` + `ai/{cloud,redact}.ts` | `POST /ai/redact`: `cloud.ts` is transport (the three NEAR AI calls, timeouts, and which of them gets the bearer key), `redact.ts` is policy and assembly (order of checks, the 8 KiB byte cap, the inference-credit bucket, the bundle), the route is only status mapping | keeps nothing, caches nothing (`no-store`), verifies nothing — the bundle is graded client-side and offline |
| `apps/api/src/json.ts` | the `Json`/`JsonObject` types and the parse-without-throwing readers, for JSON this service passes through without understanding | exists so `ai/cloud.ts` can hand back somebody else's report un-shaped |
| `apps/keeper/src/env.ts` | the keeper's own fail-fast config: the two accounts, the `ed25519:` key prefix, the 64-hex X25519 secret, `KEEPER_HEARTBEAT_S`, `KEEPER_WATCH_S` capped at 60 s, `KEEPER_API_URL` | names and reasons, never values; refuses mainnet like the API does |
| `apps/keeper/src/near.ts` | `KEEPER_METHODS` (the union `heartbeat` · `post_released_keys`), the per-method gas, and the one transport that names a node | **the keeper's whole write surface**, and the only file in the package with a signer |
| `apps/keeper/src/blobs.ts` | `GET /blob/:cid` and `POST /blob` over the tip API, with the recorded cid re-hashed locally and a disagreement refused | the store's rules stay in one place (S-8.3); a 404 is `null`, not an error |
| `apps/keeper/src/heartbeat.ts` | one beat, then the loop: first beat before the first sleep, a failure costs one interval, `stop`/`done` for a signal handler | `keeper_last_seen` is public, which is what makes a quietly dead keeper visible (B9) |
| `apps/keeper/src/watch.ts` | tip enumeration (probe until `null`, 50 new ids per pass) and the `switch_triggered` pass; `pollOnce` returns what fired so detection is testable without a timer | reads only the **public** view; no CID, no recusal list, no key |
| `apps/keeper/src/release.ts` | refuse-not-triggered / already-released / nobody-left, open the keeper's sealed `K_switch`, re-seal per non-recused member, `post_released_keys` | **the only live plaintext path in the repository**: `K_switch` exists here for the statements between `openSealed` and the last `sealTo`, and leaves as sealed bytes only |
| `apps/keeper/src/index.ts` | wires the above and shuts both loops down on SIGINT/SIGTERM | `KEEPER_X25519_SECRET` is decoded by a local 32-slice parser, not `fromHex`, so a rejected value cannot be echoed by the exception that rejects it |
| `apps/keeper/test/support.ts` | the no-network fakes: chain, blobs, calls, real X25519 members | a test never needs a port, a node, a `.env` or a timer |
| `scripts/lib/app-cert.ts` | Node-only verify of the dstack X.509 chain in `info.app_cert`: leaf → App CA → KMS CA, validity, and the quote's MRTD + RTMR0-3 + compose hash embedded in the signed leaf | stays out of `packages/crypto` because that package must be browser-safe |
| `scripts/lib/redaction-report.ts` | what a stored redaction bundle proves, as one pure function: the crypto package's checks plus the caller's app-cert chain, the `attestation_hash`, and the `unchecked` gaps in the order a judge reads them | the CLI prints it and `scripts/test/redaction-report.test.ts` asserts its shape, so "verified" cannot be printed over an unverifiable signature |
| `scripts/*`, `scripts/demo/*` | deploy, seed, demo (PRD §8 acceptance test steps 1-8), spam (anti-spam stress test), verify-attestation, sign-statement, gen-vectors | fictional data only |

Tests use `node:test` via `tsx`. Web tests use Vitest.

## 4. Root scripts
| Script | Runs |
|---|---|
| `build` / `build:contract` | `cargo near build non-reproducible-wasm` per contract (verified with cargo-near 0.22.0), then TS builds |
| `check:contract` | `cargo check --workspace --target wasm32-unknown-unknown` |
| `test` / `test:contract` | contract build + `cargo test`, then `pnpm -r test` |
| `test:vectors` | crypto package tests + `cargo test -p sealedtip vectors` |
| `test:clean` | cleaning fixtures |
| `make:fixtures` | regenerate `fixtures/files/` and re-verify every leak in them |
| `lint` | fmt, clippy `-D warnings`, ESLint, `tsc -b` |
| `dev` / `relayer` / `keeper` | local services |
| `deploy:testnet`, `seed`, `demo`, `spam`, `verify-attestation`, `sign-statement`, `gen-vectors` | `scripts/*.ts` |

## 5. Dependency direction
- `contracts/*` has no TS dependencies.
- `packages/core` ← `crypto`, the apps and the scripts.
- `packages/crypto` and `packages/clean` ← `apps/web`. `crypto` is also used by `keeper` and `scripts`.
- **`apps/api` must not import `packages/crypto` or `packages/clean`.** The server never handles keys or plaintext. `apps/api/test/no-logs.test.ts` enforces it per source file, matching import and export statements so the comments that explain the rule can still name the package.
- The one documented exception to "never handles plaintext" is `POST /ai/redact` (ARCHITECTURE §7.5): it holds `NEAR_AI_API_KEY` — a browser cannot be given our key — and so reads the passage the tipster chose to send for AI analysis. It never holds a tipster key, an exhibit or a cleaning result, and it still imports neither client package: the proxy assembles the attestation bundle and `verifyRedactionBundle`, in `apps/web`, `keeper` and `scripts`, is what grades it.
- **`apps/keeper` is the process that is *allowed* to hold a bundle key, and it is bounded rather than trusted.** Out of the workspace it takes `packages/core` (views only — that module carries no signer) and `packages/crypto` (`openSealed`, `sealTo`, `cidOf`); `near-api-js` is for its own two methods and nothing else. The bound is enforced, not described: `KEEPER_METHODS` is a union type in `src/near.ts`, `privacy.test.ts` scans every source file for a call outside it, runs the real heartbeat, watch pass and release behind the same five-sink console capture `apps/api` uses, and asserts that no hex or base64 of the keeper secret, the switch key or any panel member's secret appears in what got logged. The keeper never imports `packages/clean`, and `test/support.ts` is the only place a fake chain exists.

## 6. Where new code goes
| You're adding… | Put it in… | Also update |
|---|---|---|
| **Anything at all** | — | **`ROADMAP.md`**: your task row + Changelog line |
| A contract method | its module (`tip.rs`, `switch.rs`, …) | tests, `contract.ts`, ARCHITECTURE §5 |
| A signed action field | `types.rs` + `actions.rs` + `crypto/actions.ts` | `pnpm gen-vectors`, ARCHITECTURE §4 |
| A cleaning step | `packages/clean` + fixture + test | ARCHITECTURE §6, PRD T2 |
| An API route | `apps/api/src/routes/` behind `noLogs` | ARCHITECTURE §9, no-logs test |
| A keeper action | `apps/keeper/src/`, called through the `KEEPER_METHODS` union in `src/near.ts` | ARCHITECTURE §9, `.env.example`, the allow-list scan in `apps/keeper/test/privacy.test.ts` |
| Anything loaded by a web page | bundled locally only | CSP in `next.config.ts` |
| A spike that settles a roadmap question | `spikes/<name>/` — plain files, no workspace, no dependency | that ROADMAP row, and ARCHITECTURE §14 if it settles a hard question |
| An env var | where it's read | `.env.example` |

## 7. Naming
- **Rust:** `snake_case` / `PascalCase`; errors `E##_NAME`.
- **TypeScript:** `kebab-case.ts`, `PascalCase.tsx`.
- **Fixtures:** clearly fictional names only.
