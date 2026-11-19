import { useEffect, useMemo, useState } from "react";
import { Download, FolderArchive } from "lucide-react";
import { App, Button, Checkbox, Modal, Tag } from "antd";
import { zipSync } from "fflate";
import { saveAs } from "file-saver";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function VideoBatchDownloadModal({
    open,
    nodes,
    initialSelectedIds,
    onClose,
}: {
    open: boolean;
    nodes: CanvasNodeData[];
    initialSelectedIds: Set<string>;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const completedVideos = useMemo(
        () => nodes.filter((n) => n.type === CanvasNodeType.Video && Boolean(n.metadata?.content)),
        [nodes],
    );
    const [checkedIds, setCheckedIds] = useState<string[]>([]);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        if (!open) return;
        const preselected = completedVideos.filter((v) => initialSelectedIds.has(v.id)).map((v) => v.id);
        setCheckedIds(preselected.length > 0 ? preselected : completedVideos.map((v) => v.id));
    }, [open, completedVideos, initialSelectedIds]);

    const safeFileName = (title: string, idx: number) => {
        const cleaned = (title || `video_${idx + 1}`).replace(/[\\/:*?"<>|]+/g, "_").trim();
        return `${String(idx + 1).padStart(2, "0")}_${cleaned || "segment"}.mp4`;
    };

    const fetchVideoBytes = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    };

    const handleDownloadSeparate = async () => {
        const targets = completedVideos.filter((v) => checkedIds.includes(v.id));
        if (!targets.length) {
            message.warning("请至少勾选一段视频");
            return;
        }
        setDownloading(true);
        try {
            for (let i = 0; i < targets.length; i++) {
                const node = targets[i];
                const bytes = await fetchVideoBytes(node.metadata!.content!);
                saveAs(new Blob([bytes], { type: "video/mp4" }), safeFileName(node.title, i));
                if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 250));
            }
            message.success(`已触发下载 ${targets.length} 段视频`);
            onClose();
        } catch (err) {
            message.error(`下载失败：${err instanceof Error ? err.message : "未知错误"}`);
        } finally {
            setDownloading(false);
        }
    };

    const handleDownloadZip = async () => {
        const targets = completedVideos.filter((v) => checkedIds.includes(v.id));
        if (!targets.length) {
            message.warning("请至少勾选一段视频");
            return;
        }
        setDownloading(true);
        try {
            const entries: Record<string, Uint8Array> = {};
            for (let i = 0; i < targets.length; i++) {
                const node = targets[i];
                entries[safeFileName(node.title, i)] = await fetchVideoBytes(node.metadata!.content!);
            }
            const zipped = zipSync(entries, { level: 0 });
            saveAs(new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }), `muse-videos-${Date.now()}.zip`);
            message.success(`已打包下载 ${targets.length} 段视频`);
            onClose();
        } catch (err) {
            message.error(`打包失败：${err instanceof Error ? err.message : "未知错误"}`);
        } finally {
            setDownloading(false);
        }
    };

    const allChecked = completedVideos.length > 0 && checkedIds.length === completedVideos.length;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            centered
            title="批量下载视频片段"
            footer={
                <div className="flex items-center justify-between">
                    <Button
                        size="small"
                        onClick={() => setCheckedIds(allChecked ? [] : completedVideos.map((v) => v.id))}
                        disabled={!completedVideos.length || downloading}
                    >
                        {allChecked ? "取消全选" : "全选"}
                    </Button>
                    <div className="flex gap-2">
                        <Button onClick={onClose} disabled={downloading}>
                            关闭
                        </Button>
                        <Button
                            icon={<Download className="size-3.5" />}
                            loading={downloading}
                            disabled={!checkedIds.length}
                            onClick={() => void handleDownloadSeparate()}
                        >
                            逐个下载 ({checkedIds.length})
                        </Button>
                        <Button
                            type="primary"
                            icon={<FolderArchive className="size-3.5" />}
                            loading={downloading}
                            disabled={!checkedIds.length}
                            onClick={() => void handleDownloadZip()}
                        >
                            打包 ZIP ({checkedIds.length})
                        </Button>
                    </div>
                </div>
            }
        >
            {completedVideos.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-500">当前画布暂无已生成的视频片段</div>
            ) : (
                <div className="max-h-[55vh] space-y-2 overflow-y-auto py-2">
                    {completedVideos.map((video, idx) => {
                        const checked = checkedIds.includes(video.id);
                        return (
                            <div
                                key={video.id}
                                onClick={() =>
                                    setCheckedIds((prev) =>
                                        prev.includes(video.id) ? prev.filter((id) => id !== video.id) : [...prev, video.id],
                                    )
                                }
                                className="flex cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 py-2 transition hover:border-amber-400 dark:border-stone-800"
                            >
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <Checkbox checked={checked} />
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{video.title || `视频片段 ${idx + 1}`}</div>
                                        <div className="truncate text-xs text-stone-500">
                                            {video.metadata?.seconds ? `${video.metadata.seconds}s` : ""} {video.metadata?.size || ""}
                                        </div>
                                    </div>
                                </div>
                                <Tag color="green" className="m-0 shrink-0 text-xs">
                                    已生成
                                </Tag>
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
}
