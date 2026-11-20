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
                  .split(/\n+|[；;]+/)
                  .map((l) => l.trim())
                  .filter((l) => l.length >= 2)
            : [];
        if (charLines.length > 0) {
            for (const line of charLines.slice(0, 6)) {
                const name = line.split(/[，,：:（(]/)[0].trim().slice(0, 16);
                if (name && !seenNames.has(name)) {
                    seenNames.add(name);
                    characters.push({
                        name,
                        prompt: formatBilingualNodePrompt(
                            `真人实拍正面定妆照（${name}）：${line}；空手自然站立无武器道具，干净浅灰背景，自然柔和光，真实皮肤纹理与自然颗粒，85mm人像镜头，无文字无水印。`,
                            `Live-action portrait photograph, front-facing casting photo of ${name}: ${line}; empty-handed standing pose with no weapons or props, clean light-gray studio background, soft natural lighting, natural skin texture, 85mm lens, no text, no watermark.`,
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
                                `真人实拍正面定妆照（${name}）：${part}，空手自然站立无武器道具，干净浅灰背景，自然柔和光，真实皮肤纹理与自然颗粒，85mm人像镜头，无文字无水印。`,
                                `Live-action portrait photograph, front-facing casting photo of ${name}: ${part}, empty-handed standing pose with no weapons or props, clean light-gray studio background, soft natural lighting, natural skin texture, 85mm lens, no text, no watermark.`,
                            ),
                        });
                    }
                }
            }
        }
        if (characters.length === 0) {
            const outfitMatches = Array.from(
                clean.matchAll(/(?:^|[，,、。\s；;])([阿小老]?[\u4e00-\u9fa5]{1,2})(?:身穿|身着|穿着|穿|披着|戴着|(?=(?:白|黑|灰|红|蓝|青|绿|黄|紫|粉|米|棕|深|浅)[\u4e00-\u9fa5]{1,6}(?:T恤|长袍|衬衫|裙|连衣裙|短裤|长裤|外套|卫衣|西装|汉服)))([^\n，,。；;]{2,26})/g),
            );
            for (const m of outfitMatches) {
                const name = (m[1] || "").trim();
                const outfit = (m[2] || "").trim();
                if (!name || /^(?:两人|二人|他们|她们|男女|主角|人物|角色|画面|全身|半身|全程|只有)$/.test(name) || seenNames.has(name)) continue;
                seenNames.add(name);
                characters.push({
                    name,
                    prompt: formatBilingualNodePrompt(
                        `真人实拍正面定妆照（${name}）：${name}，${outfit}；空手自然站立无武器道具，干净浅灰背景，自然柔和光，真实皮肤纹理与自然颗粒，85mm人像镜头，无文字无水印。`,
                        `Live-action portrait photograph, front-facing casting photo of ${name} (${outfit}); empty-handed standing pose with no weapons or props, clean light-gray studio background, soft natural lighting, natural skin texture, 85mm lens, no text, no watermark.`,
                    ),
                });
                if (characters.length >= 4) break;
            }
        }
    }

    if (scenes.length === 0) {
        const cleanSceneCandidate = (raw: string) =>
            raw
                .replace(/^(?:10秒|8秒|6秒|5秒|\d+秒)[，,、\s]*(?:9:16|16:9)?[，,、\s]*/g, "")
                .replace(/[，,、\s]*(?:第三人称|第一人称|航拍|跟拍|推近|拉远|慢摇|环绕|骑行|步行|奔跑|打斗|配乐|轻民谣|音效|环境声|无对白|无多余人物|无文字水印)[^，,。；;]*/g, "")
                .replace(/[^，,。；;]*(?:视角|身穿|身着|穿着|长裙|短裙|开衫|衬衫|外套|短裤|长裤|长发|短发|发型|面貌|服装|不变|锁定)[^，,。；;]*/g, "")
                .replace(/^[，,、\s]+|[，,、\s]+$/g, "")
                .trim();

        const locRegex = /(?:古城|老街|街头|小巷|巷道|门洞|石板路|客栈|庭院|咖啡馆|室内|房间|湖畔|洱海|海边|海滩|码头|栈道|山顶|山道|森林|树林|竹林|草地|广场|公园|大桥|天台|走廊|教室|办公室|夜市|日落|清晨)[^，,。；;\n]{0,14}/g;
        const sceneLine = clean.match(/(?:场景|地点|环境)[：:]\s*([^\n]+)/);
        const extractedScenes: Array<{ name: string; desc: string }> = [];
        const seenSceneKeys = new Set<string>();

        if (sceneLine?.[1]) {
            const parts = sceneLine[1].split(/[、；;\/]|与|和(?=(?:古城|湖|海|山|街|室|林|场|桥|园))/).map((p) => cleanSceneCandidate(p)).filter(Boolean);
            for (const p of parts.slice(0, 4)) {
                const key = p.slice(0, 4);
                if (!seenSceneKeys.has(key)) {
                    seenSceneKeys.add(key);
                    extractedScenes.push({ name: p.slice(0, 12), desc: p });
                }
            }
        }

        for (const seg of segments) {
            const segBody = seg.prompt.replace(/【[^】]+】[^\n]*/g, " ").trim();
            const overview = seg.prompt.match(/【(?:本段概览|主体与空间层次)】([^\n【]+)/)?.[1]?.trim() || "";
            const locMatches = Array.from(`${overview} ${segBody}`.matchAll(locRegex)).map((m) => cleanSceneCandidate(m[0])).filter((s) => s.length >= 2);
            for (const loc of locMatches) {
                const key = loc.slice(0, 2);
                if (!seenSceneKeys.has(key) && extractedScenes.length < 4) {
                    seenSceneKeys.add(key);
                    const contextClause = cleanSceneCandidate(segBody.split(/[。；;\n]/).find((c) => c.includes(key)) || overview || loc);
                    extractedScenes.push({
                        name: loc.slice(0, 12),
                        desc: contextClause && contextClause.length >= loc.length ? contextClause : loc,
                    });
                }
            }
        }

        if (extractedScenes.length === 0) {
            const rawOverview = segments[0]?.prompt.match(/【(?:本段概览|主体与空间层次)】([^\n【]+)/)?.[1]?.trim() || "";
            const bodyLead =
                segments[0]?.prompt
                    .split("\n")
                    .find((l) => l.trim() && !/^【/.test(l.trim()))
                    ?.split(/[。；;]/)[0]
                    ?.trim() || "";
            const fallbackDesc = cleanSceneCandidate(bodyLead) || cleanSceneCandidate(rawOverview) || "核心实拍环境";
            extractedScenes.push({ name: "核心主场景", desc: fallbackDesc });
        }

        for (const sc of extractedScenes) {
            scenes.push({
                name: sc.name,
                prompt: formatBilingualNodePrompt(
                    `实拍空镜环境照片（${sc.name}）：${detectedRatio}画幅，${sc.desc}；完整呈现前中远景空间结构、地面与建筑材质、自然光线方向与空气透视，轻微胶片颗粒与真实景深，纯环境无人物、无多余车辆道具、无文字水印。`,
                    `Real-world live-action empty location photograph (${sc.name}), ${detectedRatioEn}, ${sc.desc}; detailed foreground-midground-background spatial depth, authentic surface textures and natural lighting direction, subtle film grain, no people, no extra props, no CGI look, no text, no watermark.`,
                ),
            });
        }
    }

    if (props.length === 0) {
        const lockPropMatch = clean.match(/统一道具锁定[：:]\s*\n?([\s\S]*?)(?=\n(?:统一|【|S\d+|$))/);
        const propLines = lockPropMatch?.[1]
            ? lockPropMatch[1]
                  .split(/\n+|[；;]+/)
                  .map((l) => l.trim())
                  .filter((l) => l.length >= 2)
            : [];
        if (propLines.length > 0) {
            for (const line of propLines.slice(0, 6)) {
                const propName = line.split(/[，,：:（(]/)[0].trim().slice(0, 16);
                if (propName && !seenNames.has(propName)) {
                    seenNames.add(propName);
                    props.push({
                        name: propName,
                        prompt: formatBilingualNodePrompt(
                            `实拍道具特写照片（${propName}）：${line}；干净浅色背景，自然光，真实材质质感，无人物无文字无水印。`,
                            `Live-action close-up photograph of prop (${propName}): ${line}; clean light background, natural lighting, realistic material texture, no people, no text, no watermark.`,
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
                            `实拍道具特写照片（${propName}）：干净浅色背景，自然光，真实材质质感，无人物无文字无水印。`,
                            `Live-action close-up photograph of prop (${propName}): clean light background, natural lighting, realistic material texture, no people, no text, no watermark.`,
                        ),
                    });
                }
            }
        }
        if (props.length === 0) {
            const commonProps = ["自行车", "单车", "长剑", "飞剑", "佩剑", "青冥剑", "玄岳剑", "听风剑", "手机", "酒瓶", "啤酒瓶", "雨伞", "吉他", "相机", "咖啡杯", "书本"];
            for (const propName of commonProps) {
                if (clean.includes(propName) && !seenNames.has(propName)) {
                    seenNames.add(propName);
                    props.push({
                        name: propName,
                        prompt: formatBilingualNodePrompt(
                            `实拍道具特写照片（${propName}）：干净浅色背景，自然光，真实材质质感，无人物无文字无水印。`,
                            `Live-action close-up photograph of prop (${propName}): clean light background, natural lighting, realistic material texture, no people, no text, no watermark.`,
                        ),
                    });
                    if (props.length >= 3) break;
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
                `【${seg.id} 分镜首帧实拍参考图】参考已连入的人物定妆照、场景与道具照片保持一致，${overview}，自然光影与皮肤质感，无文字无水印`,
                `[${seg.id} Live-Action Keyframe] Keep connected character, scene, and prop references consistent; ${overview}, natural lighting and skin texture, no text, no watermark`,
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
{"negativePrompt":"no text, no watermark, no logo, no over-sharpened plastic skin","characters":[{"name":"角色名","prompt":"真人实拍正面定妆照中文描述（年龄外貌、核心服装、空手站立无武器道具、浅灰背景、自然光、真实皮肤纹理、85mm镜头）","enPrompt":"Live-action front-facing casting photograph of [name], core age/appearance/outfit, empty-handed with no weapons or props, clean studio background, soft natural light, natural skin texture, 85mm lens, no text"}],"scenes":[{"name":"核心场景名","prompt":"实拍空镜环境照片（${aspectRatio}画幅，只写地点、地形材质、天气时段与自然光线，严禁写入人物动作、运镜、配乐或多余道具，强调真实摄影质感与自然颗粒，无人物）","enPrompt":"Real-world live-action empty location photograph, ${aspectRatio}, pure environment/terrain/weather/lighting only (NO character actions, NO camera moves, NO music, NO extra props), authentic daylight, natural depth of field and subtle film grain, no people, no CGI or concept art look, no text"}],"props":[{"name":"道具名","prompt":"实拍道具特写照片（核心材质与外观，干净背景，自然光，无人物）","enPrompt":"Live-action close-up photograph of prop, realistic material texture, clean background, natural light, no people, no text"}],"segments":[{"id":"S01","title":"第1段简述","duration":10,"assetRefs":["角色名","核心场景名","道具名"],"firstFramePrompt":"S01精简首帧实拍参考图提示词（参考已连入人物/场景/道具，写清景别、站位与光线，减少冗余词）","firstFrameEnPrompt":"S01 concise live-action keyframe photograph matching connected references, framing, pose and natural lighting, no text","prompt":"S01精简写实中文视频提示词（只写核心人物状态、景别运镜、关键动作、光线与无文字水印，不堆砌冗余词）","enPrompt":"S01 concise live-action video prompt focusing on subject, framing, camera move, action and natural lighting, no text","negativePrompt":"S01 negative prompt"}]}
===WORKFLOW_JSON_END===

硬性规则：
1. 【全局共享资产先拆（多场景必须独立拆出）】：逐段扫描所有分镜（S01..SNN）和对话上下文中的物理地点转换——如果剧本包含多个不同地点（例如「古城巷道」与「洱海湖畔日落」、「室内」与「室外」等），**必须为每一个独立地点分别拆出单独的场景卡**（有2个地点就拆2张场景卡，有3个就拆3张），严禁合并成一个笼统的“核心主场景”；同时严禁把分镜数量直接当成假场景卡，同一地点被多段复用则只建 1 张场景卡。
2. 【场景卡必须具体可控（禁止空泛、禁止混入人物）】：每张场景卡都必须是**可精准控场的实拍空镜环境描述**：写清**具体地点类型、建筑/地貌构图、前/中/远景核心元素、地面/墙面/水面材质细节、天气时段与主光方向色温（如清晨斜射暖光/傍晚金色逆光）、真实空气透视与胶片颗粒**；同时**严禁写入任何人物名字、人物穿搭、人物动作、运镜词或配乐词**！
3. 【人物卡只要单人正面实拍定妆照】：严禁写“三视图、表情矩阵、多视图”等易引发插画/CG感的词；每张人物卡只生成一张**真人实拍正面定妆照**，且**必须空手站立、不佩戴/不手持任何武器或道具**；【道具卡】：只生成单件实拍特写照片（也不用三视图）。
4. 【分镜精准关联资产】：每个分镜的 \`assetRefs\` 必须准确填写该段实际出镜的【角色名】与【对应场景名】（以及用到的【道具名】），确保第1段连场景A、第3段连场景B，不要乱连或漏连。
5. 【六段式分镜出字段与接续纪律】：每段视频提示词（\`prompt\` 与 \`enPrompt\`）必须按以下六段式结构出字段（无对白则声音仅写环境音/拟音，**严禁默认台湾腔对白**；**严禁出现 resume_from_snapshot_id 或 media.generate_video**）：
   - \`[时长/画幅] 一句话场景\`（如 \`[10秒 / ${aspectRatio}] ...\`）
   - **仅当本段为紧接上一段的连续镜头（同场景/同动作需要尾帧接力）时**，在 S02+ 段首加接续声明：\`本段为 N 秒短片的第 K 段（X-Y 秒），延续上一段尾帧与参考图的同一人物/场景/光线/质感，人物服装发型面容严格保持一致。\`（**若本段为独立切镜、换场景转场或不需要首尾帧接力，严禁强加此接续声明**，仅靠角色/场景参考图保持人物一致性即可）
   - **仅当本片/本段为第一人称/POV 题材时**，开头单独成段写强约束：\`全程严格第一人称：镜头就是拍摄者的眼睛，本人（及肩膀、衣袖、身体）绝不入镜，只允许手或前臂偶尔出现在画面边缘。\`
   - \`人物：\`（**全片各段出现同一角色时，必须逐字完全复用同一段人物外貌与服装颜色款式描述，严禁改写**）
   - \`场景：\`（地点 / 时间 / 光线 / 氛围）
   - \`分时节拍：\`（按 0-3秒 / 3-7秒 / 7-10秒 写清 2-3 个具体动作）
   - \`镜头语言：\`（机位 / 运镜 / 景别 / 手持或稳定 / 禁止的运镜）
   - \`声音：\`（环境音 / 拟音 / 台词，无台词不强加）
   - \`限制：\`（逐条列出禁止项：穿模、变形、塑料磨皮、多余人物、无文字水印等）
6. 【精简少干扰原则】：分镜首帧参考图提示词保持简洁直白，依靠参考图连线与尾帧接力保证人物与场景一致性！

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
            ? `采用【六段式结构化实拍导演版】（保持真实摄影感、禁止无意义形容词堆砌）：
  每段（S01、S02…）正文**必须严格按六段式出字段**：
  - 首行：\`[时长/画幅] 一句话场景\`（如 \`[10秒 / ${opts.aspectRatio}] ...\`）
  - 【按需连续接续声明（不强绑独立切镜）】：**仅当 S02/S03… 属于紧接上一段的同场景/同动作连续镜头（需要首尾帧接力）时**，才在段首加上：\`本段为 N 秒短片的第 K 段（X-Y 秒），延续上一段尾帧与参考图的同一人物/场景/光线/质感，人物服装发型面容严格保持一致。\`——**若是换场景转场、蒙太奇切镜或无需首尾帧接力的独立分镜，严禁硬塞此接续声明**（仅保留人物描述逐字复用与对应参考图）。（**严禁**输出 \`resume_from_snapshot_id\` 或 \`media.generate_video\`）
  - 【POV 强约束声明】：若为第一人称 / POV / 男友视角等题材，必须在开头单独成段写出强约束：\`全程严格第一人称：镜头就是拍摄者的眼睛，本人（及肩膀、衣袖、身体）绝不入镜，只允许手或前臂偶尔出现在画面边缘。\`
  - \`人物：\` 年龄 / 性别 / 外貌特征 / 服装颜色款式 / 发型（**全片所有段落必须逐字复用完全相同的「人物：」描述，一字不改**）
  - \`场景：\` 地点 / 时间 / 主光方向与色温 / 氛围
  - \`分时节拍：\` 按 \`0-3秒：... / 3-7秒：... / 7-10秒：...\` 写清本段 2–3 个动作（单段不超过 10 秒）
  - \`镜头语言：\` 机位 / 运镜 / 景别 / 手持或稳定 / 禁止的运镜
  - \`声音：\` 环境音 / 拟音 / 必要台词（无对白则只写环境音，**严禁默认台湾腔对白**）
  - \`限制：\` 不要穿模、不要变形、不要塑料磨皮、不要多余人物、无文字水印等。英文版结构完整对应。`
            : `采用【六段式极简实拍版】：每段严格按 \`[时长/画幅]\` + \`人物：\`（全片逐字复用）+ \`场景：\` + \`分时节拍：\` + \`镜头语言：\` + \`声音：\`（不默认台湾腔）+ \`限制：\` 输出，多段 S02+ 段首加尾帧接续声明，POV 题材加第一人称强约束，英文完整对应。`;

    const jsonTailRule = `
## 正式交付时的画布拆分 JSON（必须在交付最终提示词时附在最末尾）
当你输出正式分镜/视频提示词（非提问阶段）时，在回复的最末尾**必须**用 ===WORKFLOW_JSON_START=== 和 ===WORKFLOW_JSON_END=== 包裹一个合法的 JSON 对象（**不要使用 \`\`\`json 代码块，且字符串内换行必须用 \\n 转义**）：
===WORKFLOW_JSON_START===
{"negativePrompt":"no text, no watermark, no logo","characters":[{"name":"角色名","prompt":"真人实拍正面定妆照（空手站立无武器道具、干净浅灰背景、自然光、真实皮肤纹理、85mm镜头）","enPrompt":"Live-action front-facing casting photograph, empty-handed no weapons or props, clean studio background, soft natural light, natural skin texture, 85mm lens, no text"}],"scenes":[{"name":"核心场景名","prompt":"实拍空镜环境照片（${opts.aspectRatio}画幅，只写地点材质、时段天气与自然光线，不写动作运镜配乐，真实摄影颗粒感，无人物）","enPrompt":"Real-world live-action empty location photograph, ${opts.aspectRatio}, pure environment/lighting/weather only, authentic photography with subtle film grain and natural depth of field, no people, no concept art look, no text"}],"props":[{"name":"道具名","prompt":"实拍道具特写照片（干净浅色背景，自然光，真实材质，无人物）","enPrompt":"Live-action close-up photograph of prop, clean light background, natural light, realistic texture, no people, no text"}],"segments":[{"id":"S01","title":"第1段简述","duration":10,"assetRefs":["角色名","核心场景名","道具名"],"firstFramePrompt":"S01精简首帧实拍参考图（景别、人物站位、光线）","firstFrameEnPrompt":"S01 concise live-action keyframe photograph, framing, pose, natural lighting, no text","prompt":"S01精简中文视频提示词","enPrompt":"S01 concise English video prompt"}]}
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
