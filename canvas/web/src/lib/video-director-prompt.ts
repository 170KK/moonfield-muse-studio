export type DirectorMode = "interview" | "direct" | "storyboard" | "reverse";

export type DirectorLanguage = "bilingual" | "zh" | "en";

export type DirectorDetailLevel = "detailed" | "concise";

export type DirectorOptions = {
    mode: DirectorMode;
    durationSec: number; // 0 means auto / determined by script or interview
    aspectRatio: "16:9" | "9:16";
    language: DirectorLanguage;
    detailLevel: DirectorDetailLevel;
};

export type ExtractedDirectorResult = {
    zhPrompt: string;
    enPrompt: string;
    firstFramePrompt: string;
    isFinalDeliverable: boolean;
};

export type InterviewQuestion = {
    question: string;
    options: string[];
    preface: string;
};

export type DirectorSegmentItem = {
    id: string;
    title: string;
    duration: number;
    prompt: string;
    enPrompt?: string;
    negativePrompt?: string;
    firstFramePrompt?: string;
    firstFrameEnPrompt?: string;
    lastFramePrompt?: string;
    lastFrameEnPrompt?: string;
    assetRefs?: string[];
};

export type DirectorAssetCard = {
    name: string;
    prompt: string;
    enPrompt?: string;
};

export type DirectorStructuredWorkflow = {
    negativePrompt?: string;
    characters: DirectorAssetCard[];
    scenes: DirectorAssetCard[];
    props: DirectorAssetCard[];
    segments: DirectorSegmentItem[];
};

/** 组合双语节点文本：中文注解在上（给人看），英文提示词在下（给 AI 生图/生视频用） */
export function formatBilingualNodePrompt(zh?: string, en?: string): string {
    const zhText = (zh || "").trim();
    const enText = (en || "").trim();
    if (zhText && enText) {
        return `【中文注解】\n${zhText}\n\n【English Prompt】\n${enText}`;
    }
    return zhText || enText;
}

/** 从双语节点文本中提取实际发给 AI 生图/生视频的提示词（优先使用英文部分） */
export function extractAiPromptForGeneration(raw: string): string {
    const text = (raw || "").trim();
    if (!text) return "";
    const enMatch = text.match(/【(?:S\d+\s*)?English(?:\s+Video)?\s+Prompt】\s*([\s\S]+)$/i);
    if (enMatch?.[1]?.trim()) {
        return enMatch[1].trim();
    }
    return text;
}

const NON_OPTION_PREFIX =
    /^(?:收到|已锁定|全片统一|结构[与和：:]|几何母题|转场链|风险排序|难点与顺序|开场与收场|系统预设|如果压到|现在有一个|第\s*\d+\s*问|【本段|【最高优先级|\[Highest Priority|\[Segment Overview|\[Output Format)/i;

/** 清理因 muse2api / muse.ai DOM 重排造成的整段重复吐字（必须在未篡改的原始累积流上调用） */
export function dedupeStreamText(raw: string): string {
    let trimmed = raw.trimStart();
    if (trimmed.length < 24) return raw;

    // 1. Strip any tiny early stutter within the first 80 chars (e.g. first bullet reflow)
    for (let probeLen of [10, 6, 4]) {
        if (trimmed.length > probeLen * 2) {
            const earlyProbe = trimmed.slice(0, probeLen);
            const earlyIdx = trimmed.indexOf(earlyProbe, probeLen);
            if (earlyIdx > 0 && earlyIdx < 80) {
                trimmed = trimmed.slice(earlyIdx);
                break;
            }
        }
    }

    // 2. Pick a 14-char prefix of the message and split all full-text redumps
    const firstNewline = trimmed.indexOf("\n");
    const prefixLen = Math.min(16, firstNewline >= 6 ? firstNewline : 16);
    const prefix = trimmed.slice(0, prefixLen);
    if (prefix.length < 6) return trimmed;

    const indices: number[] = [];
    let pos = 0;
    while (pos < trimmed.length) {
        const idx = trimmed.indexOf(prefix, pos);
        if (idx < 0) break;
        indices.push(idx);
        pos = idx + prefix.length;
    }

    if (indices.length <= 1) return trimmed;

    const dumps: string[] = [];
    for (let i = 0; i < indices.length; i++) {
        const start = indices[i];
        const end = i + 1 < indices.length ? indices[i + 1] : trimmed.length;
        dumps.push(trimmed.slice(start, end));
    }

    let best = dumps[0];
    for (let i = 1; i < dumps.length; i++) {
        if (dumps[i].length >= best.length - 12) {
            best = dumps[i];
        }
    }
    return best.trim();
}

export function parseInterviewQuestion(markdown: string): InterviewQuestion | null {
    const text = dedupeStreamText(markdown).trim();
    if (!text) return null;

    // If it already contains final prompt blocks or JSON segments, it's a deliverable, NOT an interview question
    if (
        /【(?:S\d+\s*)?中文视频提示词】|【(?:S\d+\s*)?English\s+Video\s+Prompt】|\[Highest Priority\]|\[Segment Overview\]|"segments"\s*:/i.test(
            text,
        )
    ) {
        return null;
    }

    // 1. Explicit 【导演提问】 tag
    const taggedMatch = text.match(/【导演提问】[：:\s]*([^\n]+)\n([\s\S]*)$/);
    if (taggedMatch) {
        const question = taggedMatch[1].trim();
        const rawOpts = taggedMatch[2]
            .split("\n")
            .map((l) =>
                l
                    .replace(/^\s*(?:【选项[A-Fa-f0-9]*】|[-*•]|\d+[.)、]|[A-Fa-f][.)、：:])\s*/, "")
                    .replace(/^\*\*|\*\*$/g, "")
                    .trim(),
            )
            .filter((l) => l.length >= 2 && l.length <= 65 && !NON_OPTION_PREFIX.test(l) && !l.startsWith("```"));
        const options = Array.from(new Set(rawOpts));
        if (!options.some((o) => /导演决定/.test(o))) {
            options.push("这一项由导演决定");
        }
        return {
            question,
            options: options.slice(0, 5),
            preface: text.slice(0, taggedMatch.index).trim(),
        };
    }

    // 2. Fallback: natural question format ("第 1 问：..." or line ending in ？) followed immediately by 2-5 short option lines
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    let qIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/^(?:第\s*\d+\s*问|问题\s*\d*|导演提问)[：:\s]/i.test(lines[i]) || (/[？?]$/.test(lines[i]) && lines[i].length <= 60)) {
            qIndex = i;
            break;
        }
    }
    if (qIndex === -1 && lines.length >= 2 && lines.length <= 5 && lines.some((l) => /这一项由导演决定/.test(l)) && lines.every((l) => l.length <= 50)) {
        const options = Array.from(new Set(lines.map((l) => l.replace(/^\s*(?:【选项[A-Fa-f0-9]*】|[-*•]|\d+[.)、]|[A-Fa-f][.)、：:])\s*/, "").trim()).filter(Boolean)));
        return {
            question: "请选择本项创作方向：",
            options: options.slice(0, 5),
            preface: "",
        };
    }
    if (qIndex >= 0) {
        const question = lines[qIndex].replace(/^\*\*|\*\*$/g, "").trim();
        const candidateLines: string[] = [];
        for (let j = qIndex + 1; j < lines.length; j++) {
            const rawLine = lines[j];
            // Stop immediately if we hit narrative paragraphs or repeated headers
            if (NON_OPTION_PREFIX.test(rawLine) || rawLine.length > 68) {
                break;
            }
            const cleaned = rawLine
                .replace(/^\s*(?:【选项[A-Fa-f0-9]*】|[-*•]|\d+[.)、]|[①②③④⑤]|[A-Fa-f][.)、：:])\s*/, "")
                .replace(/^\*\*|\*\*$/g, "")
                .trim();
            if (cleaned.length >= 2 && cleaned.length <= 65 && !NON_OPTION_PREFIX.test(cleaned)) {
                candidateLines.push(cleaned);
            }
        }
        const options = Array.from(new Set(candidateLines));
        if (options.length >= 2) {
            if (!options.some((o) => /导演决定/.test(o))) {
                options.push("这一项由导演决定");
            }
            return {
                question,
                options: options.slice(0, 5),
                preface: lines.slice(0, qIndex).join("\n"),
            };
        }
    }

    return null;
}

/** 修复 muse.ai innerText 导致 JSON 字符串内部出现裸换行符的问题 */
function repairJsonStringNewlines(raw: string): string {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escaped) {
            out += ch;
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            out += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            out += ch;
            continue;
        }
        if (inString && (ch === "\n" || ch === "\r")) {
            if (ch === "\n") out += "\\n";
            continue;
        }
        out += ch;
    }
    return out;
}

/** 当模型没有输出 JSON 或 JSON 被截断时，直接从正文提取中英文分镜与设定卡 */
export function fallbackParseWorkflowFromText(text: string): DirectorStructuredWorkflow | null {
    const clean = dedupeStreamText(text).trim();
    if (!clean) return null;

    const segments: DirectorSegmentItem[] = [];

    // Try matching S01..S99+ or 分镜1..N (unlimited segments)
    const zhMatches = Array.from(
        clean.matchAll(
            /(?:【(S\d+)\s*中文视频提示词】|(?:^|\n)\s*(?:#+\s*)?(S\d+|分镜[一二三四五六七八九十百\d]+)[^\n]*\n)([\s\S]*?)(?=(?:【S\d+\s*(?:中文视频提示词|English)|(?:^|\n)\s*(?:#+\s*)?(?:S\d+|分镜[一二三四五六七八九十百\d]+)\b|\[Highest Priority\]|【Highest Priority】|\[Segment Overview\]|【Segment Overview】|\{\s*"characters"|$))/gi,
        ),
    );
    const enMatches = Array.from(
        clean.matchAll(
            /【(S\d+)?\s*English\s+Video\s+Prompt】([\s\S]*?)(?=(?:【(?:S\d+\s*)?(?:中文视频提示词|English\s+Video\s+Prompt)】|===WORKFLOW_JSON_START===|\{\s*"characters"|$))/gi,
        ),
    );

    if (zhMatches.length > 0) {
        zhMatches.forEach((m, idx) => {
            const id = `S${String(idx + 1).padStart(2, "0")}`;
            const body = (m[3] || m[0]).trim();
            if (body.length > 20) {
                segments.push({
                    id,
                    title: `第 ${idx + 1} 段分镜`,
                    duration: 10,
                    prompt: body,
                });
            }
        });
    }

    if (enMatches.length > 0) {
        enMatches.forEach((m, idx) => {
            const enBody = (m[2] || "").trim();
            if (segments[idx]) {
                segments[idx].enPrompt = enBody;
            } else if (enBody.length > 20) {
                const id = `S${String(idx + 1).padStart(2, "0")}`;
                segments.push({
                    id,
                    title: `Segment ${idx + 1}`,
                    duration: 10,
                    prompt: enBody,
                    enPrompt: enBody,
                });
            }
        });
    }

    // If still no segments but the text has substantial prompt content (>150 chars and not an interview question)
    if (segments.length === 0 && clean.length > 150 && !parseInterviewQuestion(clean)) {
        segments.push({
            id: "S01",
            title: "分镜片段 1",
            duration: 10,
            prompt: clean.slice(0, 1800),
        });
    }

    if (segments.length === 0) return null;

    // Extract explicit [图N] / 参考图分工 / 主体与道具 descriptions into distinct characters / scenes / props
    const characters: Array<{ name: string; prompt: string }> = [];
    const scenes: Array<{ name: string; prompt: string }> = [];
    const props: Array<{ name: string; prompt: string }> = [];
    const seenNames = new Set<string>();

    // Only scan Chinese sections for [图N] so English "[图2] only for..." doesn't pollute Chinese cards
    const zhOnlyText = segments.map((s) => s.prompt).join("\n\n") || clean;
    const refMatches = Array.from(zhOnlyText.matchAll(/\[图\d+\]\s*([^；;。\n]+)/g));
    for (const rm of refMatches) {
        const desc = rm[1].trim();
        // Skip English descriptions and cross-segment transition notes ("仅作...衔接参考", "不改变构图")
        const hanziCount = (desc.match(/[\u4e00-\u9fa5]/g) || []).length;
        const latinCount = (desc.match(/[a-zA-Z]/g) || []).length;
        if (hanziCount < 4 || latinCount > hanziCount * 1.5) continue;
        if (/^(?:仅作|只作|仅用于|用于与上一段|用于S\d+|不改变构图)/.test(desc)) continue;

        const nameMatch = desc.match(/^([^，,：:]+?)(?:（[^）]*）)?(?:角色|三视图|场景|道具)?设定图?[，,：:\s]*(.*)$/);
        const rawName = (nameMatch ? nameMatch[1] : desc.split(/[，,：:]/)[0]).replace(/(?:角色|三视图|场景|道具)?设定图?$/, "").trim();
        if (!rawName || rawName.length > 24 || seenNames.has(rawName)) continue;
        seenNames.add(rawName);
        const descWithoutNoPeople = desc.replace(/无人物|没有人物|无人/g, "");
        if (/场景|空镜|环境|景观/.test(desc) && !/角色设定|三视图/.test(desc)) {
            scenes.push({
                name: rawName,
                prompt: `空镜场景设定图：16:9 横屏画幅，超写实电影级光影与空间层次，${desc}，无人物无文字无水印`,
            });
        } else if (/角色|三视图|全身/.test(desc) || /人物/.test(descWithoutNoPeople)) {
            characters.push({
                name: rawName,
                prompt: `角色全身三视图设定图：正面、侧面、背面全身三视图同框，纯白干净背景，${desc}，五官、发型、服装材质与配色前后严格一致，超写实细节，无文字无水印`,
            });
        } else if (/道具|器物|黄叶|落叶|商品|物件|特写/.test(desc) && !/场景|全景|村落|山势/.test(desc)) {
            props.push({
                name: rawName,
                prompt: `关键道具设定图：纯白或浅灰干净背景，微距特写质感，${desc}，材质纹理与几何结构清晰可辨，无人物无文字无水印`,
            });
        } else {
            scenes.push({
                name: rawName,
                prompt: `空镜场景设定图：16:9 横屏画幅，超写实电影级光影与空间层次，${desc}，无人物无文字无水印`,
            });
        }
    }

    // Also extract shared characters/scenes/props from script overview (including 统一人物锁定 / 统一道具锁定)
    const detectedRatio = /9:16|竖屏/.test(clean) && !/16:9|横屏/.test(clean) ? "9:16 竖屏" : "16:9 横屏";
    const detectedRatioEn = detectedRatio.startsWith("9:16") ? "9:16 vertical" : "16:9 widescreen";

    if (characters.length === 0) {
        const lockMatch = clean.match(/统一人物锁定[：:]\s*\n?([\s\S]*?)(?=\n(?:统一|【|S\d+|$))/);
        const charLines = lockMatch?.[1]
            ? lockMatch[1]
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean)
            : [];
        if (charLines.length > 0) {
            for (const line of charLines.slice(0, 6)) {
                const name = line.split(/[，,：:（(]/)[0].trim().slice(0, 16);
                if (name && !seenNames.has(name)) {
                    seenNames.add(name);
                    characters.push({
                        name,
                        prompt: formatBilingualNodePrompt(
                            `角色三视图与常用表情设定图（${name}）：纯白干净背景，左侧为正面、侧面、背面全身三视图，右侧为喜/怒/惊/痛等常用表情头像矩阵，同一张图内完整展示；外貌与服装锁定：${line}；五官可辨不过度锐化，自然皮肤质感，无文字无水印。`,
                            `Character turnaround sheet & common expressions (${name}) on clean pure white background: full-body three-view turnaround (front, side, back) alongside a common facial expressions grid in one unified sheet; locked appearance & outfit: ${line}; natural skin texture, photorealistic, no text, no watermark.`,
                        ),
                    });
                }
            }
        } else {
            const charLine = clean.match(/(?:主角|人物|角色)[：:]\s*([^\n]+)/);
            if (charLine?.[1]) {
                const parts = charLine[1].split(/[、，,]/).map((s) => s.trim()).filter((s) => s && s.length <= 24);
                for (const part of parts.slice(0, 4)) {
                    const name = part.replace(/^(?:优势格斗者|弱势者|主角|角色)\s*/, "").split(/[\s（(]/)[0].trim();
                    if (name && !seenNames.has(name)) {
                        seenNames.add(name);
                        characters.push({
                            name,
                            prompt: formatBilingualNodePrompt(
                                `角色三视图与常用表情设定图（${name}）：纯白干净背景，左侧为正面、侧面、背面全身三视图，右侧为喜/怒/惊/痛等常用表情头像矩阵，同一张图内完整展示，五官发型服装材质前后严格一致，自然皮肤质感，无文字无水印。`,
                                `Character turnaround sheet & common expressions (${name}) on clean pure white background: full-body three-view turnaround (front, side, back) alongside a grid of common facial expressions (neutral, angry, shocked, pain) in one unified sheet, consistent facial features, hair and outfit, photorealistic, no text, no watermark.`,
                            ),
                        });
                    }
                }
            }
        }
    }

    if (scenes.length === 0) {
        const sceneLine = clean.match(/(?:场景|地点|环境|开收场)[：:]\s*([^\n]+)/);
        const rawOverview = segments[0]?.prompt.match(/【(?:本段概览|主体与空间层次)】([^\n【]+)/)?.[1]?.trim() || "";
        const cleanedOverview = rawOverview.replace(/^(?:10秒|8秒|6秒|5秒|\d+秒)[，,、\s]*(?:9:16|16:9)?[，,、\s]*/g, "").trim();
        const sceneDesc = sceneLine?.[1]?.trim() || cleanedOverview || "核心主场景";
        scenes.push({
            name: "核心主场景",
            prompt: formatBilingualNodePrompt(
                `空镜场景设定图：${detectedRatio}画幅，${sceneDesc}，超写实电影级光影与空间层次，无人物无文字无水印。`,
                `Empty scene concept art, ${detectedRatioEn}, ${sceneDesc}, photorealistic cinematic lighting and spatial depth, no people, no text, no watermark.`,
            ),
        });
    }

    if (props.length === 0) {
        const lockPropMatch = clean.match(/统一道具锁定[：:]\s*\n?([\s\S]*?)(?=\n(?:统一|【|S\d+|$))/);
        const propLines = lockPropMatch?.[1]
            ? lockPropMatch[1]
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean)
            : [];
        if (propLines.length > 0) {
            for (const line of propLines.slice(0, 6)) {
                const propName = line.split(/[，,：:（(]/)[0].trim().slice(0, 16);
                if (propName && !seenNames.has(propName)) {
                    seenNames.add(propName);
                    props.push({
                        name: propName,
                        prompt: formatBilingualNodePrompt(
                            `关键道具三视图设定图（${propName}）：纯白干净背景，正面/侧面/俯视三视图同框；道具细节锁定：${line}；超写实材质纹理与几何结构，无人物无文字无水印。`,
                            `Key prop three-view turnaround sheet (${propName}) on clean pure white background: front, side, and top views in one unified sheet; locked details: ${line}; photorealistic material texture and structure, no people, no text, no watermark.`,
                        ),
                    });
                }
            }
        } else {
            const propExtract = clean.match(/(?:道具|关键道具|核心道具)[：:]\s*([^\n]+)/);
            if (propExtract?.[1]) {
                const propName = propExtract[1].split(/[、，,。；;]/)[0].trim().slice(0, 16);
                if (propName && !seenNames.has(propName)) {
                    seenNames.add(propName);
                    props.push({
                        name: propName,
                        prompt: formatBilingualNodePrompt(
                            `关键道具三视图设定图（${propName}）：纯白干净背景，正面/侧面/俯视三视图同框，超写实材质纹理与几何结构，无人物无文字无水印。`,
                            `Key prop three-view turnaround sheet (${propName}) on clean pure white background: front, side, and top views in one unified sheet, photorealistic material texture and structure, no people, no text, no watermark.`,
                        ),
                    });
                }
            }
        }
    }

    const allAssetNames = [...characters, ...scenes, ...props].map((a) => a.name);
    segments.forEach((seg) => {
        if (!seg.assetRefs?.length) {
            const matched = allAssetNames.filter((n) => seg.prompt.includes(n));
            seg.assetRefs = matched.length ? matched : allAssetNames;
        }
        if (!seg.firstFramePrompt) {
            const overview = seg.prompt.match(/【(?:本段概览|Subject and Space|Segment Overview)】([^\n【]+)/)?.[1]?.trim() || seg.prompt.slice(0, 180);
            seg.firstFramePrompt = formatBilingualNodePrompt(
                `【${seg.id} 分镜首帧参考图】严格参考已连入的人物三视图、场景空镜与道具设定，保持角色外貌服装与环境光影完全一致。画面内容：${overview}`,
                `[${seg.id} Keyframe Reference] Strictly follow the connected character turnaround, scene, and prop references for consistent appearance, outfit, and lighting. Composition: ${overview}`,
            );
        }
    });

    // Extract global or per-segment negative prompt
    const globalNegativePrompt = extractNegativePromptFromText(clean) || extractNegativePromptFromText(zhOnlyText);

    return {
        negativePrompt: globalNegativePrompt,
        characters,
        scenes,
        props,
        segments: segments.map((s) => ({
            ...s,
            negativePrompt: s.negativePrompt || extractNegativePromptFromText(`${s.enPrompt || ""}\n${s.prompt}`) || globalNegativePrompt,
        })),
    };
}

function extractNegativePromptFromText(source: string): string | undefined {
    const cleanSrc = source || "";
    const m =
        cleanSrc.match(/【(?:Negative(?:\s*\/\s*Anti-Drift)?(?:\s*Rules?)?|负面(?:提示词|与防跑偏|排除)?)】\s*([^\n【]+)/i) ||
        cleanSrc.match(/(?:^|\n)\s*(?:负面提示词|负面排除|负面|Negative(?:\s*Prompt)?)[^：:\n]*[：:]\s*([^\n]+)/i);
    const val = m?.[1]?.trim();
    return val && val.length > 1 ? val : undefined;
}

export function parseDirectorWorkflowJson(text: string): DirectorStructuredWorkflow | null {
    const candidates: string[] = [];
    const tagMatch = text.match(/===WORKFLOW_JSON_START===([\s\S]*?)===WORKFLOW_JSON_END===/);
    if (tagMatch?.[1]?.trim()) {
        candidates.push(tagMatch[1].trim());
    }
    const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(text)) !== null) {
        if (m[1]?.trim().startsWith("{")) candidates.push(m[1].trim());
    }
    // Look for the last JSON object containing "segments"
    const segKeyIdx = text.lastIndexOf('"segments"');
    if (segKeyIdx > 0) {
        const openBrace = text.lastIndexOf("{", segKeyIdx);
        // Find characters/scenes root brace before "segments"
        const rootBrace = text.lastIndexOf('{"characters"', segKeyIdx);
        const searchFrom = rootBrace >= 0 ? rootBrace : openBrace >= 0 ? text.lastIndexOf("{", Math.max(0, openBrace - 1)) : -1;
        const startIdx = searchFrom >= 0 ? searchFrom : text.indexOf("{");
        const endIdx = text.lastIndexOf("}");
        if (startIdx >= 0 && endIdx > startIdx) {
            candidates.push(text.slice(startIdx, endIdx + 1));
        }
    }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(text.slice(firstBrace, lastBrace + 1));
    }

    for (const raw of candidates) {
        for (const attempt of [raw, repairJsonStringNewlines(raw)]) {
            try {
                const parsed = JSON.parse(attempt) as Partial<DirectorStructuredWorkflow>;
                if (parsed && (Array.isArray(parsed.segments) || Array.isArray(parsed.characters) || Array.isArray(parsed.scenes))) {
                    const fallbackNeg = extractNegativePromptFromText(text);
                    const wf: DirectorStructuredWorkflow = {
                        negativePrompt: parsed.negativePrompt ? String(parsed.negativePrompt) : fallbackNeg,
                        characters: Array.isArray(parsed.characters)
                            ? parsed.characters.filter((x) => x?.name && (x?.prompt || x?.enPrompt)).map((x) => ({
                                  name: String(x.name),
                                  prompt: String(x.prompt || x.enPrompt || ""),
                                  enPrompt: x.enPrompt ? String(x.enPrompt) : undefined,
                              }))
                            : [],
                        scenes: Array.isArray(parsed.scenes)
                            ? parsed.scenes.filter((x) => x?.name && (x?.prompt || x?.enPrompt)).map((x) => ({
                                  name: String(x.name),
                                  prompt: String(x.prompt || x.enPrompt || ""),
                                  enPrompt: x.enPrompt ? String(x.enPrompt) : undefined,
                              }))
                            : [],
                        props: Array.isArray(parsed.props)
                            ? parsed.props.filter((x) => x?.name && (x?.prompt || x?.enPrompt)).map((x) => ({
                                  name: String(x.name),
                                  prompt: String(x.prompt || x.enPrompt || ""),
                                  enPrompt: x.enPrompt ? String(x.enPrompt) : undefined,
                              }))
                            : [],
                        segments: Array.isArray(parsed.segments)
                            ? parsed.segments
                                  .filter((x) => x?.prompt || x?.enPrompt)
                                  .map((x, idx) => ({
                                      id: x.id || `S${String(idx + 1).padStart(2, "0")}`,
                                      title: x.title || `第 ${idx + 1} 段`,
                                      duration: Math.min(10, Math.max(5, Number(x.duration) || 10)),
                                      prompt: String(x.prompt || x.enPrompt || ""),
                                      enPrompt: x.enPrompt ? String(x.enPrompt) : undefined,
                                      negativePrompt: x.negativePrompt ? String(x.negativePrompt) : fallbackNeg,
                                      firstFramePrompt: x.firstFramePrompt ? String(x.firstFramePrompt) : undefined,
                                      firstFrameEnPrompt: x.firstFrameEnPrompt ? String(x.firstFrameEnPrompt) : undefined,
                                      lastFramePrompt: x.lastFramePrompt ? String(x.lastFramePrompt) : undefined,
                                      lastFrameEnPrompt: x.lastFrameEnPrompt ? String(x.lastFrameEnPrompt) : undefined,
                                      assetRefs: Array.isArray(x.assetRefs) ? x.assetRefs.map((r) => String(r).trim()).filter(Boolean) : undefined,
                                  }))
                            : [],
                    };
                    if (wf.segments.length > 0) {
                        wf.negativePrompt = wf.negativePrompt || wf.segments.find((s) => s.negativePrompt)?.negativePrompt;
                        return wf;
                    }
                }
            } catch {
                // try next candidate
            }
        }
    }
    return null;
}

export function buildWorkflowExtractPrompt(scriptText: string, aspectRatio: "16:9" | "9:16", durationSec: number): string {
    const durHint = durationSec > 0 ? `总时长约 ${durationSec} 秒` : "按脚本实际段落拆分";
    return `请将下面的导演脚本/分镜提示词，严格按【先资产拆解 → 再分镜与参考图/首尾帧拆解】的影视工作流，拆分为一个可直接用于无限画布节点生成的单行转义 JSON 对象。
必须放在 ===WORKFLOW_JSON_START=== 和 ===WORKFLOW_JSON_END=== 之间，不要使用 markdown 代码块，JSON 字符串内部换行一律用 \\n 转义！

===WORKFLOW_JSON_START===
{"negativePrompt":"全局负面提示词（英文优先，如：no text, no watermark, no distortion）","characters":[{"name":"角色名","prompt":"角色全身三视图+常用表情矩阵中文注解（同一张图包含正面/侧面/背面全身三视图与喜怒惊痛等常用表情头像，纯白背景，外貌服装细节）","enPrompt":"Character sheet on pure white background: full-body three-view turnaround (front, side, back) and common facial expressions grid (neutral, angry, shocked, pain) all in one unified sheet, consistent face, hair, outfit and material, photorealistic, no text"}],"scenes":[{"name":"核心场景名","prompt":"空镜场景设定图中文注解（${aspectRatio}画幅，空间结构、光线色温、无人物）","enPrompt":"Empty scene concept art, ${aspectRatio} widescreen, spatial layout, lighting and color temperature, photorealistic cinematic texture, no people, no text"}],"props":[{"name":"道具名","prompt":"关键道具三视图中文注解（同一张图包含正面/侧面/俯视三视图，纯白背景，材质纹理结构）","enPrompt":"Key prop three-view turnaround sheet (front, side, top) on clean white background, detailed material texture and geometry, photorealistic, no people, no text"}],"segments":[{"id":"S01","title":"第1段简述","duration":10,"assetRefs":["角色名","核心场景名","道具名"],"firstFramePrompt":"S01分镜参考图/首帧中文注解（结合所需资产描述该镜头构图、景别、站位与光影）","firstFrameEnPrompt":"S01 keyframe reference image English prompt combining character/scene/prop layout, framing and lighting, photorealistic","prompt":"S01完整中文视频动态提示词","enPrompt":"S01 complete English video motion prompt","negativePrompt":"S01 negative prompt"}]}
===WORKFLOW_JSON_END===

硬性规则：
1. 【全局共享资产先拆】：从剧本中提取所有独立【角色】【核心物理场景】【关键道具】，全局共享复用——严禁把 S01..S06 分镜本身拆成 6 张假场景卡！
2. 【人物卡要求】：每个人物必须要求「全身三视图（正/侧/背）+ 常用表情矩阵」全部画在同一张纯白背景图里；【道具卡要求】：每个关键道具必须要求「三视图」画在同一张纯白背景图里；所有资产均需同时提供中文 prompt 与英文 enPrompt。
3. 【分镜资产绑定与参考图】：segments 必须按 Muse 单段 ≤10 秒上限拆分（${durHint}）；每个分镜必须通过 assetRefs 列出该分镜实际用到的资产 name，并同时提供用于生成分镜参考图/首帧图的 firstFramePrompt + firstFrameEnPrompt，以及用于生成视频的 prompt + enPrompt！

待拆分的导演脚本如下：
${scriptText}`;
}

export function buildDirectorSystemPrompt(opts: DirectorOptions): string {
    const estSegments = opts.durationSec > 0 ? Math.max(1, Math.ceil(opts.durationSec / 10)) : 0;
    const durationDesc =
        opts.durationSec > 0
            ? `用户在面板指定了目标总时长：${opts.durationSec} 秒（因 Muse 单次视频上限为 10 秒，必须按 ⌈${opts.durationSec}/10⌉ 拆分为至少 ${estSegments} 段独立生成的片段 S01..S${String(estSegments).padStart(2, "0")}，所有片段时长之和等于 ${opts.durationSec} 秒；若用户在正文中明确写了其他总时长或分段，以用户正文或访谈确认为准）`
            : "目标总时长：自动（优先采用用户剧本/对话中确定的任意总时长 N 秒；若未指定，在访谈第 1 问询问总时长；确定总时长 N 秒后，因 Muse 单次上限 10 秒，自动按 ⌈N/10⌉ 拆分为对应数量的独立片段 S01、S02…SXX，不限段数）";

    const langRule =
        opts.language === "bilingual"
            ? `【中英双语强制要求】：正式交付提示词时，每一段（S01、S02…）都**必须同时提供中文和英文两份完整提示词**，严格使用纯文本标题标记（**不要**使用 \`\`\` 代码块，以免网页渲染吞掉格式）：
【S01 中文视频提示词】
【本段最高优先级】...
【本段概览】...
【输出形式】...
（完整中文导演提示词正文）

【S01 English Video Prompt】
【Highest Priority】 ...
【Segment Overview】 ...
【Output Format】 ...
(Complete English director prompt matching the Chinese version, using 【...】 for section headers instead of square brackets [...])

绝对禁止只输出中文漏掉英文！`
            : opts.language === "zh"
              ? "正式交付时，每一段使用纯文本标题【S01 中文视频提示词】输出完整中文提示词（不要使用 ``` 代码块）。"
              : "When delivering final prompts, output standalone [S01 English Video Prompt] sections for each segment (do NOT use ``` code fences).";

    const lengthRule =
        opts.detailLevel === "detailed"
            ? `采用【详细导演版 + 去 AI 感写实规范】：每段提示词严禁只写空洞形容词，必须写实落细 7 个要素：
  1) 【人物】：具体年龄/体型/发型/自然妆容/微表情，写明「五官可辨但不处处锐利、自然皮肤质感与透亮肤色」；
  2) 【服装】：具体单品+颜色+面料材质+版型+物理垂坠/随风微扬，写明「服装全程不变」；
  3) 【场景】：室内外具体空间+前景/中景/背景真实材质物件+背景轻微虚化，「场景固定」；
  4) 【光线】：主光方向+软硬（如暖色柔光正面打/柔和漫射光）+皮肤与面料自然反光+暗部微弱颗粒；
  5) 【机位光学】：明确 ${opts.aspectRatio} 画幅+具体景别（全身/中近景腰腹以上/大腿以上）+眼平或手持视角+焦段（如 85mm 长焦/轻微移轴/浅景深）+运镜轨迹；
  6) 【动作时间线】：0-3s / 3-7s / 7-10s 起止姿态、呼吸起伏、重心移动与物理惯性；
  7) 【真实质感与避坑】：主动保留「轻微动态拖影、短暂失焦、自然颗粒与少量彩噪、轻微晃动或平稳跟随」，严禁使用「强稳定、全程处处锐利、完美无瑕」等加重 AI 塑料感的词，并明确「无文字水印、无任何文字、无 logo」。英文版完整对应。`
            : `采用【精简写实版（去 AI 感）】：每段保留【本段最高优先级】【本段概览】【输出形式】与核心 7 要素（人物肤质、服装面料版型不变、场景元素与虚化、主光软硬与反光、景别焦段运镜、动作起止与呼吸感、轻微拖影/自然颗粒/无文字水印），每段中文约 320–480 字，英文完整对应。`;

    const jsonTailRule = `
## 正式交付时的画布拆分 JSON（必须在交付最终提示词时附在最末尾）
当你输出正式分镜/视频提示词（非提问阶段）时，在回复的最末尾**必须**用 ===WORKFLOW_JSON_START=== 和 ===WORKFLOW_JSON_END=== 包裹一个合法的 JSON 对象（**不要使用 \`\`\`json 代码块，且字符串内换行必须用 \\n 转义**）：
===WORKFLOW_JSON_START===
{"negativePrompt":"no text, no watermark, no logo, no over-sharpened plastic skin, no distortion","characters":[{"name":"角色名","prompt":"角色全身三视图+常用表情矩阵中文注解（纯白背景，正面/侧面/背面全身三视图与常用表情头像画在同一张图内，写清五官发型肤质服装面料）","enPrompt":"Character turnaround sheet & common facial expressions grid on pure white background (front, side, back full-body views + expression portraits in one unified sheet), natural skin texture, detailed outfit fabric, photorealistic, no text, no watermark"}],"scenes":[{"name":"核心场景名","prompt":"空镜场景设定图中文注解（${opts.aspectRatio}画幅，空间结构、光线方向软硬、材质与背景虚化，无人物无文字）","enPrompt":"Empty scene concept art, ${opts.aspectRatio} widescreen, spatial layout, lighting direction and softness, material texture, no people, no text, no watermark"}],"props":[{"name":"道具名","prompt":"关键道具三视图中文注解（纯白背景，正面/侧面/俯视三视图画在同一张图内，写清材质纹理结构）","enPrompt":"Key prop three-view turnaround sheet (front, side, top) on pure white background, detailed material texture, photorealistic, no people, no text, no watermark"}],"segments":[{"id":"S01","title":"第1段简述","duration":10,"assetRefs":["角色名","核心场景名","道具名"],"firstFramePrompt":"S01分镜首帧参考图中文注解（结合人物服装、场景光影、景别焦段与站位）","firstFrameEnPrompt":"S01 keyframe reference image prompt combining character outfit, scene lighting, framing, lens and pose, natural skin texture, no text","prompt":"S01完整中文视频动态提示词","enPrompt":"S01 complete English video prompt"}]}
===WORKFLOW_JSON_END===`;

    const modeRule = {
        interview: `【当前模式：导演访谈（先一问一答，确认后再出完整双语分镜 + 拆分 JSON）】
1. 先识别用户已给出的主体、分镜、时长、画幅和风格，绝不重复询问用户已经写清楚的内容。
2. 若还有关键维度需确认（如总时长/分段方式、观看视角、开场与收场机位、配乐与环境声），**每轮只问 1 个问题**！
3. **提问时的强制格式**（前端会识别【导演提问】与【选项A/B/C/D】并弹出交互式提问框，**严禁在【选项D】后面再输出任何其他文字**）：
   先简短列出已锁定的要点（不超过 6 行），然后在最末尾严格按以下格式输出提问块：
【导演提问】这里写本轮唯一的问题标题？
【选项A】预设选项1（控制在 25 字以内）
【选项B】预设选项2（控制在 25 字以内）
【选项C】预设选项3（控制在 25 字以内）
【选项D】这一项由导演决定
4. 提问阶段**不要**输出成片提示词。
5. 当用户回答完关键问题，或用户点击/输入“不要再提问 / 直接生成 / 剩下全部由导演决定”时，立即停止提问，直接输出：
   - 每一段的【S0X 中文视频提示词】+【S0X English Video Prompt】（双语齐全！）
   - 最末尾附上 ===WORKFLOW_JSON_START=== ... ===WORKFLOW_JSON_END=== 拆分数据。`,
        direct: `【当前模式：直接出词（跳过访谈，立即交付双语提示词 + 拆分 JSON）】
- 不提问，立即担任创意导演与摄影指导，补全机位、景别、运镜时间线、光影、材质与声景。
- 若总时长超过 10 秒，自动按 ≤10 秒拆分为 S01、S02… 逐段交付中英双语提示词，并在末尾附上 ===WORKFLOW_JSON_START=== ... ===WORKFLOW_JSON_END=== 拆分数据。`,
        storyboard: `【当前模式：分段分镜（Muse 单段 ≤10 秒强制拆段 + 双语 + 拆分 JSON）】
- 不提问，直接将创意或脚本按 Muse 单段 ≤10 秒上限拆分为 S01、S02、S03…
- 逐段输出独立的【S0X 中文视频提示词】与【S0X English Video Prompt】，并在最末尾附上 ===WORKFLOW_JSON_START=== ... ===WORKFLOW_JSON_END=== 拆分数据。`,
        reverse: `【当前模式：视频反推 / 风格复刻】
- 严格区分「实际观察」「合理推断」与「导演补全设计」。
- 先列出镜头拆解，再输出可复刻该镜头语言的中英双语视频提示词及末尾 ===WORKFLOW_JSON_START=== ... ===WORKFLOW_JSON_END=== 拆分数据。`,
    }[opts.mode];

    return `你是 Muse Studio 无限画布内置的「视频提示词导演」（muse-video-prompt）。

${modeRule}

## 硬性参数与 Muse 能力边界
- ${durationDesc}
- Muse 单次视频生成上限为 10 秒（可选 5 / 6 / 8 / 10 秒）；超过 10 秒的作品必须拆分为多段（S01、S02、S03…）。
- 目标画幅：${opts.aspectRatio}
- 多张参考图在提示词中用 [图1]、[图2] 指代附件顺序。

## 提示词结构与交付规范
- ${langRule}
- ${lengthRule}
${jsonTailRule}`;
}

export function extractDirectorBlocks(markdown: string): ExtractedDirectorResult {
    const clean = dedupeStreamText(markdown);
    let zhPrompt = "";
    let enPrompt = "";
    let firstFramePrompt = "";

    // 1. Check workflow JSON first (most structured and clean)
    const wf = parseDirectorWorkflowJson(clean);
    if (wf && wf.segments.length > 0) {
        zhPrompt = wf.segments
            .filter((s) => s.prompt)
            .map((s) => `【${s.id} ${s.title}】\n${s.prompt}`)
            .join("\n\n---\n\n");
        enPrompt = wf.segments
            .filter((s) => s.enPrompt)
            .map((s) => `[${s.id} ${s.title}]\n${s.enPrompt}`)
            .join("\n\n---\n\n");
    }

    // 2. Also extract explicit 【S0X 中文视频提示词】 and 【S0X English Video Prompt】 sections
    const zhSectionRe = /【(?:S\d+\s*)?中文视频提示词】([\s\S]*?)(?=【(?:S\d+\s*)?(?:中文视频提示词|English\s+Video\s+Prompt)】|===WORKFLOW_JSON_START===|```json|$)/gi;
    const enSectionRe = /【(?:S\d+\s*)?English\s+Video\s+Prompt】([\s\S]*?)(?=【(?:S\d+\s*)?(?:中文视频提示词|English\s+Video\s+Prompt)】|===WORKFLOW_JSON_START===|```json|$)/gi;

    const zhSections = Array.from(clean.matchAll(zhSectionRe)).map((m) => m[0].trim());
    const enSections = Array.from(clean.matchAll(enSectionRe)).map((m) => m[0].trim());

    if (zhSections.length > 0) zhPrompt = zhSections.join("\n\n---\n\n");
    if (enSections.length > 0) enPrompt = enSections.join("\n\n---\n\n");

    const isFinalDeliverable = Boolean(zhPrompt || enPrompt);
    return { zhPrompt, enPrompt, firstFramePrompt, isFinalDeliverable };
}
