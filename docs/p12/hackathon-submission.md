# Sealed Tip — Hackathon Submission Form (NEAR Hackathon 2026)

> **Document Status:** Complete & Ready for Submission  
> **Associated Issue:** #156 (`[P12] Submit the hackathon form`) · **Roadmap Task:** `S-12.9`  
> **Rule Reminder (`AGENTS.md`):** Do not submit the hackathon form without explicit user approval.

---

## 1. Submission Overview & Metadata

* **Project Title:** Sealed Tip
* **Tagline / Short Description:** Pay whistleblowers without ever learning who they are — rewards locked in advance, evidence cleaned in the browser and in a verifiable enclave, payout to any chain, and a dead man's switch.
* **Target Track:** **Privacy & Private AI**
* **Repository URL:** `https://github.com/Teescom/sealed-tip`
* **License:** MIT (`LICENSE` included in repository root)
* **Demo Video URL:** `<INSERT_YOUTUBE_OR_LOOM_LINK>` (≤ 2 minutes, following `docs/p12/demo-video-script.md`)
* **Live Web App URL:** `https://sealed-tip.vercel.app` (testnet)
* **Contract Accounts (Testnet):**
  - **Escrow & Tip Lifecycle Contract:** `sealedtip.st-deployer-f8d075.testnet`
  - **Test Token (tUSDC):** `tusdc.st-deployer-f8d075.testnet`
  - **Panel Sputnik DAO v2:** `st-panel-f8d075.sputnik-v2.testnet`
  - **RPC Endpoint:** `https://rpc.testnet.fastnear.com`

---

## 2. Standard Portal Questions & Answers

### Question 1: What problem does your project solve? (The Problem Statement)
Whistleblowers take immense risks to expose corruption, fraud, and misconduct. However:
1. **Retaliation is rampant:** Empirical surveys (ECI 2023, EY 2024 across 53 countries) show 46% of reporting employees faced workplace retaliation, and nearly one-third feared for their physical safety.
2. **Rewards require exposure:** Legal programmes that pay (e.g. SEC Whistleblower Office, which has awarded ~$1.8B) require claimants to identify themselves to investigators and operators.
3. **Existing platforms fail privacy or incentives:** SecureDrop provides anonymity but no payments; traditional crypto tip lines publish tips publicly, exposing whistleblowers to stylometric and forensic attacks.

A whistleblower is caught in a trap: hand over identifying files to an operator who may renege, or stay silent. If an operator disappears or halts payouts, evidence is buried.

**Sealed Tip solves the whistleblowing dilemma.** It provides a mathematically private, verifiable platform where:
- Plaintext evidence is cleaned before leaving the client device.
- Sensitive text is redacted inside an attested hardware TEE.
- Rewards are locked on NEAR in advance so funders cannot renege.
- Whistleblowers have no on-chain identity and claim funds to fresh burner wallets on any chain.
- An autonomous dead man's switch protects the whistleblower if they go missing.

---

### Question 2: How does Sealed Tip work? (Detailed Technical Description)

Sealed Tip is an end-to-end confidential whistleblowing system built on NEAR:

1. **Zero-Account Architecture:**
   The tipster never connects a Web3 wallet, signs in, or provides an address. Identity consists of 32 random bytes represented as 24 recovery words (BIP39). All actions are signed with an ed25519 key derived via HKDF-SHA256 (`sealedtip/ed25519/v1`). The smart contract verifies signatures on-chain with `env::ed25519_verify`.
2. **Client-Side Destructive Sanitization:**
   Before any upload, the browser strips forensic artifacts:
   - PDFs are rendered to canvas page-by-page and re-encoded into fresh PDFs, removing hidden text revisions, creator metadata, and object streams.
   - Images are re-encoded with EXIF, GPS, and XMP headers destroyed.
   - Optional scan mode thresholding suppresses printer tracking dots (Machine Identification Codes).
   - Unsupported file types (e.g. DOCX with macro and tracking vectors) are refused.
3. **Verifiable Private AI in Hardware TEE (NEAR AI Cloud):**
   Whistleblowers can accidentally identify themselves through distinctive phrasing. Sealed Tip connects directly to a NEAR AI Cloud Intel TDX confidential enclave over OHTTP. The enclave generates redaction suggestions and outputs an Intel TDX hardware attestation quote bound to a client-generated nonce, alongside an ECDSA signature over the request and response bytes. Users can verify the hardware quote offline using `pnpm verify-attestation`.
4. **Trustless Escrow & Sputnik DAO Adjudication:**
   Reward pools are locked by funders in advance. To prevent denial-of-service and front-running:
   - Tips require client-side 12-bit Proof-of-Work verified by the contract.
   - Submissions reserve zero funds. Funds are reserved **only when an appointed reviewer triages a tip as credible**.
   - Review panels are governed by a Sputnik DAO v2 council. A 2-of-3 quorum vote approves the final reward.
   - Tipsters can recuse compromised reviewers; recused members receive zero decryption keys.
5. **Multichain Payouts via 1Click Intents:**
   On testnet, payouts transfer to a fresh implicit NEAR address with an automated gas drip to make it spendable. For multichain rewards, Sealed Tip integrates 1Click Intents: USDC on NEAR is swapped directly into fresh burner addresses on Ethereum, Tron (USDT), or Solana. The destination address is signed inside the tipster's borsh `Claim` payload, preventing relayers from redirecting funds.
6. **Autonomous Dead Man's Switch:**
   If a whistleblower is detained, their switch triggers after `interval + grace` expires. Anyone can call `trigger` on-chain, prompting an autonomous Keeper daemon to re-seal the switch encryption keys to non-recused panel members. By default, only sanitized evidence is released.

---

### Question 3: What are the key Privacy Invariants of Sealed Tip?

Privacy is the primary product requirement. The architecture enforces 8 non-negotiable invariants:
1. **Plaintext stays in the browser:** Evidence never leaves the client unencrypted, except text explicitly sent to the attested TEE.
2. **Servers store ciphertext only:** All APIs run through `noLogs` middleware, stripping forwarding headers (`x-forwarded-for`, `x-real-ip`). Blobs are keyed strictly by `sha256(ciphertext)`.
3. **Zero third-party assets:** Tipster web pages load zero external CDNs, fonts, or tracking scripts under a strict Content-Security-Policy (CSP) with dynamic per-request nonces.
4. **Destructive cleaning:** PDFs are rasterized and images re-encoded; unsupported formats are rejected.
5. **Sanitized switch bundles:** The dead man's switch defaults to sanitized evidence; raw originals require explicit, informed opt-in.
6. **Recusal enforcement:** Recused reviewers receive no decryption keys and are barred from triage by smart contract guards.
7. **Fictional fixtures:** All tests, demos, and screenshots use 100% fictional data.
8. **Zero contact collection:** No email, phone numbers, or push tokens are ever requested or stored.

---

### Question 4: How can judges test and verify your project? ("Do X, See Y")

Judges can verify our entire protocol, cryptographic proofs, and acceptance stories locally or on testnet.

#### Quickstart: Offline Reproducible Test Suite
```bash
git clone https://github.com/Teescom/sealed-tip.git
cd sealed-tip
pnpm install
pnpm build:contract      # Builds sealedtip.wasm (272 KB) & mock_ft.wasm (151 KB)
pnpm test                # 258 Rust tests + 418 TypeScript tests (0 skipped, 0 failing)
pnpm lint                # cargo fmt, clippy, eslint, tsc -b
pnpm demo                # Full PRD §8 acceptance story in ~3.5s (offline simulation)
pnpm spam                # 20 junk submissions: proves 0 funds reserved for spam
```

#### Hardware TEE Attestation Verification
Verify a real Intel TDX attestation quote from NEAR AI Cloud:
```bash
pnpm verify-attestation -- --fetch deepseek-ai/DeepSeek-V4.1-Flash-1017
# -> 54+ green checks: DCAP quote valid, report_data bound to nonce, ECDSA signature verified
```

#### Live Testnet Exploration
- **Deployed Escrow Contract:** `sealedtip.st-deployer-f8d075.testnet`
- **Sputnik DAO Council:** `st-panel-f8d075.sputnik-v2.testnet`
- **Web App:** Visit `https://sealed-tip.vercel.app` (or `http://localhost:3000` via `pnpm relayer && pnpm --filter @sealedtip/web dev`):
  1. Open Programme 1 (`/p/1`): Inspect on-chain locked bounty.
  2. Go to `/submit/1`: Upload a dirty PDF; inspect the instant client-side cleaning report.
  3. View `/panel`: Observe reviewer triage and cryptographic recusal separation.
  4. View `/claim`: Test recovery phrase validation and multichain payout quotes.

---

### Question 5: What libraries, templates, and AI tools were used? (Mandatory Disclosure)

In full compliance with hackathon rules, all libraries, dependencies, and AI tooling are disclosed:

* **Rust (Smart Contracts):**
  - `near-sdk` 5.30 & `near-contract-standards` 5.30
  - `serde_json` 1.0 (dev)
  - `near-workspaces` 0.24 & `near-sandbox` 2.14 (dev, integration tests)
  - `ed25519-dalek` 2.2 (dev, test vector validation)
* **TypeScript & Web:**
  - `@scure/bip39` 2.4 (24 words ↔ 32 bytes entropy)
  - `@noble/hashes` 2.4 (HKDF-SHA256, sha256, keccak-256)
  - `@noble/ed25519` 3.2 (client ed25519 action signing)
  - `@noble/curves` 2.2 (secp256k1 signature recovery for TEE hardware responses)
  - `libsodium-wrappers` 0.8 (XChaCha20-Poly1305 bundle encryption and X25519 sealed boxes)
  - `pdfjs-dist` 6.5 & `pdf-lib` 1.17 (PDF rendering and rebuilding)
  - `exifr` 7.1 (EXIF / GPS / XMP parsing)
  - `next` 16.4.4 & `react` 19.3.1 (Web application framework)
  - `tailwindcss` 4.3 (styling)
  - `hono` 4.13 (stateless API & relayer proxy)
  - `zod` 4.6 (schema validation)
* **Vendored Artifacts:**
  - Sputnik DAO v2 wasm (`contracts/sealedtip/res/sputnikdao2.wasm`, verified and pinned in `SPUTNIK_VERSION.txt`).
* **Zero-Dependency Implementations:**
  - OHTTP, HPKE, and BHTTP browser spike implemented directly on Web Crypto `crypto.subtle`.
  - Borsh action encoder hand-rolled in `@sealedtip/crypto` to handle fieldless Rust enum variants cleanly.
* **AI Tooling Disclosure:**
  - Code, documentation, and tests were co-authored with AI coding agents (Qoder / Gemini / Claude) following strict specifications in `AGENTS.md`, `ARCHITECTURE.md`, and `ROADMAP.md`.
  - Maintainer owns architecture, code review, manual verification, testnet deployments, and secret management. Commits carry zero AI attribution trailers.
* **Single Project Entry:**
  - Sealed Tip is our sole entry in the NEAR Hackathon 2026.

---

### Question 6: Track Alignment (Why "Privacy & Private AI"?)

Sealed Tip embodies the core vision of NEAR's Privacy & Private AI track:
1. **Verifiable Confidential AI:** Rather than treating AI as a trusted black box, Sealed Tip uses NEAR AI Cloud hardware TEEs with cryptographic Intel TDX quotes and ECDSA signatures, proving that model inference occurred inside a secure enclave without data retention.
2. **On-Chain Privacy:** NEAR smart contracts verify zero-account cryptographic signatures, enforce reviewer recusal, and manage escrow without ever collecting or storing identifying tipster information.
3. **Decentralized Whistleblowing Infrastructure:** Solves a major real-world public goods problem by unifying confidential AI, on-chain governance (Sputnik DAO), and multichain intents (1Click).
