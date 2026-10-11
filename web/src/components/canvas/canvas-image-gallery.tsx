import { Button } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasImageGallery({ node, onClose, onSelectReference }: {
    node: CanvasNodeData;
    onClose: () => void;
    onSelectReference?: (nodeId: string, index: number) => void;
}) {
    const images = node.metadata?.imageOutputs || [];
    const selected = node.metadata?.referenceImageIndex ?? 0;
    const [index, setIndex] = useState(Math.min(selected, Math.max(0, images.length - 1)));
    const current = images[index];
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]")) return;
            event.preventDefault();
            event.stopPropagation();
            setIndex((value) => Math.max(0, Math.min(images.length - 1, value + (event.key === "ArrowLeft" ? -1 : 1))));
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [images.length]);
    return <AppModal open title={node.title || "图片"} width="min(1100px, calc(100vw - 48px))" centered onCancel={onClose} footer={null}>
        <div data-canvas-no-zoom className="space-y-3" onPointerDown={(event) => event.stopPropagation()}>
            <div className="relative flex h-[65vh] items-center justify-center">
                {current ? <CachedResourceImage key={`${node.id}:${current.outputIndex}`} eager storageKey={current.storageKey} src={current.content} alt={`${node.title || "图片"} ${index + 1}`} className="max-h-[65vh] max-w-full object-contain" fallback={<span role="status">图片加载失败，请关闭后重试</span>} loadingFallback={<span role="status">正在读取图片…</span>} /> : null}
                <Button aria-label="上一张" disabled={index === 0} icon={<ChevronLeft />} className="absolute left-0" onClick={() => setIndex(index - 1)} />
                <Button aria-label="下一张" disabled={index === images.length - 1} icon={<ChevronRight />} className="absolute right-0" onClick={() => setIndex(index + 1)} />
            </div>
            <div className="flex items-center justify-between gap-3">
                <span>{index + 1} / {images.length}{selected === index ? " · 当前参考图" : ""}</span>
                {onSelectReference ? <Button type="primary" disabled={selected === index} onClick={() => onSelectReference(node.id, index)}>{selected === index ? "已设为参考图" : "设为参考图"}</Button> : null}
            </div>
        </div>
    </AppModal>;
}
