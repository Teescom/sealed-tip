# Sealed Tip — Session Handoff & Testnet Verification Report

> **Superseded 2026-11-13.** This file records the 2026-11-10 session and is kept as history, not as status.
> Three of its claims no longer hold: the five "open issues" it lists are all closed (the repo has 0 open issues),
> Vercel is deployed (`https://sealed-tip-ten.vercel.app` answers 200), and the canonical deployment is
> `st-hack-f8d075.testnet` — the coordinates below under `st-deployer-f8d075.testnet` are a retired earlier
> deployment that no key here opens. For current status read the header of `ROADMAP.md`; for the live evidence read
> the 2026-11-13 Changelog entries and `scripts/live-e2e.ts`.



**Date:** 2026-11-10  
**Phase:** Phase 12 (Outward Launch & Testnet Verification)  
**Status:** Must 90/104 (87%) · Overall 94/111 (85%)  
**Head Commit:** `68d0eae`

---

## 1. Executive Summary

This report records the complete technical execution, on-chain testnet deployment, live transaction verifications, and exact repository status for Sealed Tip.

Across this session and preceding milestones:
1. **Fresh Automated Testnet Deployment:** Initialized, funded, and deployed a self-contained testnet infrastructure suite under `st-deployer-f8d075.testnet`.
2. **On-Chain Contracts & Sputnik DAO:** Successfully deployed both contracts (`sealedtip` and `mock-ft` tUSDC) and seeded a fresh Sputnik DAO v2 council (`st-panel-f8d075.sputnik-v2.testnet`). Created Programme #0 with 1,000 tUSDC escrow and approved panel appointment proposal #0 on-chain.
3. **Live Relayer Queue Rotation (Issue #116 / S-8.4 ✅):** Verified live alternating submission between Relayer A (`rel1`) and Relayer B (`rel2`) on NEAR testnet with on-chain cryptographic proof and closed GitHub Issue #116.
4. **Live Keeper Heartbeat (S-9.1 ✅):** Executed on-chain `heartbeat()` transaction updating `keeper_last_seen` timestamp and emitting `keeper_heartbeat` event on NEAR testnet.
5. **1Click Cross-Chain Quote Proxy (Issue #118 / S-8.6 ✅):** Verified live dry-run quotes via upstream 1Click Defuse API returning HTTP 201 with signed rates across Ethereum, Tron, and Arbitrum. Closed GitHub Issue #118.
6. **Phase 12 Outward Launch Documentation Suite:** Authored complete launch assets aligned with PRD §8 and privacy invariants:
   - `docs/p12/demo-video-script.md`: ≤2-minute video script & scene-by-scene storyboard.
   - `docs/p12/hackathon-submission.md`: Comprehensive hackathon submission Q&A answers.
   - `docs/p12/vercel-deployment.md`: Step-by-step production deployment guide.
   - `docs/p12/x-post.md`: 6-post announcement thread.
7. **Quality & CI Gates:** 100% green across all 258 Rust tests, 418 TypeScript tests, `pnpm lint`, `pnpm build`, and `pnpm demo` (8/8 acceptance steps in 1.71s).

---

## 2. Live Testnet Deployment Topology

All accounts, contracts, and DAO entities are live on NEAR Testnet:

### Accounts & Contracts
- **Root Deployer:** `st-deployer-f8d075.testnet` (funded via testnet faucet)
- **Sealed Tip Contract:** `sealedtip.st-deployer-f8d075.testnet` (275,380 bytes wasm deployed, `new()` called)
- **Mock Token (tUSDC):** `tusdc.st-deployer-f8d075.testnet` (152,415 bytes wasm deployed, `new()` called, 6 decimals)
- **Sputnik DAO v2:** `st-panel-f8d075.sputnik-v2.testnet` (6 NEAR bond, council policy configured)
- **Relayer A:** `rel1.st-deployer-f8d075.testnet`
- **Relayer B:** `rel2.st-deployer-f8d075.testnet`
- **Keeper:** `keeper.st-deployer-f8d075.testnet`
- **Funder:** `funder.st-deployer-f8d075.testnet`
- **Panel Members:**
  - `panel1.st-deployer-f8d075.testnet`
  - `panel2.st-deployer-f8d075.testnet`
  - `panel3.st-deployer-f8d075.testnet`

### Verified On-Chain Transactions
- **Contract Deployment:**
  - `tusdc` deploy & init: `8cCzYuqqib2qd6AorJq1kBSErC2BKGwZMpPBAmZ4G8an`
  - `sealedtip` deploy & init: `GsBKbSRGook1LxNiHsX94p7GVdj4t3hqD8GqgEqNsksm`
- **Sputnik DAO Council Vote & Appointment:**
  - Vote Approve (`panel2`): `3LJNGVpF7Nyhvz...`
  - Vote Approve (`panel3`): `DuTqQuapP2se...`
  - Emitted `panel_set` event on `sealedtip` contract.
- **Relayer Alternation (Issue #116 / S-8.4):**
  - Action 1 via Relayer A (`rel1`): `5eLmJZf8PeUvco8Mm7bCifyLzQ8YvQAwnCbFkypvY5R8`
  - Action 2 via Relayer B (`rel2`): `Awgor7PH36QSUsFWqXQNsEaQfrQJaLxEq5w6k8wDQMRd`
- **Keeper Heartbeat (S-9.1):**
  - Keeper `heartbeat()` call: `9X9YNrJrRXskeMKUBTyHaftdwwJRhQYhmhhDTLxWnqvQ`
  - Updated `keeper_last_seen` to `1794322241645617862`.

---

## 3. Test & Verification Matrix

All gates were re-measured and verified locally:

| Suite | Command | Result | Details |
|---|---|---|---|
| **Contract Unit & Integration Tests** | `cargo test --workspace` | **258 / 258 pass** | 176 unit tests + 82 integration tests across 15 binaries. 0 failed, 0 skipped. |
| **Sandbox Concurrency** | `cargo test -p sealedtip --test switch` | **7 / 7 pass** | Verified dead man's switch lifecycle, check-ins, grace periods, and keeper releases. |
| **TypeScript Workspace Tests** | `pnpm -r test` | **418 / 418 pass** | 344 `node:test` + 74 `vitest` (`apps/web`). 0 failed, 0 skipped. |
| **Lint & Format** | `pnpm lint` | **Exit 0** | `cargo fmt --check`, `clippy --all-targets -D warnings`, `eslint .`, `tsc -b`. |
| **Build & Optimization** | `pnpm build` | **Exit 0** | Production wasms optimized with `wasm-opt`; Next.js static and dynamic routes compiled. |
| **Acceptance Demo (PRD §8)** | `pnpm demo` | **8 / 8 pass** | Completed all 8 acceptance steps in **1.71 s** (target: < 360 s). |

---

## 4. Current State & Where We Stood

As of this handoff, **only 5 issues remain open** on GitHub across the entire repository. All 5 are outward-facing or human-gated steps that require external account actions or user approvals:

| Issue | Title | Status | Required Next Action |
|---|---|---|---|
| **#5** | `[P0] $1 mainnet check of the 1Click deposit method` | Gated by Mainnet funds | User explicit approval to spend $1 real funds on NEAR mainnet via `scripts/verify-1click-mainnet.ts`. |
| **#153** | `[P12] Deploy the web app to Vercel` | Guide ready | Follow [`docs/p12/vercel-deployment.md`](file:///home/gamp/sealed-tip/docs/p12/vercel-deployment.md) to link GitHub repository in Vercel dashboard and add public env vars. |
| **#154** | `[P12] Record the demo video` | Script ready | Record a ≤2-minute screen walkthrough following the scene breakdown in [`docs/p12/demo-video-script.md`](file:///home/gamp/sealed-tip/docs/p12/demo-video-script.md). |
| **#155** | `[P12] Draft the X post` | Copy ready | Post the 6-tweet announcement thread in [`docs/p12/x-post.md`](file:///home/gamp/sealed-tip/docs/p12/x-post.md) from the official project account. |
| **#156** | `[P12] Submit the hackathon form` | Answers ready | Fill out Devpost / hackathon submission form using the prepared fields in [`docs/p12/hackathon-submission.md`](file:///home/gamp/sealed-tip/docs/p12/hackathon-submission.md). |

---

## 5. Handoff Checklist for Next Agent / Maintainer

1. **Vercel Deploy (#153):**
   - Connect `https://github.com/Teescom/sealed-tip` on Vercel.
   - Configure Root Directory: `apps/web`.
   - Set environment variables as documented in `docs/p12/vercel-deployment.md`.
2. **Demo Video (#154):**
   - Use testnet web deployment or local `pnpm dev` (`http://localhost:3000`).
   - Run through the 5 scenes in `docs/p12/demo-video-script.md`.
3. **Hackathon Submission (#156):**
   - Review tracks: Privacy & Private AI (Primary).
   - Paste prepared text from `docs/p12/hackathon-submission.md`.
