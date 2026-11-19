import { Fragment, useEffect, useState } from "react";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { CheckCircle2, Copy, Cpu, KeyRound, Link2, PlugZap, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

const AGENT_PLUGIN_INSTALL_WIN = 'git clone https://github.com/basketikun/infinite-canvas.git; cd infinite-canvas; codex plugin marketplace add "$PWD"; codex plugin add infinite-canvas@infinite-canvas-local';
const AGENT_PLUGIN_INSTALL_UNIX = 'git clone https://github.com/basketikun/infinite-canvas.git && cd infinite-canvas && codex plugin marketplace add "$(pwd)" && codex plugin add infinite-canvas@infinite-canvas-local';
const AGENT_MCP_ADD_COMMAND = "codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent@latest mcp";
const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove infinite-canvas";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove infinite-canvas";

const AI_PROVIDER_PRESETS = [
    { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
    { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
    { label: "Ollama 本地", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:14b" },
];

export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [provider, setProvider] = useState<"codex" | "openai-compatible">("codex");
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [apiKeyMasked, setApiKeyMasked] = useState("");
    const [model, setModel] = useState("");
    const [savingProvider, setSavingProvider] = useState(false);
    const [testingProvider, setTestingProvider] = useState(false);

    useEffect(() => {
        if (!connected || !url || !token) return;
        let active = true;
        fetch(`${url.replace(/\/$/, "")}/agent/provider`, { headers: { "x-canvas-agent-token": token } })
            .then((res) => res.json())
            .then((data: { ok?: boolean; provider?: "codex" | "openai-compatible"; baseUrl?: string; apiKeyMasked?: string; model?: string }) => {
                if (!active || !data?.ok) return;
                setProvider(data.provider === "openai-compatible" ? "openai-compatible" : "codex");
                setBaseUrl(data.baseUrl || "");
                setApiKeyMasked(data.apiKeyMasked || "");
                setModel(data.model || "");
                setApiKey("");
            })
            .catch(() => {
                // ignore when agent offline
            });
        return () => {
            active = false;
        };
    }, [connected, token, url]);

    const saveProvider = async (nextProvider = provider) => {
        if (!connected) {
            message.warning("请先连接本地 Agent");
            return;
        }
        setSavingProvider(true);
        try {
            const res = await fetch(`${url.replace(/\/$/, "")}/agent/provider`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-canvas-agent-token": token },
                body: JSON.stringify({ provider: nextProvider, baseUrl, apiKey, model }),
            });
            const data = (await res.json()) as { ok?: boolean; apiKeyMasked?: string; error?: string };
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
            if (data.apiKeyMasked) setApiKeyMasked(data.apiKeyMasked);
            setApiKey("");
            message.success(nextProvider === "openai-compatible" ? "已切换为自定义 OpenAI 兼容 API" : "已切换为 Codex 模式");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSavingProvider(false);
        }
    };

    const testProvider = async () => {
        if (!connected) {
            message.warning("请先连接本地 Agent");
            return;
        }
        setTestingProvider(true);
        try {
            const res = await fetch(`${url.replace(/\/$/, "")}/agent/provider/test`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-canvas-agent-token": token },
                body: JSON.stringify({ baseUrl, apiKey, model }),
            });
            const data = (await res.json()) as { ok?: boolean; reply?: string; error?: string };
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
            message.success(`API 连接成功：${data.reply || "OK"}`);
        } catch (error) {
            message.error(`测试失败：${error instanceof Error ? error.message : "未知错误"}`);
        } finally {
            setTestingProvider(false);
        }
    };
    const steps = [{ title: t("agent.connect.pluginTitle"), text: t("agent.connect.pluginText") }, { title: t("agent.connect.directTitle"), text: t("agent.connect.directText"), command: "npx -y @basketikun/canvas-agent@latest" }];
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const codexPluginReminder = (
        <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            <div className="font-medium" style={{ color: theme.node.text }}>
                {t("agent.connect.pluginReminder")}
            </div>
            <div className="mt-1">{t("agent.connect.pluginReminderText")}</div>
            <div className="mt-2 flex flex-col gap-1.5">
                {[
                    ["安装(Win)", AGENT_PLUGIN_INSTALL_WIN],
                    ["安装(Mac)", AGENT_PLUGIN_INSTALL_UNIX],
                    ["手动 MCP", AGENT_MCP_ADD_COMMAND],
                    [t("agent.connect.removePlugin"), AGENT_PLUGIN_REMOVE_COMMAND],
                    [t("agent.connect.removeMcp"), AGENT_MCP_REMOVE_COMMAND],
                ].map(([label, command]) => (
                    <div key={command} className="flex min-w-0 items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {label}
                        </span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6 shrink-0" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <Fragment key={step.title}>
                                <div className="rounded-lg px-3 py-2.5">
                                    <div className="text-sm font-medium leading-5">{step.title}</div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {step.text}
                                    </div>
                                    {command ? (
                                        <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                            <Tooltip title={t("agent.connect.copyCommand")}>
                                                <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                </div>
                                {index === 0 ? codexPluginReminder : null}
                            </Fragment>
                        );
                    })}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="rounded-xl border p-3.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-indigo-500" />
                            <span className="text-sm font-semibold">AI 模型接入 (开源多模型支持)</span>
                        </div>
                    </div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        可自由选择本机 Codex，或接入任意 OpenAI 兼容 API（DeepSeek、通义千问、OpenRouter、OneAPI、本地 Ollama 等），均支持调用画布工具。
                    </div>
                    <div className="mt-3">
                        <Segmented
                            block
                            value={provider}
                            onChange={(val) => {
                                const next = val as "codex" | "openai-compatible";
                                setProvider(next);
                                if (next === "codex" && connected) void saveProvider("codex");
                            }}
                            options={[
                                { label: "Codex (本机 CLI)", value: "codex" },
                                { label: "自定义 OpenAI 兼容 API", value: "openai-compatible" },
                            ]}
                        />
                    </div>
                    {provider === "openai-compatible" ? (
                        <div className="mt-3 grid gap-2.5">
                            <div className="flex flex-wrap gap-1.5">
                                {AI_PROVIDER_PRESETS.map((preset) => (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => {
                                            setBaseUrl(preset.baseUrl);
                                            setModel(preset.model);
                                        }}
                                        className="cursor-pointer rounded-md border px-2 py-0.5 text-[11px] transition hover:opacity-80"
                                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                            <label className="grid gap-1">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    API Base URL
                                </span>
                                <Input
                                    size="middle"
                                    prefix={<Link2 className="mr-1 size-3.5" style={{ color: theme.node.faint }} />}
                                    value={baseUrl}
                                    onChange={(e) => setBaseUrl(e.target.value)}
                                    placeholder="https://api.openai.com/v1"
                                />
                            </label>
                            <label className="grid gap-1">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    API Key
                                </span>
                                <Input.Password
                                    size="middle"
                                    prefix={<KeyRound className="mr-1 size-3.5" style={{ color: theme.node.faint }} />}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={apiKeyMasked ? `已保存 (${apiKeyMasked})，留空则沿用` : "sk-...（本地 Ollama 可留空）"}
                                />
                            </label>
                            <label className="grid gap-1">
                                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                    模型名称 (Model)
                                </span>
                                <Input
                                    size="middle"
                                    prefix={<Cpu className="mr-1 size-3.5" style={{ color: theme.node.faint }} />}
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    placeholder="gpt-4o / deepseek-chat / qwen-plus"
                                />
                            </label>
                            <div className="mt-1 flex items-center gap-2">
                                <Button type="primary" loading={savingProvider} disabled={!connected} onClick={() => void saveProvider("openai-compatible")} icon={<CheckCircle2 className="size-3.5" />}>
                                    保存并应用
                                </Button>
                                <Button loading={testingProvider} disabled={!connected} onClick={() => void testProvider()}>
                                    测试连接
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2.5 rounded-lg border px-2.5 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            当前使用本机 Codex CLI 登录态及 <code className="text-[11px]">~/.codex/config.toml</code> 配置。
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
