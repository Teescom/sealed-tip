#!/usr/bin/env python3
import os
import subprocess
import tempfile

svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradients -->
    <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
      <stop offset="0%" stop-color="#0d4520" />
      <stop offset="65%" stop-color="#062a12" />
      <stop offset="100%" stop-color="#021207" />
    </radialGradient>
    
    <radialGradient id="centerGlow" cx="50%" cy="45%" r="40%">
      <stop offset="0%" stop-color="#00EC97" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#00EC97" stop-opacity="0" />
    </radialGradient>

    <!-- Metal & Shield Gradients -->
    <linearGradient id="mintGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#55FFC2" />
      <stop offset="45%" stop-color="#00EC97" />
      <stop offset="100%" stop-color="#009A60" />
    </linearGradient>

    <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0e3a1d" />
      <stop offset="100%" stop-color="#041a0b" />
    </linearGradient>

    <linearGradient id="paperGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="70%" stop-color="#f2efe3" />
      <stop offset="100%" stop-color="#ded8c4" />
    </linearGradient>

    <linearGradient id="goldSeal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FCD34D" />
      <stop offset="60%" stop-color="#F59E0B" />
      <stop offset="100%" stop-color="#B45309" />
    </linearGradient>

    <!-- Filters -->
    <filter id="subtleShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.65" />
    </filter>

    <filter id="glowMint" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#00EC97" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- Base Circle Background -->
  <rect width="512" height="512" rx="128" fill="url(#bgGlow)" />
  <circle cx="256" cy="256" r="256" fill="url(#centerGlow)" />

  <!-- Outer Cryptographic Ring (24 Word Marks) -->
  <circle cx="256" cy="256" r="236" fill="none" stroke="#1c4429" stroke-width="2" />
  <circle cx="256" cy="256" r="226" fill="none" stroke="#00EC97" stroke-width="1.5" stroke-opacity="0.3" stroke-dasharray="3 14" />
  <circle cx="256" cy="256" r="216" fill="none" stroke="#1c4429" stroke-width="1.5" />

  <!-- Outer Ring Ticks (24 Ticks representing 24 BIP39 recovery words) -->
  <g stroke="#00EC97" stroke-width="2.5" stroke-linecap="round" opacity="0.75">
'''

# Add 24 radial tick marks
import math
for i in range(24):
    angle = i * (360 / 24)
    rad = math.radians(angle)
    r1 = 228
    r2 = 236 if i % 6 == 0 else 232
    width = 3.5 if i % 6 == 0 else 1.5
    opacity = 1.0 if i % 6 == 0 else 0.45
    x1 = 256 + r1 * math.cos(rad)
    y1 = 256 + r1 * math.sin(rad)
    x2 = 256 + r2 * math.cos(rad)
    y2 = 256 + r2 * math.sin(rad)
    svg_content += f'    <line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke-width="{width}" opacity="{opacity}" />\n'

svg_content += '''  </g>

  <!-- Main Security Shield / Emblem Background -->
  <g filter="url(#subtleShadow)">
    <!-- Outer Shield Border -->
    <path d="M256 64 
             C330 64 394 92 414 142
             C414 260 354 366 256 422
             C158 366 98 260 98 142
             C118 92 182 64 256 64 Z" 
          fill="url(#shieldGrad)" 
          stroke="url(#mintGrad)" 
          stroke-width="5" />
          
    <!-- Inner Shield Inset Hairline -->
    <path d="M256 78 
             C320 78 378 102 396 146
             C396 250 342 348 256 398
             C170 348 116 250 116 146
             C134 102 192 78 256 78 Z" 
          fill="none" 
          stroke="#00EC97" 
          stroke-width="1.5" 
          stroke-opacity="0.35" />
  </g>

  <!-- Confidential Document Motif (Cleaned Whistleblower File) -->
  <g filter="url(#subtleShadow)" transform="translate(0, -6)">
    <!-- Document Base with Folded Dog-Ear Top Right -->
    <path d="M196 140 
             H284 
             L324 180 
             V304 
             C324 312 318 318 310 318 
             H196 
             C188 318 182 312 182 304 
             V154 
             C182 146 188 140 196 140 Z" 
          fill="url(#paperGrad)" />
          
    <!-- Folded Dog-Ear Corner -->
    <path d="M284 140 V176 C284 180 288 184 292 184 H324 Z" 
          fill="#c8c2ae" />
          
    <!-- Sanitized Text Indicator Lines (Representing Redaction) -->
    <rect x="204" y="172" width="64" height="6" rx="3" fill="#14160F" opacity="0.85" />
    <rect x="204" y="190" width="104" height="6" rx="3" fill="#14160F" opacity="0.35" />
    <rect x="204" y="206" width="92" height="6" rx="3" fill="#14160F" opacity="0.35" />
    <rect x="204" y="222" width="76" height="6" rx="3" fill="#14160F" opacity="0.85" />
  </g>

  <!-- Cryptographic Wax Seal & Padlock (Confidential Lock) -->
  <g filter="url(#glowMint)" transform="translate(0, -2)">
    <!-- Shackle (Padlock Top Loop) -->
    <path d="M228 256 V234 C228 218 240 206 256 206 C272 206 284 218 284 234 V256" 
          fill="none" 
          stroke="url(#mintGrad)" 
          stroke-width="11" 
          stroke-linecap="round" />
          
    <!-- Padlock Body / Wax Seal Centerpiece -->
    <rect x="216" y="250" width="80" height="68" rx="18" 
          fill="#041D0C" 
          stroke="url(#mintGrad)" 
          stroke-width="4.5" />
          
    <!-- Keyhole -->
    <circle cx="256" cy="276" r="8" fill="#00EC97" />
    <path d="M252 278 L250 298 H262 L260 278 Z" fill="#00EC97" />
  </g>

  <!-- Banner / Brand Typography: "SEALED TIP" -->
  <g transform="translate(256, 362)">
    <!-- Banner Plate -->
    <rect x="-96" y="-15" width="192" height="30" rx="15" 
          fill="#062A12" 
          stroke="#00EC97" 
          stroke-width="2" 
          filter="url(#subtleShadow)" />
          
    <!-- Text -->
    <text x="0" y="6" 
          text-anchor="middle" 
          font-family="system-ui, -apple-system, sans-serif" 
          font-size="15" 
          font-weight="900" 
          letter-spacing="3" 
          fill="#00EC97">SEALED TIP</text>
  </g>

  <!-- Accent Privacy Stars / Checkmark Nodes -->
  <circle cx="256" cy="100" r="4" fill="#00EC97" filter="url(#glowMint)" />
  <circle cx="150" cy="148" r="3" fill="#00EC97" opacity="0.6" />
  <circle cx="362" cy="148" r="3" fill="#00EC97" opacity="0.6" />
</svg>
'''

output_svg = "/home/gamp/sealed-tip/docs/assets/pfp.svg"
output_png = "/home/gamp/sealed-tip/docs/assets/pfp.png"
web_svg = "/home/gamp/sealed-tip/apps/web/public/assets/pfp.svg"
web_png = "/home/gamp/sealed-tip/apps/web/public/assets/pfp.png"

with open(output_svg, "w") as f:
    f.write(svg_content)

with open(web_svg, "w") as f:
    f.write(svg_content)

print(f"Generated SVG: {output_svg}")

# Render to 512x512 PNG using headless chrome
html_wrapper = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
  }}
  img {{
    width: 512px;
    height: 512px;
    display: block;
  }}
</style>
</head>
<body>
  <img src="file://{output_svg}" />
</body>
</html>'''

with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as tf:
    tf.write(html_wrapper)
    temp_html = tf.name

cmd = [
    "/usr/bin/google-chrome",
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--window-size=512,512",
    "--hide-scrollbars",
    f"--screenshot={output_png}",
    temp_html
]

subprocess.run(cmd, check=True)
os.remove(temp_html)

# Copy to apps/web/public/assets/pfp.png
import shutil
shutil.copyfile(output_png, web_png)

print(f"Rendered PNG: {output_png} (and {web_png})")
