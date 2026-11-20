<div align="center">

# MoonField Muse Studio (月域 Muse Studio)

**Open-Source All-in-One AI Infinite Canvas Studio · Built-in Multi-Account Muse Pool & Multi-Provider AI Agent**

[简体中文](README.md) · [English](README_EN.md)

</div>

---

## Overview

**MoonField Muse Studio** is an out-of-the-box local AI creative studio combining an **Infinite Canvas node workflow**, a **concurrent Muse account pool** (Text-to-Image, Image-to-Image, Text/Image-to-Video, Text), and a **multi-provider AI Agent**. Even on a brand-new Windows PC with no dev environment installed, beginners can launch everything with a single click.

### Key Features
- **Infinite Canvas & AI Director Workflow**: Connect Text, Image, Video, and Audio nodes freely. Includes an **AI Video Director** to turn scripts/interviews into structured 5-column storyboard graphs with `S01 → S02` last-frame chaining, in-place stacked video/image versions (Set Primary / Duplicate / Download), wheel-zoom lightbox, and non-fullscreen modal video playback.
- **MoonField Account Pool (`N × 5` Parallelism)**: Built-in local pool console with one-click popup login, automatic video-capability probing, and multi-account / multi-tab parallel generation.
- **Multi-Provider AI Agent (Bring Your Own AI)**: Supports both **Codex (local CLI)** and **any OpenAI-compatible API** (with 1-click presets for OpenAI, DeepSeek, Qwen/DashScope, OpenRouter, and local Ollama). Full canvas tool-calling (`read_canvas`, `create_nodes`, image/video generation, layout) plus one-click **"Add to Chat"** buttons on text, image, and video nodes.
- **Zero-Setup One-Click Bootstrap**: Automatically detects/installs Python & Node.js, creates `.venv`, installs dependencies, detects Chrome/Edge, generates a unique local API key, and auto-opens `http://127.0.0.1:3010` with zero manual key copying.

---

## Quick Start (Windows — Beginner Friendly)

> Works on a fresh Windows PC as long as **Google Chrome** or **Microsoft Edge** is installed.

### Option 1: One-Line Terminal Download & Launch (No Git Required)
Open PowerShell (`Win + R` -> `powershell`) and paste this single command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Join-Path $env:USERPROFILE 'Muse-Studio'; $z=Join-Path $env:TEMP 'muse-studio.zip'; Invoke-WebRequest -Uri 'https://github.com/170KK/moonfield-muse-studio/archive/refs/heads/main.zip' -OutFile $z; Expand-Archive -Path $z -DestinationPath $env:TEMP -Force; if (Test-Path $d) { Remove-Item -Recurse -Force $d }; Move-Item (Join-Path $env:TEMP 'moonfield-muse-studio-main') $d; Remove-Item $z -Force; Set-Location $d; .\start_muse_studio.ps1"
```

Or if `git` is already installed:
```powershell
git clone https://github.com/170KK/moonfield-muse-studio.git; cd moonfield-muse-studio; powershell -NoProfile -ExecutionPolicy Bypass -File .\start_muse_studio.ps1
```

### Option 2: Download ZIP & Double-Click
1. Click **`<> Code` → `Download ZIP`** and extract to any folder (e.g. `D:\Muse-Studio`).
2. Double-click **`启动 Muse Studio.bat`** in the root folder.
   - On **first launch**, it automatically installs Python 3.11 / Node.js LTS (via `winget` if missing), creates `.venv` and installs packages, generates `pool/.env` with a fresh random key, starts **Pool (`18620`)**, **Agent (`17381`)**, and **Web (`3010`)**, and opens `http://127.0.0.1:3010` in your browser.
3. To stop all services, double-click **`停止 Muse Studio.bat`**.

---

## First-Time Setup (2 Steps)

### Step 1: Add a Muse Account in the Pool (for Image / Video / Text Generation)
1. Click **"Account Pool"** (`月域号池`) in the top bar or home page (the local pool URL and API key are auto-discovered—no manual copying required).
2. Click **Popup Login** (or import cookies) to sign in to at least one Muse account.

### Step 2: Connect Your AI Agent (Optional, for Chatting & Canvas Control)
1. Open the **Agent** panel on the right and switch to the **Connect / Setup** tab.
2. Choose either:
   - **Codex (Local CLI)**: Uses your local Codex login/config out of the box.
   - **Custom OpenAI-Compatible API**: Pick a preset (**OpenAI / DeepSeek / Qwen / OpenRouter / Local Ollama**) or enter your own `Base URL`, `API Key`, and `Model`, then click **Save & Apply** and **Test Connection**.

---

## Privacy & Security

- All personal cookies, isolated browser profiles (`data/browser-profiles/`), local pool keys (`pool/.env`), and Agent credentials (`data/agent/canvas-agent.json`) stay **strictly local** and are excluded via `.gitignore`.

---

## License & Commercial Use

This project is **free for personal, non-commercial use only** (study, research, evaluation, and non-profit purposes). Commercial use — including selling, renting, paid services, or use in commercial products or for-profit business — is **prohibited** without the author's prior written permission.

**For commercial licensing, contact the author via WeChat: iSevenTeen_**

See the root `LICENSE` file for full terms. Third-party components (infinite-canvas, muse2api, etc.) retain their own MIT licenses; see `LICENSES/`.
