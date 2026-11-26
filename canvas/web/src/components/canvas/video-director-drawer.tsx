import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clapperboard, Copy, Film, HelpCircle, ImagePlus, Layers, PlusSquare, RefreshCw, RotateCcw, Send, Sparkles, Square } from "lucide-react";
import { App, Button, Drawer, Input, InputNumber, Segmented, Select, Space, Tag, Tooltip } from "antd";
import copy from "copy-to-clipboard";

import {
    buildDirectorSystemPrompt,
    buildWorkflowExtractPrompt,
    dedupeStreamText,
    extractDirectorBlocks,
    fallbackParseWorkflowFromText,
    formatBilingualNodePrompt,
    parseDirectorWorkflowJson,
    parseInterviewQuestion,
    type DirectorDetailLevel,
    type DirectorLanguage,
    type DirectorMode,
    type DirectorStructuredWorkflow,
} from "@/lib/video-director-prompt";
import { buildApiUrl, encodeChannelModel, modelOptionLabel, resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";

type ChatMsg = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

const MODE_OPTIONS: Array<{ label: string; value: DirectorMode }> = [
    { label: "导演访谈", value: "interview" },
    { label: "直接出词", value: "direct" },
    { label: "分段分镜", value: "storyboard" },
    { label: "视频反推", value: "reverse" },
];

const QUICK_CHIPS: Record<DirectorMode, string[]> = {
    interview: [
        "这一项由导演决定",
        "按 Muse 单段 ≤10 秒自动拆段，输出每段完整中英双语提示词",
    ],
    direct: ["暴雨夜霓虹街头，机械少女撑透明伞回眸", "电商口播带货：桌面暖光下展示极简金属保温杯"],
    storyboard: ["按 Muse 单段 ≤10 秒自动拆分全片分镜，输出每段中英双语提示词", "60 秒古风仙侠短片，按 10 秒一段自动拆成连续分镜"],
    reverse: ["反推这段画面：手持跟拍人物穿过狭窄菜市场，暖黄灯光，最后定格在摊位特写"],
};

function stripTrailingJsonBlock(text: string): string {
    return dedupeStreamText(text)
        .replace(/===WORKFLOW_JSON_START===[\s\S]*?(?:===WORKFLOW_JSON_END===|$)/g, "")
        .replace(/```(?:json|JSON)?\s*\{[\s\S]*?\}\s*```\s*$/g, "")
        .replace(/\{\s*"characters"\s*:[\s\S]*$/g, "")
        .trim();
}

export function VideoDirectorDrawer({
    open,
    initialText,
    sourceNodeId,
    onClose,
    onInsertTextNode,
    onWriteToSourceNode,
    onCreateVideoFlow,
    onBuildFullWorkflow,
}: {
    open: boolean;
    initialText?: string;
    sourceNodeId?: string;
    onClose: () => void;
    onInsertTextNode: (text: string, title?: string) => void;
    onWriteToSourceNode?: (nodeId: string, text: string) => void;
    onCreateVideoFlow: (opts: { prompt: string; firstFramePrompt?: string; aspectRatio: "16:9" | "9:16" }) => void;
    onBuildFullWorkflow?: (opts: { sourceNodeId?: string; scriptText: string; workflow: DirectorStructuredWorkflow; aspectRatio: "16:9" | "9:16"; imageCount: number }) => void;
}) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [mode, setMode] = useState<DirectorMode>("interview");
    const [durationSec, setDurationSec] = useState<number>(0);
    const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
    const [language, setLanguage] = useState<DirectorLanguage>("bilingual");
    const [detailLevel, setDetailLevel] = useState<DirectorDetailLevel>("detailed");
    const [nodePromptLang, setNodePromptLang] = useState<"bilingual" | "zh" | "en">("bilingual");
    const [imageCount, setImageCount] = useState<number>(() => Math.max(1, Number(config.canvasImageCount) || 1));
    const [input, setInput] = useState("");
    const [inlineReplyByMsgId, setInlineReplyByMsgId] = useState<Record<string, string>>({});
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [deepExtractingId, setDeepExtractingId] = useState<string | null>(null);
    const [regeneratingCardKey, setRegeneratingCardKey] = useState<string | null>(null);
    const [workflowOverrides, setWorkflowOverrides] = useState<Record<string, DirectorStructuredWorkflow>>({});
    const abortRef = useRef<AbortController | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const userScrolledUpRef = useRef(false);

    useEffect(() => {
        if (!open) return;
        if (initialText?.trim()) {
            setInput(initialText.trim());
        }
    }, [open, initialText, sourceNodeId]);

    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el || userScrolledUpRef.current) return;
        el.scrollTop = el.scrollHeight;
    }, [messages, streaming]);

    const handleScroll = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        userScrolledUpRef.current = distanceFromBottom > 120;
    };

    const fallbackTextChannel = config.channels.find((c) => c.models.some((m) => m.capability === "text"));
    const fallbackTextModel = fallbackTextChannel
        ? encodeChannelModel(fallbackTextChannel.id, fallbackTextChannel.models.find((m) => m.capability === "text")!.name)
        : config.model;
    const activeTextModel = config.textModel || fallbackTextModel;
    const reqCfg = resolveModelRequestConfig(config, activeTextModel);

    const stopGenerating = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStreaming(false);
        setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content.trim()) {
                return prev.slice(0, -1);
            }
            return prev;
        });
    };

    const resolveDirectorAuthKey = async () => {
        const direct = reqCfg.apiKey.trim();
        if (direct) return direct;
        if (!reqCfg.baseUrl || /127\.0\.0\.1|localhost/.test(reqCfg.baseUrl)) {
            try {
                const r = await fetch("/local-pool-info", { cache: "no-store" });
                if (r.ok) {
                    const info = (await r.json()) as { ok?: boolean; apiKey?: string };
                    if (info?.ok && info.apiKey) return info.apiKey.trim();
                }
            } catch {
                // ignore
            }
        }
        return "";
    };

    const callTextCompletion = async (sysPrompt: string, chatMessages: Array<{ role: "user" | "assistant"; content: string }>, signal?: AbortSignal) => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const authKey = await resolveDirectorAuthKey();
        if (authKey) headers.Authorization = `Bearer ${authKey}`;
        const res = await fetch(buildApiUrl(reqCfg.baseUrl, "/chat/completions"), {
            method: "POST",
            headers,
            signal,
            body: JSON.stringify({
                model: reqCfg.model || "muse-spark",
                stream: false,
                messages: [{ role: "system", content: sysPrompt }, ...chatMessages],
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(errText || `HTTP ${res.status}`);
        }
        const json = await res.json();
        return dedupeStreamText(String(json?.choices?.[0]?.message?.content || ""));
    };

    const sendMessage = async (overrideText?: string, forceMode?: DirectorMode, replaceLastAssistant = false, interrupt = false) => {
        const text = (overrideText ?? input).trim();
        if ((!text && !replaceLastAssistant) || (streaming && !interrupt)) return;
        if (!reqCfg.baseUrl.trim()) {
            message.error("请先在右上角配置文本模型渠道");
            return;
        }

        if (interrupt && abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }

        userScrolledUpRef.current = false;
        const effectiveMode = forceMode || mode;
        if (forceMode) setMode(forceMode);
        const assistantId = `a-${Date.now()}`;
        const baseMessages =
            messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1].content.trim()
                ? messages.slice(0, -1)
                : messages;
        let nextHistory: ChatMsg[];

        if (replaceLastAssistant && baseMessages.length >= 2) {
            nextHistory = baseMessages.slice(0, -1);
            setMessages([...nextHistory, { id: assistantId, role: "assistant", content: "" }]);
        } else {
            const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", content: text };
            nextHistory = [...baseMessages, userMsg];
            setMessages([...nextHistory, { id: assistantId, role: "assistant", content: "" }]);
            if (!overrideText) setInput("");
        }
        setStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const resetIdleTimer = (hasCompleteMarker: boolean) => {
            if (idleTimer) clearTimeout(idleTimer);
            // If we already received WORKFLOW_JSON_END, finish in 250ms; if clean content stopped growing for 6s, auto-complete so user never gets stuck waiting!
            const waitMs = hasCompleteMarker ? 250 : 6000;
            idleTimer = setTimeout(() => {
                if (abortRef.current === controller) {
                    controller.abort();
                }
            }, waitMs);
        };

        const systemPrompt = buildDirectorSystemPrompt({
            mode: effectiveMode,
            durationSec,
            aspectRatio,
            language,
            detailLevel,
        });

        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            const authKey = await resolveDirectorAuthKey();
            if (authKey) headers.Authorization = `Bearer ${authKey}`;

            const res = await fetch(buildApiUrl(reqCfg.baseUrl, "/chat/completions"), {
                method: "POST",
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model: reqCfg.model || "muse-spark",
                    stream: true,
                    messages: [
                        { role: "system", content: systemPrompt },
                        ...nextHistory.filter((m) => m.content.trim().length > 0).map((m) => ({ role: m.role, content: m.content })),
                    ],
                }),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(errText || `HTTP ${res.status}`);
            }

            const reader = res.body?.getReader();
            if (!reader) {
                const json = await res.json();
                const full = dedupeStreamText(String(json?.choices?.[0]?.message?.content || ""));
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m)));
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let accumulated = "";
            let lastCleanLen = 0;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const raw of lines) {
                    const line = raw.trim();
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") {
                        if (idleTimer) clearTimeout(idleTimer);
                        break;
                    }
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed?.error?.message) {
                            throw new Error(String(parsed.error.message));
                        }
                        const delta = parsed?.choices?.[0]?.delta?.content;
                        if (typeof delta === "string" && delta) {
                            accumulated += delta;
                            const cleanDisplay = dedupeStreamText(accumulated);
                            if (cleanDisplay.length !== lastCleanLen) {
                                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: cleanDisplay } : m)));
                                if (cleanDisplay.length > 60 && cleanDisplay.length > lastCleanLen) {
                                    resetIdleTimer(cleanDisplay.includes("===WORKFLOW_JSON_END==="));
                                }
                                lastCleanLen = cleanDisplay.length;
                            }
                        }
                    } catch (chunkErr) {
                        if (chunkErr instanceof Error && !(chunkErr instanceof SyntaxError)) {
                            throw chunkErr;
                        }
                        // ignore partial JSON chunks
                    }
                }
            }
        } catch (err) {
            if ((err as Error)?.name !== "AbortError") {
                const msg = err instanceof Error ? err.message : "请求失败";
                message.error(`导演请求失败：${msg}`);
                setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId && !m.content ? { ...m, content: `请求失败：${msg}` } : m)),
                );
            }
        } finally {
            if (idleTimer) clearTimeout(idleTimer);
            if (abortRef.current === controller) {
                abortRef.current = null;
                setStreaming(false);
            }
        }
    };

    const formatWorkflowByLang = (wf: DirectorStructuredWorkflow): DirectorStructuredWorkflow => {
        const formatCard = <T extends { name: string; prompt: string; enPrompt?: string }>(c: T): T => ({
            ...c,
            prompt:
                nodePromptLang === "en" && c.enPrompt
                    ? c.enPrompt
                    : nodePromptLang === "zh"
                      ? c.prompt
                      : formatBilingualNodePrompt(c.prompt, c.enPrompt),
        });
        return {
            characters: wf.characters.map(formatCard),
            scenes: wf.scenes.map(formatCard),
            props: wf.props.map(formatCard),
            segments: wf.segments.map((seg) => {
                const zh = seg.prompt || "";
                const en = seg.enPrompt || "";
                const finalPrompt =
                    nodePromptLang === "en" && en
                        ? en
                        : nodePromptLang === "zh"
                          ? zh
                          : formatBilingualNodePrompt(zh, en);
                const ffZh = seg.firstFramePrompt || "";
                const ffEn = seg.firstFrameEnPrompt || "";
                const finalFirstFramePrompt =
                    nodePromptLang === "en"
                        ? ffEn || ffZh
                        : nodePromptLang === "zh"
                          ? ffZh
                          : formatBilingualNodePrompt(ffZh, ffEn);
                return { ...seg, prompt: finalPrompt, ...(finalFirstFramePrompt ? { firstFramePrompt: finalFirstFramePrompt } : {}) };
            }),
        };
    };

    const getResolvedWorkflow = (msgId: string, cleanText: string): DirectorStructuredWorkflow | null => {
        if (workflowOverrides[msgId]) return workflowOverrides[msgId];
        return parseDirectorWorkflowJson(cleanText) || fallbackParseWorkflowFromText(cleanText);
    };

    const handleRegenerateSingleCard = async (
        msgId: string,
        baseWf: DirectorStructuredWorkflow,
        kind: "characters" | "scenes" | "props",
        index: number,
    ) => {
        const item = baseWf[kind][index];
        if (!item || regeneratingCardKey) return;
        const key = `${msgId}-${kind}-${index}`;
        setRegeneratingCardKey(key);
        try {
            const kindLabel = kind === "characters" ? "角色真人实拍正面定妆照设定卡" : kind === "scenes" ? `实拍空镜场景设定卡（${aspectRatio}画幅，具体前中远景、材质与光线，严禁人物）` : "关键道具实拍特写设定卡";
            const newPrompt = await callTextCompletion(
                "你是专业影视美术设定师，只输出一段可直接用于文生图的详细中文设定图提示词，不要输出多余寒暄或代码块。",
                [
                    {
                        role: "user",
                        content: `请基于以下设定重新优化并生成一份更精细、防跑偏的【${kindLabel} · ${item.name}】文生图提示词（当前版本：${item.prompt}）。直接输出新提示词正文：`,
                    },
                ],
            );
            if (newPrompt.trim()) {
                const nextList = [...baseWf[kind]];
                nextList[index] = { ...item, prompt: newPrompt.trim() };
                setWorkflowOverrides((prev) => ({
                    ...prev,
                    [msgId]: { ...baseWf, [kind]: nextList },
                }));
                message.success(`已重新生成：${item.name}`);
            }
        } catch (err) {
            message.error(`重新生成失败：${err instanceof Error ? err.message : "未知错误"}`);
        } finally {
            setRegeneratingCardKey(null);
        }
    };

    const handleDeepReExtractWorkflow = async (msgId: string, scriptText: string) => {
        if (deepExtractingId || extractingId) return;
        if (streaming) stopGenerating();
        setDeepExtractingId(msgId);
        try {
            const fullContext = messages
                .map((m) => `${m.role === "user" ? "【用户脚本/要求】" : "【导演方案】"}\n${dedupeStreamText(m.content)}`)
                .join("\n\n");
            const extractPrompt = buildWorkflowExtractPrompt(fullContext || scriptText, aspectRatio, durationSec);
            const rawJson = await callTextCompletion(
                "你是专业影视分镜与资产拆解专家，必须逐段核对所有独立角色、所有不同物理地点场景（多场景绝不合并）及道具，只输出 ===WORKFLOW_JSON_START=== 和 ===WORKFLOW_JSON_END=== 包裹的单行合法 JSON 对象。",
                [{ role: "user", content: extractPrompt }],
            );
            const workflow = parseDirectorWorkflowJson(rawJson);
            if (!workflow || !workflow.segments.length) {
                message.error("重新深度拆解未返回有效结构，请再试一次");
                return;
            }
            setWorkflowOverrides((prev) => ({ ...prev, [msgId]: workflow }));
            message.success(
                `已重新深度拆解：${workflow.characters.length} 角色卡 · ${workflow.scenes.length} 场景卡 · ${workflow.props.length} 道具卡 · ${workflow.segments.length} 段分镜`,
            );
        } catch (err) {
            message.error(`重新深度拆解失败：${err instanceof Error ? err.message : "未知错误"}`);
        } finally {
            setDeepExtractingId(null);
        }
    };

    const handleSplitAndBuildWorkflow = async (msgId: string, scriptText: string) => {
        if (!onBuildFullWorkflow || extractingId) return;
        if (streaming) stopGenerating();
        setExtractingId(msgId);
        try {
            const explicitJsonWorkflow = workflowEdits[msgId] || parseDirectorWorkflowJson(scriptText);
            let workflow = explicitJsonWorkflow;

            if (!workflow || !workflow.segments.length) {
                const fullContext = messages
                    .map((m) => `${m.role === "user" ? "【用户脚本/要求】" : "【导演方案】"}\n${dedupeStreamText(m.content)}`)
                    .join("\n\n");
                const extractPrompt = buildWorkflowExtractPrompt(fullContext || scriptText, aspectRatio, durationSec);
                try {
                    const rawJson = await callTextCompletion(
                        "你是专业分镜结构化助手，只输出 ===WORKFLOW_JSON_START=== 和 ===WORKFLOW_JSON_END=== 包裹的单行合法 JSON 对象。",
                        [{ role: "user", content: extractPrompt }],
                    );
                    workflow = parseDirectorWorkflowJson(rawJson);
                } catch {
                    workflow = null;
                }
                if (!workflow || !workflow.segments.length) {
                    workflow = getResolvedWorkflow(msgId, scriptText);
                }
            }

            if (!workflow || !workflow.segments.length) {
                message.error("未能提取出分镜段落，请先输入创意并点击发送");
                return;
            }

            const formatted = formatWorkflowByLang(workflow);
            onBuildFullWorkflow({
                sourceNodeId,
                scriptText: stripTrailingJsonBlock(scriptText),
                workflow: formatted,
                aspectRatio,
                imageCount,
            });
            message.success(
                `已拆分搭建到画布：${formatted.characters.length} 个角色设定卡、${formatted.scenes.length} 个场景设定卡、${formatted.props.length} 个道具设定卡、${formatted.segments.length} 段分镜`,
            );
        } catch (err) {
            const localFallback = getResolvedWorkflow(msgId, scriptText);
            if (localFallback && localFallback.segments.length > 0) {
                const formatted = formatWorkflowByLang(localFallback);
                onBuildFullWorkflow({
                    sourceNodeId,
                    scriptText: stripTrailingJsonBlock(scriptText),
                    workflow: formatted,
                    aspectRatio,
                    imageCount,
                });
                message.success(`已从正文拆分搭建到画布：${formatted.segments.length} 段分镜`);
            } else {
                message.error(`拆分失败：${err instanceof Error ? err.message : "未知错误"}`);
            }
        } finally {
            setExtractingId(null);
        }
    };

    const handleCopy = (text: string, label: string) => {
        if (!text) return;
        copy(text);
        message.success(`已复制${label}`);
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={680}
            title={
                <div className="flex items-center gap-2">
                    <Clapperboard className="size-4 text-amber-500" />
                    <span>视频提示词导演（muse-video-prompt）</span>
                    <Tag color="blue" className="m-0 text-xs">
                        {modelOptionLabel(config, activeTextModel)}
                    </Tag>
                    {sourceNodeId ? <Tag color="gold" className="m-0 text-xs">已绑定文本节点</Tag> : null}
                </div>
            }
            extra={
                <Button
                    size="small"
                    icon={<RotateCcw className="size-3.5" />}
                    onClick={() => {
                        stopGenerating();
                        setMessages([]);
                        setWorkflowOverrides({});
                    }}
                >
                    新对话
                </Button>
            }
        >
            <div className="flex h-full flex-col gap-3">
                <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                    <Segmented
                        block
                        value={mode}
                        onChange={(v) => setMode(v as DirectorMode)}
                        options={MODE_OPTIONS}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Space size={4}>
                            <span className="text-stone-500">总时长(秒)</span>
                            <InputNumber
                                size="small"
                                min={0}
                                max={600}
                                step={5}
                                value={durationSec}
                                onChange={(v) => setDurationSec(Number(v) || 0)}
                                style={{ width: 74 }}
                                placeholder="0=自动"
                            />
                            <span className="text-[11px] text-stone-400">
                                {durationSec > 0 ? `≈${Math.ceil(durationSec / 10)}段×≤10s` : "0=按剧本/访谈自动拆段"}
                            </span>
                        </Space>
                        <Space size={4}>
                            <span className="text-stone-500">画幅</span>
                            <Select
                                size="small"
                                value={aspectRatio}
                                onChange={setAspectRatio}
                                style={{ width: 78 }}
                                options={[
                                    { label: "16:9", value: "16:9" },
                                    { label: "9:16", value: "9:16" },
                                ]}
                            />
                        </Space>
                        <Space size={4}>
                            <span className="text-stone-500">输出</span>
                            <Select
                                size="small"
                                value={language}
                                onChange={setLanguage}
                                style={{ width: 92 }}
                                options={[
                                    { label: "中英双语", value: "bilingual" },
                                    { label: "仅中文", value: "zh" },
                                    { label: "仅英文", value: "en" },
                                ]}
                            />
                        </Space>
                        <Space size={4}>
                            <span className="text-stone-500">篇幅</span>
                            <Select
                                size="small"
                                value={detailLevel}
                                onChange={setDetailLevel}
                                style={{ width: 100 }}
                                options={[
                                    { label: "详细导演版", value: "detailed" },
                                    { label: "精简可复制", value: "concise" },
                                ]}
                            />
                        </Space>
                        <Space size={4}>
                            <span className="text-stone-500">生图张数</span>
                            <Select
                                size="small"
                                value={imageCount}
                                onChange={(val) => {
                                    setImageCount(val);
                                    updateConfig("canvasImageCount", String(val));
                                }}
                                style={{ width: 72 }}
                                options={[
                                    { label: "1 张", value: 1 },
                                    { label: "2 张", value: 2 },
                                    { label: "3 张", value: 3 },
                                    { label: "4 张", value: 4 },
                                ]}
                            />
                        </Space>
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-1 space-y-3 overflow-y-auto pr-1"
                >
                    {messages.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-stone-300 p-4 text-xs leading-6 text-stone-500 dark:border-stone-700 dark:text-stone-400">
                            <div className="mb-1 font-medium text-stone-700 dark:text-stone-200">
                                小白全流程：一句话创意 → 弹出式导演提问 → 中英双语分镜 → 一键拆角色/场景/道具上画布
                            </div>
                            <ul className="list-disc space-y-1 pl-4">
                                <li>
                                    <b>导演访谈（带交互提问框）</b>：导演每次提 1 个问题并弹出可点击选项框；也可随时点下方「结束提问直接出双语分镜」。
                                </li>
                                <li>
                                    <b>独立设定卡 + 单卡重新生成</b>：自动拆出不同内容的<b>角色设定卡（三视图）、场景设定卡、道具设定卡</b>，每张卡支持单独重新生成或一键全套上画布。
                                </li>
                            </ul>
                        </div>
                    ) : null}

                    {messages.map((msg, idx) => {
                        const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
                        const isMsgStreaming = streaming && isLastAssistant;
                        const cleanText = msg.role === "assistant" ? dedupeStreamText(msg.content) : msg.content;
                        const isErrorMsg = msg.role === "assistant" && /^请求失败[：:]/.test(cleanText.trim());
                        const extracted = msg.role === "assistant" && cleanText && !isErrorMsg ? extractDirectorBlocks(cleanText) : null;
                        const interviewQ = msg.role === "assistant" && cleanText && !isErrorMsg ? parseInterviewQuestion(cleanText) : null;
                        const parsedWf =
                            msg.role === "assistant" && !isMsgStreaming && cleanText && !isErrorMsg && !interviewQ
                                ? getResolvedWorkflow(msg.id, cleanText)
                                : null;
                        const displayContent =
                            msg.role === "assistant"
                                ? stripTrailingJsonBlock(interviewQ ? interviewQ.preface || cleanText : cleanText)
                                : cleanText;
                        const primaryPrompt = extracted?.zhPrompt || extracted?.enPrompt || "";

                        return (
                            <div
                                key={msg.id}
                                className={
                                    msg.role === "user"
                                        ? "ml-10 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-stone-900 dark:text-stone-100"
                                        : "mr-1 rounded-lg border border-stone-200 bg-white px-3.5 py-3 text-xs leading-6 text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
                                }
                            >
                                {displayContent ? (
                                    <pre className="m-0 whitespace-pre-wrap break-words font-sans">{displayContent}</pre>
                                ) : !interviewQ ? (
                                    <pre className="m-0 whitespace-pre-wrap break-words font-sans">导演思考中...</pre>
                                ) : null}

                                {/* 交互式导演提问框 */}
                                {interviewQ ? (
                                    <div className="mt-3 rounded-xl border-2 border-amber-400/80 bg-amber-50/70 p-3 dark:border-amber-500/60 dark:bg-amber-950/30">
                                        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                                            <HelpCircle className="size-4 shrink-0 text-amber-500" />
                                            <span>{interviewQ.question}</span>
                                        </div>
                                        <div className="mt-2.5 flex flex-col gap-1.5">
                                            {interviewQ.options.map((opt, optIdx) => (
                                                <button
                                                    key={`${opt}-${optIdx}`}
                                                    type="button"
                                                    disabled={streaming}
                                                    onClick={() => void sendMessage(opt)}
                                                    className="flex cursor-pointer items-center justify-between rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-xs font-medium text-stone-800 shadow-xs transition hover:border-amber-500 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-amber-900/40"
                                                >
                                                    <span>
                                                        {String.fromCharCode(65 + optIdx)}. {opt}
                                                    </span>
                                                    <span className="shrink-0 pl-2 text-[11px] text-amber-600 dark:text-amber-400">点击选择 →</span>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/80 pt-2 dark:border-amber-800/60">
                                            <div className="flex min-w-[180px] flex-1 items-center gap-1.5">
                                                <Input
                                                    size="small"
                                                    placeholder="可直接在此自由输入回答（回车发送）"
                                                    value={inlineReplyByMsgId[msg.id] || ""}
                                                    disabled={streaming}
                                                    onChange={(e) => setInlineReplyByMsgId((prev) => ({ ...prev, [msg.id]: e.target.value }))}
                                                    onPressEnter={() => {
                                                        const val = (inlineReplyByMsgId[msg.id] || "").trim();
                                                        if (!val || streaming) return;
                                                        setInlineReplyByMsgId((prev) => ({ ...prev, [msg.id]: "" }));
                                                        void sendMessage(val);
                                                    }}
                                                    className="!text-xs"
                                                />
                                                {(inlineReplyByMsgId[msg.id] || "").trim() ? (
                                                    <Button
                                                        size="small"
                                                        disabled={streaming}
                                                        onClick={() => {
                                                            const val = (inlineReplyByMsgId[msg.id] || "").trim();
                                                            if (!val || streaming) return;
                                                            setInlineReplyByMsgId((prev) => ({ ...prev, [msg.id]: "" }));
                                                            void sendMessage(val);
                                                        }}
                                                    >
                                                        发送
                                                    </Button>
                                                ) : null}
                                            </div>
                                            <Button
                                                size="small"
                                                type="primary"
                                                icon={<Sparkles className="size-3.5" />}
                                                onClick={() => {
                                                    void sendMessage(
                                                        "不要再提问了，剩余所有未确认项全部由导演决定，请立即按 Muse 单段 ≤10 秒自动拆段，输出每一段完整的【S0X 中文视频提示词】+【S0X English Video Prompt】以及末尾 ===WORKFLOW_JSON_START=== 拆分数据。",
                                                        "storyboard",
                                                        false,
                                                        true,
                                                    );
                                                }}
                                            >
                                                结束提问，立即生成中英双语分镜
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}

                                {/* 流式输出中提示：仅当已开始输出分镜/设定内容且尚未结束时显示，避免刚发脚本还在思考就提示拆分 */}
                                {isMsgStreaming &&
                                !interviewQ &&
                                cleanText.trim().length > 60 &&
                                /S0?1|角色设定|场景设定|道具设定|中文视频提示词|English Video Prompt|WORKFLOW_JSON/i.test(cleanText) ? (
                                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-300">
                                        <span className="inline-block size-2 animate-pulse rounded-full bg-amber-500" />
                                        <span>正在生成完整分镜与拆分数据，请等待输出结束后再点击「一键拆分搭建全流程」...</span>
                                    </div>
                                ) : null}

                                {/* 已拆分出的角色设定卡、场景设定卡、道具设定卡与分段分镜预览（含单卡重新生成） */}
                                {!isMsgStreaming && parsedWf && parsedWf.segments.length > 0 ? (
                                    <div className="mt-3 space-y-2 rounded-xl border border-emerald-300/80 bg-emerald-50/40 p-3 dark:border-emerald-800/70 dark:bg-emerald-950/20">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                                <CheckCircle2 className="size-4 text-emerald-500" />
                                                <span>
                                                    已拆分就绪：{parsedWf.characters.length} 角色卡 · {parsedWf.scenes.length} 场景卡 · {parsedWf.props.length} 道具卡 · {parsedWf.segments.length} 段分镜
                                                </span>
                                            </div>
                                            <Space size={6} wrap>
                                                <Tooltip title="由 AI 重新通读上下文与全部段落，细化并拆出全部独立角色、多场景与道具">
                                                    <Button
                                                        size="small"
                                                        loading={deepExtractingId === msg.id}
                                                        icon={<Sparkles className="size-3" />}
                                                        onClick={() => void handleDeepReExtractWorkflow(msg.id, cleanText)}
                                                    >
                                                        重新深度拆解
                                                    </Button>
                                                </Tooltip>
                                                <span className="text-[11px] text-stone-500">上画布语言:</span>
                                                <Select
                                                    size="small"
                                                    value={nodePromptLang}
                                                    onChange={setNodePromptLang}
                                                    style={{ width: 96 }}
                                                    options={[
                                                        { label: "中英双语", value: "bilingual" },
                                                        { label: "仅中文", value: "zh" },
                                                        { label: "仅英文", value: "en" },
                                                    ]}
                                                />
                                            </Space>
                                        </div>

                                        {/* 角色设定卡 / 场景设定卡 / 道具设定卡 独立列表 + 重新生成 */}
                                        {(["characters", "scenes", "props"] as const).map((kind) => {
                                            const list = parsedWf[kind];
                                            if (!list.length) return null;
                                            const badgeLabel = kind === "characters" ? "角色设定卡" : kind === "scenes" ? "场景设定卡" : "道具设定卡";
                                            const badgeColor = kind === "characters" ? "purple" : kind === "scenes" ? "cyan" : "orange";
                                            return (
                                                <div key={kind} className="space-y-1">
                                                    {list.map((card, cIdx) => {
                                                        const cardKey = `${msg.id}-${kind}-${cIdx}`;
                                                        return (
                                                            <div
                                                                key={cardKey}
                                                                className="flex items-start justify-between gap-2 rounded-lg border border-stone-200/80 bg-white px-2.5 py-1.5 text-[11px] dark:border-stone-800 dark:bg-stone-900"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Tag color={badgeColor} className="m-0 text-[10px]">
                                                                            {badgeLabel}
                                                                        </Tag>
                                                                        <span className="font-semibold text-stone-800 dark:text-stone-100">{card.name}</span>
                                                                    </div>
                                                                    <div className="mt-0.5 line-clamp-2 text-stone-500 dark:text-stone-400">{card.prompt}</div>
                                                                </div>
                                                                <div className="flex shrink-0 items-center gap-1">
                                                                    <Tooltip title="重新生成此设定卡提示词">
                                                                        <Button
                                                                            size="small"
                                                                            type="text"
                                                                            loading={regeneratingCardKey === cardKey}
                                                                            icon={<RefreshCw className="size-3" />}
                                                                            onClick={() => void handleRegenerateSingleCard(msg.id, parsedWf, kind, cIdx)}
                                                                        >
                                                                            重写
                                                                        </Button>
                                                                    </Tooltip>
                                                                    <Tooltip title="单独把这张设定卡插入画布">
                                                                        <Button
                                                                            size="small"
                                                                            type="text"
                                                                            icon={<PlusSquare className="size-3" />}
                                                                            onClick={() => {
                                                                                onInsertTextNode(card.prompt, `${badgeLabel} · ${card.name}`);
                                                                                message.success(`已插入：${badgeLabel} · ${card.name}`);
                                                                            }}
                                                                        />
                                                                    </Tooltip>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}

                                        {/* 分段分镜列表 */}
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            {parsedWf.segments.map((seg) => (
                                                <div key={seg.id} className="flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] dark:border-emerald-800 dark:bg-stone-900">
                                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">{seg.id}</span>
                                                    <span className="max-w-[110px] truncate text-stone-600 dark:text-stone-300">{seg.title}</span>
                                                    <Button size="small" type="link" className="!h-4 !px-1 !text-[11px]" onClick={() => handleCopy(seg.prompt, `${seg.id} 中文提示词`)}>
                                                        中
                                                    </Button>
                                                    {seg.enPrompt ? (
                                                        <Button size="small" type="link" className="!h-4 !px-1 !text-[11px]" onClick={() => handleCopy(seg.enPrompt!, `${seg.id} 英文提示词`)}>
                                                            EN
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {/* 底部操作栏：流式生成彻底完成后才显示，避免未生成完误点拆分导致内容残缺 */}
                                {msg.role === "assistant" && !isMsgStreaming && cleanText.length > 40 && !interviewQ && !isErrorMsg ? (
                                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-stone-200 pt-2 dark:border-stone-800">
                                        {onBuildFullWorkflow ? (
                                            <Button
                                                size="small"
                                                type="primary"
                                                loading={extractingId === msg.id}
                                                icon={<Layers className="size-3" />}
                                                onClick={() => void handleSplitAndBuildWorkflow(msg.id, cleanText)}
                                            >
                                                一键拆分搭建全流程
                                            </Button>
                                        ) : null}
                                        {isLastAssistant ? (
                                            <Button
                                                size="small"
                                                icon={<RefreshCw className="size-3" />}
                                                onClick={() => {
                                                    void sendMessage(undefined, undefined, true, true);
                                                }}
                                            >
                                                重新生成
                                            </Button>
                                        ) : null}
                                        {extracted?.zhPrompt ? (
                                            <Button size="small" icon={<Copy className="size-3" />} onClick={() => handleCopy(extracted.zhPrompt, "全部中文提示词")}>
                                                复制中文
                                            </Button>
                                        ) : null}
                                        {extracted?.enPrompt ? (
                                            <Button size="small" icon={<Copy className="size-3" />} onClick={() => handleCopy(extracted.enPrompt, "全部英文提示词")}>
                                                复制英文
                                            </Button>
                                        ) : null}
                                        {sourceNodeId && onWriteToSourceNode ? (
                                            <Button
                                                size="small"
                                                icon={<PlusSquare className="size-3" />}
                                                onClick={() => {
                                                    onWriteToSourceNode(sourceNodeId, stripTrailingJsonBlock(cleanText));
                                                    message.success("已回写到原文本节点");
                                                }}
                                            >
                                                写入原文本节点
                                            </Button>
                                        ) : primaryPrompt ? (
                                            <Button
                                                size="small"
                                                icon={<PlusSquare className="size-3" />}
                                                onClick={() => {
                                                    onInsertTextNode(primaryPrompt, "导演视频提示词");
                                                    message.success("已插入文本节点到画布");
                                                }}
                                            >
                                                插入文本节点
                                            </Button>
                                        ) : null}
                                        {primaryPrompt ? (
                                            <Button
                                                size="small"
                                                icon={<Film className="size-3" />}
                                                onClick={() => {
                                                    onCreateVideoFlow({
                                                        prompt: primaryPrompt,
                                                        aspectRatio,
                                                    });
                                                    message.success("已在画布创建：提示词 + 视频节点并连线");
                                                }}
                                            >
                                                建单段视频流
                                            </Button>
                                        ) : null}
                                        {extracted?.firstFramePrompt ? (
                                            <Button
                                                size="small"
                                                icon={<ImagePlus className="size-3" />}
                                                onClick={() => {
                                                    onCreateVideoFlow({
                                                        prompt: primaryPrompt,
                                                        firstFramePrompt: extracted.firstFramePrompt,
                                                        aspectRatio,
                                                    });
                                                    message.success("已创建：首帧生图 + 提示词 + 视频节点");
                                                }}
                                            >
                                                + 首帧生图流
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}

                                {isLastAssistant && isErrorMsg ? (
                                    <div className="mt-2 flex justify-end">
                                        <Button
                                            size="small"
                                            icon={<RefreshCw className="size-3" />}
                                            onClick={() => void sendMessage(undefined, undefined, true)}
                                        >
                                            重试该请求
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {messages.length > 0 && mode === "interview" ? (
                        <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<Sparkles className="size-3" />}
                            onClick={() => {
                                void sendMessage(
                                    "不要再提问了，剩余所有未确认项全部由导演决定，请立即按 Muse 单段 ≤10 秒自动拆段，输出每一段完整的【S0X 中文视频提示词】+【S0X English Video Prompt】以及末尾 ===WORKFLOW_JSON_START=== 拆分数据。",
                                    "storyboard",
                                    false,
                                    true,
                                );
                            }}
                        >
                            ⚡ 结束提问，立即生成双语分镜
                        </Button>
                    ) : null}
                    {QUICK_CHIPS[mode].map((chip) => (
                        <button
                            key={chip}
                            type="button"
                            disabled={streaming}
                            onClick={() => void sendMessage(chip)}
                            className="cursor-pointer rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-600 transition hover:border-amber-400 hover:text-amber-600 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
                        >
                            {chip}
                        </button>
                    ))}
                </div>

                <div className="flex items-end gap-2">
                    <Input.TextArea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void sendMessage();
                            }
                        }}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        placeholder="输入你的视频创意、点击上方提问卡片选项，或自由输入回答（Enter 发送，Shift+Enter 换行）"
                    />
                    {streaming ? (
                        <Button danger icon={<Square className="size-3.5" />} onClick={stopGenerating}>
                            停止
                        </Button>
                    ) : (
                        <Button type="primary" icon={<Send className="size-3.5" />} onClick={() => void sendMessage()}>
                            发送
                        </Button>
                    )}
                </div>
            </div>
        </Drawer>
    );
}
