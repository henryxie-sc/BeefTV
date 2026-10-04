import { useEffect, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { getChatGPTConnection, updateChatGPTConnection, openChatGPTAuthorization, ASSISTANT_CONNECTION_EVENT, type ChatGPTConnection as Connection } from "@/services/api/agent-assistant";

export function ChatGPTConnection() {
    const { message } = App.useApp();
    const [connection, setConnection] = useState<Connection | null>(null);
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState("");
    const [failed, setFailed] = useState(false);
    const polling = connection?.state === "pending" || connection?.state === "starting";
    useEffect(() => {
        let disposed = false;
        const refresh = () => { void getChatGPTConnection().then((value) => {
            if (disposed) return;
            setConnection(value); setFailed(false);
            if (value.connected) window.dispatchEvent(new Event(ASSISTANT_CONNECTION_EVENT));
        }).catch(() => { if (!disposed) setFailed(true); }); };
        refresh();
        const timer = polling ? setInterval(refresh, 1500) : undefined;
        return () => { disposed = true; clearInterval(timer); };
    }, [polling]);

    const update = async (action: Parameters<typeof updateChatGPTConnection>[0], payload?: Record<string, string>) => {
        setBusy(true);
        try { setConnection(await updateChatGPTConnection(action, payload)); setCode(""); }
        catch { void message.error("连接操作未完成，请稍后重试；助手正在处理消息时无法切换账号。"); }
        finally { setBusy(false); }
    };
    const url = connection?.authUrl || connection?.device?.verificationUri;
    const safeURL = url && (() => { try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "auth.openai.com" ? parsed.href : undefined; } catch { return undefined; } })();
    return <section className="settings-section mb-3">
        <h3 className="text-sm font-semibold">创作助手 · ChatGPT / Codex</h3>
        <p className="mt-1 mb-3 text-xs text-foreground/55">使用 ChatGPT 账号授权连接创作助手，无需填写 API Key。模型能否使用取决于账号权限。</p>
        <p className="mb-3 text-sm">{failed ? "连接状态读取失败，请重新打开设置" : !connection ? "正在读取连接状态…" : connection.state === "starting" ? "正在准备登录…" : connection.state === "pending" ? "等待你在浏览器中完成授权" : connection.state === "error" ? "登录未完成，请重试" : connection.connected ? "已登录" : "未登录"}</p>
        <div className="flex flex-wrap items-center gap-2">
            {!connection?.active ? <Button disabled={!connection || busy} loading={busy} onClick={() => void update("connect", { model: "gpt-6-astra" })}>启用账号连接</Button> : <>
                <Select aria-label="ChatGPT 助手模型" value={connection.model} options={connection.models?.map((model) => ({ value: model.id, label: model.name }))} disabled={busy || polling || !connection.models?.length} onChange={(model) => void update("connect", { model })} />
                {!connection.connected && !polling && <Button type="primary" loading={busy} onClick={() => void update("login", { method: "browser" })}>登录 ChatGPT / Codex</Button>}
                {!connection.connected && !polling && <Button disabled={busy} onClick={() => void update("login", { method: "device_code" })}>使用设备码登录</Button>}
                {polling && connection.state === "pending" && <Button disabled={busy} onClick={() => void update("cancel")}>取消登录</Button>}
                {connection.connected && <Button disabled={busy} onClick={() => void update("logout")}>退出账号</Button>}
                <Button disabled={busy || polling} onClick={() => void update("disable")}>使用 API 渠道</Button>
            </>}
            {safeURL && <Button onClick={() => void openChatGPTAuthorization().catch(() => { void message.error("浏览器打开失败，请重试"); })} type="primary">打开授权页面</Button>}
        </div>
        {connection?.device && <p className="mt-3 text-sm">设备授权码：<strong>{connection.device.userCode}</strong></p>}
        {connection?.prompt && <div className="mt-3 flex gap-2"><Input.Password aria-label="授权回调链接或授权码" placeholder="若自动回调失败，粘贴授权后的完整链接或授权码" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /><Button disabled={busy || !code.trim()} onClick={() => void update("answer", { code })}>完成登录</Button></div>}
    </section>;
}
