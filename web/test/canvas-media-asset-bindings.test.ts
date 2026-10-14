import { beforeEach, expect, test } from "bun:test";
import { captureUserScope } from "@/lib/user-scope-guard";
import { ensureCanvasMediaAssetBindings } from "@/services/canvas-media-asset-bindings";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

const project: CanvasProject = {
    id: "media-preflight", title: "test", createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 1,
    nodes: [{ id: "video", type: CanvasNodeType.Video, title: "old result", position: { x: 0, y: 0 }, width: 720, height: 405, metadata: { storageKey: "resource:video", content: "/api/resources/video/file" } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: "grid", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, directorScenes: [],
    timeline: { clips: [{ id: "clip", nodeId: "audio", kind: "audio", trackId: "track", startMs: 0, durationMs: 1000, directMedia: { id: "audio", kind: "audio", title: "audio", storageKey: "resource:audio", url: "/api/resources/audio/file" } }] },
};
beforeEach(() => useCanvasStore.setState({ projects: [structuredClone(project)] }));
const input = () => ({ projectId: project.id, expectedScope: captureUserScope() });

test("preflight persists missing node and timeline assets before binding their identities", async () => {
    const keys: string[] = [];
    await ensureCanvasMediaAssetBindings(input(), async ({ node }) => {
        keys.push(node.metadata!.storageKey!);
        return { assetId: `asset-${node.id}`, confirmed: true, created: false, linkedToProject: false };
    });
    expect(keys).toEqual(["resource:video", "resource:audio"]);
    const saved = useCanvasStore.getState().projects[0];
    expect(saved.nodes[0].metadata?.assetId).toBe("asset-video");
    expect(saved.timeline?.clips[0].directMedia?.assetId).toBe("asset-timeline-media:audio");
    expect(saved.nodes[0].metadata?.content).toBe(project.nodes[0].metadata?.content);
    await ensureCanvasMediaAssetBindings(input(), async () => { throw new Error("already bound media must not be resynced"); });
});

test("unconfirmed asset persistence stops and does not attach a local-only identity", async () => {
    await expect(ensureCanvasMediaAssetBindings(input(), async () => ({ assetId: "local-only", confirmed: false, created: true, linkedToProject: false }))).rejects.toThrow("尚未保存完成");
    expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.assetId).toBeUndefined();
});

test("media removed while its asset is saving is not resurrected", async () => {
    await ensureCanvasMediaAssetBindings(input(), async ({ node }) => {
        const current = useCanvasStore.getState().projects[0];
        useCanvasStore.getState().updateProject(project.id, node.id === "video" ? { nodes: [] } : { timeline: { clips: [] } });
        expect(current.id).toBe(project.id);
        return { assetId: "asset-result", confirmed: true, created: true, linkedToProject: false };
    });
    expect(useCanvasStore.getState().projects[0].nodes).toEqual([]);
    expect(useCanvasStore.getState().projects[0].timeline?.clips).toEqual([]);
});

test("a node changed to a different resource while saving does not receive the old asset", async () => {
    await ensureCanvasMediaAssetBindings(input(), async ({ node }) => {
        if (node.id === "video") {
            useCanvasStore.getState().updateProject(project.id, { nodes: [{ ...project.nodes[0], metadata: { content: "/api/resources/replaced/file", storageKey: "resource:replaced" } }] });
        }
        return { assetId: "asset-old", confirmed: true, created: true, linkedToProject: false };
    });
    const node = useCanvasStore.getState().projects[0].nodes[0];
    expect(node.metadata?.storageKey).toBe("resource:replaced");
    expect(node.metadata?.assetId).toBeUndefined();
});
