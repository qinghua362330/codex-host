import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { harnessIdSchema } from "@codexhost/shared-contracts";

import { discoverNativeHarnessConfiguration } from "../src/native-discovery.js";
import { FileHarnessConfigurationStore } from "../src/store.js";

describe("native Harness configuration discovery", () => {
  it("discovers Claude Code settings and OAuth without returning secret values", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "codexhost-native-discovery-"));
    await mkdir(path.join(home, ".claude"));
    await writeFile(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example.test/v1",
          ANTHROPIC_API_KEY: "secret-anthropic-key",
          ANTHROPIC_MODEL: "claude-sonnet-4-5",
        },
      }),
    );
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { token: "x" } }));

    const result = await discoverNativeHarnessConfiguration("claude-code", { HOME: home });
    expect(result.summary).toMatchObject({
      status: "detected",
      authType: "third-party-gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKeyConfigured: true,
      apiKeyHint: "****-key",
      model: "claude-sonnet-4-5",
    });
    expect(result.summary.sources).toEqual(
      expect.arrayContaining([
        { kind: "settings-file", path: path.join(home, ".claude", "settings.json") },
        { kind: "oauth-file", path: path.join(home, ".claude.json") },
      ]),
    );
    expect(JSON.stringify(result.summary)).not.toContain("secret-anthropic-key");
    expect(result.endpoint?.apiKey).toBe("secret-anthropic-key");
  });

  it("imports the detected native values into a separate CodexHost profile", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "codexhost-native-import-"));
    await mkdir(path.join(home, ".claude"));
    await writeFile(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_API_KEY: "secret-anthropic-key", ANTHROPIC_MODEL: "claude" } }),
    );
    const configPath = path.join(home, ".codexhost", "harnesses.json");
    const store = new FileHarnessConfigurationStore({
      environment: { HOME: home, CODEXHOST_HARNESS_CONFIG: configPath },
      harnessIds: ["claude-code"],
    });

    const result = await store.importLocal({ harnessId: harnessIdSchema.parse("claude-code") });
    const profile = result.snapshot.harnesses[0]?.profiles.find(({ id }) => id === "native");
    expect(profile).toMatchObject({
      label: "Local Harness configuration",
      authType: "official-api-key",
      apiKeyConfigured: true,
      model: "claude",
    });
    expect(JSON.parse(await readFile(configPath, "utf8")).harnesses["claude-code"].activeProfile).toBe(
      "native",
    );
  });
});
