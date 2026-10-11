export function isAPIMartMidjourney(model: string, baseUrl: string, protocol?: string) {
    try {
        const url = new URL(baseUrl);
        return model.trim().toLowerCase() === "midjourney" && url.protocol === "https:" && url.hostname.toLowerCase() === "api.apimart.ai" && protocol === "openai-image";
    } catch { return false; }
}

export function midjourneyOptions(value?: string): Record<string, string | number | boolean> {
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Midjourney 参数格式无效");
    return parsed as Record<string, string | number | boolean>;
}

export function midjourneyRatio(size: string) {
    const match = size.trim().match(/^(\d+)\s*[:x]\s*(\d+)$/i);
    if (!match || !Number(match[1]) || !Number(match[2])) throw new Error("Midjourney 宽高比必须为正数，例如 16:9");
    const width = Number(match[1]), height = Number(match[2]);
    let a = width, b = height;
    while (b) [a, b] = [b, a % b];
    return `${width / a}:${height / a}`;
}

export const midjourneyFields = [
    { key: "version", label: "模型版本", options: ["8.2", "8.1", "7", "6.1", "5.2", "5.1", "6"] },
    { key: "speed", label: "速度（影响计费）", options: ["relax", "fast", "turbo"] },
    { key: "style", label: "风格", options: ["raw"] },
    { key: "seed", label: "随机种子", min: 0, max: 4294967295 },
    { key: "stylize", label: "风格化", min: 0, max: 1000 },
    { key: "chaos", label: "变化度", min: 0, max: 100 },
    { key: "weird", label: "怪异度", min: 0, max: 3000 },
    { key: "negative_prompt", label: "排除内容", text: true },
    { key: "iw", label: "图片权重", min: 0, max: 3, step: 0.1 },
    { key: "cw", label: "角色权重", min: 0, max: 100 },
    { key: "sw", label: "风格权重", min: 0, max: 1000 },
    { key: "dw", label: "深度权重", min: 0, max: 100, step: 0.1 },
    { key: "cref", label: "角色参考 URL", text: true },
    { key: "sref", label: "风格参考 URL", text: true },
    { key: "dref", label: "深度参考 URL", text: true },
    { key: "repeat", label: "重复次数（额外生成）", min: 2, max: 40 },
    { key: "stop", label: "提前停止（v5–6.1 / Niji 5–6）", min: 10, max: 100 },
    { key: "niji", label: "Niji 动漫（搭配版本 7 或 6）", boolean: true },
    { key: "tile", label: "无缝平铺", boolean: true },
    { key: "raw", label: "原始风格（v5.1+）", boolean: true },
    { key: "draft", label: "草稿模式（v7+）", boolean: true },
    { key: "hd", label: "高清模式（v8.1 / v8.2）", boolean: true },
    { key: "nsfw_check", label: "内容预审（额外计费）", boolean: true },
    { key: "extra", label: "其他原生参数（--xxx）", text: true },
] as const;
