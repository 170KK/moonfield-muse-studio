import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { App, Dropdown, Empty, Input, Modal, Popconfirm, Select, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, ChevronRight, Download, Eye, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Image as ImageIcon, LayoutGrid, ListChecks, Music2, Pencil, Plus, Rows3, Search, Settings2, Square, Trash2, Type, Video } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { exportAssets, readAssetPackage } from "@/pages/assets/asset-transfer";
import { fetchSourcePrompts, type Prompt } from "@/services/api/prompts";
import { uploadMediaFile } from "@/services/file-storage";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision, uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetFolder, type AssetKind } from "@/stores/use-asset-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onHoverNode: (nodeId: string | null) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onHoverNode, onInsertAsset }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[60] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-5 px-4 pt-3.5">
                    <TabButton label={t("canvas.sidePanel.canvas")} active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                    <TabButton label={t("canvas.sidePanel.assets")} active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                    <TabButton label={t("canvas.sidePanel.prompts")} active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {tab === "canvas" ? (
                        <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} onHoverNode={onHoverNode} theme={theme} />
                    ) : tab === "assets" ? (
                        <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                    ) : (
                        <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                    )}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.sidePanel.resize")} />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Canvas tab: list nodes and center, zoom, and select the clicked node.
// ---------------------------------------------------------------------------

const NODE_FILTER_VALUES = ["all", CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text, CanvasNodeType.Audio, CanvasNodeType.Config, CanvasNodeType.Group];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onHoverNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; onHoverNode: (nodeId: string | null) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const nodeViewMode = useCanvasSidePanelStore((state) => state.nodeViewMode);
    const setNodeViewMode = useCanvasSidePanelStore((state) => state.setNodeViewMode);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);
    const treeRows = useMemo(() => {
        const filteredIds = new Set(filtered.map((node) => node.id));
        const groups = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
        const children = new Map<string, CanvasNodeData[]>();
        filtered.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId && groups.has(groupId)) children.set(groupId, [...(children.get(groupId) || []), node]);
        });
        return nodes.flatMap((node) => {
            if (node.metadata?.groupId && groups.has(node.metadata.groupId)) return [];
            if (node.type !== CanvasNodeType.Group) return filteredIds.has(node.id) ? [{ node, depth: 0, hasChildren: false }] : [];
            const groupChildren = children.get(node.id) || [];
            if (!filteredIds.has(node.id) && !groupChildren.length) return [];
            return [{ node, depth: 0, hasChildren: groupChildren.length > 0 }, ...(collapsedGroups.has(node.id) ? [] : groupChildren.map((child) => ({ node: child, depth: 1, hasChildren: false })))];
        });
    }, [collapsedGroups, filtered, nodes]);

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    // Let the hover preview fade out before the canvas starts moving to the node.
    const PRESS_FOCUS_DELAY = 180;
    const focusTimerRef = useRef<number | null>(null);
    useEffect(() => () => { if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current); }, []);
    const activateNode = (node: CanvasNodeData) => {
        if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
        const hasPreview = (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content);
        if (!hasPreview) {
            onFocusNode(node.id);
            return;
        }
        onHoverNode(null);
        focusTimerRef.current = window.setTimeout(() => {
            focusTimerRef.current = null;
            onFocusNode(node.id);
        }, PRESS_FOCUS_DELAY);
    };

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.sidePanel.exportName", { count: targets.length }));
            message.success(t("canvas.sidePanel.exported", { count: targets.length }));
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col" onMouseLeave={() => onHoverNode(null)}>
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="min-w-0 truncate text-xs font-medium opacity-60">{t("canvas.sidePanel.elements")}</span>
                {filtered.length ? <span className="shrink-0 text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                </button>
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_VALUES.map((value) => ({ value, label: value === "all" ? t("common.all") : t(`canvas.sidePanel.filter.${value}`) }))} />}
                <button
                    type="button"
                    onClick={() => setNodeViewMode(nodeViewMode === "grid" ? "list" : "grid")}
                    className="flex shrink-0 items-center rounded-md px-1.5 py-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    title={nodeViewMode === "grid" ? t("canvas.sidePanel.viewList") : t("canvas.sidePanel.viewGrid")}
                    aria-label={nodeViewMode === "grid" ? t("canvas.sidePanel.viewList") : t("canvas.sidePanel.viewGrid")}
                >
                    {nodeViewMode === "grid" ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                </button>
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchNodes")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {nodeViewMode === "grid" ? (
                    filtered.length ? (
                        <div className="grid gap-2 px-1 [grid-template-columns:repeat(auto-fill,minmax(88px,1fr))]">
                            {filtered.map((node) => {
                                const Icon = NODE_TYPE_ICON[node.type] || FileText;
                                const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                                const isChecked = checked.has(node.id);
                                const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                                return (
                                    <button
                                        key={node.id}
                                        type="button"
                                        data-node-item
                                        onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))}
                                        onMouseEnter={() => onHoverNode(node.id)}
                                        onMouseLeave={(event) => {
                                            const to = event.relatedTarget as Element | null;
                                            if (!to || !to.closest("[data-node-item]")) onHoverNode(null);
                                        }}
                                        className="group relative flex min-w-0 flex-col rounded-lg p-1 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                                        style={active ? { background: theme.toolbar.activeBg } : undefined}
                                        title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}
                                    >
                                        <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-md">
                                            {isImage ? <img src={previewUrlFor(node.metadata?.storageKey) || node.metadata?.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-6 opacity-60" />}
                                            {selectMode ? (
                                                <span className="absolute left-1 top-1">
                                                    <CheckMark checked={isChecked} theme={theme} />
                                                </span>
                                            ) : null}
                                            {node.metadata?.status && node.metadata.status !== "idle" ? <span className="absolute right-1 top-1 size-1.5 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                        </span>
                                        <span className="mt-1 block truncate text-xs font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="pt-16 text-center text-sm opacity-40">{t("canvas.sidePanel.noNodes")}</div>
                    )
                ) : treeRows.length ? (
                    <div className="space-y-1.5">
                        {treeRows.map(({ node, depth, hasChildren }) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const isChecked = checked.has(node.id);
                            const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                            return (
                                <div
                                    key={node.id}
                                    data-node-item
                                    className={cn("group relative flex items-center rounded-lg transition", depth && "ml-5", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
                                    style={active ? { background: theme.toolbar.activeBg } : undefined}
                                    onMouseEnter={() => onHoverNode(node.id)}
                                    onMouseLeave={(event) => {
                                        const to = event.relatedTarget as Element | null;
                                        if (!to || !to.closest("[data-node-item]")) onHoverNode(null);
                                    }}
                                >
                                    {depth ? <span className="pointer-events-none absolute -left-3 top-[calc(-50%-0.4rem)] h-[calc(100%+0.4rem)] w-3 rounded-bl-md border-b border-l opacity-45" style={{ borderColor: theme.node.stroke }} /> : null}
                                    {node.type === CanvasNodeType.Group && hasChildren ? (
                                        <button type="button" onClick={() => setCollapsedGroups((prev) => (prev.has(node.id) ? new Set([...prev].filter((id) => id !== node.id)) : new Set(prev).add(node.id)))} className="ml-1 grid size-6 shrink-0 place-items-center opacity-55 transition hover:opacity-100" aria-label={node.title}>
                                            <ChevronRight className={cn("size-3.5 transition-transform", !collapsedGroups.has(node.id) && "rotate-90")} />
                                        </button>
                                    ) : null}
                                    <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))} className={cn("flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left", node.type === CanvasNodeType.Group && hasChildren ? "pl-0" : "pl-2")} title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}>
                                        {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                                        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                                            {isImage ? <img src={previewUrlFor(node.metadata?.storageKey) || node.metadata?.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}
                                        </span>
                                        <span className="min-w-0 flex-1 space-y-0.5">
                                            <span className="block truncate text-sm font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
                                            <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span>
                                        </span>
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                    {selectMode || !isImage ? null : (
                                        <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5">
                                            <button type="button" onClick={() => onPreviewNode(node.id)} className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.preview")} title={t("canvas.sidePanel.preview")}>
                                                <Eye className="size-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{t("canvas.sidePanel.noNodes")}</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {allChecked ? t("canvas.sidePanel.clearAll") : t("workbench.selectAll")}
                    </button>
                    <span className="text-xs opacity-45">{t("canvas.sidePanel.selected", { count: checked.size })}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        {t("canvas.exportSelected")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Assets tab: collapsible type groups, tag filtering, and click-to-insert.
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; icon: typeof Square }[] = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Video },
    { kind: "text", icon: FileText },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders || []);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const addFolder = useAssetStore((state) => state.addFolder);
    const renameFolder = useAssetStore((state) => state.renameFolder);
    const removeFolder = useAssetStore((state) => state.removeFolder);
    const moveFolder = useAssetStore((state) => state.moveFolder);
    const moveAssetToFolder = useAssetStore((state) => state.moveAssetToFolder);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [folderModalOpen, setFolderModalOpen] = useState(false);
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [parentFolderId, setParentFolderId] = useState<string | undefined>(undefined);
    const [newFolderName, setNewFolderName] = useState("");
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportTargetId, setExportTargetId] = useState<string>("__all__");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderImportInputRef = useRef<HTMLInputElement>(null);

    const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            const matchTag = tagFilter === "all" || (asset.tags || []).includes(tagFilter);
            const matchQuery = !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query);
            return matchTag && matchQuery;
        });
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    const openCreateFolder = (parentId?: string) => {
        setEditingFolderId(null);
        setParentFolderId(parentId);
        setNewFolderName("");
        setFolderModalOpen(true);
    };

    const openRenameFolder = (folder: AssetFolder) => {
        setEditingFolderId(folder.id);
        setParentFolderId(undefined);
        setNewFolderName(folder.name);
        setFolderModalOpen(true);
    };

    const handleSubmitFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        if (editingFolderId) {
            renameFolder(editingFolderId, trimmed);
            message.success(`已重命名为：${trimmed}`);
        } else {
            const id = addFolder(trimmed, parentFolderId);
            if (id) {
                setExpandedFolders((prev) => ({
                    ...prev,
                    ...(parentFolderId ? { [parentFolderId]: true } : {}),
                    [id]: true,
                }));
                message.success(`已创建文件夹：${trimmed}`);
            }
        }
        setNewFolderName("");
        setEditingFolderId(null);
        setParentFolderId(undefined);
        setFolderModalOpen(false);
    };

    const formatDateTimeFolderName = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    const addMediaFile = async (file: File, targetFolderId?: string) => {
        const cleanTitle = file.name.replace(/\.[^.]+$/, "").trim() || file.name;
        if (file.type.startsWith("image/")) {
            const image = await uploadImage(file);
            addAsset({ kind: "image", title: cleanTitle, coverUrl: image.url, tags: [], folderId: targetFolderId, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
            return true;
        }
        if (file.type.startsWith("video/")) {
            const media = await uploadMediaFile(file, "video");
            addAsset({ kind: "video", title: cleanTitle, coverUrl: "", tags: [], folderId: targetFolderId, data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
            return true;
        }
        return false;
    };

    const handleFiles = async (fileList: FileList | null, explicitFolderId?: string) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        const zipFiles = files.filter((f) => f.name.toLowerCase().endsWith(".zip") || f.type === "application/zip");
        const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
        let added = 0;
        try {
            for (const zipFile of zipFiles) {
                const imported = await readAssetPackage(zipFile);
                if (imported.length > 0) {
                    const rawBase = zipFile.name.replace(/\.[^.]+$/, "").trim();
                    const folderName = rawBase || formatDateTimeFolderName();
                    const zipFolderId = explicitFolderId || addFolder(folderName);
                    if (zipFolderId) {
                        setExpandedFolders((prev) => ({ ...prev, [zipFolderId]: true }));
                    }
                    imported.forEach((asset) => {
                        const payload = { ...asset } as Record<string, unknown>;
                        delete payload.id;
                        delete payload.createdAt;
                        delete payload.updatedAt;
                        if (zipFolderId) payload.folderId = zipFolderId;
                        addAsset(payload as Parameters<typeof addAsset>[0]);
                        added += 1;
                    });
                }
            }
            if (mediaFiles.length > 0) {
                let targetFolderId = explicitFolderId || undefined;
                if (!targetFolderId && mediaFiles.length > 1) {
                    const createdId = addFolder(formatDateTimeFolderName());
                    if (createdId) {
                        targetFolderId = createdId;
                        setExpandedFolders((prev) => ({ ...prev, [createdId]: true }));
                    }
                }
                for (const file of mediaFiles) {
                    if (await addMediaFile(file, targetFolderId)) added += 1;
                }
            }
            if (added) message.success(t("canvas.sidePanel.addedAssets", { count: added }));
            else message.warning(t("canvas.sidePanel.mediaOnly"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleLocalFolderImport = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
        if (!files.length) {
            message.warning("所选文件夹中没有支持的图片或视频文件");
            if (folderImportInputRef.current) folderImportInputRef.current.value = "";
            return;
        }
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        try {
            const pathMap = new Map<string, string>();
            let firstRootId: string | undefined;
            const ensureFolderByParts = (parts: string[]): string | undefined => {
                let parentId: string | undefined = undefined;
                let accum = "";
                for (const part of parts) {
                    accum = accum ? `${accum}/${part}` : part;
                    const cached = pathMap.get(accum);
                    if (cached) {
                        parentId = cached;
                    } else {
                        const existing = folders.find((f) => (f.parentId || undefined) === parentId && f.name === part);
                        const id = existing ? existing.id : addFolder(part, parentId);
                        if (id) {
                            pathMap.set(accum, id);
                            setExpandedFolders((prev) => ({ ...prev, [id]: true }));
                            if (!firstRootId && accum === parts[0]) firstRootId = id;
                            parentId = id;
                        }
                    }
                }
                return parentId;
            };
            let added = 0;
            for (const file of files) {
                const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
                const segments = rel.split("/").filter(Boolean);
                const dirParts = segments.length > 1 ? segments.slice(0, -1) : [];
                const targetFolderId = dirParts.length > 0 ? ensureFolderByParts(dirParts) : undefined;
                if (await addMediaFile(file, targetFolderId)) added += 1;
            }
            if (added) message.success(t("canvas.sidePanel.addedAssets", { count: added }));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (folderImportInputRef.current) folderImportInputRef.current.value = "";
        }
    };

    const collectFolderSubtreeIds = (rootId: string): Set<string> => {
        const ids = new Set<string>([rootId]);
        let added = true;
        while (added) {
            added = false;
            for (const f of folders) {
                if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
                    ids.add(f.id);
                    added = true;
                }
            }
        }
        return ids;
    };

    const getExportCandidates = (targetId: string) => {
        if (targetId === "__all__") return assets;
        if (targetId === "__root__") return assets.filter((a) => !a.folderId);
        const ids = collectFolderSubtreeIds(targetId);
        return assets.filter((a) => a.folderId && ids.has(a.folderId));
    };

    const exportTreeOptions = useMemo(() => {
        const result: Array<{ id: string; name: string; depth: number }> = [];
        const walk = (parentId: string | undefined, depth: number) => {
            for (const f of folders.filter((item) => (item.parentId || undefined) === parentId)) {
                result.push({ id: f.id, name: f.name, depth });
                walk(f.id, depth + 1);
            }
        };
        walk(undefined, 0);
        return result;
    }, [folders]);

    const confirmExportAssets = async () => {
        const items = getExportCandidates(exportTargetId);
        if (!items.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        const folderName =
            exportTargetId === "__all__"
                ? t("assets.packageName")
                : exportTargetId === "__root__"
                  ? "未分类资产"
                  : folderMap.get(exportTargetId)?.name || t("assets.packageName");
        setExportModalOpen(false);
        await exportAssets(items, folderName);
    };

    const handleDropOnFolder = (e: React.DragEvent, targetFolderId?: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverFolderId(null);
        const draggedFolderId = e.dataTransfer.getData("text/muse-folder-id");
        if (draggedFolderId) {
            if (draggedFolderId !== targetFolderId) {
                moveFolder(draggedFolderId, targetFolderId);
                if (targetFolderId) {
                    setExpandedFolders((prev) => ({ ...prev, [targetFolderId]: true }));
                }
                message.success(targetFolderId ? `已移动文件夹到：${folderMap.get(targetFolderId)?.name || ""}` : "已移至根目录");
            }
            return;
        }
        const assetId = e.dataTransfer.getData("text/muse-asset-id");
        if (assetId) {
            moveAssetToFolder(assetId, targetFolderId);
            if (targetFolderId) {
                setExpandedFolders((prev) => ({ ...prev, [targetFolderId]: true }));
            }
            message.success(targetFolderId ? `已拖入文件夹：${folderMap.get(targetFolderId)?.name || ""}` : "已移至未分类");
            return;
        }
        if (e.dataTransfer.files?.length) {
            void handleFiles(e.dataTransfer.files, targetFolderId || "");
        }
    };

    return (
        <>
        <Dropdown
            trigger={["contextMenu"]}
            menu={{
                items: [
                    { key: "new-folder", icon: <FolderPlus className="size-3.5" />, label: "新建文件夹", onClick: () => openCreateFolder() },
                    { key: "upload", icon: <Plus className="size-3.5" />, label: "添加本地图片/视频", onClick: () => fileInputRef.current?.click() },
                ],
            }}
        >
        <div className="flex h-full flex-col">
            <div className="px-3 pb-1.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchAssets")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-2">
                <button
                    type="button"
                    onClick={() => openCreateFolder()}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-500/45 bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-500 transition hover:bg-amber-500/20"
                    title="新建文件夹（也可在下方空白处右键新建）"
                >
                    <FolderPlus className="size-3.5 shrink-0" />
                    <span className="truncate">新建文件夹</span>
                </button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "files", label: "选择图片 / 视频 / 资产包（多选）", onClick: () => fileInputRef.current?.click() },
                            { key: "folder", label: "选择本地文件夹导入", onClick: () => folderImportInputRef.current?.click() },
                        ],
                    }}
                >
                    <button
                        type="button"
                        disabled={uploading}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.text }}
                    >
                        <Plus className="size-3.5 shrink-0" />
                        <span className="truncate">新增资产</span>
                    </button>
                </Dropdown>
                <button
                    type="button"
                    onClick={() => {
                        if (!assets.length) {
                            message.warning(t("assets.noneToExport"));
                            return;
                        }
                        setExportTargetId("__all__");
                        setExportModalOpen(true);
                    }}
                    className="flex shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ borderColor: theme.toolbar.border, color: theme.node.text }}
                    title="选择文件夹导出资产"
                >
                    <Download className="size-3.5 shrink-0" />
                    <span>导出</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*,video/*,application/zip,.zip" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
                <input ref={folderImportInputRef} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => void handleLocalFolderImport(e.target.files)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        {t("common.all")}
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {/* 竖向文件夹树：支持多级子文件夹、点击展开查看资产、拖拽图片/视频进去、右键新建子文件夹/重命名/删除 */}
                {folders.length > 0 ? (
                    <div className="mb-2 space-y-1">
                        {(() => {
                            const renderFolderBranch = (parentId: string | undefined, depth: number): React.ReactNode =>
                                folders
                                    .filter((f) => (f.parentId || undefined) === parentId)
                                    .map((folder) => {
                                        const isExpanded = Boolean(expandedFolders[folder.id]);
                                        const isDragOver = dragOverFolderId === folder.id;
                                        const folderItems = filtered.filter((a) => a.folderId === folder.id);
                                        const childFolders = folders.filter((f) => f.parentId === folder.id);
                                        const subtreeIds = collectFolderSubtreeIds(folder.id);
                                        const subtreeAssetCount = filtered.filter((a) => a.folderId && subtreeIds.has(a.folderId)).length;
                                        return (
                                            <Dropdown
                                                key={folder.id}
                                                trigger={["contextMenu"]}
                                                menu={{
                                                    items: [
                                                        { key: "sub", icon: <FolderPlus className="size-3.5" />, label: "新建子文件夹", onClick: () => openCreateFolder(folder.id) },
                                                        { key: "rename", icon: <Pencil className="size-3.5" />, label: "重命名文件夹", onClick: () => openRenameFolder(folder) },
                                                        {
                                                            key: "move",
                                                            icon: <FolderInput className="size-3.5" />,
                                                            label: "移动文件夹到",
                                                            children: [
                                                                ...(folder.parentId
                                                                    ? [{ key: "__root__", label: "根目录", onClick: () => (moveFolder(folder.id, undefined), message.success("已移至根目录")) }]
                                                                    : []),
                                                                ...folders
                                                                    .filter((f) => f.id !== folder.id && f.id !== folder.parentId)
                                                                    .map((f) => ({
                                                                        key: f.id,
                                                                        label: `📁 ${f.name}`,
                                                                        onClick: () => {
                                                                            moveFolder(folder.id, f.id);
                                                                            setExpandedFolders((prev) => ({ ...prev, [f.id]: true }));
                                                                            message.success(`已移入：${f.name}`);
                                                                        },
                                                                    })),
                                                            ],
                                                        },
                                                        {
                                                            key: "delete",
                                                            danger: true,
                                                            icon: <Trash2 className="size-3.5" />,
                                                            label: "删除文件夹",
                                                            onClick: () => {
                                                                removeFolder(folder.id);
                                                                message.success("已删除文件夹");
                                                            },
                                                        },
                                                    ],
                                                }}
                                            >
                                                <div
                                                    draggable
                                                    onDragStart={(e) => {
                                                        e.stopPropagation();
                                                        e.dataTransfer.setData("text/muse-folder-id", folder.id);
                                                        e.dataTransfer.effectAllowed = "move";
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setDragOverFolderId(folder.id);
                                                    }}
                                                    onDragLeave={(e) => {
                                                        e.stopPropagation();
                                                        setDragOverFolderId(null);
                                                    }}
                                                    onDrop={(e) => handleDropOnFolder(e, folder.id)}
                                                    className={cn("rounded-lg transition", isDragOver && "bg-amber-500/15 ring-2 ring-amber-500/60")}
                                                >
                                                    <div
                                                        className="group/folder flex w-full items-center gap-1 rounded-md py-1.5 pr-1.5 text-left text-xs font-semibold opacity-85 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                                                        style={{ paddingLeft: 6 + depth * 14 }}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))}
                                                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                                        >
                                                            <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", isExpanded && "rotate-90")} />
                                                            {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-amber-500" /> : <Folder className="size-3.5 shrink-0 text-amber-500" />}
                                                            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                                                            <span className="shrink-0 text-[11px] opacity-55">
                                                                {childFolders.length > 0 ? `${childFolders.length} 子夹 · ${subtreeAssetCount}` : folderItems.length}
                                                            </span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openCreateFolder(folder.id);
                                                            }}
                                                            className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition hover:bg-amber-500/20 hover:text-amber-500 group-hover/folder:opacity-100"
                                                            title="在此文件夹内新建子文件夹"
                                                        >
                                                            <FolderPlus className="size-3" />
                                                        </button>
                                                    </div>
                                                    {isExpanded ? (
                                                        <div>
                                                            {childFolders.length > 0 ? <div className="space-y-0.5">{renderFolderBranch(folder.id, depth + 1)}</div> : null}
                                                            {folderItems.length > 0 ? (
                                                                <div className="grid grid-cols-2 gap-2 pb-2 pt-1" style={{ paddingLeft: 8 + depth * 14, paddingRight: 4 }}>
                                                                    {folderItems.map((asset) => (
                                                                        <AssetCard
                                                                            key={asset.id}
                                                                            asset={asset}
                                                                            folders={folders}
                                                                            theme={theme}
                                                                            onInsert={() => onInsert(buildInsertPayload(asset))}
                                                                            onMoveToFolder={(fid) => {
                                                                                moveAssetToFolder(asset.id, fid);
                                                                                message.success(fid ? `已移入文件夹：${folderMap.get(fid)?.name || ""}` : "已移出文件夹");
                                                                            }}
                                                                            onRemove={() => (removeAsset(asset.id), message.success(t("canvas.sidePanel.assetRemoved")))}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            ) : childFolders.length === 0 ? (
                                                                <div className="py-1.5 text-[11px] opacity-45" style={{ paddingLeft: 26 + depth * 14 }}>
                                                                    空文件夹，可拖入图片或点右侧 + 建子文件夹
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </Dropdown>
                                        );
                                    });
                            return renderFolderBranch(undefined, 0);
                        })()}
                    </div>
                ) : null}
                {groups.length ? (
                    <div
                        onDragOver={(e) => {
                            if (folders.length > 0) {
                                e.preventDefault();
                                setDragOverFolderId("uncategorized");
                            }
                        }}
                        onDragLeave={() => setDragOverFolderId(null)}
                        onDrop={(e) => handleDropOnFolder(e, undefined)}
                        className={cn("space-y-1 rounded-lg transition", dragOverFolderId === "uncategorized" && "ring-2 ring-amber-500/50")}
                    >
                        {groups.map((group) => {
                            const uncategorizedItems = folders.length > 0 ? group.items.filter((a) => !a.folderId) : group.items;
                            if (uncategorizedItems.length === 0) return null;
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{folders.length > 0 ? `未分类 · ${t(`assets.kinds.${group.kind}`)}` : t(`assets.kinds.${group.kind}`)}</span>
                                        <span className="opacity-50">{uncategorizedItems.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {uncategorizedItems.map((asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    folders={folders}
                                                    theme={theme}
                                                    onInsert={() => onInsert(buildInsertPayload(asset))}
                                                    onMoveToFolder={(fid) => {
                                                        moveAssetToFolder(asset.id, fid);
                                                        message.success(fid ? `已移入文件夹：${folderMap.get(fid)?.name || ""}` : "已移出文件夹");
                                                    }}
                                                    onRemove={() => (removeAsset(asset.id), message.success(t("canvas.sidePanel.assetRemoved")))}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noAssets")} className="pt-16" />
                )}
            </div>
        </div>
        </Dropdown>
        <Modal
            title={editingFolderId ? "重命名文件夹" : parentFolderId ? `在「${folderMap.get(parentFolderId)?.name || ""}」内新建子文件夹` : "新建文件夹"}
            open={folderModalOpen}
            onOk={handleSubmitFolder}
            onCancel={() => {
                setFolderModalOpen(false);
                setEditingFolderId(null);
                setNewFolderName("");
            }}
            okText="确定"
            cancelText="取消"
            width={340}
            centered
        >
            <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onPressEnter={handleSubmitFolder}
                placeholder="请输入文件夹名称（如：角色库、场景库）"
            />
        </Modal>
        <Modal
            title="选择要导出的文件夹"
            open={exportModalOpen}
            onOk={() => void confirmExportAssets()}
            onCancel={() => setExportModalOpen(false)}
            okText="确认导出"
            cancelText="取消"
            width={380}
            centered
            destroyOnHidden
        >
            <div className="max-h-72 space-y-1 overflow-y-auto py-1">
                <button
                    type="button"
                    onClick={() => setExportTargetId("__all__")}
                    className={cn(
                        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition",
                        exportTargetId === "__all__" ? "bg-indigo-500/15 font-medium text-indigo-500" : "hover:bg-black/5 dark:hover:bg-white/10",
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Folder className="size-3.5 text-indigo-500" />
                        <span>全部资产（所有文件夹）</span>
                    </span>
                    <span className="opacity-50">{assets.length}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setExportTargetId("__root__")}
                    className={cn(
                        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition",
                        exportTargetId === "__root__" ? "bg-indigo-500/15 font-medium text-indigo-500" : "hover:bg-black/5 dark:hover:bg-white/10",
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Folder className="size-3.5 text-stone-400" />
                        <span>仅未分类资产</span>
                    </span>
                    <span className="opacity-50">{assets.filter((a) => !a.folderId).length}</span>
                </button>
                {exportTreeOptions.map((item) => {
                    const count = getExportCandidates(item.id).length;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setExportTargetId(item.id)}
                            style={{ paddingLeft: `${12 + item.depth * 16}px` }}
                            className={cn(
                                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg py-2 pr-3 text-left text-xs transition",
                                exportTargetId === item.id ? "bg-indigo-500/15 font-medium text-indigo-500" : "hover:bg-black/5 dark:hover:bg-white/10",
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <Folder className="size-3.5 shrink-0 text-amber-500" />
                                <span className="truncate">{item.name}</span>
                            </span>
                            <span className="shrink-0 opacity-50">{count}</span>
                        </button>
                    );
                })}
            </div>
        </Modal>
        </>
    );
});

function AssetCard({ asset, folders, folderName, theme, onInsert, onMoveToFolder, onRemove }: { asset: Asset; folders: AssetFolder[]; folderName?: string; theme: CanvasTheme; onInsert: () => void; onMoveToFolder: (folderId?: string) => void; onRemove: () => void }) {
    const { t } = useTranslation();
    const moveMenuItems = [
        ...folders.map((f) => ({
            key: f.id,
            label: `📁 ${f.name}`,
            onClick: () => onMoveToFolder(f.id),
        })),
        ...(asset.folderId
            ? [
                  { type: "divider" as const },
                  { key: "__none__", label: "移出文件夹（未分类）", onClick: () => onMoveToFolder(undefined) },
              ]
            : []),
    ];
    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData("text/muse-asset-id", asset.id);
                e.dataTransfer.effectAllowed = "move";
            }}
            className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing"
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
        >
            <AssetCover asset={asset} />
            {folderName ? (
                <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex max-w-[85%] items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                    <Folder className="size-2.5 shrink-0" />
                    <span className="truncate">{folderName}</span>
                </div>
            ) : null}
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-4" />
                </button>
                {moveMenuItems.length > 0 ? (
                    <Dropdown menu={{ items: moveMenuItems }} trigger={["click"]}>
                        <button
                            type="button"
                            className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-amber-600 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                            title="移动到文件夹"
                        >
                            <FolderInput className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
                <Popconfirm title={t("canvas.sidePanel.removeAssetTitle")} okText={t("canvas.sidePanel.remove")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label={t("canvas.sidePanel.removeAsset")}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") {
        if (asset.coverUrl) return <img src={asset.coverUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
        return <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
    }
    return <img src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
}

// ---------------------------------------------------------------------------
// Prompt library tab: collapsible source groups, lazy loading, and copy or text-node insertion actions.
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [detail, setDetail] = useState<Prompt | null>(null);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("canvas.sidePanel.promptCopied"));
        } catch {
            message.error(t("canvas.sidePanel.copyFailed"));
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchPrompts")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-1">
                    {enabledSources.length ? enabledSources.map((source) => (
                        <PromptSourceGroup
                            key={source.id}
                            sourceId={source.id}
                            sourceName={source.name}
                            keyword={keyword}
                            open={!!expanded[source.id]}
                            theme={theme}
                            onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                            onInsert={onInsert}
                            onView={setDetail}
                        />
                    )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.noPrompts")} className="pt-12" />}
                </div>
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

function PromptSourceGroup({
    sourceId,
    sourceName,
    keyword,
    open,
    theme,
    onToggle,
    onInsert,
    onView,
}: {
    sourceId: string;
    sourceName: string;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onView: (prompt: Prompt) => void;
}) {
    const { t } = useTranslation();
    // Cache a source after its first expansion to avoid repeated requests; search results also need the data for counts.
    const showResults = open || !!keyword.trim();
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });

    const filtered = useMemo(() => {
        const items = query.data || [];
        const q = keyword.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(q));
    }, [query.data, keyword]);

    const insertPrompt = (item: Prompt) => onInsert({ kind: "text", content: item.prompt, title: item.title });

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{sourceName}</span>
                {showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
            </button>
            {showResults ? (
                <div className="px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            {t("canvas.sidePanel.loadFailedRetry")}
                        </button>
                    ) : filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.map((item) => (
                                <PromptRow key={item.id} item={item} theme={theme} onInsert={() => insertPrompt(item)} onView={() => onView(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{keyword.trim() ? t("canvas.sidePanel.noMatchingPrompts") : t("canvas.sidePanel.sourceEmpty")}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.viewDetails")} title={t("canvas.sidePanel.viewDetails")}>
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("canvas.sidePanel.inserted")}
                    title={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
