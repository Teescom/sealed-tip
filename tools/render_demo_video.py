#!/usr/bin/env python3
"""
Sealed Tip — Demo Video Generator
Renders a 115-second (1m 55s), 1080p 60fps MP4 video implementing
the exact storyboard and scene timings from docs/p12/demo-video-script.md.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCREENSHOTS_DIR = ROOT / "docs" / "screenshots"
OUTPUT_DIR = ROOT / "docs" / "p12"
OUTPUT_VIDEO = OUTPUT_DIR / "demo-video.mp4"
OUTPUT_POSTER = OUTPUT_DIR / "demo-video-poster.jpg"

SCENES = [
    {
        "id": 1,
        "duration": 12,
        "step_num": "01",
        "title": "The Whistleblower Dilemma",
        "subtitle": "Traditional channels force identity disclosure; anonymous leaks leave whistleblowers unpaid and unprotected.",
        "badge": "PROBLEM STATEMENT",
        "metric_title": "THE COMPROMISE",
        "metric_val": "Zero Leaks vs Zero Pay",
        "details": [
            "KYC identity requirements expose whistleblowers to employer retaliation",
            "Anonymous drops offer zero economic security or reward escrow",
            "Sealed Tip bridges the gap: end-to-end privacy with guaranteed bounties"
        ],
        "image": "01_landing.png",
        "vo": "Whistleblowers risk everything to expose corruption, but claiming a reward almost always requires revealing your identity. Sealed Tip solves this: private evidence cleaning, verifiable AI redaction, guaranteed escrow, and multichain payouts."
    },
    {
        "id": 2,
        "duration": 12,
        "step_num": "02",
        "title": "Programme Setup & Funder Escrow",
        "subtitle": "Bounties are deposited upfront in NEAR smart contract escrow with non-renegeable reservations.",
        "badge": "STEP 1: ON-CHAIN ESCROW",
        "metric_title": "ACTIVE ESCROW",
        "metric_val": "5,000 tUSDC Balance · 1,000 Max",
        "details": [
            "Funder 'Clean Roads Fund' opens 'Road contract fraud — Fictional State'",
            "5,000 tUSDC deposited into sealedtip.st-deployer-f8d075.testnet",
            "Contract invariant 1: funds reserved on triage, funder cannot claw back"
        ],
        "image": "03_programme_detail.png",
        "vo": "Programmes are funded upfront. Here, an audit fund locks 5,000 USDC in smart contract escrow on NEAR, with a 1,000 USDC maximum reward. Funds cannot be clawed back once a tip is marked credible."
    },
    {
        "id": 3,
        "duration": 16,
        "step_num": "03",
        "title": "Tipster Onboarding & Client Cleaning",
        "subtitle": "No wallet connection. Identity is 32 random bytes. All evidence is cleaned in the browser before encryption.",
        "badge": "STEP 2: ZERO-ACCOUNT PRIVACY",
        "metric_title": "METADATA STRIPPED",
        "metric_val": "100% Client-Side In-Browser",
        "details": [
            "24 recovery words generate ed25519 signing key and X25519 encryption key",
            "Destructive cleaning: PDFs rasterized, EXIF GPS and camera serials purged",
            "Printer tracking dots and author 'J. Okafor' stripped; plaintext never leaves device"
        ],
        "image": "04_submit_tip.png",
        "vo": "The tipster connects no wallet—identity is 32 random bytes as 24 words. In the browser, evidence is cleaned destructively: PDFs are rasterized, EXIF and GPS data are stripped, and printer tracking dots are neutralized. Plaintext never leaves the device."
    },
    {
        "id": 4,
        "duration": 14,
        "step_num": "04",
        "title": "Verifiable AI Redaction inside TEE",
        "subtitle": "Optional text redaction via NEAR AI Cloud in an Intel TDX hardware enclave with verifiable hardware signature.",
        "badge": "STEP 3: TEE ATTESTATION",
        "metric_title": "INTEL TDX QUOTE",
        "metric_val": "56 / 56 Offline Checks Passed",
        "details": [
            "DeepSeek-V4.1-Flash model runs in isolated hardware enclave",
            "Removes stylometric identifiers ('only procurement officer in Lokoja annex')",
            "Hardware ECDSA signature verified byte-for-byte against enclave quote"
        ],
        "image": "04_submit_tip.png",
        "vo": "For stylometry, the tipster can redact text via NEAR AI Cloud in an Intel TDX hardware enclave. An attestation report proves the exact model and output with a hardware signature verifiable offline."
    },
    {
        "id": 5,
        "duration": 12,
        "step_num": "05",
        "title": "PoW Submission & Anti-Spam",
        "subtitle": "Client mines 12-bit PoW to prevent griefing. Relayers rotate submission with timing jitter.",
        "badge": "STEP 4: ANTI-SPAM & ROTATION",
        "metric_title": "SPAM IMMUNITY",
        "metric_val": "20 Spam Submissions = 0 Reserved",
        "details": [
            "Tipster recuses conflicted panel member #3 (gets 0 sealed keys)",
            "Client solves 12-bit Proof-of-Work in < 1 second",
            "Relayer A & Relayer B alternate submissions with zero IP logging"
        ],
        "image": "01_landing.png",
        "vo": "The tipster recuses conflicted panel members and computes a client-side proof-of-work. A relayer forwards the submission with a random timing delay, logging zero IP data. Spam submissions reserve zero funds."
    },
    {
        "id": 6,
        "duration": 12,
        "step_num": "06",
        "title": "Panel Triage & Escrow Reservation",
        "subtitle": "Non-recused panel member opens exhibit box and marks credible, locking bounty instantly on-chain.",
        "badge": "STEP 5: IMMUTABLE RESERVATION",
        "metric_title": "BOUNTY LOCKED",
        "metric_val": "1,000 tUSDC Reserved On-Chain",
        "details": [
            "Reviewer decrypts exhibit; recused member panel3 cannot decrypt",
            "Triage marks credible → 1,000 tUSDC reserved from programme balance",
            "Funder tries to withdraw full balance: REJECTED with E16_INSUFFICIENT_UNRESERVED"
        ],
        "image": "05_panel.png",
        "vo": "A panel reviewer decrypts the bundle and marks the tip credible. The contract immediately locks 1,000 USDC. Even if the funder tries to withdraw their balance, the contract protects the tipster's bounty."
    },
    {
        "id": 7,
        "duration": 10,
        "step_num": "07",
        "title": "Sputnik DAO Adjudication",
        "subtitle": "Decentralized council votes on final reward allocation. Surplus reservation returns to escrow.",
        "badge": "STEP 6: SPUTNIK DAO V2",
        "metric_title": "COUNCIL QUORUM",
        "metric_val": "2-of-3 Council Quorum Passed",
        "details": [
            "Council creates proposal #1: FunctionCall on sealedtip::resolve_tip",
            "Panel members vote VoteApprove; 800 tUSDC reward accepted",
            "Unused 200 tUSDC reservation released back to funder balance"
        ],
        "image": "05_panel.png",
        "vo": "Governance is decentralized: a Sputnik DAO panel votes to approve an 800 USDC reward, and the remaining 200 USDC reserve is returned to the pool."
    },
    {
        "id": 8,
        "duration": 14,
        "step_num": "08",
        "title": "Anonymous Multichain Payout",
        "subtitle": "Tipster claims reward to a fresh anonymous address with automated gas drip or multichain intents.",
        "badge": "STEP 7: ANONYMOUS CLAIM",
        "metric_title": "CROSS-CHAIN INTENTS",
        "metric_val": "USDC (NEAR) ➔ USDT (Tron/ETH)",
        "details": [
            "Tipster proves ownership with 24 recovery words (nonce 0 signature)",
            "Testnet: 800 tUSDC + 0.05 NEAR gas drip to fresh implicit account",
            "Mainnet route: 1Click Defuse non-custodial swap directly to Tron or Ethereum"
        ],
        "image": "06_claim.png",
        "vo": "The tipster claims the reward using their 24 words. On testnet, funds arrive at a fresh implicit address with a gas drip. On mainnet, 1Click Intents bridges the reward to fresh burner addresses on Tron, Ethereum, or Solana."
    },
    {
        "id": 9,
        "duration": 13,
        "step_num": "09",
        "title": "Autonomous Dead Man's Switch",
        "subtitle": "If whistleblower communication stops, keeper daemon autonomously re-seals cleaned evidence to panel.",
        "badge": "STEP 8: TIPSTER PROTECTION",
        "metric_title": "PRODUCTION READY",
        "metric_val": "258 Rust · 418 TS Tests · MIT",
        "details": [
            "Missed check-in activates trigger; keeper posts re-sealed K_switch keys",
            "Only cleaned evidence released; raw originals protected",
            "Deployed live on NEAR Testnet & Vercel (https://sealed-tip.vercel.app)"
        ],
        "image": "07_status.png",
        "vo": "If a whistleblower is detained, their dead man's switch triggers, and an autonomous keeper releases sanitized evidence to the panel. Sealed Tip: true whistleblower protection on NEAR. Fully tested, open source, and live on testnet."
    }
]

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1920px;
    height: 1080px;
    background: radial-gradient(circle at 50% 20%, #151821 0%, #0a0b0f 70%, #050608 100%);
    color: #f0f2f5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 48px 64px 40px 64px;
    overflow: hidden;
  }
  
  /* Top Nav / Brand Bar */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand-logo {
    width: 38px;
    height: 38px;
    background: #00ec97;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 20px;
    color: #060709;
  }
  .brand-text {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .brand-tag {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 13px;
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.06);
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .header-meta {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .badge-phase {
    background: rgba(0, 236, 151, 0.15);
    color: #00ec97;
    border: 1px solid rgba(0, 236, 151, 0.3);
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .scene-counter {
    font-family: ui-monospace, monospace;
    font-size: 15px;
    color: #64748b;
  }

  /* Content Grid */
  .main-grid {
    display: grid;
    grid-template-columns: 820px 920px;
    gap: 52px;
    align-items: center;
    flex: 1;
    margin: 28px 0;
  }
  
  /* Left Panel */
  .info-panel {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .scene-step {
    font-family: ui-monospace, monospace;
    font-size: 14px;
    color: #00ec97;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .scene-step::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #00ec97;
    border-radius: 50%;
  }
  .title {
    font-size: 46px;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -1.2px;
    color: #ffffff;
  }
  .subtitle {
    font-size: 20px;
    line-height: 1.45;
    color: #94a3b8;
    font-weight: 400;
  }
  
  .metric-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 4px solid #00ec97;
    border-radius: 10px;
    padding: 16px 20px;
  }
  .metric-label {
    font-size: 12px;
    color: #64748b;
    font-family: ui-monospace, monospace;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .metric-value {
    font-size: 24px;
    font-weight: 700;
    color: #f1f5f9;
  }
  
  .details-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .detail-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    font-size: 17px;
    line-height: 1.4;
    color: #cbd5e1;
  }
  .detail-check {
    color: #00ec97;
    font-weight: 800;
    font-size: 18px;
    line-height: 1;
    margin-top: 2px;
  }

  /* Right Panel - Browser Mockup */
  .browser-window {
    background: #181920;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(0, 236, 151, 0.05);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 570px;
  }
  .browser-bar {
    height: 42px;
    background: #101116;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 14px;
  }
  .browser-dots {
    display: flex;
    gap: 7px;
  }
  .browser-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }
  .browser-url {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 4px 14px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: #94a3b8;
    flex: 1;
    text-align: center;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .browser-content {
    flex: 1;
    overflow: hidden;
    position: relative;
    background: #090a0f;
  }
  .browser-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  /* Bottom Voiceover Caption Bar */
  .footer-vo {
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    gap: 18px;
    backdrop-filter: blur(8px);
  }
  .vo-icon {
    width: 32px;
    height: 32px;
    background: rgba(0, 236, 151, 0.2);
    color: #00ec97;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    flex-shrink: 0;
  }
  .vo-text {
    font-size: 16.5px;
    line-height: 1.45;
    color: #e2e8f0;
    font-style: italic;
  }
  .vo-speaker {
    color: #00ec97;
    font-style: normal;
    font-weight: 700;
    margin-right: 6px;
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.8px;
  }
</style>
</head>
<body>

  <!-- Top Header -->
  <div class="header">
    <div class="brand">
      <div class="brand-logo">ST</div>
      <div class="brand-text">SEALED TIP</div>
      <div class="brand-tag">NEAR PROTOCOL</div>
      <div class="brand-tag">PRIVACY & PRIVATE AI</div>
    </div>
    <div class="header-meta">
      <div class="badge-phase">__BADGE__</div>
      <div class="scene-counter">SCENE __STEP_NUM__ / 09</div>
    </div>
  </div>

  <!-- Main Grid -->
  <div class="main-grid">
    <div class="info-panel">
      <div class="scene-step">__BADGE__</div>
      <h1 class="title">__TITLE__</h1>
      <p class="subtitle">__SUBTITLE__</p>
      
      <div class="metric-card">
        <div class="metric-label">__METRIC_TITLE__</div>
        <div class="metric-value">__METRIC_VAL__</div>
      </div>

      <div class="details-list">
        __DETAILS_HTML__
      </div>
    </div>

    <!-- Right Window -->
    <div class="browser-window">
      <div class="browser-bar">
        <div class="browser-dots">
          <div class="browser-dot dot-red"></div>
          <div class="browser-dot dot-yellow"></div>
          <div class="browser-dot dot-green"></div>
        </div>
        <div class="browser-url">https://sealed-tip.vercel.app</div>
      </div>
      <div class="browser-content">
        <img class="browser-img" src="__IMG_URL__" alt="UI screen">
      </div>
    </div>
  </div>

  <!-- Voiceover Bar -->
  <div class="footer-vo">
    <div class="vo-icon">▶</div>
    <div class="vo-text"><span class="vo-speaker">NARRATION:</span> "__VO__"</div>
  </div>

</body>
</html>
"""

def generate_scene_html(scene: dict, img_path: str) -> str:
    details_html = "\n".join([
        f'<div class="detail-item"><span class="detail-check">✓</span><span>{d}</span></div>'
        for d in scene["details"]
    ])
    html = HTML_TEMPLATE
    html = html.replace("__BADGE__", scene["badge"])
    html = html.replace("__STEP_NUM__", scene["step_num"])
    html = html.replace("__TITLE__", scene["title"])
    html = html.replace("__SUBTITLE__", scene["subtitle"])
    html = html.replace("__METRIC_TITLE__", scene["metric_title"])
    html = html.replace("__METRIC_VAL__", scene["metric_val"])
    html = html.replace("__DETAILS_HTML__", details_html)
    html = html.replace("__IMG_URL__", img_path)
    html = html.replace("__VO__", scene["vo"])
    return html

def render_scenes():
    temp_dir = Path(tempfile.mkdtemp(prefix="sealedtip_video_"))
    print(f"Working in temporary directory: {temp_dir}")
    
    rendered_frames = []
    
    for scene in SCENES:
        sid = scene["id"]
        img_src = (SCREENSHOTS_DIR / scene["image"]).resolve()
        html_content = generate_scene_html(scene, f"file://{img_src}")
        
        html_file = temp_dir / f"scene_{sid:02d}.html"
        html_file.write_text(html_content, encoding="utf-8")
        
        png_file = temp_dir / f"scene_{sid:02d}.png"
        print(f"Capturing Scene {sid}/09: {scene['title']} ({scene['duration']}s)...")
        
        cmd = [
            "google-chrome-stable",
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--window-size=1920,1080",
            f"--screenshot={png_file}",
            f"file://{html_file.resolve()}"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Error capturing scene {sid}: {res.stderr}")
            sys.exit(1)
            
        rendered_frames.append((png_file, scene["duration"]))
        
    print(f"All {len(rendered_frames)} scenes captured.")
    
    # Generate concat file for FFmpeg
    concat_file = temp_dir / "concat.txt"
    with open(concat_file, "w") as f:
        for png_file, duration in rendered_frames:
            f.write(f"file '{png_file.resolve()}'\n")
            f.write(f"duration {duration}\n")
        # Final image repeat for ffmpeg concat bug
        f.write(f"file '{rendered_frames[-1][0].resolve()}'\n")
        
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Save poster frame from Scene 1
    poster_src = rendered_frames[0][0]
    subprocess.run(["cp", str(poster_src), str(OUTPUT_POSTER)], check=True)
    print(f"Saved poster image: {OUTPUT_POSTER}")
    
    # Render final MP4 with synthesized ambient background synth
    total_duration = sum(s["duration"] for s in SCENES) # 115s
    print(f"Rendering {OUTPUT_VIDEO} (Total duration: {total_duration}s = 1m 55s)...")
    
    # Render audio track first
    audio_wav = temp_dir / "audio.wav"
    audio_cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"aevalsrc=0.06*sin(2*PI*55*t)+0.03*sin(2*PI*110*t)+0.015*sin(2*PI*165*t):d={total_duration}:s=44100",
        "-af", f"lowpass=f=400,afade=t=in:ss=0:d=2,afade=t=out:st={total_duration-3}:d=3",
        str(audio_wav)
    ]
    subprocess.run(audio_cmd, check=True)

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-i", str(audio_wav),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(OUTPUT_VIDEO)
    ]
    
    res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"FFmpeg error:\n{res.stderr}")
        sys.exit(1)
        
    print(f"Successfully generated: {OUTPUT_VIDEO}")
    
    # Probe duration and size
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "default=noprint_wrappers=1", str(OUTPUT_VIDEO)],
        capture_output=True, text=True
    )
    print("Video specifications:\n" + probe.stdout)

if __name__ == "__main__":
    render_scenes()
