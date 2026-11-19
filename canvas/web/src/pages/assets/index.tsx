import { ArrowLeft, ChevronRight, Copy, Download, Folder, FolderInput, FolderPlus, MoreHorizontal, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Card, Drawer, Dropdown, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { assetCoverUrl, useAssetStore, type Asset, type AssetFolder, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video"] as const;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { i18n: i18nCtx, t } = useTranslation();
    const isEn = i18nCtx.resolvedLanguage?.startsWith("en") ?? false;
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const folderImportInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders || []);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const addFolder = useAssetStore((state) => state.addFolder);
    const renameFolder = useAssetStore((state) => state.renameFolder);
    const removeFolder = useAssetStore((state) => state.removeFolder);
    const moveFolder = useAssetStore((state) => state.moveFolder);
    const moveAssetToFolder = useAssetStore((state) => state.moveAssetToFolder);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
    const [folderModal, setFolderModal] = useState<{ mode: "create" | "rename"; parentId?: string; folderId?: string; name: string } | null>(null);
    const [moveTarget, setMoveTarget] = useState<{ kind: "asset" | "folder"; id: string; title: string; currentFolderId?: string } | null>(null);
    const [moveDestFolderId, setMoveDestFolderId] = useState<string | undefined>(undefined);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportTargetId, setExportTargetId] = useState<string>("__all__");
    const [dragOverFolderId, setDragOverFolderId] = useState<string | "__root__" | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);

    // 如果当前所在文件夹被外部删除（例如在画布中删除），自动回退到上层或根目录
    useEffect(() => {
        if (currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
            setCurrentFolderId(undefined);
        }
    }, [currentFolderId, folders]);

    const folderPath = useMemo(() => {
        const path: AssetFolder[] = [];
        let cursor = currentFolderId;
        const guard = new Set<string>();
        while (cursor && !guard.has(cursor)) {
            guard.add(cursor);
            const found = folders.find((f) => f.id === cursor);
            if (!found) break;
            path.unshift(found);
            cursor = found.parentId;
        }
        return path;
    }, [currentFolderId, folders]);

    const visibleFolders = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (query) {
            return folders.filter((f) => f.name.toLowerCase().includes(query));
        }
        return folders.filter((f) => (f.parentId || undefined) === currentFolderId);
    }, [folders, currentFolderId, keyword]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query && (asset.folderId || undefined) !== currentFolderId) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter, currentFolderId]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            folderId: editingAsset ? editingAsset.folderId : currentFolderId,
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                message.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
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
        if (targetId === "__all__") return validAssets;
        if (targetId === "__root__") return validAssets.filter((a) => !a.folderId);
        const ids = collectFolderSubtreeIds(targetId);
        return validAssets.filter((a) => a.folderId && ids.has(a.folderId));
    };

    const exportAllAssets = () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        setExportTargetId(currentFolderId || "__all__");
        setExportModalOpen(true);
    };

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
                  ? isEn
                      ? "root-assets"
                      : "根目录资产"
                  : folders.find((f) => f.id === exportTargetId)?.name || t("assets.packageName");
        setExportModalOpen(false);
        await exportAssets(items, folderName);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            let targetFolderId = currentFolderId;
            if (importedAssets.length > 0) {
                const rawBase = file.name.replace(/\.[^.]+$/, "").trim();
                const now = new Date();
                const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
                const baseName = rawBase || (isEn ? `Imported ${stamp}` : `导入资产 ${stamp}`);
                const existsSameName = folders.some((f) => (f.parentId || undefined) === currentFolderId && f.name === baseName);
                const folderName = existsSameName ? `${baseName} (${stamp})` : baseName;
                const createdId = addFolder(folderName, currentFolderId);
                if (createdId) {
                    targetFolderId = createdId;
                }
            }
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                if (targetFolderId) {
                    payload.folderId = targetFolderId;
                }
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            if (targetFolderId && targetFolderId !== currentFolderId) {
                setCurrentFolderId(targetFolderId);
                setPage(1);
            }
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const addMediaFileAsAsset = async (file: File, folderId?: string) => {
        const cleanTitle = file.name.replace(/\.[^.]+$/, "").trim() || file.name;
        if (file.type.startsWith("image/")) {
            const image = await uploadImage(file);
            addAsset({
                kind: "image",
                title: cleanTitle,
                coverUrl: image.url,
                tags: [],
                folderId,
                source: isEn ? "Local Import" : "本地导入",
                data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
            });
            return true;
        }
        if (file.type.startsWith("video/")) {
            const media = await uploadMediaFile(file, "video");
            addAsset({
                kind: "video",
                title: cleanTitle,
                coverUrl: "",
                tags: [],
                folderId,
                source: isEn ? "Local Import" : "本地导入",
                data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType },
            });
            return true;
        }
        return false;
    };

    const formatDateTimeFolderName = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    const importSelectedFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const zipFiles = files.filter((f) => f.name.toLowerCase().endsWith(".zip") || f.type === "application/zip");
        const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
        try {
            for (const zipFile of zipFiles) {
                await importAssetZip(zipFile);
            }
            if (mediaFiles.length > 0) {
                // 单图片/单视频不建文件夹；多图片/多文件自动建立日期时间命名的新文件夹
                let targetFolderId = currentFolderId;
                if (mediaFiles.length > 1) {
                    const folderName = formatDateTimeFolderName();
                    const createdId = addFolder(folderName, currentFolderId);
                    if (createdId) targetFolderId = createdId;
                }
                let importedCount = 0;
                for (const file of mediaFiles) {
                    if (await addMediaFileAsAsset(file, targetFolderId)) {
                        importedCount += 1;
                    }
                }
                if (targetFolderId && targetFolderId !== currentFolderId) {
                    setCurrentFolderId(targetFolderId);
                    setPage(1);
                }
                if (importedCount > 0) {
                    message.success(t("assets.imported", { count: importedCount }));
                }
            }
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const importLocalFolder = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
        if (!files.length) {
            message.warning(isEn ? "No supported image or video files found in the selected folder" : "所选文件夹中没有支持的图片或视频文件");
            if (folderImportInputRef.current) folderImportInputRef.current.value = "";
            return;
        }
        try {
            const pathMap = new Map<string, string>();
            let firstRootFolderId: string | undefined;
            const ensureFolderByParts = (parts: string[]): string | undefined => {
                let parentId = currentFolderId;
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
                            if (!firstRootFolderId && accum === parts[0]) firstRootFolderId = id;
                            parentId = id;
                        }
                    }
                }
                return parentId;
            };

            let importedCount = 0;
            for (const file of files) {
                const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
                const segments = rel.split("/").filter(Boolean);
                const dirParts = segments.length > 1 ? segments.slice(0, -1) : [];
                const targetFolderId = dirParts.length > 0 ? ensureFolderByParts(dirParts) : currentFolderId;
                if (await addMediaFileAsAsset(file, targetFolderId)) {
                    importedCount += 1;
                }
            }
            if (firstRootFolderId) {
                setCurrentFolderId(firstRootFolderId);
                setPage(1);
            }
            message.success(t("assets.imported", { count: importedCount }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (folderImportInputRef.current) folderImportInputRef.current.value = "";
        }
    };
    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    const isDescendantOrSelf = (candidateId: string | undefined, folderId: string): boolean => {
        let cursor = candidateId;
        const guard = new Set<string>();
        while (cursor && !guard.has(cursor)) {
            if (cursor === folderId) return true;
            guard.add(cursor);
            cursor = folders.find((f) => f.id === cursor)?.parentId;
        }
        return false;
    };

    const submitFolderModal = () => {
        if (!folderModal) return;
        const trimmed = folderModal.name.trim();
        if (!trimmed) {
            message.warning(isEn ? "Please enter a folder name" : "请输入文件夹名称");
            return;
        }
        if (folderModal.mode === "create") {
            addFolder(trimmed, folderModal.parentId);
            message.success(isEn ? "Folder created" : "文件夹已创建");
        } else if (folderModal.folderId) {
            renameFolder(folderModal.folderId, trimmed);
            message.success(isEn ? "Folder renamed" : "文件夹已重命名");
        }
        setFolderModal(null);
    };

    const handleDropToFolder = (event: React.DragEvent, targetFolderId?: string) => {
        event.preventDefault();
        setDragOverFolderId(null);
        const raw = event.dataTransfer.getData("application/x-muse-move");
        if (!raw) return;
        try {
            const payload = JSON.parse(raw) as { kind: "asset" | "folder"; id: string };
            if (payload.kind === "asset") {
                moveAssetToFolder(payload.id, targetFolderId);
                message.success(isEn ? "Asset moved" : "资产已移动");
            } else if (payload.kind === "folder") {
                if (isDescendantOrSelf(targetFolderId, payload.id)) {
                    message.warning(isEn ? "Cannot move a folder into itself" : "不能把文件夹移动到自身或子文件夹内");
                    return;
                }
                moveFolder(payload.id, targetFolderId);
                message.success(isEn ? "Folder moved" : "文件夹已移动");
            }
        } catch {
            // ignore malformed drag payload
        }
    };

    const confirmMoveTarget = () => {
        if (!moveTarget) return;
        if (moveTarget.kind === "asset") {
            moveAssetToFolder(moveTarget.id, moveDestFolderId);
            message.success(isEn ? "Asset moved" : "资产已移动");
        } else {
            if (isDescendantOrSelf(moveDestFolderId, moveTarget.id)) {
                message.warning(isEn ? "Cannot move a folder into itself" : "不能把文件夹移动到自身或子文件夹内");
                return;
            }
            moveFolder(moveTarget.id, moveDestFolderId);
            message.success(isEn ? "Folder moved" : "文件夹已移动");
        }
        setMoveTarget(null);
    };

    const folderTreeOptions = useMemo(() => {
        const result: Array<{ id: string; name: string; depth: number }> = [];
        const walk = (parentId: string | undefined, depth: number) => {
            const children = folders.filter((f) => (f.parentId || undefined) === parentId);
            for (const f of children) {
                if (moveTarget?.kind === "folder" && isDescendantOrSelf(f.id, moveTarget.id)) continue;
                result.push({ id: f.id, name: f.name, depth });
                walk(f.id, depth + 1);
            }
        };
        walk(undefined, 0);
        return result;
    }, [folders, moveTarget]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="pb-8">
                    <div className="mx-auto max-w-5xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("assets.title")}</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{t("assets.description")}</p>
                    </div>

                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <Input.Search
                            className="w-full"
                            size="large"
                            allowClear
                            prefix={<Search className="size-4 text-stone-400" />}
                            value={keyword}
                            placeholder={t("assets.search")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            onSearch={(value) => {
                                setPage(1);
                                setKeyword(value);
                            }}
                        />
                    </div>

                    <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                                <div className="text-xs font-medium text-stone-500 dark:text-stone-400">{t("assets.type")}</div>
                                <div className="flex flex-wrap gap-2">
                                    {kindOptions.map((option) => (
                                        <Tag.CheckableTag
                                            key={option}
                                            checked={kindFilter === option}
                                            className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                                            onChange={() => {
                                                setPage(1);
                                                setKindFilter(option);
                                            }}
                                        >
                                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                                        </Tag.CheckableTag>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4">
                                <button
                                    type="button"
                                    className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-indigo-400"
                                    onClick={() => setFolderModal({ mode: "create", parentId: currentFolderId, name: "" })}
                                >
                                    <FolderPlus className="size-4" />
                                    <span>{isEn ? "New Folder" : "新建文件夹"}</span>
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={() => void exportAllAssets()}
                                >
                                    {t("assets.export")}
                                </button>
                                <Dropdown
                                    trigger={["click"]}
                                    menu={{
                                        items: [
                                            {
                                                key: "files",
                                                label: isEn ? "Images / Videos / Zip (Multi-select)" : "选择图片 / 视频 / 资产包（支持多选）",
                                                onClick: () => assetInputRef.current?.click(),
                                            },
                                            {
                                                key: "folder",
                                                label: isEn ? "Import Local Folder" : "选择本地文件夹导入",
                                                onClick: () => folderImportInputRef.current?.click(),
                                            },
                                        ],
                                    }}
                                >
                                    <button
                                        type="button"
                                        className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    >
                                        {t("assets.add")}
                                    </button>
                                </Dropdown>
                            </div>
                        </div>

                        {/* 文件夹面包屑导航（与画布资产库实时同步，支持拖拽放置移动） */}
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200/80 bg-white/80 px-3 py-2 backdrop-blur dark:border-stone-800 dark:bg-zinc-900/60">
                            <div className="flex flex-wrap items-center gap-1 text-xs">
                                {currentFolderId ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const parent = folderPath.length >= 2 ? folderPath[folderPath.length - 2]?.id : undefined;
                                            setCurrentFolderId(parent);
                                            setPage(1);
                                        }}
                                        className="mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-stone-600 transition hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                                    >
                                        <ArrowLeft className="size-3.5" />
                                        <span>{isEn ? "Up" : "上一级"}</span>
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCurrentFolderId(undefined);
                                        setPage(1);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragOverFolderId("__root__");
                                    }}
                                    onDragLeave={() => setDragOverFolderId(null)}
                                    onDrop={(e) => handleDropToFolder(e, undefined)}
                                    className={cn(
                                        "cursor-pointer rounded-md px-2 py-1 transition",
                                        !currentFolderId ? "bg-indigo-500/12 font-semibold text-indigo-600 dark:text-indigo-300" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
                                        dragOverFolderId === "__root__" && "ring-2 ring-indigo-500",
                                    )}
                                >
                                    {isEn ? "All Assets (Root)" : "全部资产（根目录）"}
                                </button>
                                {folderPath.map((folder) => (
                                    <span key={folder.id} className="inline-flex items-center gap-1">
                                        <ChevronRight className="size-3.5 text-stone-400" />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCurrentFolderId(folder.id);
                                                setPage(1);
                                            }}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                setDragOverFolderId(folder.id);
                                            }}
                                            onDragLeave={() => setDragOverFolderId(null)}
                                            onDrop={(e) => handleDropToFolder(e, folder.id)}
                                            className={cn(
                                                "cursor-pointer rounded-md px-2 py-1 transition",
                                                currentFolderId === folder.id ? "bg-indigo-500/12 font-semibold text-indigo-600 dark:text-indigo-300" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
                                                dragOverFolderId === folder.id && "ring-2 ring-indigo-500",
                                            )}
                                        >
                                            {folder.name}
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <span className="text-[11px] text-stone-400">
                                {isEn ? "Synced with Canvas · Drag cards onto folders to move" : "与画布资产库实时同步 · 支持拖拽卡片到文件夹或点击移动"}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    {visibleFolders.length ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {visibleFolders.map((folder) => {
                                const subtreeIds = collectFolderSubtreeIds(folder.id);
                                const childFolderCount = subtreeIds.size - 1;
                                const childAssetCount = validAssets.filter((a) => a.folderId && subtreeIds.has(a.folderId)).length;
                                return (
                                    <div
                                        key={folder.id}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData("application/x-muse-move", JSON.stringify({ kind: "folder", id: folder.id }));
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            setDragOverFolderId(folder.id);
                                        }}
                                        onDragLeave={() => setDragOverFolderId(null)}
                                        onDrop={(e) => handleDropToFolder(e, folder.id)}
                                        className={cn(
                                            "group flex items-center justify-between gap-3 rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 shadow-xs transition hover:border-indigo-400/70 hover:shadow-sm dark:border-stone-800 dark:bg-zinc-900/80",
                                            dragOverFolderId === folder.id && "border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/40",
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCurrentFolderId(folder.id);
                                                setPage(1);
                                            }}
                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                                        >
                                            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                                                <Folder className="size-5" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{folder.name}</div>
                                                <div className="mt-0.5 text-[11px] text-stone-400">
                                                    {isEn
                                                        ? `${childFolderCount} folders · ${childAssetCount} assets`
                                                        : `${childFolderCount} 个子文件夹 · ${childAssetCount} 个资产`}
                                                </div>
                                            </div>
                                        </button>
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    {
                                                        key: "subfolder",
                                                        label: isEn ? "New Subfolder" : "新建子文件夹",
                                                        icon: <FolderPlus className="size-3.5" />,
                                                        onClick: () => setFolderModal({ mode: "create", parentId: folder.id, name: "" }),
                                                    },
                                                    {
                                                        key: "rename",
                                                        label: isEn ? "Rename" : "重命名",
                                                        icon: <PencilLine className="size-3.5" />,
                                                        onClick: () => setFolderModal({ mode: "rename", folderId: folder.id, name: folder.name }),
                                                    },
                                                    {
                                                        key: "move",
                                                        label: isEn ? "Move to..." : "移动到...",
                                                        icon: <FolderInput className="size-3.5" />,
                                                        onClick: () => {
                                                            setMoveTarget({ kind: "folder", id: folder.id, title: folder.name, currentFolderId: folder.parentId });
                                                            setMoveDestFolderId(folder.parentId);
                                                        },
                                                    },
                                                    { type: "divider" },
                                                    {
                                                        key: "delete",
                                                        danger: true,
                                                        label: isEn ? "Delete Folder" : "删除文件夹",
                                                        icon: <Trash2 className="size-3.5" />,
                                                        onClick: () => {
                                                            removeFolder(folder.id);
                                                            message.success(isEn ? "Folder removed (contents moved up)" : "文件夹已删除（内容已移至上级）");
                                                        },
                                                    },
                                                ],
                                            }}
                                        >
                                            <Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} />
                                        </Dropdown>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                onOpen={() => setPreviewAsset(asset)}
                                onEdit={() => openEdit(asset)}
                                onMove={() => {
                                    setMoveTarget({ kind: "asset", id: asset.id, title: asset.title, currentFolderId: asset.folderId });
                                    setMoveDestFolderId(asset.folderId);
                                }}
                                onCopy={copyAssetText}
                                onDownload={downloadImage}
                                onDelete={() => setDeletingAsset(asset)}
                            />
                        ))}
                    </div>

                    {!visibleAssets.length && !visibleFolders.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                    <div className="flex justify-center">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[10, 20, 50, 100]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" multiple accept="image/*,video/*,application/zip,.zip" className="hidden" onChange={(event) => void importSelectedFiles(event.target.files)} />
            <input ref={folderImportInputRef} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(event) => void importLocalFolder(event.target.files)} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>

            <Modal
                title={folderModal?.mode === "rename" ? (isEn ? "Rename Folder" : "重命名文件夹") : isEn ? "New Folder" : "新建文件夹"}
                open={Boolean(folderModal)}
                onCancel={() => setFolderModal(null)}
                onOk={submitFolderModal}
                okText={t("common.save")}
                cancelText={t("common.cancel")}
                destroyOnHidden
            >
                <Input
                    autoFocus
                    value={folderModal?.name || ""}
                    placeholder={isEn ? "Folder name" : "请输入文件夹名称"}
                    onChange={(e) => setFolderModal((prev) => (prev ? { ...prev, name: e.target.value } : null))}
                    onPressEnter={submitFolderModal}
                />
            </Modal>

            <Modal
                title={isEn ? `Move "${moveTarget?.title || ""}"` : `移动「${moveTarget?.title || ""}」`}
                open={Boolean(moveTarget)}
                onCancel={() => setMoveTarget(null)}
                onOk={confirmMoveTarget}
                okText={isEn ? "Move Here" : "移动到此处"}
                cancelText={t("common.cancel")}
                destroyOnHidden
            >
                <div className="max-h-72 space-y-1 overflow-y-auto py-1">
                    <button
                        type="button"
                        onClick={() => setMoveDestFolderId(undefined)}
                        className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                            moveDestFolderId === undefined ? "bg-indigo-500/15 font-medium text-indigo-600 dark:text-indigo-300" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                        )}
                    >
                        <Folder className="size-4 text-stone-400" />
                        <span>{isEn ? "All Assets (Root)" : "全部资产（根目录）"}</span>
                    </button>
                    {folderTreeOptions.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setMoveDestFolderId(item.id)}
                            style={{ paddingLeft: `${12 + item.depth * 18}px` }}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-3 text-left text-sm transition",
                                moveDestFolderId === item.id ? "bg-indigo-500/15 font-medium text-indigo-600 dark:text-indigo-300" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                            )}
                        >
                            <Folder className="size-4 shrink-0 text-amber-500" />
                            <span className="truncate">{item.name}</span>
                        </button>
                    ))}
                </div>
            </Modal>

            <Modal
                title={isEn ? "Select Folder to Export" : "选择要导出的文件夹"}
                open={exportModalOpen}
                onCancel={() => setExportModalOpen(false)}
                onOk={() => void confirmExportAssets()}
                okText={isEn ? "Export" : "确认导出"}
                cancelText={t("common.cancel")}
                destroyOnHidden
            >
                <div className="max-h-80 space-y-1 overflow-y-auto py-1">
                    <button
                        type="button"
                        onClick={() => setExportTargetId("__all__")}
                        className={cn(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                            exportTargetId === "__all__" ? "bg-indigo-500/15 font-medium text-indigo-600 dark:text-indigo-300" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                        )}
                    >
                        <span className="flex items-center gap-2">
                            <Folder className="size-4 text-indigo-500" />
                            <span>{isEn ? "All Assets (Everything)" : "全部资产（所有文件夹）"}</span>
                        </span>
                        <span className="text-xs text-stone-400">{validAssets.length}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setExportTargetId("__root__")}
                        className={cn(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                            exportTargetId === "__root__" ? "bg-indigo-500/15 font-medium text-indigo-600 dark:text-indigo-300" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                        )}
                    >
                        <span className="flex items-center gap-2">
                            <Folder className="size-4 text-stone-400" />
                            <span>{isEn ? "Root Only (Uncategorized)" : "仅根目录（未分类资产）"}</span>
                        </span>
                        <span className="text-xs text-stone-400">{validAssets.filter((a) => !a.folderId).length}</span>
                    </button>
                    {folderTreeOptions.map((item) => {
                        const count = getExportCandidates(item.id).length;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setExportTargetId(item.id)}
                                style={{ paddingLeft: `${12 + item.depth * 18}px` }}
                                className={cn(
                                    "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg py-2 pr-3 text-left text-sm transition",
                                    exportTargetId === item.id ? "bg-indigo-500/15 font-medium text-indigo-600 dark:text-indigo-300" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                                )}
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    <Folder className="size-4 shrink-0 text-amber-500" />
                                    <span className="truncate">{item.name}</span>
                                </span>
                                <span className="shrink-0 text-xs text-stone-400">{count}</span>
                            </button>
                        );
                    })}
                </div>
            </Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onMove, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onMove: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { i18n: i18nCtx, t } = useTranslation();
    const isEn = i18nCtx.resolvedLanguage?.startsWith("en") ?? false;
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = assetCoverUrl(asset);
    const summary = assetSummary(asset);
    return (
        <Card
            hoverable
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData("application/x-muse-move", JSON.stringify({ kind: "asset", id: asset.id }));
            }}
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : asset.kind === "video" && asset.data.url ? (
                        <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="aspect-[4/3] w-full bg-black object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("assets.unknownSource")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {summary}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[11px]">{t("assets.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
                <Button size="small" onClick={onOpen}>
                    {t("common.view")}
                </Button>
                {asset.kind !== "video" ? (
                    <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.edit")}
                    </Button>
                ) : null}
                <Button size="small" icon={<FolderInput className="size-3.5" />} onClick={onMove}>
                    {isEn ? "Move" : "移动"}
                </Button>
                {asset.kind === "text" ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.download")}
                    </Button>
                ) : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("common.delete")}
                </Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={assetCoverUrl(asset)} preview={{ src: cover }} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

async function readAssetMediaBlob(asset: Extract<Asset, { kind: "image" | "video" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "video" ? asset.data.url : asset.data.dataUrl || asset.coverUrl;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
