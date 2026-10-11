import { expect, test } from "bun:test";
import { selectCanvasReferenceImage } from "@/lib/canvas/canvas-image-outputs";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("selected gallery image survives serialization and becomes the downstream reference", () => {
    const outputs = Array.from({ length: 4 }, (_, index) => ({
        content: `/api/resources/image-${index}/file`, storageKey: `resource:image-${index}`,
        assetId: `asset-${index}`, resourceId: `image-${index}`, mimeType: "image/png",
        bytes: 100, naturalWidth: 1200, naturalHeight: 800, outputIndex: index,
    }));
    const node: CanvasNodeData = {
        id: "gallery", type: CanvasNodeType.Image, title: "四张图", position: { x: 10, y: 20 }, width: 600, height: 400,
        metadata: { ...outputs[0], imageOutputs: outputs, referenceImageIndex: 0, previewContent: "old-preview" },
    };
    const selected = JSON.parse(JSON.stringify(selectCanvasReferenceImage(node, 2))) as CanvasNodeData;
    expect(selected.metadata?.imageOutputs).toHaveLength(4);
    expect(selected.metadata?.referenceImageIndex).toBe(2);
    expect(selected.metadata?.assetId).toBe("asset-2");
    expect(selected.metadata?.previewContent).toBeUndefined();
    expect(nodeReferenceImage(selected)?.storageKey).toBe("resource:image-2");
    expect(node.metadata?.referenceImageIndex).toBe(0);
    expect(selectCanvasReferenceImage(node, 4)).toBe(node);
});
