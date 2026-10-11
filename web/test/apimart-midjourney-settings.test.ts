import { expect, test } from "bun:test";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import { modelCapabilityConfigFor } from "../src/lib/model-capabilities";

test("APIMart MJ settings reach task metadata and replace stale OpenAI options", async () => {
    const channel = createModelChannel({ id: "mj", name: "APIMart", baseUrl: "https://api.apimart.ai/v1", apiKey: "test", interfaceType: "openai-image", models: ["midjourney"] });
    const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel("mj", "midjourney"), size: "2880x2880", quality: "high", count: "3", transparentBackground: "true", midjourneyOptions: JSON.stringify({ version: "7", speed: "fast", stylize: 0, niji: true }) };
    const profile = modelCapabilityConfigFor(config, config.model).image!;
    expect(profile.quality.values).toContain("0.25");
    expect(profile.transparentBackground.supported).toBe(false);
    expect(profile.references.maskSupported).toBe(false);
    const task = await prepareBackendGenerationTask({ mode: "image", prompt: "draw", config });
    const input = task.input as { config: Record<string, unknown>; metadata: { providerOptions: Record<string, unknown> } };
    expect(input.config.size).toBe("1:1");
    expect(input.config.quality).toBeUndefined();
    expect(input.config.count).toBe("1");
    expect(input.config.transparentBackground).toBe("false");
    expect(input.metadata.providerOptions["apimart-midjourney"]).toEqual({ version: "7", speed: "fast", stylize: 0, niji: true });
    channel.baseUrl = "https://other.example.com";
    expect(modelCapabilityConfigFor(config, config.model).image!.quality.values).not.toContain("0.25");
});
