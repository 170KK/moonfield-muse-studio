import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const CANVAS_SYNC_CHANNEL = "muse-canvas-store-sync";
const TAB_ID = nanoid();
const canvasBroadcastChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CANVAS_SYNC_CHANNEL) : null;

type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistValue: StorageValue<CanvasStore> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let isExternalRehydrate = false;
let isFullReplacePending = false;
let persistChain: Promise<void> = Promise.resolve();
const dirtyProjectIds = new Set<string>();
const dirtyDeletedIds = new Set<string>();

function mergeCanvasStates(
    local: PersistedCanvasState,
    remote: PersistedCanvasState,
    preferLocalIds?: Set<string>,
    localDeletedIds?: Set<string>,
): PersistedCanvasState {
    const deletedMap = new Map<string, CanvasDeletedProject>();
    for (const item of remote.deletedProjects || []) {
        deletedMap.set(item.id, item);
    }
    for (const item of local.deletedProjects || []) {
        const prev = deletedMap.get(item.id);
        if (!prev || item.deletedAt > prev.deletedAt) {
            deletedMap.set(item.id, item);
        }
    }

    const remoteMap = new Map((remote.projects || []).map((p) => [p.id, p]));
    const localMap = new Map((local.projects || []).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const mergedProjects: CanvasProject[] = [];

    const pickProject = (id: string): CanvasProject | null => {
        const del = deletedMap.get(id);
        const r = remoteMap.get(id);
        const l = localMap.get(id);
        if (localDeletedIds?.has(id)) return null;
        let chosen: CanvasProject | undefined;
        if (r && l) {
            if (l.updatedAt > r.updatedAt) chosen = l;
            else if (r.updatedAt > l.updatedAt) chosen = r;
            else chosen = preferLocalIds?.has(id) ? l : r;
        } else {
            chosen = l || r;
        }
        if (!chosen) return null;
        if (del && del.deletedAt >= chosen.updatedAt) return null;
        return chosen;
    };

    // Keep projects newly created in other tabs at the front, then local order
    for (const r of remote.projects || []) {
        if (!localMap.has(r.id)) {
            seen.add(r.id);
            const picked = pickProject(r.id);
            if (picked) mergedProjects.push(picked);
        }
    }
    for (const l of local.projects || []) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        const picked = pickProject(l.id);
        if (picked) mergedProjects.push(picked);
    }

    return {
        projects: mergedProjects,
        deletedProjects: Array.from(deletedMap.values()),
    };
}

async function flushPendingCanvasPersist(name = CANVAS_STORE_KEY) {
    if (!useCanvasStore.getState().hydrated) return;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const value = pendingPersistValue;
    if (!value) return;
    pendingPersistValue = null;

    const localDirtyProjects = new Set(dirtyProjectIds);
    const localDirtyDeleted = new Set(dirtyDeletedIds);
    const fullReplace = isFullReplacePending;
    dirtyProjectIds.clear();
    dirtyDeletedIds.clear();
    isFullReplacePending = false;

    persistChain = persistChain.then(async () => {
        let nextValue = value;
        if (!fullReplace) {
            try {
                const raw = await localForageStorage.getItem(name);
                if (raw) {
                    const parsed = JSON.parse(raw) as StorageValue<CanvasStore>;
                    const remoteState = (parsed?.state || { projects: [], deletedProjects: [] }) as PersistedCanvasState;
                    const localState = value.state as PersistedCanvasState;
                    const merged = mergeCanvasStates(localState, remoteState, localDirtyProjects, localDirtyDeleted);
                    nextValue = { ...value, state: merged as StorageValue<CanvasStore>["state"] };
                    if (merged.projects.length !== localState.projects.length || merged.projects.some((p, i) => p !== localState.projects[i])) {
                        isExternalRehydrate = true;
                        try {
                            useCanvasStore.setState({ projects: merged.projects, deletedProjects: merged.deletedProjects });
                        } finally {
                            isExternalRehydrate = false;
                        }
                    }
                    queuedPersistState = merged;
                }
            } catch {
                // fallback to writing local value if remote read/parse fails
            }
        }
        await localForageStorage.setItem(name, JSON.stringify(nextValue));
        canvasBroadcastChannel?.postMessage({ type: "sync", tabId: TAB_ID, ts: Date.now() });
    });
    await persistChain;
}

async function syncCanvasFromStorage() {
    if (!useCanvasStore.getState().hydrated) return;
    if (saveTimer || pendingPersistValue) return;
    try {
        const raw = await localForageStorage.getItem(CANVAS_STORE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as StorageValue<CanvasStore>;
        const remoteState = (parsed?.state || { projects: [], deletedProjects: [] }) as PersistedCanvasState;
        const current = useCanvasStore.getState();
        const merged = mergeCanvasStates(
            { projects: current.projects, deletedProjects: current.deletedProjects },
            remoteState,
            dirtyProjectIds,
            dirtyDeletedIds,
        );
        queuedPersistState = merged;
        isExternalRehydrate = true;
        try {
            useCanvasStore.setState({ projects: merged.projects, deletedProjects: merged.deletedProjects });
        } finally {
            isExternalRehydrate = false;
        }
    } catch {
        // ignore storage read error
    }
}

if (canvasBroadcastChannel) {
    canvasBroadcastChannel.onmessage = (event) => {
        if (event.data?.tabId === TAB_ID) return;
        void syncCanvasFromStorage();
    };
}

if (typeof window !== "undefined") {
    window.addEventListener("focus", () => {
        void syncCanvasFromStorage();
    });
    window.addEventListener("pagehide", () => {
        void flushPendingCanvasPersist();
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            void flushPendingCanvasPersist();
        } else if (document.visibilityState === "visible") {
            void syncCanvasFromStorage();
        }
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        try {
            const value = await Promise.race([
                localForageStorage.getItem(name),
                new Promise<string | null>((resolve) =>
                    setTimeout(() => {
                        try {
                            resolve(typeof window !== "undefined" ? window.localStorage.getItem(name) : null);
                        } catch {
                            resolve(null);
                        }
                    }, 2500),
                ),
            ]);
            if (!value) return null;
            const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
            queuedPersistState = parsed.state as PersistedCanvasState;
            return parsed;
        } catch {
            return null;
        }
    },
    setItem: (name, value) => {
        if (isExternalRehydrate) return;
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        pendingPersistValue = value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            void flushPendingCanvasPersist(name);
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                dirtyProjectIds.add(id);
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                dirtyProjectIds.add(project.id);
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => {
                dirtyProjectIds.add(id);
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                }));
            },
            deleteProjects: (ids) => {
                ids.forEach((id) => {
                    dirtyDeletedIds.add(id);
                    dirtyProjectIds.delete(id);
                });
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                });
            },
            replaceProjects: (projects, deletedProjects = []) => {
                isFullReplacePending = true;
                set({ projects, deletedProjects });
            },
            updateProject: (id, patch) => {
                dirtyProjectIds.add(id);
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                }));
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
