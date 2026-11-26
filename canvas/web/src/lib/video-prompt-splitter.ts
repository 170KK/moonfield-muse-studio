export type SplitVideoSegment = {
    id: string;
    title: string;
    prompt: string;
    duration: number;
};

const SEGMENT_HEADER_PATTERNS: RegExp[] = [
    /^(?:#+\s*)?(?:第\s*[一二三四五六七八九十\d]+\s*[段镜幕](?:提示词)?|片段\s*[一二三四五六七八九十\d]+)\b[^\n]*$/gm,
    /^(?:#+\s*)?(?:Clip|Part|Segment|Prompt)\s*\d+\b[^\n]*$/gim,
    /^(?:#+\s*)?(?:S0?\d+|SEG0?\d+)\s*[：:｜|\-][^\n]*$/gim,
];

export function isLongOrMultiSegmentPrompt(prompt: string, seconds?: number, tags?: string[]): boolean {
    if ((seconds || 0) > 10) return true;
    if (tags?.some((t) => t.includes("长视频") || t.includes("多段"))) return true;
    for (const re of SEGMENT_HEADER_PATTERNS) {
        re.lastIndex = 0;
        const matches = prompt.match(re);
        if (matches && matches.length >= 2) return true;
    }
    return false;
}

export function splitLongVideoPrompt(prompt: string, totalSeconds = 10, baseTitle = "视频"): SplitVideoSegment[] {
    const clean = prompt.trim();
    if (!clean) return [];

    // 1. Try explicit multi-segment headers first
    for (const re of SEGMENT_HEADER_PATTERNS) {
        re.lastIndex = 0;
        const matches = Array.from(clean.matchAll(re)).filter((m) => m.index !== undefined);
        if (matches.length >= 2) {
            const preamble = clean.slice(0, matches[0].index!).trim();
            const sharedHeader = preamble && preamble.length <= 550 ? preamble : "";
            return matches.slice(0, 12).map((m, idx) => {
                const start = m.index!;
                const end = idx + 1 < matches.length ? matches[idx + 1].index! : clean.length;
                const body = clean.slice(start, end).trim();
                const segId = `S${String(idx + 1).padStart(2, "0")}`;
                const headerLine = m[0].replace(/^#+\s*/, "").trim().slice(0, 28);
                const fullPrompt =
                    idx === 0 && sharedHeader && !body.includes(sharedHeader.slice(0, 30))
                        ? `${sharedHeader}\n\n${body}`
                        : idx > 0
                          ? `延续上一段尾帧的人物、服装、场景与光线质感，保持动作自然衔接：\n${sharedHeader && !body.includes(sharedHeader.slice(0, 24)) ? `${sharedHeader}\n` : ""}${body}`
                          : body;
                return {
                    id: segId,
                    title: `${segId} · ${headerLine || baseTitle}`,
                    prompt: fullPrompt,
                    duration: 10,
                };
            });
        }
    }

    // 2. Fallback: split by duration (<= 10s per Muse segment), capped at 12 segments
    const effectiveTotal = Math.max(20, totalSeconds > 10 ? totalSeconds : 30);
    const count = Math.min(12, Math.max(2, Math.ceil(effectiveTotal / 10)));
    const perSeg = Math.min(10, Math.max(5, Math.round(effectiveTotal / count)));

    return Array.from({ length: count }, (_, idx) => {
        const segId = `S${String(idx + 1).padStart(2, "0")}`;
        const tStart = idx * perSeg;
        const tEnd = idx === count - 1 ? effectiveTotal : (idx + 1) * perSeg;
        const segHeader =
            idx === 0
                ? `本段为 ${effectiveTotal} 秒长视频的第 1/${count} 段（${tStart}-${tEnd} 秒），时长严格为 ${perSeg} 秒，专注演绎开场与前半段动作：`
                : `本段为 ${effectiveTotal} 秒长视频的第 ${idx + 1}/${count} 段（${tStart}-${tEnd} 秒），时长严格为 ${perSeg} 秒，延续上一段尾帧的同一人物、服装、场景与光线质感，自然接续第 ${idx + 1} 段剧情：`;
        return {
            id: segId,
            title: `${segId}（${tStart}-${tEnd}s）· ${baseTitle}`,
            prompt: `${segHeader}\n${clean}`,
            duration: perSeg,
        };
    });
}
