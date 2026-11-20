<div align="center">

# 月域 Muse Studio (MoonField Muse Studio)

**开源的一体化 AI 无限画布导演工作台 · 内置 Muse 多账号并发号池与多模型 Agent**

[简体中文](README.md) · [English](README_EN.md)

</div>

---

## 项目简介

**月域 Muse Studio** 是一套开箱即用的本地 AI 影视/分镜创作工作台，将 **无限画布节点编排**、**Muse 多账号并发号池（文生图 / 图生图 / 文生视频 / 图生视频 / 文本）** 与 **多模型 AI Agent 助手** 融为一体，无需复杂配置，小白也能在全新电脑上一键启动使用。

### 核心特性
- **无限画布 · AI 导演分镜流**：支持文本、图片、视频、音频节点自由连线；内置「视频导演」可从剧本/访谈自动拆解五列分镜图，支持 `S01 → S02` 尾帧无缝接力、原位多版本叠层对比（设为主视频 / 创建副本）、滚轮缩放看图与非全屏弹窗播放。
- **月域号池引擎（N × 5 真并行）**：内置本地号池控制台，支持弹窗一键登录抓号、自动测通视频能力，支持单账号多标签页并发与多账号轮询调度。
- **多模型 AI Agent（可接入任意大模型）**：右侧助手同时支持 **Codex（本机 CLI）** 与 **自定义 OpenAI 兼容 API**（内置 OpenAI、DeepSeek、通义千问、OpenRouter、本地 Ollama 一键预设），可直接调用 `读取画布`、`创建节点`、`生成图片/视频` 等全套画布工具，也支持选中画布节点一键 **「添加到对话」**。
- **零门槛一键自举部署**：首次运行自动检测/安装 Python 与 Node.js、自动建立虚拟环境与安装依赖、自动探测本机 Chrome/Edge 并生成随机号池密钥与浏览器隔离目录，网页端自动免密连接本机号池与 Agent。

---

## 小白一键启动教程（Windows）

> 适用场景：一台什么环境都没有的全新 Windows 电脑，只需确保装有 **Google Chrome** 或 **Microsoft Edge** 浏览器。

### 方式一：终端一键拉取并启动（推荐，无需装 Git）
按 `Win + R` 输入 `powershell` 回车，复制粘贴下面整行命令回车即可全自动下载、装环境并启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Join-Path $env:USERPROFILE 'Muse-Studio'; $z=Join-Path $env:TEMP 'muse-studio.zip'; Invoke-WebRequest -Uri 'https://github.com/170KK/moonfield-muse-studio/archive/refs/heads/main.zip' -OutFile $z; Expand-Archive -Path $z -DestinationPath $env:TEMP -Force; if (Test-Path $d) { Remove-Item -Recurse -Force $d }; Move-Item (Join-Path $env:TEMP 'moonfield-muse-studio-main') $d; Remove-Item $z -Force; Set-Location $d; .\start_muse_studio.ps1"
```

如果本机已安装 `git`，也可以用：
```powershell
git clone https://github.com/170KK/moonfield-muse-studio.git; cd moonfield-muse-studio; powershell -NoProfile -ExecutionPolicy Bypass -File .\start_muse_studio.ps1
```

### 方式二：手动下载压缩包启动
1. 点击页面右上角绿色 **`<> Code` → `Download ZIP`** 下载并解压到任意目录（建议英文路径，如 `D:\Muse-Studio`）。
2. 双击根目录下的 **`启动 Muse Studio.bat`**。
   - **首次运行**会自动完成：检测并安装 Python 3.11 / Node.js LTS（若未安装会通过 `winget` 自动安装）→ 创建 `.venv` 并安装依赖 → 生成本机随机配置 `pool/.env` → 启动 **号池 (`18620`)**、**Agent (`17381`)** 与 **前端 (`3010`)** → 自动在浏览器打开 `http://127.0.0.1:3010`。
3. 如需停止全部后台服务，双击 **`停止 Muse Studio.bat`** 即可。

---

## 首次使用 2 步配置

### 第 1 步：添加 Muse 号池账号（用于生图 / 生视频 / 文本）
1. 在打开的网页中点击顶部或首页的 **「月域号池」**（前端已自动填好本机号池地址与密钥，无需手动复制 Key）。
2. 在号池页面点击 **「弹窗登录」**（或导入 Cookie）登录你的 Muse 账号，建议测试确认视频能力可用后返回画布即可直接创作。

### 第 2 步：连接右侧 AI Agent（可选，用于对话操控画布）
1. 打开画布右侧 **「Agent」** 面板，点击顶部 **「连接 / 设置」** 标签页。
2. 在 **「AI 模型接入」** 中二选一：
   - **Codex (本机 CLI)**：若本机已登录 Codex，默认即可直接使用。
   - **自定义 OpenAI 兼容 API**：点击 **DeepSeek / 通义千问 / OpenAI / OpenRouter / Ollama 本地** 预设（或手动填写 `API Base URL`、`API Key`、`模型名称`），点 **「保存并应用」** 与 **「测试连接」** 即可。

---

## 隐私与安全说明

- 所有个人账号 Cookie、Chrome 隔离配置（`data/browser-profiles/`）、号池随机密钥（`pool/.env`）与 Agent 密钥（`data/agent/canvas-agent.json`）均**仅保存在你的本地电脑**，并已列入 `.gitignore`，不会包含在开源代码中。

---

## 致谢与第三方组件

本项目基于以下项目构建，版权归各自作者所有：

- **无限画布（`canvas/`）**：基于 infinite-canvas 项目，MIT 许可证，授权文本见 `LICENSES/infinite-canvas-MIT.txt`。
- **号池引擎（`pool/`）**：基于 muse2api 项目，MIT 许可证，授权文本见 `LICENSES/muse2api-MIT.txt`。
- **视频导演技能（`skills/muse-video-prompt/`）**：来自 [dichenxiang/muse-video-prompt](https://github.com/dichenxiang/muse-video-prompt)（抖音作者 deverel 丨ai美学丶skill）。原仓库未附开源许可证，版权归原作者所有；本仓库仅为方便一键安装而内置并标注出处，详见该目录下的 `SOURCE.md`，如需再分发请先取得原作者许可。

除上述第三方组件外，本项目其余代码以根目录 `LICENSE`（MIT）授权。
