import crypto from "node:crypto";
import type { z } from "zod";

import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "../canvas/schemas.js";
import { AGENT_PROMPT, type AgentLlmConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

type OpenAiContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

type OpenAiToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

type OpenAiMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string | OpenAiContentPart[] }
    | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

type OpenAiTurnOptions = {
    threadId: string;
    llm: AgentLlmConfig;
    callTool: (name: ToolName, input: unknown) => Promise<unknown>;
    onStart?: () => void;
    onTurn?: (turnId: string) => void;
    onFinish?: () => void;
};

const MAX_TOOL_ROUNDS = 12;
const threadHistories = new Map<string, OpenAiMessage[]>();
const activeControllers = new Map<string, AbortController>();

function normalizeBaseUrl(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "");
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
    if (!def) return { type: "object" };
    const typeName = String(def.typeName || "");
    const description = typeof def.description === "string" ? def.description : undefined;
    const withDesc = (obj: Record<string, unknown>) => (description ? { ...obj, description } : obj);

    if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodNullable") {
        return withDesc(zodToJsonSchema(def.innerType as z.ZodTypeAny));
    }
    if (typeName === "ZodEffects") {
        return withDesc(zodToJsonSchema(def.schema as z.ZodTypeAny));
    }
    if (typeName === "ZodString") return withDesc({ type: "string" });
    if (typeName === "ZodNumber") return withDesc({ type: "number" });
    if (typeName === "ZodBoolean") return withDesc({ type: "boolean" });
    if (typeName === "ZodLiteral") return withDesc({ const: def.value });
    if (typeName === "ZodEnum") return withDesc({ type: "string", enum: def.values });
    if (typeName === "ZodArray") {
        return withDesc({ type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) });
    }
    if (typeName === "ZodRecord") {
        return withDesc({
            type: "object",
            additionalProperties: def.valueType ? zodToJsonSchema(def.valueType as z.ZodTypeAny) : true,
        });
    }
    if (typeName === "ZodUnion") {
        const options = Array.isArray(def.options) ? def.options : [];
        return withDesc({ anyOf: options.map((opt) => zodToJsonSchema(opt as z.ZodTypeAny)) });
    }
    if (typeName === "ZodObject") {
        const shapeFn = def.shape as (() => Record<string, z.ZodTypeAny>) | Record<string, z.ZodTypeAny>;
        const shape = typeof shapeFn === "function" ? shapeFn() : shapeFn || {};
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, fieldSchema] of Object.entries(shape)) {
            properties[key] = zodToJsonSchema(fieldSchema);
            const fDef = (fieldSchema as unknown as { _def?: { typeName?: string } })._def;
            if (fDef?.typeName !== "ZodOptional" && fDef?.typeName !== "ZodDefault") {
                required.push(key);
            }
        }
        return withDesc({
            type: "object",
            properties,
            ...(required.length ? { required } : {}),
        });
    }
    return withDesc({ type: "object" });
}

function buildOpenAiTools() {
    return toolNames.map((name) => ({
        type: "function" as const,
        function: {
            name,
            description: toolDescriptions[name],
            parameters: zodToJsonSchema(toolInputSchemas[name]),
        },
    }));
}

function buildUserContent(prompt: string, attachments: AgentAttachment[]): string | OpenAiContentPart[] {
    const parts: OpenAiContentPart[] = [{ type: "text", text: prompt }];
    for (const att of attachments) {
        if (att.dataUrl) {
            parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
        }
    }
    return parts.length === 1 ? prompt : parts;
}

export function interruptOpenAiTurn(threadId?: string) {
    if (threadId) {
        const ctrl = activeControllers.get(threadId);
        if (!ctrl) return false;
        ctrl.abort();
        return true;
    }
    if (!activeControllers.size) return false;
    for (const ctrl of activeControllers.values()) ctrl.abort();
    return true;
}

export async function testOpenAiProvider(llm: AgentLlmConfig): Promise<{ ok: boolean; reply?: string; error?: string }> {
    const baseUrl = normalizeBaseUrl(llm.baseUrl || "");
    const model = (llm.model || "").trim();
    const apiKey = (llm.apiKey || "").trim();
    if (!baseUrl) return { ok: false, error: "请填写 API Base URL" };
    if (!model) return { ok: false, error: "请填写模型名称（Model）" };
    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "Reply with OK only." }],
                max_tokens: 16,
                stream: false,
            }),
            signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        let data: Record<string, unknown> = {};
        try {
            data = JSON.parse(text) as Record<string, unknown>;
        } catch {
            // non-JSON
        }
        if (!res.ok) {
            const errMsg = (data?.error as { message?: string } | undefined)?.message || text.slice(0, 200) || `HTTP ${res.status}`;
            return { ok: false, error: errMsg };
        }
        const choices = Array.isArray(data.choices) ? (data.choices as Array<{ message?: { content?: string } }>) : [];
        const reply = choices[0]?.message?.content?.trim() || "OK";
        return { ok: true, reply };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function runOpenAiAgentTurn(prompt: string, emit: AgentEmit, attachments: AgentAttachment[], options: OpenAiTurnOptions) {
    const { threadId, llm, callTool, onStart, onTurn, onFinish } = options;
    const baseUrl = normalizeBaseUrl(llm.baseUrl || "");
    const model = (llm.model || "").trim();
    const apiKey = (llm.apiKey || "").trim();
    const turnId = `oai_turn_${crypto.randomUUID()}`;
    const controller = new AbortController();
    activeControllers.set(threadId, controller);

    onStart?.();
    onTurn?.(turnId);

    if (!baseUrl || !model) {
        emit("error", { threadId, turnId, message: "自定义 AI 接口未配置完整，请在「连接」页填写 Base URL 和模型名称。" });
        activeControllers.delete(threadId);
        onFinish?.();
        return;
    }

    const history = threadHistories.get(threadId) || [{ role: "system", content: AGENT_PROMPT }];
    history.push({ role: "user", content: buildUserContent(prompt, attachments) });
    threadHistories.set(threadId, history);

    const tools = buildOpenAiTools();

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const itemId = `oai_msg_${crypto.randomUUID()}`;
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify({
                    model,
                    messages: history,
                    tools,
                    tool_choice: "auto",
                    stream: false,
                }),
                signal: controller.signal,
            });

            const raw = await res.text();
            let payload: Record<string, unknown> = {};
            try {
                payload = JSON.parse(raw) as Record<string, unknown>;
            } catch {
                // ignore
            }
            if (!res.ok) {
                const errMsg = (payload?.error as { message?: string } | undefined)?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
                throw new Error(errMsg);
            }

            const choices = Array.isArray(payload.choices) ? payload.choices : [];
            const msg = (choices[0] as { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } } | undefined)?.message;
            if (!msg) throw new Error("模型返回格式无效（缺少 choices[0].message）");

            const assistantText = typeof msg.content === "string" ? msg.content : "";
            const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

            history.push({
                role: "assistant",
                content: assistantText || null,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            });

            if (assistantText.trim()) {
                emit("chat_message", {
                    threadId,
                    turnId,
                    message: {
                        id: `${threadId}:${turnId}:${itemId}`,
                        itemId,
                        threadId,
                        turnId,
                        role: "assistant",
                        text: assistantText,
                        itemType: "agent_message",
                        status: "completed",
                    },
                });
            }

            if (!toolCalls.length) {
                emit("turn_completed", { threadId, turnId, status: "completed" });
                return;
            }

            for (const tc of toolCalls) {
                const toolName = tc.function?.name as ToolName;
                const callItemId = tc.id || `tc_${crypto.randomUUID()}`;
                let parsedArgs: unknown = {};
                try {
                    parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
                } catch {
                    parsedArgs = {};
                }

                emit("chat_message", {
                    threadId,
                    turnId,
                    message: {
                        id: `${threadId}:${turnId}:${callItemId}`,
                        itemId: callItemId,
                        threadId,
                        turnId,
                        role: "assistant",
                        itemType: "mcp_tool_call",
                        tool: toolName,
                        server: "infinite-canvas",
                        status: "inProgress",
                        arguments: parsedArgs,
                    },
                });

                let toolResultText = "";
                let toolOk = true;
                try {
                    const schema = toolInputSchemas[toolName];
                    if (!schema) throw new Error(`未知画布工具: ${toolName}`);
                    const result = await callTool(toolName, schema.parse(parsedArgs));
                    toolResultText = JSON.stringify(result, null, 2);
                } catch (err) {
                    toolOk = false;
                    toolResultText = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
                }

                emit("chat_message", {
                    threadId,
                    turnId,
                    message: {
                        id: `${threadId}:${turnId}:${callItemId}`,
                        itemId: callItemId,
                        threadId,
                        turnId,
                        role: "assistant",
                        itemType: "mcp_tool_call",
                        tool: toolName,
                        server: "infinite-canvas",
                        status: toolOk ? "completed" : "failed",
                        arguments: parsedArgs,
                        result: toolResultText,
                    },
                });

                history.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: toolResultText,
                });
            }
        }

        emit("turn_completed", { threadId, turnId, status: "completed" });
    } catch (error) {
        if (controller.signal.aborted) {
            emit("turn_completed", { threadId, turnId, status: "interrupted" });
        } else {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn("OpenAI-compatible turn failed", { threadId, turnId, error: msg });
            emit("error", { threadId, turnId, message: msg });
        }
    } finally {
        activeControllers.delete(threadId);
        onFinish?.();
    }
}
