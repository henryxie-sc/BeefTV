import type { CanvasNodeData } from "@/types/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";

export function selectCanvasReferenceImage(node: CanvasNodeData, index: number): CanvasNodeData {
    const image = node.metadata?.imageOutputs?.[index];
    if (!Number.isInteger(index) || !image) return node;
    const size = !node.metadata?.manualSize && !node.metadata?.freeResize && image.naturalWidth > 0 && image.naturalHeight > 0
        ? fitNodeSize(image.naturalWidth, image.naturalHeight) : {};
    return {
        ...node,
        ...size,
        metadata: { ...node.metadata, ...image, referenceImageIndex: index, previewContent: undefined },
    };
}
