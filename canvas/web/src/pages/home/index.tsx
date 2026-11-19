import { ArrowRight, ArrowUpRight, CheckCircle2, Cpu, Database, Film, FolderTree, Image as ImageIcon, Layers, Sparkles, Video, Wand2, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function IndexPage() {
    const { i18n } = useTranslation();
    const isEn = i18n.resolvedLanguage?.startsWith("en") ?? false;
    const navigate = useNavigate();

    const workflowSteps = [
        {
            step: "01",
            title: isEn ? "Pool Login" : "号池加号",
            detail: isEn ? "Popup login & auto video check" : "弹窗免复制登录，自动测通生视频",
        },
        {
            step: "02",
            title: isEn ? "AI Director" : "导演拆词",
            detail: isEn ? "Script to bilingual storyboard" : "剧本/访谈拆解中英双语分镜与负面词",
        },
        {
            step: "03",
            title: isEn ? "2K & Chaining" : "画布生图生视频",
            detail: isEn ? "2K sheets + end-frame continuity" : "2K 设定图 + 尾帧自动串联下一镜",
        },
        {
            step: "04",
            title: isEn ? "Batch Export" : "打包成片",
            detail: isEn ? "Cinema preview & ZIP download" : "无留白大屏回放，一键批量导出 ZIP",
        },
    ];

    return (
        <main className="relative h-full overflow-y-auto bg-[#f8f9fb] text-stone-950 selection:bg-indigo-500/20 dark:bg-[#06070a] dark:text-stone-100">
            {/* 建筑感精密网格 + 径向遮罩 + 顶部双极光氛围层 */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(99,102,241,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(99,102,241,0.06)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_80%_65%_at_50%_20%,#000_55%,transparent_100%)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)]" />
            <div className="pointer-events-none absolute inset-x-0 -top-24 h-[520px] bg-[radial-gradient(ellipse_65%_50%_at_50%_0%,rgba(99,102,241,0.22),rgba(139,92,246,0.08)_45%,transparent_75%)]" />
            <div className="pointer-events-none absolute right-1/4 top-32 h-72 w-72 rounded-full bg-emerald-500/10 blur-[110px]" />

            <section className="relative mx-auto flex min-h-full max-w-7xl flex-col justify-center px-6 py-10 lg:py-14">
                {/* ==================== Hero 区域 ==================== */}
                <div className="mx-auto max-w-4xl text-center">
                    <div className="inline-flex items-center gap-2.5 rounded-full border border-stone-200/90 bg-white/80 px-4 py-1.5 text-xs font-medium text-stone-700 shadow-xs backdrop-blur-md dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-300">
                        <span className="relative flex size-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                            <span className="relative inline-flex size-2 rounded-full bg-indigo-500" />
                        </span>
                        <span className="tracking-wide">
                            {isEn
                                ? "MOONFIELD STUDIO · AI DIRECTOR & INFINITE CANVAS"
                                : "月域创作引擎 · AI 导演分镜与多账号并发工作台"}
                        </span>
                    </div>

                    <h1 className="mt-6 text-balance text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-[64px] lg:leading-[1.08]">
                        <span className="bg-gradient-to-b from-stone-950 via-stone-800 to-stone-600 bg-clip-text text-transparent dark:from-white dark:via-stone-100 dark:to-stone-400">
                            {isEn ? "MoonField · " : "月域 · "}
                        </span>
                        <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-emerald-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-violet-300 dark:to-emerald-300">
                            Muse Studio
                        </span>
                    </h1>

                    <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-7 text-stone-600 sm:text-[17px] dark:text-stone-400">
                        {isEn
                            ? "From script breakdown and 2K character sheets to S01→S02 end-frame video continuity — powered by a multi-account concurrent pool."
                            : "从剧本拆词、2K 原画设定卡到 S01→S02 尾帧无缝视频接力，由多账号独立标签页并发号池驱动的一体化影视创作台。"}
                    </p>

                    {/* 两个大号高质感核心主按钮 */}
                    <div className="mt-9 flex flex-wrap items-center justify-center gap-4 sm:gap-5">
                        <button
                            type="button"
                            onClick={() => navigate("/canvas")}
                            className="group relative inline-flex h-15 cursor-pointer items-center justify-center gap-3.5 overflow-hidden rounded-2xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-9 text-base font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.32)_inset,0_16px_36px_-8px_rgba(79,70,229,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:from-indigo-500 hover:to-violet-600 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.4)_inset,0_20px_44px_-8px_rgba(79,70,229,0.7)] active:translate-y-0"
                        >
                            <span className="flex size-8 items-center justify-center rounded-xl bg-white/15 backdrop-blur-xs">
                                <Layers className="size-4.5" />
                            </span>
                            <span className="tracking-tight">{isEn ? "Open Infinite Canvas" : "进入无限画布"}</span>
                            <ArrowRight className="size-4.5 transition-transform duration-200 group-hover:translate-x-1" />
                        </button>

                        <button
                            type="button"
                            onClick={() => navigate("/pool")}
                            className="group relative inline-flex h-15 cursor-pointer items-center justify-center gap-3.5 rounded-2xl border border-stone-300/90 bg-white/90 px-9 text-base font-semibold text-stone-900 shadow-[0_1px_0_0_rgba(255,255,255,0.8)_inset,0_12px_28px_-10px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/60 hover:shadow-[0_16px_36px_-10px_rgba(16,185,129,0.22)] active:translate-y-0 dark:border-white/14 dark:bg-[#11131a]/90 dark:text-white dark:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_16px_36px_-12px_rgba(0,0,0,0.7)] dark:hover:border-emerald-400/50"
                        >
                            <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                                <Database className="size-4.5" />
                            </span>
                            <span className="tracking-tight">{isEn ? "Account Pool Console" : "先加账号（月域号池）"}</span>
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
                                {isEn ? "N×5 Parallel" : "支持并发"}
                            </span>
                        </button>
                    </div>
                </div>

                {/* ==================== 非对称 Bento Grid 核心工作区 ==================== */}
                <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
                    {/* Bento 主卡 1：无限画布 · AI 导演 (7列) */}
                    <button
                        type="button"
                        onClick={() => navigate("/canvas")}
                        className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-3xl border border-stone-200/90 bg-white/85 p-6 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.9)_inset,0_16px_40px_-16px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-500/50 hover:shadow-[0_20px_48px_-16px_rgba(79,70,229,0.2)] lg:col-span-7 dark:border-white/[0.08] dark:bg-[#0d0f16]/90 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_20px_48px_-20px_rgba(0,0,0,0.75)] dark:hover:border-indigo-400/45"
                    >
                        <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-indigo-500/10 blur-3xl transition-opacity group-hover:opacity-100" />

                        <div className="flex w-full items-start justify-between gap-4">
                            <div>
                                <div className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                                    <Wand2 className="size-3.5" />
                                    <span>{isEn ? "AI DIRECTOR WORKFLOW" : "核心创作流 · AI 导演画布"}</span>
                                </div>
                                <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
                                    {isEn ? "Infinite Canvas · Storyboard Graph" : "无限画布 · AI 导演分镜流"}
                                </h2>
                                <p className="mt-1.5 max-w-xl text-xs leading-5 text-stone-500 sm:text-sm dark:text-stone-400">
                                    {isEn
                                        ? "Auto-constructs 5-column vertical storyboard graphs with character sheets, 2K stills, and S01→S02 tail-frame video chaining."
                                        : "访谈或剧本一键生成纵向五列节点图：自动串联设定卡、2K 分镜首帧与 S01→S02 尾帧无缝视频接力。"}
                                </p>
                            </div>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-200/80 bg-stone-100/80 text-stone-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:border-indigo-500/40 group-hover:bg-indigo-500 group-hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
                                <ArrowUpRight className="size-4" />
                            </span>
                        </div>

                        {/* 内置可视化节点流缩略图（Bento 视觉焦点） */}
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-stone-200/70 bg-stone-50/90 px-4 py-3.5 text-xs dark:border-white/[0.06] dark:bg-[#08090e]/90">
                            <div className="flex items-center gap-2 rounded-xl border border-stone-200/80 bg-white px-3 py-2 shadow-2xs dark:border-white/10 dark:bg-[#12141d]">
                                <Sparkles className="size-3.5 text-violet-500" />
                                <span className="font-medium">{isEn ? "Script / Brief" : "剧本 / 导演拆词"}</span>
                            </div>
                            <span className="text-stone-300 dark:text-stone-600">━━▸</span>
                            <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/8 px-3 py-2 text-indigo-700 dark:text-indigo-300">
                                <ImageIcon className="size-3.5" />
                                <span className="font-medium">{isEn ? "2K Reference Card" : "2K 角色场景设定卡"}</span>
                            </div>
                            <span className="text-stone-300 dark:text-stone-600">━━▸</span>
                            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                                <Film className="size-3.5" />
                                <span className="font-medium">{isEn ? "S01 → S02 Tail Chain" : "S01 尾帧 ▸ S02 续接"}</span>
                            </div>
                        </div>
                    </button>

                    {/* Bento 主卡 2：月域号池管理 (5列) */}
                    <button
                        type="button"
                        onClick={() => navigate("/pool")}
                        className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-3xl border border-stone-200/90 bg-white/85 p-6 text-left shadow-[0_1px_0_0_rgba(255,255,255,0.9)_inset,0_16px_40px_-16px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-[0_20px_48px_-16px_rgba(16,185,129,0.18)] lg:col-span-5 dark:border-white/[0.08] dark:bg-[#0d0f16]/90 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_20px_48px_-20px_rgba(0,0,0,0.75)] dark:hover:border-emerald-400/45"
                    >
                        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />

                        <div className="flex w-full items-start justify-between gap-4">
                            <div>
                                <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                                    <Cpu className="size-3.5" />
                                    <span>{isEn ? "CONCURRENT ACCOUNT POOL" : "多账号调度引擎"}</span>
                                </div>
                                <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
                                    {isEn ? "MoonField Account Pool" : "月域号池控制台"}
                                </h2>
                                <p className="mt-1.5 text-xs leading-5 text-stone-500 sm:text-sm dark:text-stone-400">
                                    {isEn
                                        ? "One-click popup login, auto video capability probe, and true N×5 isolated-tab concurrency."
                                        : "弹窗免复制登录抓号、自动测通生视频能力，支持单号 1–5 并发（多号叠加最高 25 路并行）。"}
                                </p>
                            </div>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-200/80 bg-stone-100/80 text-stone-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:border-emerald-500/40 group-hover:bg-emerald-500 group-hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
                                <ArrowUpRight className="size-4" />
                            </span>
                        </div>

                        {/* 号池遥测微组件 */}
                        <div className="mt-6 grid grid-cols-3 gap-2">
                            <div className="rounded-xl border border-stone-200/70 bg-stone-50/90 px-3 py-2.5 dark:border-white/[0.06] dark:bg-[#08090e]/90">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="size-3.5" />
                                    <span>{isEn ? "Auto Probe" : "自动测视频"}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-stone-400">{isEn ? "Popup login" : "入池即验可用性"}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200/70 bg-stone-50/90 px-3 py-2.5 dark:border-white/[0.06] dark:bg-[#08090e]/90">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                                    <Zap className="size-3.5" />
                                    <span>{isEn ? "N × 5 Slots" : "N×5 并发"}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-stone-400">{isEn ? "Isolated tabs" : "后台多标签并行"}</div>
                            </div>
                            <div className="rounded-xl border border-stone-200/70 bg-stone-50/90 px-3 py-2.5 dark:border-white/[0.06] dark:bg-[#08090e]/90">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                    <Database className="size-3.5" />
                                    <span>{isEn ? "30m Keepalive" : "LRU 轮转"}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-stone-400">{isEn ? "Auto refresh" : "30分钟静默保活"}</div>
                            </div>
                        </div>
                    </button>

                    {/* 下排 3 张紧凑精密卡片 (4 + 4 + 4 = 12列) */}
                    <button
                        type="button"
                        onClick={() => navigate("/image")}
                        className="group flex cursor-pointer flex-col justify-between rounded-3xl border border-stone-200/90 bg-white/80 p-5 text-left backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-lg lg:col-span-4 dark:border-white/[0.08] dark:bg-[#0d0f16]/85"
                    >
                        <div className="flex items-center justify-between">
                            <span className="flex size-10 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-100/80 text-stone-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-200">
                                <ImageIcon className="size-5" />
                            </span>
                            <span className="rounded-full border border-stone-200/80 bg-stone-100/70 px-2.5 py-0.5 font-mono text-[11px] text-stone-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-400">
                                2048 × 1152 · 2K
                            </span>
                        </div>
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-base font-bold">
                                <span>{isEn ? "2K Image Studio" : "生图工作台 · 2K 原图"}</span>
                                <ArrowRight className="size-4 opacity-40 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">
                                {isEn
                                    ? "Default 2K high-res extraction via Muse lightbox with bilingual & negative prompt controls."
                                    : "默认 2K 高清参数，自动穿透 Muse 灯箱抓取高清原图，支持参考图与负面词排除。"}
                            </p>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate("/video")}
                        className="group flex cursor-pointer flex-col justify-between rounded-3xl border border-stone-200/90 bg-white/80 p-5 text-left backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-lg lg:col-span-4 dark:border-white/[0.08] dark:bg-[#0d0f16]/85"
                    >
                        <div className="flex items-center justify-between">
                            <span className="flex size-10 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-100/80 text-stone-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-200">
                                <Video className="size-5" />
                            </span>
                            <span className="rounded-full border border-stone-200/80 bg-stone-100/70 px-2.5 py-0.5 font-mono text-[11px] text-stone-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-400">
                                1–10s · First/Last Frame
                            </span>
                        </div>
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-base font-bold">
                                <span>{isEn ? "Motion Video Studio" : "视频创作台 · 首尾帧接力"}</span>
                                <ArrowRight className="size-4 opacity-40 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">
                                {isEn
                                    ? "1–10s Muse video generation, first & last frame continuity, and reverse video prompting."
                                    : "支持 1–10 秒自由时长、首尾帧无缝衔接、视频反推分镜提示词与批量打包下载。"}
                            </p>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate("/assets")}
                        className="group flex cursor-pointer flex-col justify-between rounded-3xl border border-stone-200/90 bg-white/80 p-5 text-left backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-lg lg:col-span-4 dark:border-white/[0.08] dark:bg-[#0d0f16]/85"
                    >
                        <div className="flex items-center justify-between">
                            <span className="flex size-10 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-100/80 text-stone-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-200">
                                <FolderTree className="size-5" />
                            </span>
                            <span className="rounded-full border border-stone-200/80 bg-stone-100/70 px-2.5 py-0.5 font-mono text-[11px] text-stone-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-400">
                                Cross-Tab Sync
                            </span>
                        </div>
                        <div className="mt-4">
                            <div className="flex items-center justify-between text-base font-bold">
                                <span>{isEn ? "Synced Asset Library" : "多级资产库 · 画布实时同步"}</span>
                                <ArrowRight className="size-4 opacity-40 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">
                                {isEn
                                    ? "Nested folders, drag & drop organization, local folder import, and selective folder ZIP export."
                                    : "支持多级嵌套文件夹、拖拽移动、本地文件夹整包导入与按指定文件夹导出 ZIP。"}
                            </p>
                        </div>
                    </button>
                </div>

                {/* ==================== 底部 4 步精密流水线横条 ==================== */}
                <div className="mt-5 grid gap-3 rounded-2xl border border-stone-200/80 bg-white/65 px-5 py-4 backdrop-blur-md sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.07] dark:bg-[#0b0d13]/80">
                    {workflowSteps.map((s) => (
                        <div key={s.step} className="flex items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-indigo-500/25 bg-indigo-500/10 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-300">
                                {s.step}
                            </span>
                            <div className="min-w-0">
                                <div className="truncate text-xs font-bold tracking-tight">{s.title}</div>
                                <div className="truncate text-[11px] text-stone-500 dark:text-stone-400">{s.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
