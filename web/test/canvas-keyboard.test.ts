import { expect, test } from "bun:test";

import { hasCanvasTextSelection, isCanvasTextEditingElement } from "../src/pages/canvas/use-canvas-keyboard";

test("Canvas editing boundary includes native controls and every editable attribute mode", () => {
    expect(isCanvasTextEditingElement(null)).toBe(false);
    for (const mode of ["input", "textarea", "select", "true", "", "plaintext-only"]) {
        expect(isCanvasTextEditingElement({ closest: (selector) => {
            expect(selector).toContain("input, textarea, select");
            expect(selector).toContain("[contenteditable]:not([contenteditable='false'])");
            return { mode };
        } })).toBe(true);
    }
    expect(isCanvasTextEditingElement({ closest: () => null })).toBe(false);
});

test("Canvas deletion yields to selected prompt text after focus moves away", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-keyboard.ts", import.meta.url)).text();
    const block = source.slice(source.indexOf('if (event.key === "Delete" || event.key === "Backspace")'));
    expect(block.indexOf("if (hasCanvasTextSelection(window.getSelection())) return;")).toBeLessThan(block.indexOf("event.preventDefault();"));
    expect(source).toContain("isCanvasTextEditingElement(target) || isCanvasTextEditingElement(document.activeElement)");
});

test("Canvas copy shortcut yields to a real browser text selection", () => {
    expect(hasCanvasTextSelection(null)).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: true, rangeCount: 1, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 0, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "Agent 文本" })).toBe(true);
});

test("Canvas keyboard keeps node copy as the fallback when no text is selected", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-keyboard.ts", import.meta.url)).text();
    expect(source).toContain("if (hasCanvasTextSelection(window.getSelection())) return;");
    expect(source).toContain("event.preventDefault();\n                copySelectedNodes();");
});

test("Canvas delete prioritizes an explicitly selected connection over a stale node selection", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-keyboard.ts", import.meta.url)).text();
    expect(source).toContain("if (selectedConnectionId) deleteConnection(selectedConnectionId);");
    expect(source).toContain("else if (selectedNodeIdsRef.current.size) deleteNodes(new Set(selectedNodeIdsRef.current));");
});
