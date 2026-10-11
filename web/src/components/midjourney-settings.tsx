import type { AiConfig } from "@/stores/use-config-store";
import { Checkbox } from "@/components/ui/base/checkbox/checkbox";
import { midjourneyFields, midjourneyOptions, midjourneyRatio } from "@/lib/apimart-midjourney";

export function MidjourneySettings({ config, onChange }: { config: AiConfig; onChange: (key: "quality" | "size" | "midjourneyOptions", value: string) => void }) {
    const options = midjourneyOptions(config.midjourneyOptions);
    const update = (key: string, value: string | number | boolean | undefined) => {
        const next = { ...options };
        if (value === undefined) delete next[key]; else next[key] = value;
        onChange("midjourneyOptions", JSON.stringify(next));
    };
    const control = "mt-1 w-full rounded-lg border border-[var(--border-semantic)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs";
    const activeRatio = config.size === "auto" ? "1:1" : midjourneyRatio(config.size);
    const common = new Set(["version", "speed", "stylize", "chaos", "weird", "seed", "niji", "tile", "raw", "draft", "hd"]);
    return <div className="space-y-4 text-xs">
        <div className="flex gap-3">
            <span className="shrink-0 pt-2 opacity-60">比例</span>
            <div className="grid flex-1 grid-cols-4 gap-1 rounded-xl bg-[var(--bg-secondary)] p-2">
                {["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "9:21"].map((ratio) => {
                    const [w, h] = ratio.split(":").map(Number);
                    return <button key={ratio} type="button" aria-label={`比例 ${ratio}`} aria-pressed={activeRatio === ratio} className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: activeRatio === ratio ? "var(--border-semantic)" : "transparent", background: activeRatio === ratio ? "var(--bg-tertiary)" : "transparent", opacity: activeRatio === ratio ? 1 : 0.65 }} onClick={() => onChange("size", ratio)}>
                        <span aria-hidden="true" className="inline-block shrink-0 rounded-sm border-2 border-current" style={{ width: 18 * Math.min(1, w / h), height: 18 * Math.min(1, h / w) }} />
                        <span>{ratio}</span>
                    </button>;
                })}
            </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
            <label>版本<select aria-label="模型版本" className={control} value={String(options.version ?? "")} onChange={(event) => update("version", event.target.value || undefined)}>
                <option value="">默认</option>{["8.2", "8.1", "7", "6.1", "5.2", "5.1", "6"].map((version) => <option key={version} value={version}>v{version}</option>)}
            </select></label>
            <label>速度<select aria-label="速度（影响计费）" className={control} value={String(options.speed ?? "")} onChange={(event) => update("speed", event.target.value || undefined)}>
                <option value="">默认</option>{["relax", "fast", "turbo"].map((speed) => <option key={speed} value={speed}>{speed[0].toUpperCase() + speed.slice(1)}</option>)}
            </select></label>
            <label>画质<select aria-label="Midjourney 质量" className={control} value={["0.25", "0.5", "1", "2"].includes(config.quality) ? config.quality : "auto"} onChange={(event) => onChange("quality", event.target.value)}>
                {["auto", "0.25", "0.5", "1", "2"].map((value) => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}
            </select></label>
        </div>
        {[{ key: "stylize", label: "风格化强度", max: 1000, fallback: 100 }, { key: "chaos", label: "混乱度", max: 100, fallback: 0 }, { key: "weird", label: "怪异度", max: 3000, fallback: 0 }].map((field) => <label key={field.key} className="block space-y-2">
            <span className="flex items-center justify-between"><span className="opacity-65">{field.label}</span><output className="tabular-nums">{String(options[field.key] ?? field.fallback)}{options[field.key] === undefined ? " · 默认" : ""}</output></span>
            <input className="block h-5 w-full cursor-pointer accent-[var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={field.label} type="range" min={0} max={field.max} step={1} value={Number(options[field.key] ?? field.fallback)} onChange={(event) => update(field.key, Number(event.target.value))} />
        </label>)}
        <label className="flex items-center gap-3"><span className="shrink-0 opacity-65">随机种子（可选）</span><input aria-label="随机种子" type="number" min={0} max={4294967295} step={1} className={control} key={String(options.seed ?? "")} defaultValue={String(options.seed ?? "")} placeholder="例如 123456" onBlur={(event) => {
            if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return; }
            update("seed", event.target.value === "" ? undefined : Number(event.target.value));
        }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
        <div className="flex items-start gap-3"><span className="shrink-0 pt-0.5 opacity-65">参数</span><div className="flex flex-wrap gap-x-4 gap-y-3">
            {[{ key: "niji", label: "Niji 动漫" }, { key: "tile", label: "平铺" }, { key: "raw", label: "Raw 原始" }, { key: "draft", label: "Draft 草图" }, { key: "hd", label: "HD 高清" }].map((field) => <Checkbox key={field.key} checked={options[field.key] === true} onChange={(event) => update(field.key, event.target.checked)}>{field.label}</Checkbox>)}
        </div></div>
        <details className="border-t border-[var(--border-semantic)] pt-3">
            <summary className="cursor-pointer opacity-65">高级参数</summary>
            <div className="mt-3">
                <label className="block">自定义宽高比<input aria-label="Midjourney 宽高比" className={control} key={config.size} defaultValue={activeRatio} onBlur={(event) => {
                    try { const ratio = midjourneyRatio(event.target.value); event.target.setCustomValidity(""); onChange("size", ratio); }
                    catch { event.target.setCustomValidity("请输入有效宽高比，例如 16:9"); event.target.reportValidity(); }
                }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            </div>
        <p className="my-3 text-xs opacity-60">未设置的参数沿用提示词或上游默认值。速度、重复生成和内容预审可能影响费用；开关需与模型版本兼容。</p>
        <div className="grid grid-cols-2 gap-3">
            {midjourneyFields.filter((field) => !common.has(field.key)).map((field) => <label key={field.key} className={`block text-xs ${"text" in field ? "col-span-2" : ""}`}>{field.label}
                {"options" in field || "boolean" in field ? <select aria-label={field.label} className={control} value={String(options[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value === "" ? undefined : "boolean" in field ? event.target.value === "true" : event.target.value)}>
                    <option value="">未设置</option>
                    {"options" in field ? field.options.map((value) => <option key={value} value={value}>{value}</option>) : <><option value="true">开启</option><option value="false">关闭</option></>}
                </select> : <input aria-label={field.label} className={control} type={"text" in field ? "text" : "number"} min={"min" in field ? field.min : undefined} max={"max" in field ? field.max : undefined} step={"step" in field ? field.step : 1} placeholder="未设置" key={String(options[field.key] ?? "")} defaultValue={String(options[field.key] ?? "")} onBlur={(event) => {
                    if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return; }
                    const value = event.target.value.trim();
                    update(field.key, value === "" ? undefined : "text" in field ? value : Number(value));
                }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}
            </label>)}
        </div>
        <button type="button" className="mt-3 text-xs underline underline-offset-4" onClick={() => onChange("midjourneyOptions", "{}")}>重置专属参数</button>
        </details>
    </div>;
}
