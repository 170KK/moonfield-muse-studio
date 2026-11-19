import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video";
export type AssetFolder = { id: string; name: string; parentId?: string; createdAt: string };
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderId?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    folders: AssetFolder[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    addFolder: (name: string, parentId?: string) => string;
    renameFolder: (id: string, name: string) => void;
    removeFolder: (id: string) => void;
    moveFolder: (folderId: string, targetParentId?: string) => void;
    moveAssetToFolder: (assetId: string, folderId?: string) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
const ASSET_SYNC_CHANNEL = "muse-asset-store-sync";
const assetBroadcastChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(ASSET_SYNC_CHANNEL) : null;
let isExternalRehydrate = false;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.folders = parsed.state.folders || [];
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: async (name, value) => {
        await localForageStorage.setItem(name, JSON.stringify(value));
        if (!isExternalRehydrate) {
            assetBroadcastChannel?.postMessage({ type: "sync", ts: Date.now() });
        }
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            folders: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            addFolder: (name, parentId) => {
                const trimmed = name.trim();
                const id = nanoid();
                if (!trimmed) return "";
                set((state) => ({
                    folders: [...(state.folders || []), { id, name: trimmed, ...(parentId ? { parentId } : {}), createdAt: new Date().toISOString() }],
                }));
                return id;
            },
            renameFolder: (id, name) => {
                const trimmed = name.trim();
                if (!trimmed) return;
                set((state) => ({
                    folders: (state.folders || []).map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
                }));
            },
            removeFolder: (id) =>
                set((state) => {
                    const target = (state.folders || []).find((f) => f.id === id);
                    const fallbackParent = target?.parentId;
                    return {
                        folders: (state.folders || [])
                            .filter((f) => f.id !== id)
                            .map((f) => (f.parentId === id ? { ...f, parentId: fallbackParent } : f)),
                        assets: state.assets.map((a) => (a.folderId === id ? { ...a, folderId: fallbackParent } : a)),
                    };
                }),
            moveFolder: (folderId, targetParentId) =>
                set((state) => {
                    const folders = state.folders || [];
                    const target = targetParentId || undefined;
                    if (target === folderId) return state;
                    // 防止把文件夹移动到自身或子孙文件夹内形成环
                    let cursor = target;
                    while (cursor) {
                        if (cursor === folderId) return state;
                        cursor = folders.find((f) => f.id === cursor)?.parentId;
                    }
                    return {
                        folders: folders.map((f) => (f.id === folderId ? { ...f, parentId: target } : f)),
                    };
                }),
            moveAssetToFolder: (assetId, folderId) =>
                set((state) => ({
                    assets: state.assets.map((a) => (a.id === assetId ? ({ ...a, folderId: folderId || undefined, updatedAt: new Date().toISOString() } as Asset) : a)),
                })),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, folders: state.folders || [] }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);

if (typeof window !== "undefined") {
    const syncFromStorage = async () => {
        isExternalRehydrate = true;
        try {
            await useAssetStore.persist.rehydrate();
        } finally {
            isExternalRehydrate = false;
        }
    };
    assetBroadcastChannel?.addEventListener("message", () => {
        void syncFromStorage();
    });
    window.addEventListener("focus", () => {
        void syncFromStorage();
    });
}
