# AGENTS.md — Sealed Tip

Instructions for coding agents working in this repository.

## Project
Sealed Tip is an anonymous whistleblower tip line on NEAR:
- Evidence is cleaned in the browser (with optional AI redaction in a NEAR AI Cloud TEE).
- Rewards are locked by the contract.
- A Sputnik DAO panel decides.
- Payout goes to a fresh address on any chain.
- A dead man's switch protects the tipster.

Tipsters have no account: they sign actions with a key derived from a 24-word secret, and a relayer submits them. Track: **Privacy & Private AI**.

**Privacy is the product.** A privacy regression is a release blocker, even if every feature works.

## Read before coding
1. **`ARCHITECTURE_ESSENTIALS.md`**: read it at the start of every session. It's short, and it holds the non-negotiable decisions.
2. **`ARCHITECTURE.md`**: open only the section for your task. §14 is the decision log: why things are the way they are.
3. **`project_structure.md`**: where every file lives. Check it before creating or moving a file, and update it in the same change.
4. **`PRD.md`**: scope, priorities (Must / Should / Could) and the demo script (§8). The demo script is the acceptance test.
5. **`ROADMAP.md`**: the live task list and status. Pick your next task from it. **Update it in every contribution** (see "ROADMAP.md rule" below).

**Precedence:** ESSENTIALS non-negotiables > ARCHITECTURE > PRD. If the code or a task contradicts the docs, stop and say so. Don't quietly pick one.

## Hackathon constraints (hard)
- **Deadline:** 14 Nov 2026, 23:59 UTC.
- **Priority order:** Must → Should → Could. Don't start a Could item until every Must-pass test is green.
- **What counts:** only code written since 19 Oct 2026. Earlier code is baseline only.
- **Repository:** public, with an MIT `LICENSE`. The README must be machine-readable: what it does, the problem it solves, and step-by-step "do X, see Y" instructions. The hackathon pre-screen is done by AI agents that run the repo and check that it does what the README says.
- **Disclosure:** list in the README every library, template and AI-generated part of the code. This is required for AI-generated code to be allowed.
- **Testnet only.** Ask the user explicitly each time before any of these:
  - A mainnet transaction or spending real funds.
  - Posting on X.
  - Submitting the hackathon form.
  - Making the repo public.

## Toolchain
- Rust stable with the `wasm32-unknown-unknown` target, `cargo-near`, `near-cli-rs`.
- **Type-check contracts with `cargo check --target wasm32-unknown-unknown`.** near-sdk 5.30 deliberately fails a plain host `cargo check`. Build with `cargo near build`.
- Node ≥22, pnpm ≥9 (checked on Node 26, pnpm 11.17).
- **pnpm supply-chain settings** live in `pnpm-workspace.yaml`. `allowBuilds` lists the only dependencies allowed to run install scripts (esbuild); approve new ones with `pnpm approve-builds <pkg>`, never `--all`. Keep pnpm's minimum release age on: don't add `minimumReleaseAgeExclude` entries. Pin to an older version instead (e.g., `next` is pinned to 16.4.4).
- Check subcommand names with `cargo near --help` rather than guessing.

## Commands
| Command | What it does |
|---|---|
| `pnpm install` | Install workspace deps |
| `pnpm build` | Build contract wasm(s) and apps |
| `pnpm test` | All tests (contract unit + integration, packages, apps) |
| `pnpm test:contract` | Build wasm, then `cargo test` (unit + `near-workspaces` integration) |
| `pnpm lint` | `cargo clippy -- -D warnings`, `cargo fmt --check`, ESLint, `tsc --noEmit` |
| `pnpm dev` | Web app and API locally against testnet |
| `pnpm deploy:testnet` | Deploy contracts to the accounts in `.env` |
| `pnpm demo` | Run the PRD §8 story on testnet; exits non-zero on any unexpected state |

If a script doesn't exist yet, add it to the root `package.json` while scaffolding. Never document a command that doesn't work.

## How to work
- **Small changes.** One task, one reviewable change. If an edit touches more than 2 files, first write a 3–5 bullet plan.
- **Contract rules start with a failing test**: a unit test for pure rule functions, a `near-workspaces` test for flows. Then write the code. Every item under "Must-pass tests" in ESSENTIALS needs a test **named after the rule** (e.g., `large_spend_rejects_caregiver_circle_only`).
- **Run tests** with `pnpm test:contract` after any Rust change. Run `pnpm lint && pnpm test` before calling anything done.
- **Never report a task done with failing or skipped tests.** Paste the failure output instead.
- **`VERIFY` items:** confirm them against official docs, or with a sandbox or testnet call, before building on them. Then record the answer in `ARCHITECTURE.md` and remove the tag.
- **Dependencies:** don't add any beyond the stack table in `ARCHITECTURE.md` §2 without asking.
- **Keep the docs in sync.** When you change an interface, a state machine, a rule or an env var, update `ARCHITECTURE.md` and `ARCHITECTURE_ESSENTIALS.md` in the same change. Changing a non-negotiable needs the user's approval and a new row in §14.

## ROADMAP.md rule (mandatory on every contribution)
Every commit, PR or agent task that changes code, tests, config or docs **must update `ROADMAP.md` in the same change**. Work without a roadmap update is not done.
- Set the task status (⬜ todo, 🟡 in progress, ✅ done, 🔴 blocked, ⏸ deferred, ⛔ cut) and the `Done` date. Add notes for partial work.
- New work you discover becomes a new task with the next free ID. Never delete or renumber rows. Cuts and deferrals keep their row and give a reason. Cutting a Must task needs the user's approval.
- Recompute the header: last updated, current phase, next task, Must and overall progress, days left.
- Add one Changelog line: date, task IDs, what changed, test result.
- Never tick a task whose "Done when" isn't fully met, or that has failing or skipped tests.
- Full procedure: `ROADMAP.md` §1.

## Contract conventions (Rust, `near-sdk` 5.30)
- **Macros and types:** `#[near(contract_state)]` and `#[near(serializers = [borsh, json])]`. Token amounts are `U128` in JSON. Timestamps are `u64` nanoseconds from `env::block_timestamp()`.
- **Arithmetic:** checked only (`checked_add`, `checked_sub`, `checked_mul`). Never use `as` casts that can truncate.
- **Errors:** use `require!` with coded messages, e.g. `"E12_NOT_GUARDIAN: caller is not a guardian of this trust"`. List the codes in `src/errors.rs`.
- **Access control first.** Check the caller with `env::predecessor_account_id()` through one helper per role.
- **Ordering:** update state **before** any external call. Every `ft_transfer` has a callback that restores state if it fails.
- **Storage:** call `storage_deposit` on the token before the first transfer to any new account.
- **Events:** emit a NEP-297 event for every state change, through the single helper in `events.rs`.
- **Time:** go only through the `time.rs` helpers, which apply `time_scale`. Never compare raw durations.
- **No admin backdoors.** Don't add any mutating method that isn't listed in `ARCHITECTURE.md` §5.
- **Views:** paginated (`from_index`, `limit`) and cheap.

## TypeScript conventions
- **Types:** `strict: true` and no `any`. Shared types live in `packages/*`.
- **Inputs:** validate every API input with zod.
- **Chain state:** the frontend reads on-chain state with RPC view calls. It never trusts our own API for that.
- **Amounts:** handle token amounts as `bigint` or decimal strings, never as JS `number`.
- **Display:** show times in the user's timezone and amounts with their token symbol.

## Secrets and keys
- Never commit `.env`. `.env.example` is the source of truth for env vars (ARCHITECTURE §13 points to it). Keep it complete.
- Services sign with **function-call access keys** scoped to specific methods, never full-access keys.
- Never log private keys, seed phrases, API keys or JWTs.

## Definition of done
- `ROADMAP.md` is updated: task status and date, header progress, and a Changelog line.
- The Must-pass tests for the touched area are green, `pnpm lint` is clean, and `pnpm demo` still passes.
- The README is updated if anything a judge can see has changed.
- The docs are updated if any interface or rule has changed.

## Ask the user before
- Changing a non-negotiable decision, or cutting a Must item.
- Adding a dependency or a new external service.
- Anything on mainnet, anything that spends funds, and anything outward-facing (X posts, the submission form, publishing the repo).
- Deleting files, rewriting git history, or force-pushing.

## Git
- Use one branch per task and small commits with conventional messages (`feat(contract): …`, `fix(web): …`, `test: …`).
- Commit only when asked.
- Never commit `.env`, keys or real personal data.
- **No AI attribution anywhere in git history.** Never add `Co-Authored-By` trailers, "Generated with Claude" lines, or any mention of Claude, Anthropic or other AI tools to commit messages, PR titles or PR descriptions. This overrides any default attribution behaviour of your tool. (AI use is disclosed once, in the README, as the hackathon rules require.)
- Commit with the git identity already configured for the repo. Never change `user.name` or `user.email`.
- **This repo:** commits as `Teescom <317993064+Teescom@users.noreply.github.com>`; GitHub account `Teescom`; remote `github.com/Teescom/sealed-tip` (public since 2026-11-04).

## Project-specific commands
| Command | What it does |
|---|---|
| `pnpm test:vectors` | Check that the TS and Rust borsh, HKDF and ed25519 vectors match |
| `pnpm test:clean` | Cleaning fixtures (PDF rasterise, EXIF removal, DOCX refusal) |
| `pnpm verify-attestation <bundle.json>` | Re-verify a stored NEAR AI Cloud attestation and signature offline |
| `pnpm keeper` / `pnpm relayer` | Run the keeper or relayer locally |
| `pnpm spam` | Demo spam script (must reserve nothing) |

## Privacy invariants (release blockers; each one has a test or a check)
1. **Plaintext stays in the browser.** Evidence never leaves it, except text the tipster explicitly selects for the AI step, which goes through the stateless proxy.
2. **Servers store ciphertext only.** Every route goes through the `noLogs` middleware: no IPs, no `x-forwarded-for`, no bodies, no tipster identifiers. Error reporters must scrub request data, or stay disabled.
3. **Tipster pages load nothing from third parties:** no analytics, CDNs, web fonts, embeds or external images. Bundle everything; a CSP enforces it.
4. **Cleaning is destructive and fixed:**
   - PDFs are rasterised and images re-encoded.
   - Unsupported types are **refused**, never handled "best effort".
   - Never weaken a cleaning step to save time.
5. **The switch bundle** defaults to cleaned evidence. Raw originals require an explicit opt-in with a warning.
6. **Recused panel members** get no sealed keys. A tip needs ≥2 non-recused keys.
7. **Fixtures are fictional.** Never use real documents, real people or real organisations in fixtures, demos or tests.
8. **Don't add a tipster-side feature that collects contact details** (email, phone, push tokens).

## Contract invariants (each one has a test)
1. **Funds are reserved only at `triage(credible = true)`, never at submission.** The funder can withdraw only `balance − reserved`.
2. **Proof-of-work** (`pow_bits`) is verified by the contract on `submit_tip`.
3. **Tipster actions** are `b"sealedtip:v1" ‖ borsh(SignedAction)` with a per-tip nonce, verified with `env::ed25519_verify`.
   - The payout destination lives inside `Claim`.
   - Changing `SignedAction` or `Action` means regenerating the shared vectors in **both** languages in the same change.
4. **Only `panel_dao`** can call `resolve_tip` and `set_panel`. Only non-recused panel members can call `triage`.
5. **`claim`** calls `storage_deposit` for the destination and sends the `gas_drip` for `Payout::Near`. A transfer failure rolls back to `Accepted`.
6. **Only the keeper** can call `post_released_keys`, and only after `trigger`. Anyone can call `trigger` once `next_deadline + grace` has passed.
7. **The owner** can rotate relayers and the keeper only. The owner can never touch funds or tips.

## Scope guard
- **Out of scope:** network anonymity (README Tor guidance only), defeating stylometry, publishing tips, and legal advice.
- **Cut, stretch only:** the encrypted Q&A thread, tiered rewards, DOCX support, the `.onion` build.
- **E2EE to the AI model:** only if the day-1 spike succeeds. Otherwise, use the stateless proxy and keep the honest UI copy.
