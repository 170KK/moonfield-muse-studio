import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { BookOpen, Copy, FileText, Search, Star, Video } from "lucide-react";

import { isLongOrMultiSegmentPrompt, splitLongVideoPrompt, type SplitVideoSegment } from "@/lib/video-prompt-splitter";

type MusePromptItem = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl?: string;
    tags: string[];
    author?: string;
    imageSize?: string;
    imageCount?: number;
};

const FAVORITES_STORAGE_KEY = "muse_studio:video_prompt_favorites_v1";

function loadFavorites(): string[] {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

export function MuseVideoPromptModal({
    open,
    onClose,
    onCreateVideoNode,
    onCreateVideoChain,
    onInsertTextNode,
}: {
    open: boolean;
    onClose: () => void;
    onCreateVideoNode: (item: { title: string; prompt: string; aspect?: string; seconds?: number }) => void;
    onCreateVideoChain: (item: { title: string; segments: SplitVideoSegment[]; aspect?: string }) => void;
    onInsertTextNode: (item: { title: string; prompt: string }) => void;
}) {
    const { message } = App.useApp();
    const [items, setItems] = useState<MusePromptItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [aspectFilter, setAspectFilter] = useState<string>("all");
    const [refFilter, setRefFilter] = useState<"all" | "ref" | "text">("all");
    const [onlyFavorites, setOnlyFavorites] = useState(false);
    const [favorites, setFavorites] = useState<string[]>(loadFavorites);
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!open || items.length > 0) return;
        setLoading(true);
        void fetch("/prompts/muse-video-prompts.json", { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : []))
            .then((data: MusePromptItem[]) => {
                if (Array.isArray(data)) setItems(data);
            })
            .catch(() => {
                message.error("加载 Muse 视频提示词库失败");
            })
            .finally(() => setLoading(false));
    }, [open, items.length, message]);

    const toggleFavorite = (id: string) => {
        setFavorites((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try {
                localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // ignore storage quota errors
            }
            return next;
        });
    };

    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of items) {
            const cat = item.tags?.[0];
            if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
        }
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    }, [items]);

    const filtered = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        return items.filter((item) => {
            if (selectedCategory !== "all" && item.tags?.[0] !== selectedCategory) return false;
            if (aspectFilter !== "all" && item.imageSize !== aspectFilter) return false;
            if (refFilter === "ref" && !item.tags?.includes("需参考图")) return false;
            if (refFilter === "text" && !item.tags?.includes("纯文本")) return false;
            if (onlyFavorites && !favorites.includes(item.id)) return false;
            if (q && ![item.title, item.prompt, item.description, item.author || "", ...(item.tags || [])].join(" ").toLowerCase().includes(q)) {
                return false;
            }
            return true;
        });
    }, [items, keyword, selectedCategory, aspectFilter, refFilter, onlyFavorites, favorites]);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success("已复制提示词");
        } catch {
            message.error("复制失败");
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <BookOpen className="size-4 text-indigo-500" />
                    <span>Muse 视频提示词库</span>
                    <Tag color="geekblue" className="m-0 text-xs">
                        {items.length} 条精选
                    </Tag>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={920}
            centered
        >
            <div className="flex h-[72dvh] flex-col gap-3" data-canvas-no-zoom onWheelCapture={(e) => e.stopPropagation()}>
                <Input
                    size="large"
                    allowClear
                    prefix={<Search className="size-4 text-stone-400" />}
                    placeholder="搜标题、关键词或提示词内容..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                />

                {/* 分类胶囊筛选 */}
                <div className="flex flex-wrap gap-1.5">
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("all")}
                        className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition ${
                            selectedCategory === "all"
                                ? "border-indigo-500 bg-indigo-500 text-white"
                                : "border-stone-200 bg-stone-50 text-stone-700 hover:border-indigo-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                        }`}
                    >
                        全部 {items.length}
                    </button>
                    {categories.map(([cat, count]) => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedCategory((cur) => (cur === cat ? "all" : cat))}
                            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition ${
                                selectedCategory === cat
                                    ? "border-indigo-500 bg-indigo-500 text-white"
                                    : "border-stone-200 bg-stone-50 text-stone-700 hover:border-indigo-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                            }`}
                        >
                            {cat} {count}
                        </button>
                    ))}
                </div>

                {/* 二级条件栏：画幅 / 参考图 / 收藏 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-2.5 dark:border-stone-800">
                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            size="small"
                            value={aspectFilter}
                            onChange={setAspectFilter}
                            style={{ width: 112 }}
                            options={[
                                { label: "全部画幅", value: "all" },
                                { label: "16:9 横屏", value: "16:9" },
                                { label: "9:16 竖屏", value: "9:16" },
                            ]}
                        />
                        <Select
                            size="small"
                            value={refFilter}
                            onChange={setRefFilter}
                            style={{ width: 128 }}
                            options={[
                                { label: "全部类型", value: "all" },
                                { label: "只看需参考图", value: "ref" },
                                { label: "只看纯文本", value: "text" },
                            ]}
                        />
                        <button
                            type="button"
                            onClick={() => setOnlyFavorites((v) => !v)}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                                onlyFavorites
                                    ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300"
                                    : "border-stone-200 text-stone-600 hover:border-amber-400 dark:border-stone-700 dark:text-stone-300"
                            }`}
                        >
                            <Star className={`size-3.5 ${onlyFavorites ? "fill-current" : ""}`} />
                            我的收藏 {favorites.length}
                        </button>
                    </div>
                    <span className="text-xs text-stone-500">共匹配 {filtered.length} 条</span>
                </div>

                {/* 提示词卡片列表 */}
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                    {loading ? (
                        <div className="flex h-48 items-center justify-center">
                            <Spin />
                        </div>
                    ) : filtered.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的提示词" className="py-12" />
                    ) : (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {filtered.map((item) => {
                                const isFav = favorites.includes(item.id);
                                const isExpanded = Boolean(expandedIds[item.id]);
                                return (
                                    <div
                                        key={item.id}
                                        className="flex flex-col justify-between gap-2.5 rounded-xl border border-stone-200 bg-white p-3.5 transition hover:border-indigo-400/70 dark:border-stone-800 dark:bg-stone-900/80"
                                    >
                                        <div>
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    {item.coverUrl ? (
                                                        <img src={item.coverUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" loading="lazy" />
                                                    ) : null}
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
                                                            {item.title}
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {item.tags.map((tag) => (
                                                                <Tag key={tag} className="m-0 text-[10px]">
                                                                    {tag}
                                                                </Tag>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFavorite(item.id)}
                                                    className="shrink-0 cursor-pointer p-1 text-stone-400 transition hover:text-amber-500"
                                                    title={isFav ? "取消收藏" : "收藏"}
                                                >
                                                    <Star className={`size-4 ${isFav ? "fill-amber-400 text-amber-400" : ""}`} />
                                                </button>
                                            </div>
                                            <div
                                                onClick={() => setExpandedIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                                className={`mt-2 cursor-pointer whitespace-pre-wrap text-xs leading-5 text-stone-600 dark:text-stone-300 ${
                                                    isExpanded ? "" : "line-clamp-3"
                                                }`}
                                                title="点击展开/收起完整提示词"
                                            >
                                                {item.prompt}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-stone-100 pt-2 dark:border-stone-800">
                                            <span className="text-[11px] text-stone-400">{item.author ? `by ${item.author}` : item.id}</span>
                                            <div className="flex items-center gap-1.5">
                                                <Button size="small" icon={<Copy className="size-3" />} onClick={() => void copyPrompt(item.prompt)}>
                                                    复制
                                                </Button>
                                                <Button
                                                    size="small"
                                                    icon={<FileText className="size-3" />}
                                                    onClick={() => {
                                                        onInsertTextNode({ title: item.title, prompt: item.prompt });
                                                        onClose();
                                                    }}
                                                >
                                                    文本节点
                                                </Button>
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    icon={<Video className="size-3" />}
                                                    onClick={() => {
                                                        const isLong = isLongOrMultiSegmentPrompt(item.prompt, item.imageCount, item.tags);
                                                        if (isLong) {
                                                            const segments = splitLongVideoPrompt(item.prompt, item.imageCount || 30, item.title);
                                                            if (segments.length >= 2) {
                                                                onCreateVideoChain({
                                                                    title: item.title,
                                                                    segments,
                                                                    aspect: item.imageSize || undefined,
                                                                });
                                                                onClose();
                                                                return;
                                                            }
                                                        }
                                                        onCreateVideoNode({
                                                            title: item.title,
                                                            prompt: item.prompt,
                                                            aspect: item.imageSize || undefined,
                                                            seconds: item.imageCount || undefined,
                                                        });
                                                        onClose();
                                                    }}
                                                >
                                                    {isLongOrMultiSegmentPrompt(item.prompt, item.imageCount, item.tags) ? "拆段尾帧链" : "建视频节点"}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
