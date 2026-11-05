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
│   └── mock-ft/                  # testnet tUSDC
├── packages/
│   ├── core/                     # @sealedtip/core — zod mirror of contract types, view client
│   ├── crypto/                   # @sealedtip/crypto — keys, borsh actions, sealing, PoW (browser-only secrets)
│   └── clean/                    # @sealedtip/clean — file gate, PDF rasterise, image re-encode, scan mode, report
├── apps/
│   ├── web/                      # Next.js (strict CSP; no third-party loads)
│   ├── api/                      # Hono: blobs (ciphertext only), relayer queue, AI proxy, quotes — noLogs everywhere
│   └── keeper/                   # switch keeper: heartbeat, watch triggers, re-seal keys
├── scripts/                      # deploy, seed, demo, spam, verify-attestation, sign-statement, gen-vectors
├── fixtures/                     # vectors.json (TS↔Rust), fictional files
└── docs/screenshots/
```

## 2. Contract `contracts/sealedtip/`
```
src/
├── lib.rs        # state (programmes, tips, relayers, keeper, keeper_last_seen, owner), init, ft_on_transfer {"fund": id}
├── types.rs      # PanelMember, Programme, TipStatus, SealedKey, Switch, Tip, SwitchInput, Payout, SignedAction,
│                 # Action, FtMessage, TipPublic, ProgrammeStats
├── errors.rs     # E01…E24 (messages never include tipster data)
├── events.rs     # NEP-297 `sealedtip` events (no tipster data)
├── time.rs       # time_scale helpers
├── actions.rs    # DOMAIN_TAG ‖ borsh(SignedAction); submit message; ed25519 verification
├── pow.rs        # leading-zero-bit check
├── access.rs     # assert_funder / assert_panel_dao / assert_panel_member (non-recused)
├── programme.rs  # create_programme, withdraw_unreserved, close_programme, set_panel (DAO)
├── tip.rs        # submit_tip (relayer), triage (panel member), resolve_tip (DAO), retract (signed)
├── claim.rs      # claim (signed; storage_deposit + gas drip + ft_transfer)
├── switch.rs     # checkin (signed), trigger (anyone), post_released_keys + heartbeat (keeper)
├── admin.rs      # owner: set_relayers, set_keeper — never funds or tips
├── token.rs      # promises + on_claim_paid rollback
└── views.rs      # get_programme, list_programmes, get_programme_stats, get_tip_public (no CIDs), get_tip_for_panel
tests/
├── common/mod.rs
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
- **Changing `SignedAction` or `Action`** means running `pnpm gen-vectors` and updating `actions.rs` and `packages/crypto/src/actions.ts` in the same change.
- **Signatures are passed as `Base64VecU8`**, because serde can't handle `[u8; 64]`.

## 3. TypeScript workspace

| Path | Responsibility | Privacy label |
|---|---|---|
| `packages/core/src/types.ts` | zod mirror of `types.rs` | — |
| `packages/core/src/contract.ts` | view client; the only place with method names | — |
| `packages/crypto/src/keys.ts` | 24-word secret, HKDF → ed25519 + x25519 | **browser-only** |
| `packages/crypto/src/actions.ts` | borsh SignedAction + domain tag, signing | **browser-only** (keys) |
| `packages/crypto/src/seal.ts` | XChaCha20-Poly1305 bundles, sealed boxes, cid | **browser-only** (plaintext) |
| `packages/crypto/src/pow.ts` | PoW solve/check | — |
| `packages/crypto/src/attestation.ts` | offline re-verify of a NEAR AI Cloud attestation bundle (nonce + signing-address bindings, TDX quote v4 register offsets, RTMR replay from the event log, compose-manifest hash, OHTTP ed25519 wrapper, GPU evidence nonce, compose-manager action-log quote) | no network, no new deps; malformed input becomes a failed check, never a throw |
| `packages/clean/src/gate.ts` | magic-byte sniff; PDF/JPEG/PNG only; everything else refused | **browser-only** |
| `packages/clean/src/{pdf,image,scan,report}.ts` | rasterise, re-encode, scan mode, removal report | **browser-only** |
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
| `apps/api/src/routes/relay.ts`, `relay/{queue,submit,ratelimit}.ts` | random-delay queue, 2 relayers, limits keyed by claim pubkey | no IP keys |
| `apps/api/src/routes/ai.ts` | stateless NEAR AI Cloud proxy + attestation bundle | keeps nothing |
| `apps/keeper/src/{heartbeat,watch,release}.ts` | heartbeat, trigger watch, re-seal to non-recused | holds keeper key only |
| `scripts/lib/app-cert.ts` | Node-only verify of the dstack X.509 chain in `info.app_cert`: leaf → App CA → KMS CA, validity, and the quote's MRTD + RTMR0-3 + compose hash embedded in the signed leaf | stays out of `packages/crypto` because that package must be browser-safe |
| `scripts/*` | deploy, seed, demo, spam, verify-attestation, sign-statement, gen-vectors | fictional data only |

Tests use `node:test` via `tsx`. Web tests use Vitest.

## 4. Root scripts
| Script | Runs |
|---|---|
| `build` / `build:contract` | `cargo near build non-reproducible-wasm` per contract (verified with cargo-near 0.22.0), then TS builds |
| `check:contract` | `cargo check --workspace --target wasm32-unknown-unknown` |
| `test` / `test:contract` | contract build + `cargo test`, then `pnpm -r test` |
| `test:vectors` | crypto package tests + `cargo test -p sealedtip vectors` |
| `test:clean` | cleaning fixtures |
| `lint` | fmt, clippy `-D warnings`, ESLint, `tsc -b` |
| `dev` / `relayer` / `keeper` | local services |
| `deploy:testnet`, `seed`, `demo`, `spam`, `verify-attestation`, `sign-statement`, `gen-vectors` | `scripts/*.ts` |

## 5. Dependency direction
- `contracts/*` has no TS dependencies.
- `packages/core` ← `crypto`, the apps and the scripts.
- `packages/crypto` and `packages/clean` ← `apps/web`. `crypto` is also used by `keeper` and `scripts`.
- **`apps/api` must not import `packages/crypto` or `packages/clean`.** The server never handles keys or plaintext.

## 6. Where new code goes
| You're adding… | Put it in… | Also update |
|---|---|---|
| **Anything at all** | — | **`ROADMAP.md`**: your task row + Changelog line |
| A contract method | its module (`tip.rs`, `switch.rs`, …) | tests, `contract.ts`, ARCHITECTURE §5 |
| A signed action field | `types.rs` + `actions.rs` + `crypto/actions.ts` | `pnpm gen-vectors`, ARCHITECTURE §4 |
| A cleaning step | `packages/clean` + fixture + test | ARCHITECTURE §6, PRD T2 |
| An API route | `apps/api/src/routes/` behind `noLogs` | ARCHITECTURE §9, no-logs test |
| Anything loaded by a web page | bundled locally only | CSP in `next.config.ts` |
| An env var | where it's read | `.env.example` |

## 7. Naming
- **Rust:** `snake_case` / `PascalCase`; errors `E##_NAME`.
- **TypeScript:** `kebab-case.ts`, `PascalCase.tsx`.
- **Fixtures:** clearly fictional names only.
