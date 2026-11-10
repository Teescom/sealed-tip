# Sealed Tip — Launch Post & Thread for X (Twitter)

> **Document Status:** Complete & Ready for Review  
> **Associated Issue:** #155 (`[P12] Draft the X post`) · **Roadmap Task:** `S-12.7`  
> **Rule Reminder (`AGENTS.md`):** Do not post to X without explicit user approval.

---

## 1. Publishing Strategy & Overview

- **Audience:** NEAR ecosystem builders, privacy researchers, investigative journalism tech communities, and Web3 security auditors.
- **Track:** Privacy & Private AI (NEAR Hackathon 2026).
- **Primary Message:** Whistleblowers face retaliation and often never get paid. Sealed Tip solves the whistleblowing dilemma by combining client-side evidence sanitization, hardware-attested AI redaction in a NEAR AI Cloud TEE, contract-enforced reward escrow on NEAR, Sputnik DAO panel adjudication, multichain payout via 1Click Intents, and a dead man's switch.
- **Tone:** Technical, high-conviction, rigorous, and privacy-first. No hype or marketing fluff; emphasize mathematical guarantees, verified enclaves, and code reproducibility.
- **Key Links:**
  - **Repository:** `https://github.com/Teescom/sealed-tip`
  - **Live Web App:** `https://sealed-tip.vercel.app` (or custom domain)
  - **Demo Video:** `https://youtu.be/<VIDEO_ID>`

---

## 2. Main Launch Thread (Tweet-by-Tweet)

### Tweet 1 (Hook / The Dilemma)
> 46% of employees who report misconduct face retaliation. 49% cite fear of personal safety as the #1 barrier.
> 
> Whistleblower rewards exist, but claiming them requires revealing your identity.
> 
> Introducing Sealed Tip: an anonymous whistleblower tip line where evidence is cleaned in your browser, AI redaction runs in a hardware TEE, rewards are locked on @NEARProtocol, and payouts go to fresh burner addresses on any chain. 🧵👇
> 
> 🔗 https://github.com/Teescom/sealed-tip

* **Media:** Video snippet or teaser card of the Sealed Tip clean UI showing "Anonymous Tip Submission — No Wallet Required".
* **Character Count:** ~430 chars (long-form X) or split into 240 chars.

---

### Tweet 2 (Pillar 1: Zero Account Cryptography)
> 1/ The tipster has NO account. No wallet connection. No KYC. No ENS.
> 
> You hold 32 random bytes as 24 recovery words.
> Keys are derived in-browser via HKDF-SHA256:
> • ed25519 for domain-separated action signatures
> • X25519 for end-to-end evidence encryption
> 
> Relayers submit actions to NEAR, but cannot tamper with them or redirect payouts. The smart contract validates every signature with `env::ed25519_verify`.
> 
> Privacy is the product.

* **Media:** Diagram showing `24 words ➔ HKDF ➔ (ed25519 + X25519) ➔ Signed Borsh Action`.

---

### Tweet 3 (Pillar 2: Destructive Client-Side Cleaning)
> 2/ Leaking metadata ruins anonymity.
> 
> Before evidence leaves your device, Sealed Tip cleans it in the browser:
> 📄 PDFs are rasterized into images and rebuilt page-by-page (removing author tags, edit histories, hidden layers).
> 📸 Images are re-encoded with EXIF and GPS stripped.
> 🖨️ Optional scan mode neutralizes printer tracking dots.
> 🚫 Unsupported formats (like DOCX) are refused outright.
> 
> Plaintext never leaves your browser.

* **Media:** Screenshot of the client-side Cleaning Report showing removed metadata (author, GPS coordinates, revisions).

---

### Tweet 4 (Pillar 3: Verifiable AI Redaction in NEAR AI Cloud TEE)
> 3/ Whistleblowers can reveal their identity through wording ("as the only engineer in the annex...").
> 
> Sealed Tip features optional AI redaction running in a confidential NEAR AI Cloud TEE.
> 
> • Direct browser ➔ TEE encryption over OHTTP
> • Intel TDX hardware attestation quote bound to a client-generated nonce
> • Cryptographic ECDSA signature over exact completion bytes
> 
> You can verify the hardware quote offline:
> `pnpm verify-attestation`

* **Media:** Screenshot of the `AttestationPanel` UI displaying Intel TDX verified quote, nonce match, and ECDSA signature.

---

### Tweet 5 (Pillar 4: Trustless Escrow & Sputnik DAO Adjudication)
> 4/ Why trust an organization to actually pay?
> 
> Funder rewards are locked in a NEP-141 escrow contract before tips are submitted.
> 
> • Anti-spam: Tips require client-side Proof-of-Work (12-bit).
> • Reservations: Funds are locked ONLY when an appointed reviewer triages a tip as credible.
> • Governance: Final reward approval is decided on-chain by a Sputnik DAO v2 council (2-of-3 quorum).
> 
> Funders cannot withdraw funds backing an active, credible tip.

* **Media:** Screenshot of the Panel Review & Sputnik DAO proposal UI showing credible triage and escrow reservation.

---

### Tweet 6 (Pillar 5: Multichain Payouts via 1Click Intents)
> 5/ How do you cash out without deanonymizing yourself on a KYC exchange?
> 
> Testnet payouts go to fresh NEAR implicit accounts with an automated gas drip.
> 
> For multichain rewards, Sealed Tip integrates 1Click Intents:
> Swap locked USDC on NEAR directly to fresh burner addresses on Ethereum, Tron (USDT), or Solana in a single atomic claim.
> 
> The destination address is signed inside the tipster's borsh payload—relayers cannot redirect a single cent.

* **Media:** Screenshot of the Claim Reward UI showing payout options (NEAR Implicit account vs. 1Click Multichain Intents).

---

### Tweet 7 (Pillar 6: The Dead Man's Switch)
> 6/ What if the whistleblower is detained or goes missing?
> 
> Every tip includes an autonomous Dead Man's Switch:
> • Tipster checks in periodically via a signed 1-click action.
> • If a deadline passes (interval + grace period), anyone can trigger the switch on-chain.
> • An autonomous Keeper daemon releases the switch decryption keys to non-recused panel members.
> • Defaults to sanitized evidence; raw files require explicit opt-in.

* **Media:** UI screenshot of Switch Settings (interval slider, grace countdown, keeper status).

---

### Tweet 8 (Verification & Open Source)
> 7/ We don't ask for trust. Run the full verification yourself:
> 
> 💻 Full repo: https://github.com/Teescom/sealed-tip
> 📜 MIT License
> 🧪 258 Rust contract & sandbox tests + 418 TypeScript tests passing (0 skipped)
> ⚡ Complete 8-step PRD §8 acceptance test runs in ~3.5s:
> `pnpm demo`
> 
> 🛡️ Anti-spam stress test:
> `pnpm spam`
> 
> Built for the @NEARProtocol Hackathon 2026 (Privacy & Private AI track).
> 
> Feedback welcome! 🚀

---

## 3. Alternative: Standalone Single Long-Form Post (X Premium / Blog Announcement)

For posting as a single, comprehensive long-form post:

```markdown
Whistleblowers risk retaliation, career ruin, and imprisonment to expose corruption. Yet, claiming financial rewards almost universally requires identifying themselves to the very organizations they report on.

We built Sealed Tip to solve this dilemma: an anonymous whistleblower tip line where evidence is cleaned client-side, AI redaction runs in a verifiable hardware enclave, rewards are locked in on-chain escrow, and payouts go to fresh burner addresses on any chain.

Built for the @NEARProtocol Hackathon 2026 (Privacy & Private AI track).

How Sealed Tip protects whistleblowers:

1. Zero Account Architecture: The tipster has no wallet or public identity. Identity is 32 random bytes (24 words). All actions are signed with an ed25519 key derived via HKDF-SHA256 and verified by the smart contract.

2. Client-Side Destructive Cleaning: PDFs are rasterized and rebuilt; images are stripped of EXIF/GPS metadata; tracking dots are suppressed via scan mode. Plaintext never leaves the browser.

3. Verifiable Private AI (NEAR AI Cloud TEE): Text can be sent directly to an Intel TDX confidential enclave over OHTTP. The enclave returns a cryptographic hardware quote and signature verifying the exact model and output.

4. Contract-Enforced Escrow: Reward pools are locked on-chain in advance. Tips require 12-bit Proof-of-Work to eliminate spam. Funds are reserved upon credible triage by a panel member and approved via a Sputnik DAO v2 council vote.

5. Multichain Payouts via 1Click Intents: Payouts go to fresh implicit NEAR accounts or bridge seamlessly to fresh addresses on Ethereum, Tron, or Solana without centralized KYC touchpoints.

6. Autonomous Dead Man's Switch: Protects the whistleblower if they disappear. If check-in deadlines lapse, a keeper daemon automatically releases the decryption keys to non-recused panel members.

Tested & Verifiable:
• 258 Rust unit + near-workspaces sandbox tests
• 418 TypeScript tests (0 skipped)
• Full 8-step end-to-end acceptance demo (`pnpm demo`)
• Open source under MIT license

Explore the project:
GitHub: https://github.com/Teescom/sealed-tip
Live App: https://sealed-tip.vercel.app
Demo Video: https://youtu.be/<VIDEO_ID>
```

---

## 4. Visual Media Checklist

| Asset # | Filename | Content / Visual Focus |
|---|---|---|
| **M-1** | `hero-flow.png` | Architecture diagram: Tipster (browser clean + HKDF) ➔ NEAR AI Cloud TEE ➔ Relayer ➔ SealedTip Contract & Escrow ➔ Sputnik DAO ➔ 1Click Payout. |
| **M-2** | `cleaning-report.png` | Before/after UI showing metadata stripping from `invoice_fictional.pdf` (author, creation software, incremental revision removal). |
| **M-3** | `attestation-panel.png` | Close-up of the `AttestationPanel` with green checkmarks for Intel TDX quote verification, nonce binding, and ECDSA signature. |
| **M-4** | `payout-intent.png` | Claim screen showing payout destination options: NEAR implicit account with gas drip and cross-chain 1Click quote to Tron/Ethereum. |
| **M-5** | `demo-gif.gif` | 10-second fast-cut GIF of the submit flow: upload file ➔ see cleaning report ➔ solve PoW ➔ submit tip. |
