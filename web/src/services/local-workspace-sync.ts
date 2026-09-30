import { rebindInconsistentCanvasAssets, type CanvasAssetRebindResult } from "@/services/canvas-asset-repair";
import { createLocalCanvasProject, deleteLocalCanvasProjects, openLocalCanvasProject, openLocalCanvasProjectFromBackend } from "@/services/local-workspace-repository";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { http } from "@/services/api/request";
import { queryGenerationTask } from "@/services/api/task-center";
import { generationEffectApplied } from "@/services/generation-consumer-dedupe";
import { attachNodeEffectKey } from "@/services/generation-task-materializer";
import { CanvasNodeType } from "@/types/canvas";

type CanvasSaveSummary = Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt" | "revision">;

export { isLocalWorkspaceMode } from "@/services/workspace-mode";

let operationTail: Promise<void> = Promise.resolve();
const canvasRefreshListeners = new Set<(project: CanvasProject, previous: CanvasProject | undefined) => void>();
const repairingTextTasks = new Set<string>();

async function repairCompletedTextResults(projectId: string) {
    const project = openLocalCanvasProject(projectId);
    if (!project) return;
    const candidates = project.nodes.filter((node) => node.type === CanvasNodeType.Text && node.metadata?.taskId
        && node.metadata.taskStatus === "succeeded"
        && !generationEffectApplied(node.metadata, attachNodeEffectKey(node.metadata.taskId, node.id, 0)));
    if (!candidates.length) return;
    const { applyRecoveredGenerationTaskResultToNodes } = await import("@/lib/canvas/canvas-generation-task-sync");
    const { persistCanvasGenerationEffect } = await import("@/services/canvas-generation-consumer");
    for (const candidate of candidates) {
        const taskId = candidate.metadata!.taskId!;
        const key = `${projectId}:${taskId}`;
        if (repairingTextTasks.has(key)) continue;
        repairingTextTasks.add(key);
        try {
            const task = await queryGenerationTask(taskId);
            if (task.projectId !== projectId || task.status !== "succeeded" || task.type !== "canvas_text") continue;
            const before = openLocalCanvasProject(projectId);
            const node = before?.nodes.find((item) => item.id === candidate.id);
            if (!before || node?.metadata?.taskId !== taskId || generationEffectApplied(node.metadata || {}, attachNodeEffectKey(taskId, candidate.id, 0))) continue;
            const applied = await applyRecoveredGenerationTaskResultToNodes(before.nodes, task, candidate.id);
            if (!applied.updated) continue;
            const persisted = await persistCanvasGenerationEffect({ projectId, effectKey: applied.effectKey, previousNodes: before.nodes, nodes: applied.nodes });
            canvasRefreshListeners.forEach((listener) => listener(persisted, before));
        } catch (error) {
            console.warn("已完成文本任务的画布结果恢复失败", { projectId, taskId, error });
        } finally {
            repairingTextTasks.delete(key);
        }
    }
}

/**
 * Backward-compatible local persistence facade.
 *
 * Call sites keep their historical function names while the implementation
 * contains no account, cloud snapshot, upload queue, conflict baseline or
 * retry machinery. New code should use the workspace repositories directly.
 */
export function hasRemoteUserDataSyncSession() {
    return false;
}

export function withRemoteUserDataSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationTail.then(operation, operation);
    operationTail = next.then(() => undefined, () => undefined);
    return next;
}

export async function loadCanvasProjectForEditing(
    id: string,
    options: { latest?: boolean; historyRestore?: { snapshotId: string; revision: number }; onLoad?: (project: CanvasProject) => void } = {},
) {
    const project = await openLocalCanvasProjectFromBackend(id);
    if (project) options.onLoad?.(project);
    if (project) void repairCompletedTextResults(id).catch((error) => {
        console.warn("已完成文本任务的画布结果恢复未启动", { projectId: id, error });
    });
    return project || undefined;
}

// 画布内容被其他写入者（远端刷新、任务回写）替换后通知本地编辑器合并。
export function subscribeCanvasRefresh(listener: (project: CanvasProject, previous: CanvasProject | undefined) => void) {
    canvasRefreshListeners.add(listener);
    return () => { canvasRefreshListeners.delete(listener); };
}

/**
 * Persist an editor snapshot to the co-packaged Go repository.  Local edits
 * normally stay in IndexedDB for instant UI feedback, but the Go repository is
 * also read by task/SSE paths.  Callers that mutate the canvas outside the
 * normal save flow (for example node deletion) must use this bridge or the next
 * remote refresh can resurrect the stale server snapshot.
 */
export async function syncLocalCanvasSnapshot(id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "appearance" | "backgroundMode" | "showImageInfo" | "viewport">>) {
    const current = openLocalCanvasProject(id);
    if (!current) throw new Error("本地画布不存在");
    const project = { ...current, ...patch };
    const response = await http.put<{ project: CanvasSaveSummary }>(`/canvas-projects/${encodeURIComponent(id)}`, { project });
    const saved = { ...project, revision: response.project?.revision ?? project.revision, updatedAt: response.project?.updatedAt ?? project.updatedAt };
    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === id ? saved : item) }));
    return saved;
}

type LocalAssetPageOptions = {
    page: number;
    pageSize: number;
    kind?: string;
    category?: string;
    folderId?: string;
    uncategorized?: boolean;
    status?: string;
    query?: string;
    signal?: AbortSignal;
};

export async function loadAssetLibraryPage(options: LocalAssetPageOptions) {
    if (options.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const query = options.query?.trim().toLowerCase() || "";
    const filtered = useAssetStore.getState().assets.filter((asset) => {
        if (options.kind && asset.kind !== options.kind) return false;
        if (options.category && asset.category !== options.category) return false;
        if (options.status && asset.status !== options.status) return false;
        if (options.folderId && asset.folderId !== options.folderId) return false;
        if (options.uncategorized && asset.folderId) return false;
        if (!query) return true;
        return [asset.title, asset.source, ...(asset.tags || [])].join(" ").toLowerCase().includes(query);
    });
    const start = Math.max(0, options.page - 1) * options.pageSize;
    const countBy = (key: (asset: Asset) => string | undefined) => filtered.reduce<Record<string, number>>((counts, asset) => {
        const value = key(asset) || "";
        counts[value] = (counts[value] || 0) + 1;
        return counts;
    }, {});
    return {
        assets: filtered.slice(start, start + options.pageSize),
        kindCounts: countBy((asset) => asset.kind),
        categoryCounts: countBy((asset) => asset.category),
        folderCounts: countBy((asset) => asset.folderId),
        page: options.page,
        pageSize: options.pageSize,
        total: filtered.length,
        hasMore: start + options.pageSize < filtered.length,
    };
}

export async function loadAssetsForUse(ids: Iterable<string>) {
    const available = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
    if ([...new Set(ids)].some((id) => !available.has(id))) throw new Error("部分本地素材不存在，请重新选择素材");
}

export function localSavedRemotePendingMessage(localAction: string, error: unknown) {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "未知错误";
    return `${localAction}失败：${detail}`;
}

export async function createCanvasProjectWithRemoteSync(
    title: string,
    projectId?: string,
    initialContent?: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>,
): Promise<{ id: string; syncError?: unknown }> {
    return { ...await createLocalCanvasProject(title, projectId, initialContent), syncError: undefined };
}

export async function deleteAssetWithRemoteSync(id: string) {
    const assetId = id.trim();
    if (!assetId) throw new Error("素材 ID 不能为空");
    await useAssetStore.getState().removeAsset(assetId);
    await flushAssetStorePersistence();
}

export function deleteCanvasProjectsWithRemoteSync(ids: string[]) {
    return deleteLocalCanvasProjects(ids);
}

/** Legacy save name retained while callers migrate to workspace repositories. */
export async function saveRemoteUserDataNow(_input?: string | readonly string[] | { force?: boolean }) {
    await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
}

export function scheduleRemoteUserDataSync() {
    void saveRemoteUserDataNow().catch((error) => console.error("本地工作区保存失败", error));
}

export async function forceOverwriteRemoteCanvasSync(): Promise<CanvasAssetRebindResult> {
    const result = rebindInconsistentCanvasAssets(useAssetStore.getState().assets);
    await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
    return result;
}
