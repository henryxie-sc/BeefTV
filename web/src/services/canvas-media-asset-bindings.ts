import { canvasNodesMissingResourceAssetBinding } from "@/lib/canvas/canvas-node-asset";
import { assertUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** Persist missing media Assets before a document references them; never recreate deleted media. */
export async function ensureCanvasMediaAssetBindings(
    input: { projectId: string; expectedScope: CapturedUserScope; signal?: AbortSignal },
    ensureAsset = ensureCanvasNodeAsset,
) {
    const assertCurrent = () => {
        if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        assertUserScope(input.expectedScope);
    };
    assertCurrent();
    const project = useCanvasStore.getState().openProject(input.projectId);
    if (!project) throw new Error("画布不存在，未保存媒体关联");
    const targets = canvasNodesMissingResourceAssetBinding(project.nodes).map((node) => ({ node, clipId: "" }));
    for (const clip of project.timeline?.clips || []) {
        const media = clip.directMedia;
        if (!media || media.kind === "text" || media.assetId) continue;
        const node: CanvasNodeData = {
            id: `timeline-media:${media.id}`, type: media.kind === "audio" ? CanvasNodeType.Audio : media.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image,
            title: media.title, position: { x: 0, y: 0 }, width: media.width || 320, height: media.height || 240,
            metadata: { content: media.url || media.dataUrl || media.content || "", storageKey: media.storageKey, mimeType: media.mimeType, bytes: media.bytes, durationMs: media.durationMs, naturalWidth: media.width, naturalHeight: media.height },
        };
        if (canvasNodesMissingResourceAssetBinding([node]).length) targets.push({ node, clipId: clip.id });
    }
    for (const { node, clipId } of targets) {
        assertCurrent();
        const result = await ensureAsset({ canvasId: input.projectId, node, source: "canvas-manual", expectedScope: input.expectedScope, signal: input.signal });
        assertCurrent();
        if (!result.confirmed || !result.assetId) throw new Error("素材库关联尚未保存完成，未开始生成");
        const current = useCanvasStore.getState().openProject(input.projectId);
        if (!current) throw new DOMException("Aborted", "AbortError");
        if (clipId) {
            const timeline = current.timeline;
            if (!timeline) continue;
            useCanvasStore.getState().updateProject(input.projectId, { timeline: { ...timeline, clips: timeline.clips.map((clip) => {
                const media = clip.directMedia;
                if (clip.id !== clipId || !media || media.assetId || media.storageKey !== node.metadata?.storageKey || (media.url || media.dataUrl || media.content || "") !== node.metadata?.content) return clip;
                return { ...clip, directMedia: { ...media, assetId: result.assetId } };
            }) } });
        } else {
            useCanvasStore.getState().updateProject(input.projectId, { nodes: current.nodes.map((item) =>
                item.id === node.id && !item.metadata?.assetId && item.metadata?.storageKey === node.metadata?.storageKey && item.metadata?.content === node.metadata?.content
                    ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item) });
        }
    }
}
