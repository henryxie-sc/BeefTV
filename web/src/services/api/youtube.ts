import type { ReferenceVideo } from "@/types/media";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

export type YouTubePromptLink = { texts: string[]; videoId: string; url: string };

const GEMINI_GENERATE_CONTENT_PROTOCOL = "gemini-generate-content";

function videoIdFromYouTubeURL(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return "";
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let videoId = "";
    if (host === "youtu.be" || host === "www.youtu.be") {
        videoId = parts[0] || "";
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
        if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
        else if (parts.length === 2 && ["shorts", "embed", "live", "v"].includes(parts[0])) videoId = parts[1];
    } else if (["youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host) && parts.length === 2 && parts[0] === "embed") {
        videoId = parts[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
}

export function youtubeVideoLinksInPrompt(prompt: string): YouTubePromptLink[] {
    const links = new Map<string, YouTubePromptLink>();
    const urlPattern = /https?:\/\/[^\s<>"'`]+/giu;
    for (const match of prompt.matchAll(urlPattern)) {
        const text = match[0].replace(/[)\]}>.,!?，。！？、；：]+$/u, "");
        const videoId = videoIdFromYouTubeURL(text);
        if (!videoId) continue;
        const existing = links.get(videoId);
        if (existing) {
            if (!existing.texts.includes(text)) existing.texts.push(text);
            continue;
        }
        links.set(videoId, { texts: [text], videoId, url: `https://www.youtube.com/watch?v=${videoId}` });
    }
    return [...links.values()];
}

export function youtubeReferencesForPrompt(prompt: string, links: YouTubePromptLink[]) {
    const references: ReferenceVideo[] = links.map((link) => ({
        id: `youtube-${link.videoId}`,
        name: `YouTube 视频 ${link.videoId}`,
        type: "video/youtube",
        url: link.url,
    }));
    let resolvedPrompt = prompt;
    for (const [index, link] of links.entries()) {
        const marker = `[视频素材${index + 1}]`;
        for (const text of link.texts) resolvedPrompt = resolvedPrompt.split(text).join(marker);
    }
    return { prompt: resolvedPrompt, references };
}

export function configureGeminiYouTubeProtocol(
    config: AiConfig,
    selectedChannel: ModelChannel,
    currentProtocol?: string,
): AiConfig | null {
    if (currentProtocol === GEMINI_GENERATE_CONTENT_PROTOCOL) return config;
    if (currentProtocol || (selectedChannel.apiFormat || config.apiFormat) !== "gemini") return null;

    const channel = { ...selectedChannel, interfaceType: GEMINI_GENERATE_CONTENT_PROTOCOL };
    const channels = config.channels || [];
    const hasSelectedChannel = channels.some((item) => item.id === selectedChannel.id);
    return {
        ...config,
        channels: hasSelectedChannel ? channels.map((item) => (item.id === selectedChannel.id ? channel : item)) : [...channels, channel],
    };
}
