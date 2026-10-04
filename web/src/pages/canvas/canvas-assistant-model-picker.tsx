import { App, Select } from "antd";
import { useEffect, useState } from "react";
import { getAssistantAccountConnection, updateAssistantAccountConnection, ASSISTANT_CONNECTION_EVENT, type AssistantAccountMode, type ChatGPTConnection } from "@/services/api/agent-assistant";
import { assistantModelOptions, resolveAssistantModel } from "@/lib/assistant-model";
import { modelDisplayName, resolveModelChannel, useConfigStore } from "@/stores/use-config-store";

export function CanvasAssistantModelPicker({ busy }: { busy: boolean }) {
    const { message } = App.useApp();
    const [connection, setConnection] = useState<(ChatGPTConnection & { mode: AssistantAccountMode }) | null>(null);
    const [switching, setSwitching] = useState(false);
    const starting = connection?.state === "starting";
    useEffect(() => {
        let disposed = false;
        const refresh = () => { void Promise.all((["chatgpt", "gemini"] as const).map(async (mode) => ({ ...await getAssistantAccountConnection(mode), mode }))).then((values) => { if (!disposed) setConnection(values.find((value) => value.active) || null); }).catch(() => { if (!disposed) setConnection(null); }); };
        refresh();
        const timer = starting ? setInterval(refresh, 1500) : undefined;
        window.addEventListener(ASSISTANT_CONNECTION_EVENT, refresh);
        return () => { disposed = true; clearInterval(timer); window.removeEventListener(ASSISTANT_CONNECTION_EVENT, refresh); };
    }, [starting]);
    const config = useConfigStore((state) => state.config);
    const selected = resolveAssistantModel(config);
    const options = assistantModelOptions(config).map((value) => ({
        value,
        label: modelDisplayName(config, value),
        title: `${modelDisplayName(config, value)} · ${resolveModelChannel(config, value).name}`,
    }));
    return (
        <Select
            className="canvas-assistant-model"
            aria-label="助手模型"
            size="small"
            variant="borderless"
            value={connection?.active ? connection.model : selected || undefined}
            placeholder={options.length ? "选择助手模型" : "暂无可用模型"}
            options={connection?.active ? connection.models?.map(({ id, name }) => ({ value: id, label: name })) : options}
            disabled={busy || switching || (connection?.active ? !connection.models?.length : options.length === 0)}
            placement="topLeft"
            popupMatchSelectWidth={false}
            onChange={(value) => {
                if (connection?.active) {
                    setSwitching(true);
                    const mode = connection.mode;
                    void updateAssistantAccountConnection(mode, "connect", { model: value }).then((next) => setConnection({ ...next, mode }))
                        .catch(() => { void message.error("助手模型切换失败，请稍后重试"); })
                        .finally(() => setSwitching(false));
                    return;
                }
                if (!busy && assistantModelOptions(useConfigStore.getState().config).includes(value)) {
                    useConfigStore.getState().updateConfig("assistantModel", value);
                }
            }}
        />
    );
}
