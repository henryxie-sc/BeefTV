import type { AiConfig } from "@/stores/use-config-store";
import { midjourneyFields, midjourneyOptions, midjourneyRatio } from "@/lib/apimart-midjourney";

export function MidjourneySettings({ config, onChange }: { config: AiConfig; onChange: (key: "quality" | "size" | "midjourneyOptions", value: string) => void }) {
    const options = midjourneyOptions(config.midjourneyOptions);
    const update = (key: string, value: string | number | boolean | undefined) => {
        const next = { ...options };
        if (value === undefined) delete next[key]; else next[key] = value;
        onChange("midjourneyOptions", JSON.stringify(next));
    };
    const control = "mt-1 w-full rounded-lg border border-[var(--border-semantic)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs";
    return <div className="space-y-3">
        <label className="block text-xs">质量
            <select aria-label="Midjourney 质量" className={control} value={["0.25", "0.5", "1", "2"].includes(config.quality) ? config.quality : "auto"} onChange={(event) => onChange("quality", event.target.value)}>
                {["auto", "0.25", "0.5", "1", "2"].map((value) => <option key={value} value={value}>{value === "auto" ? "自动（使用提示词或上游默认值）" : value}</option>)}
            </select>
        </label>
        <label className="block text-xs">宽高比
            <input aria-label="Midjourney 宽高比" className={control} key={config.size} defaultValue={config.size === "auto" ? "1:1" : midjourneyRatio(config.size)} placeholder="16:9" onBlur={(event) => {
                try { const ratio = midjourneyRatio(event.target.value); event.target.setCustomValidity(""); onChange("size", ratio); }
                catch { event.target.setCustomValidity("请输入有效宽高比，例如 16:9"); event.target.reportValidity(); }
            }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
        <p className="text-xs opacity-70">一次任务的结果以模型返回为准，不指定像素分辨率。未设置的参数沿用提示词或上游默认值；这里的设置优先于提示词。</p>
        <div className="grid grid-cols-2 gap-3">
            {midjourneyFields.map((field) => <label key={field.key} className={`block text-xs ${"text" in field ? "col-span-2" : ""}`}>{field.label}
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
    </div>;
}
