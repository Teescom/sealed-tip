# Sealed Tip — Product Requirements Document

> Pay whistleblowers without ever learning who they are.
> NEAR Hackathon 2026 · Primary track: **Privacy & Private AI** · Secondary: Social Money, Open Innovation
> Build window: 1–14 Nov 2026 (submission deadline 14 Nov 23:59 UTC)

---

## 1. Problem

Whistleblowers expose corruption and fraud, but they're punished for it and often never paid.

- Nigeria's 2016 whistleblower policy promises 2.5–5% of recovered funds, but it's a policy, not a law, so it gives no protection against retaliation. Critics say delayed or unpaid rewards have been "rampant". In March 2026 the EFCC chair called for a law to stop the victimisation of whistleblowers.
- 46% of employees who reported misconduct faced retaliation (ECI 2023). Almost a third of respondents feared for their personal safety (EY 2024, 53 countries). 49% of Europeans call fear of retaliation the biggest barrier to reporting (NAVEX).
- Reward programmes that do pay (e.g., the SEC's reported $1.8B since 2012) require the whistleblower to identify themselves. Paying a reward without exposing identity is described as an **unsolved problem** (Starknet RFP).

Today's options:
- **SecureDrop:** anonymous, but pays nothing.
- **Government programmes:** pay, but require identity and can renege.
- **Old crypto tip lines:** pay, but published every tip publicly.

## 2. Product in one sentence

An anonymous tip line where evidence is cleaned of identifying details by an AI running in a verifiable secure enclave, rewards are locked in a contract before any tip arrives, a review panel decides, the whistleblower is paid to a fresh address on any chain, and a dead man's switch makes harming them pointless.

## 3. Users

| Persona | Who | What they need |
|---|---|---|
| **Whistleblower (Tipster)** | Employee, civil servant, contractor with evidence of wrongdoing | Submit without an account, wallet or crypto; be sure nothing identifies them; get paid privately; protection if threatened |
| **Funder** | Anti-corruption NGO, media foundation, company ethics fund, DAO | Create a bounty programme with clear rules; know funds only go to verified tips |
| **Panel** | Journalists / NGO investigators (Sputnik DAO members) | See cleaned evidence, ask questions, vote accept/reject, set reward within the rules |
| **Public** | Anyone | See programmes, locked funds, number of tips, outcomes, and that rewards were paid; never see tipster data |
| **Judge / reviewer** | Hackathon judges + AI screeners | Run the full flow on testnet with fictional evidence; verify the TEE attestation |

## 4. Goals and non-goals

**Goals (hackathon scope)**
1. Programmes with rewards **locked up front**; funders can't withdraw funds reserved for tips under review.
2. Account-less submission: browser generates a claim key; a relayer pays gas.
3. Two-stage cleaning: deterministic metadata stripping **in the browser**, then AI redaction of identifying content by a TEE model on NEAR AI Cloud with attestation shown.
4. Evidence encrypted client-side; panel reads only the cleaned version.
5. Panel decision through Sputnik DAO; reward set within programme bounds.
6. Claim with a signature over the payout destination (can't be redirected); payout to a fresh NEAR account or any chain via NEAR Intents (mainnet).
7. Dead man's switch: missed check-ins release the switch bundle (cleaned by default) to the non-recused panel.
8. Public programme pages with zero tipster data.

**Non-goals**
- Network-level anonymity (we instruct users to use Tor; we don't build it).
- Legal advice, or deciding whether a disclosure is lawful.
- Publishing tips publicly.
- Off-ramp to bank accounts.
- Defeating stylometry or "only 3 people knew this" inference — we warn, we can't solve it.

## 5. Core user stories

### Tipster
- T1. I open a programme page, read the rules and the locked reward, and press "Submit a tip". No login.
- T2. I add PDFs or images (Word files are refused with "export as PDF"). The page rebuilds every PDF from page images and re-encodes every photo locally, which destroys hidden metadata and old revisions. It shows me what was removed (author, GPS, device, edit history). For scans and printouts, an optional scan mode suppresses printer tracking dots, and I'm warned that this isn't guaranteed.
- T3. Optionally, I pick text for the AI to check. It flags phrases that could identify me ("as the only accountant in the Kano office…"). I accept or edit each suggestion, and a "Verified secure enclave" panel shows the attestation. The page tells me plainly that the text I choose passes through Sealed Tip's no-logs proxy.
- T4. My browser creates a **claim secret** shown as 24 words, with an optional passphrase. That's my only link to the tip, and I'm told to save it offline.
- T5. I optionally turn on the dead man's switch: check in every N days, or the switch bundle goes to the panel. By default that bundle is the **cleaned** evidence plus my full description. Raw originals go only if I explicitly opt in.
- T6. I check status with my 24 words.
- T9. I can exclude panel members I believe are involved. They never get a key to my evidence.
- T10. My submission and check-ins are sent after a random delay, so the timing doesn't point to me.
- T7. If accepted, I claim the reward to a **new** address on the chain I choose (USDT on Tron, BTC, NEAR…) without revealing anything else.
- T8. I can retract my tip before review ends.

### Funder
- F1. I create a programme: title, scope, reward rule (fixed or tiered, max per tip), review period, panel DAO, and deposit funds.
- F2. I can't withdraw funds reserved for tips under review; I can withdraw the unreserved balance after closing.

### Panel
- P1. I register my encryption public key (via DAO proposal).
- P2. I see a queue of tips with cleaned evidence decrypted locally in my browser.
- P3. I triage each new tip as credible or not. Only credible tips reserve reward funds, so spam can't lock the pool.
- P4. I propose accept (with any reward ≤ max) or reject through the DAO. Once it passes, the contract records it.

### Public
- U1. Programme page shows funds locked, tips received, accepted/rejected counts, rewards paid (amounts, not recipients' identities beyond fresh addresses), and the panel members.

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| F1 | Programme with `max_reward`, `panel_dao`, token funds via `ft_transfer_call`, NEAR `ops_balance` for storage and gas drips | Must |
| F2 | Reserve-on-triage: a panel member marks a tip credible, which reserves `max_reward` (or `Unfunded` if short); funder can withdraw only unreserved funds | Must |
| F3 | Submission via an allow-listed relayer (2 instances) with a random delay; the contract verifies proof-of-work and the tipster's signature | Must |
| F4 | Browser cleaning: rasterise PDFs, re-encode images, optional scan mode, refuse other types; show a report of what was removed | Must |
| F5 | Optional AI identity-risk redaction via a NEAR AI Cloud TEE model through a stateless proxy; attestation plus response signature verified and displayed | Must |
| F6 | Client-side encryption: bundle encrypted with K; K sealed to each non-recused panel member (≥2) | Must |
| F7 | Panel decision only through `panel_dao` (Sputnik FunctionCall proposal) | Must |
| F8 | Tipster actions are signed borsh structs (ed25519, per-tip nonce); the payout is bound in the claim signature | Must |
| F9 | Payout to a fresh NEAR account (testnet, with `storage_deposit` plus gas drip) or a 1Click deposit address (mainnet) | Must |
| F10 | Dead man's switch: signed `checkin`, `trigger` by anyone after deadline + grace, keeper releases the cleaned switch bundle (raw only by opt-in); keeper heartbeat shown publicly | Must |
| F11 | Recusal of panel members at submission | Must |
| F12 | Retract before decision | Should |
| F13 | Tipster signs a statement to reveal their identity later (`sign-statement` script) | Should |
| F14 | Encrypted Q&A between panel and tipster; `.onion` static build | Could |

## 7. Non-functional requirements

- **No tipster PII server-side**: the relayer and API don't log IPs or bodies; documented and visible in code (`NO_LOGS` middleware + tests).
- **Plaintext never leaves the browser** except to the attested TEE model (E2EE where supported; otherwise a stateless proxy, stated as a trust assumption).
- **Funds can't be redirected**: payout is bound by the tipster's signature.
- **Rewards can't be reneged on**: reservation is enforced by the contract.
- **Reproducible**: `pnpm demo` runs the full story with fictional documents.

## 8. Demo script (what judges will see)

1. Funder "Clean Roads Fund" creates a programme "Road contract fraud — Fictional State", deposits 5,000 tUSDC, max reward 1,000.
2. Tipster uploads `invoice_fictional.pdf` (hidden author "J. Okafor", creation software, an incremental-update revision) and a phone photo with GPS EXIF.
3. Browser rebuilds the PDF from page images, re-encodes the photo, and shows what was removed. The AI flags "as the only procurement officer in the Lokoja annex", and the tipster accepts the redaction. Attestation panel: ✓ Intel TDX quote, ✓ nonce bound, ✓ response signature. The tipster recuses one panel member.
4. Tip submitted via relayer (no wallet, demo delay of a few seconds). A spam script sends 20 junk submissions: they fail the proof-of-work or are dismissed at triage, and reserve nothing.
5. A panel member triages the real tip as credible, which reserves 1,000 tUSDC. The funder tries to withdraw everything and fails. The recused member has no key and can't open the evidence.
6. DAO proposal "accept tip #1, reward 800" passes → tip Accepted.
7. Tipster claims to a brand-new testnet account using the recovery phrase → paid. Mainnet path shown via a real 1Click dry-run quote (USDC on NEAR → USDT on Tron).
8. Second tip with a dead man's switch (interval 2 min). The tipster stops checking in, anyone calls `trigger`, and the keeper releases the switch-bundle key. The panel can now open the **cleaned** bundle and full description, with no raw files because the tipster didn't opt in.

## 9. Success metrics (hackathon)

- Every README claim maps to a test (contract integration tests + browser stripping unit tests with fixture files).
- An external verifier can re-check the stored attestation JSON with the documented script.
- Full demo < 6 minutes.

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| Stylometry / insider-knowledge identification | AI warns; README is explicit that this can't be fully solved |
| IP address exposure | Tor guidance; relayer doesn't log; static site can be served as `.onion` |
| Cash-out deanonymisation (KYC exchange) | Guidance on payout choices; fresh address per claim |
| False / defamatory tips | Panel-only access; no public tip content; panel review required |
| Panel corruption | Multiple organisations on the panel; DAO vote; dead man's switch goes to the panel *and* optional secondary recipients (stretch) |
| Keeper is a trust point | Keeper only holds the sealed switch-bundle key (K_switch); production plan runs it in a TEE (e.g., OutLayer) — **VERIFY** feasibility; documented |
| Legal exposure for operators | README disclaimer; programmes define lawful scope |
| NEAR AI Cloud E2EE availability | Fallback: stateless proxy with no logs, documented |

## 11. Milestones (11 days)

> Summary only. The detailed, live plan with task IDs, acceptance criteria and status is **`ROADMAP.md`**, which is updated in every contribution.

| Day | Deliverable |
|---|---|
| 4 Nov | Day-1 spikes: NEAR AI Cloud attestation (+ whether E2EE works from the browser); TS↔Rust borsh/ed25519 test vectors |
| 5–6 Nov | Contract: programmes, reserve-on-triage, tips (PoW, signatures, recusal), DAO resolve, claim (storage + gas drip), switch; tests |
| 7 Nov | Browser cleaning (rasterise PDF, re-encode images, scan mode) with fixtures and removal report; $1 mainnet 1Click deposit check (only with your explicit OK) |
| 8 Nov | Client-side encryption (libsodium), blob store, relayer queue (2 instances, random delay, noLogs) |
| 9 Nov | AI redaction through the proxy plus the attestation panel |
| 10 Nov | Panel UI (triage, decrypt, DAO proposal), public programme page, claim page |
| 11 Nov | Keeper (heartbeat, release), demo script, spam script |
| 12 Nov | README (threat model, trust assumptions), LICENSE |
| 13 Nov | Demo video + X post |
| 14 Nov | Submit |
