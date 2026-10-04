import { useEffect, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { getAssistantAccountConnection, updateAssistantAccountConnection, openAssistantAccountAuthorization, ASSISTANT_CONNECTION_EVENT, type AssistantAccountMode, type ChatGPTConnection as Connection } from "@/services/api/agent-assistant";

export function ChatGPTConnection({ mode = "chatgpt" }: { mode?: AssistantAccountMode }) {
    const google = mode === "gemini";
    const label = google ? "Gemini / Google" : "ChatGPT / Codex";
    const { message } = App.useApp();
    const [connection, setConnection] = useState<Connection | null>(null);
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState("");
    const [failed, setFailed] = useState(false);
    const polling = connection?.state === "pending" || connection?.state === "starting";
    useEffect(() => {
        let disposed = false;
        let lastConnected = false;
        const refresh = () => { void getAssistantAccountConnection(mode).then((value) => {
            if (disposed) return;
            setConnection(value); setFailed(false);
            const becameConnected = value.connected && !lastConnected;
            lastConnected = value.connected;
            if (becameConnected) window.dispatchEvent(new Event(ASSISTANT_CONNECTION_EVENT));
        }).catch(() => { if (!disposed) setFailed(true); }); };
        refresh();
        const timer = polling ? setInterval(refresh, 1500) : undefined;
        window.addEventListener(ASSISTANT_CONNECTION_EVENT, refresh);
        return () => { disposed = true; clearInterval(timer); window.removeEventListener(ASSISTANT_CONNECTION_EVENT, refresh); };
    }, [polling, mode]);

    const update = async (action: Parameters<typeof updateAssistantAccountConnection>[1], payload?: Record<string, string>) => {
        setBusy(true);
        try { setConnection(await updateAssistantAccountConnection(mode, action, payload)); setCode(""); }
        catch { void message.error("连接操作未完成，请稍后重试；助手正在处理消息时无法切换账号。"); }
        finally { setBusy(false); }
    };
    const url = connection?.authUrl || connection?.device?.verificationUri;
    const safeURL = url && (() => { try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.host === (google ? "accounts.google.com" : "auth.openai.com") && !parsed.username && !parsed.password ? parsed.href : undefined; } catch { return undefined; } })();
    return <section className="settings-section mb-3">
        <h3 className="text-sm font-semibold">创作助手 · {label}</h3>
        <p className="mt-1 mb-3 text-xs text-foreground/55">使用 {google ? "Google" : "ChatGPT"} 账号授权连接创作助手，无需填写 API Key。模型能否使用取决于账号权限。</p>
        <p className="mb-3 text-sm">{failed ? "连接状态读取失败，请重新打开设置" : !connection ? "正在读取连接状态…" : connection.state === "starting" ? "正在准备登录…" : connection.state === "pending" ? "等待你在浏览器中完成授权" : connection.state === "error" ? "登录未完成，请重试" : connection.connected ? "已登录" : "未登录"}</p>
        {connection?.errorReason === "oauth_network_error" && <p className="mb-3 text-sm text-foreground/70">{google ? "Google" : "OpenAI"} 授权或连接失败，请确认代理可用后重新登录。浏览器授权成功并不代表助手连接已完成。</p>}
        {connection?.errorReason === "oauth_project_required" && <p className="mb-3 text-sm text-foreground/70">该账号需要配置 Google Cloud 项目；请先使用个人 Google 账号尝试登录。</p>}
        {connection?.errorReason === "oauth_verification_required" && <p className="mb-3 text-sm text-foreground/70">Google 要求额外验证，请先在官方 Gemini CLI 完成账号验证后重试。</p>}
        {connection?.errorReason === "oauth_access_denied" && <p className="mb-3 text-sm text-foreground/70">Google 拒绝了此账号的 Code Assist 请求，请检查账号权限及服务可用地区。</p>}
        {connection?.errorReason === "oauth_sdk_contract_error" && <p className="mb-3 text-sm text-foreground/70">账号授权已结束，但助手与 Google SDK 的连接失败，请更新应用后重试。</p>}
        {connection?.errorReason === "oauth_client_unsupported" && <p className="mb-3 text-sm text-foreground/70">Google 已收到授权，但拒绝此客户端使用 Code Assist。请使用官方 Gemini CLI 或 Gemini API 渠道。</p>}
        {connection?.errorReason === "oauth_region_restricted" && <p className="mb-3 text-sm text-foreground/70">{google ? "Google" : "OpenAI"} 拒绝了当前地区或网络的账号请求。请确认所在地和网络出口符合服务支持地区要求。</p>}
        {connection?.errorReason === "oauth_state_mismatch" && <p className="mb-3 text-sm text-foreground/70">授权回调与本次登录不匹配，请重新登录并使用新打开的授权页面。</p>}
        <div className="flex flex-wrap items-center gap-2">
            {!connection?.active ? <Button disabled={!connection || busy} loading={busy} onClick={() => void update("connect", { model: google ? "gemini-2.5-pro" : "gpt-6-astra" })}>启用{google ? " Gemini" : ""}账号连接</Button> : <>
                <Select aria-label={`${label} 助手模型`} value={connection.model} options={connection.models?.map((model) => ({ value: model.id, label: model.name }))} disabled={busy || polling || !connection.models?.length} onChange={(model) => void update("connect", { model })} />
                {!connection.connected && !polling && <Button type="primary" loading={busy} onClick={() => void update("login", { method: "browser" })}>登录 {label}</Button>}
                {!google && !connection.connected && !polling && <Button disabled={busy} onClick={() => void update("login", { method: "device_code" })}>使用设备码登录</Button>}
                {polling && connection.state === "pending" && <Button disabled={busy} onClick={() => void update("cancel")}>取消登录</Button>}
                {connection.connected && <Button disabled={busy} onClick={() => void update("logout")}>退出账号</Button>}
                <Button disabled={busy || polling} onClick={() => void update("disable")}>使用 API 渠道</Button>
            </>}
            {safeURL && <Button onClick={() => void openAssistantAccountAuthorization(mode).catch(() => { void message.error("浏览器打开失败，请重试"); })} type="primary">打开授权页面</Button>}
        </div>
        {connection?.device && <p className="mt-3 text-sm">设备授权码：<strong>{connection.device.userCode}</strong></p>}
        {connection?.prompt && <div className="mt-3 flex gap-2"><Input.Password aria-label="授权回调链接或授权码" placeholder="若自动回调失败，粘贴授权后的完整链接或授权码" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /><Button disabled={busy || !code.trim()} onClick={() => void update("answer", { code })}>完成登录</Button></div>}
    </section>;
}
