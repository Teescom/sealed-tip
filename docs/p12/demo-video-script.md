# Sealed Tip — Demo Video Storyboard & Script (≤ 120 Seconds)

> **Document Status:** Complete & Ready for Recording  
> **Associated Issue:** #154 (`[P12] Record the demo video (≤ 2 min)`) · **Roadmap Task:** `S-12.6`  
> **Acceptance Criterion:** Strict runtime ≤ 120 seconds. Demonstrates PRD §8 end-to-end with fictional test files.

---

## 1. Technical Specs & Recording Guidelines

- **Target Duration:** Exactly 1 minute 55 seconds (115 seconds, leaving a 5-second buffer under the 120-second cap).
- **Target Spoken Word Count:** ~245 words (paced at ~130 words/minute for clear, measured delivery).
- **Resolution:** 1080p (1920x1080) at 60 fps.
- **Audio:** High-fidelity voiceover, subtle low-frequency background ambient synth ducked at -24 dB during voiceover.
- **Privacy Enforcement (`AGENTS.md` Invariant 7):** All documents, names, and organizations are 100% fictional (`Clean Roads Fund`, `invoice_fictional.pdf`, author `J. Okafor`, `Lokoja annex`). No real credentials, private keys, or personal identifiers appear on screen.

---

## 2. Timed Scene-by-Scene Storyboard

```
Total Runtime: 01:55 (115 seconds)
```

### Scene 1: The Whistleblower Dilemma (0:00 – 0:12 | 12s)
* **Visual Cue:** Fast cinematic title card: "Sealed Tip — Anonymous Whistleblower Tip Line on NEAR". Cuts to a split screen illustrating the dilemma: existing whistleblower programs require KYC identity; anonymous leaks leave whistleblowers unpaid and unprotected.
* **On-Screen Text Overlay:** *Whistleblowers risk retaliation. Identity leaks ruin lives.*
* **Voiceover (VO):**
  > "Whistleblowers risk everything to expose corruption, but claiming a reward almost always requires revealing your identity. Sealed Tip solves this: private evidence cleaning, verifiable AI redaction, guaranteed escrow, and multichain payouts."

---

### Scene 2: Programme Setup & Funder Escrow (0:12 – 0:24 | 12s)
* **Visual Cue:** Screen capture of the Programme View (`/p/1` or `/programmes/new`). Funder "Clean Roads Fund" has created "Road contract fraud — Fictional State", depositing 5,000 tUSDC with a 1,000 max reward locked in on-chain escrow.
* **On-Screen Text Overlay:** *Step 1: On-Chain Escrow Locked in Advance (tUSDC)*
* **Voiceover (VO):**
  > "Programmes are funded upfront. Here, an audit fund locks 5,000 USDC in smart contract escrow on NEAR, with a 1,000 USDC maximum reward. Funds cannot be clawed back once a tip is marked credible."

---

### Scene 3: Tipster Onboarding & Client-Side Cleaning (0:24 – 0:40 | 16s)
* **Visual Cue:** Browser navigates to `/submit/1`. Tipster receives 24 recovery words (no wallet connection, no account). Tipster drags in `invoice_fictional.pdf` and a photo. Instantly, the UI shows the Cleaning Report: PDF rasterized into images, EXIF GPS coordinates stripped, author "J. Okafor" removed.
* **On-Screen Text Overlay:** *Step 2: No Account. 100% Client-Side Metadata Stripping.*
* **Voiceover (VO):**
  > "The tipster connects no wallet—identity is 32 random bytes as 24 words. In the browser, evidence is cleaned destructively: PDFs are rasterized, EXIF and GPS data are stripped, and printer tracking dots are neutralized. Plaintext never leaves the device."

---

### Scene 4: Verifiable AI Redaction inside TEE (0:40 – 0:54 | 14s)
* **Visual Cue:** Tipster reviews text. AI redaction highlights identifying phrasing: *"as the only procurement officer in the Lokoja annex"*. Tipster accepts the redaction. The `AttestationPanel` pops open, displaying green checkmarks: Intel TDX quote verified, client nonce matched, ECDSA hardware signature valid.
* **On-Screen Text Overlay:** *Step 3: Confidential AI Redaction (NEAR AI Cloud Intel TDX Enclave)*
* **Voiceover (VO):**
  > "For stylometry, the tipster can redact text via NEAR AI Cloud in an Intel TDX hardware enclave. An attestation report proves the exact model and output with a hardware signature verifiable offline."

---

### Scene 5: PoW Submission & Anti-Spam (0:54 – 0:66 | 12s)
* **Visual Cue:** Tipster recuses panel member #3 (`panel3.testnet`). Client solves 12-bit Proof-of-Work in under a second. Action is signed with derived ed25519 key and submitted through a stateless relayer with noLogs. Screen cuts to a terminal running `pnpm spam`: 20 junk submissions fail PoW or triage, reserving 0 funds.
* **On-Screen Text Overlay:** *Step 4: Recusal, 12-bit Client PoW, Zero Spam Reservations*
* **Voiceover (VO):**
  > "The tipster recuses conflicted panel members and computes a client-side proof-of-work. A relayer forwards the submission with a random timing delay, logging zero IP data. Spam submissions reserve zero funds."

---

### Scene 6: Panel Triage & Escrow Reservation (0:66 – 0:78 | 12s)
* **Visual Cue:** Reviewer logs into `/panel` with `panel1.testnet`. Opens encrypted bundle using their X25519 key (recused member cannot open). Reviewer marks tip as Credible. UI shows 1,000 tUSDC instantly reserved on-chain. Funder attempts to withdraw funds; contract blocks withdrawal (`E16_RESERVED_FUNDS`).
* **On-Screen Text Overlay:** *Step 5: Triage Reserves Reward — Funder Cannot Withdraw*
* **Voiceover (VO):**
  > "A panel reviewer decrypts the bundle and marks the tip credible. The contract immediately locks 1,000 USDC. Even if the funder tries to withdraw their balance, the contract protects the tipster's bounty."

---

### Scene 7: Sputnik DAO Adjudication (0:78 – 0:88 | 10s)
* **Visual Cue:** Screen shows Sputnik DAO v2 council interface. Council members vote 2-of-3 on proposal: "Accept tip #1, reward 800 tUSDC". Proposal passes. Contract updates status to `Accepted`. Unused 200 tUSDC is released back to funder.
* **On-Screen Text Overlay:** *Step 6: Sputnik DAO v2 Council Approval (2-of-3 Quorum)*
* **Voiceover (VO):**
  > "Governance is decentralized: a Sputnik DAO panel votes to approve an 800 USDC reward, and the remaining 200 USDC reserve is returned to the pool."

---

### Scene 8: Anonymous Payout via 1Click Intents (0:88 – 1:02 | 14s)
* **Visual Cue:** Tipster navigates to `/claim`. Enters 24 recovery words. Signs claim payload. Shows testnet claim to fresh implicit NEAR account with automated gas drip. Then switches toggle to show 1Click Intents cross-chain quote: swaps USDC on NEAR to fresh USDT on Tron or ETH.
* **On-Screen Text Overlay:** *Step 7: Anonymous Claim — NEAR Implicit Account or Multichain Intents*
* **Voiceover (VO):**
  > "The tipster claims the reward using their 24 words. On testnet, funds arrive at a fresh implicit address with a gas drip. On mainnet, 1Click Intents bridges the reward to fresh burner addresses on Tron, Ethereum, or Solana."

---

### Scene 9: Dead Man's Switch & Outro (1:02 – 1:15 | 13s)
* **Visual Cue:** Fast demonstration of the Dead Man's Switch: Tipster sets 2-minute interval. Tipster goes dark; timer expires. Anyone calls `trigger` on-chain. Autonomous keeper daemon detects trigger and re-seals cleaned evidence to panel members. Final title screen with repository URL, test suite stats, and MIT license.
* **On-Screen Text Overlay:** *Step 8: Autonomous Dead Man's Switch · 258 Rust Tests · 418 TS Tests · MIT*
* **Voiceover (VO):**
  > "If a whistleblower is detained, their dead man's switch triggers, and an autonomous keeper releases sanitized evidence to the panel. Sealed Tip: true whistleblower protection on NEAR. Fully tested, open source, and live on testnet."

---

## 3. Video Production Checklist & Cue Sheet

| Time | Visual / Capture Source | Audio / Narration Focus | PRD §8 Alignment |
|---|---|---|---|
| **0:00 – 0:12** | Intro slide + Problem diagram | Problem Statement & Privacy thesis | Intro / Motivation |
| **0:12 – 0:24** | Web UI: `/p/1` (Programme & Escrow) | 5,000 tUSDC deposited, max reward 1,000 | Step 1: Programme setup |
| **0:24 – 0:40** | Web UI: `/submit/1` + Cleaning View | 24 words, PDF rasterization, EXIF strip | Step 2 & 3: Sanitization |
| **0:40 – 0:54** | Web UI: `AttestationPanel` | Intel TDX quote, nonce match, signature | Step 3: TEE attestation |
| **0:54 – 1:06** | Web UI + CLI: `pnpm spam` | 12-bit PoW, relayer delay, spam check | Step 4: Submission & Anti-spam |
| **1:06 – 1:18** | Web UI: `/panel` review | Credible triage, 1,000 reserved, withdraw blocked | Step 5: Triage & Reservation |
| **1:18 – 1:28** | Sputnik DAO voting UI | 2-of-3 council vote, 800 reward approved | Step 6: DAO Resolution |
| **1:28 – 1:42** | Web UI: `/claim` | 24 words claim, gas drip, 1Click multichain | Step 7: Anonymous Claim |
| **1:42 – 1:55** | Web UI: Switch + Outro slide | Dead man's switch release, Keeper, GitHub repo | Step 8: Dead Man's Switch |

---

## 4. Subtitle Track (.SRT Format Reference)

```srt
1
00:00:00,000 --> 00:00:05,500
Whistleblowers risk everything to expose misconduct, but claiming rewards requires revealing identity.

2
00:00:05,500 --> 00:00:12,000
Sealed Tip solves this: private evidence cleaning, verifiable AI, guaranteed escrow, and multichain payouts.

3
00:00:12,000 --> 00:00:18,500
Programmes are funded upfront with 5,000 USDC locked in smart contract escrow on NEAR.

4
00:00:18,500 --> 00:00:24,000
Funds cannot be withdrawn once a tip is triaged as credible.

5
00:00:24,000 --> 00:00:30,000
The tipster has no account: identity is 32 random bytes stored as 24 recovery words.

6
00:00:30,000 --> 00:00:36,000
Evidence is cleaned in the browser: PDFs rasterized, EXIF stripped, tracking dots neutralized.

7
00:00:36,000 --> 00:00:40,000
Plaintext never leaves the device.

8
00:00:40,000 --> 00:00:47,000
AI redaction runs in a NEAR AI Cloud Intel TDX enclave with cryptographic hardware attestation.

9
00:00:47,000 --> 00:00:54,000
Hardware quotes and signatures are verifiable offline with our open-source tools.

10
00:00:54,000 --> 00:01:00,000
The tipster solves a 12-bit client PoW and submits via a relayer that logs zero IP data.

11
00:01:00,000 --> 00:01:06,000
Spam submissions are rejected or dismissed, reserving zero funds.

12
00:01:06,000 --> 00:01:12,000
A panel reviewer decrypts the evidence and marks it credible, locking 1,000 USDC in escrow.

13
00:01:12,000 --> 00:01:18,000
The funder cannot withdraw backing funds. Recused members receive zero decryption keys.

14
00:01:18,000 --> 00:01:24,000
A Sputnik DAO v2 council votes 2-of-3 to approve an 800 USDC reward for the whistleblower.

15
00:01:24,000 --> 00:01:28,000
The remaining reserve is automatically released back to the funder.

16
00:01:28,000 --> 00:01:35,000
The tipster claims via 24 words to a fresh implicit NEAR address with automated gas drip.

17
00:01:35,000 --> 00:01:42,000
Or bridges directly to fresh burner addresses on Tron, Ethereum, or Solana via 1Click Intents.

18
00:01:42,000 --> 00:01:48,000
If the whistleblower goes missing, an autonomous Dead Man's Switch triggers key release.

19
00:01:48,000 --> 00:01:55,000
Sealed Tip: verifiable privacy on NEAR. Fully tested, open source, and live on testnet.
```
