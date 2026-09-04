import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const PRESETS = {
  spec: {
    title: "Issue #53 BLE Concurrency Spec",
    prompt: `# Kokolog Monitor: BLE Auto-Connect & Fault Recovery Specification
Analyze the following acceptance criteria for Issue #53:
1. The runtime monitors advertisements for all registered devices and connects up to four simultaneously.
2. ECG, acceleration, and rPos reception is independent per device.
3. One failing device does not block the other three.
4. GATT 133 closes resources before reconnection, and duplicate concurrent attempts do not occur.
5. A normal reconnect attempt starts within two seconds.
6. Bluetooth-off, scan-restricted, permission, and terminal states provide distinct guidance.

Task:
- Identify the 3 critical race conditions in this 4-slot BLE connection and reconnect state machine.
- Provide a concise architectural recommendation for GATT 133 resource closure.
`
  },
  bug: {
    title: "Dart State Reducer Missing Case",
    prompt: `// Identify the bug and fix the missing state mapping in this Dart reducer snippet:
MonitorAppState reduceAppState({
  required HrmRuntimeState snapshot,
  required bool isSnapshotFresh,
  required TransportHealth? transportHealth,
  required bool isConfigured,
}) {
  if (!isConfigured) return MonitorAppState.unconfigured();
  return switch (snapshot.availability) {
    HrmRuntimeAvailability.ready => _reduceReady(snapshot),
    HrmRuntimeAvailability.bluetoothOff => MonitorAppState.actionRequired(ActionRequiredKind.bluetoothOff),
    HrmRuntimeAvailability.permissionRequired => MonitorAppState.actionRequired(ActionRequiredKind.permissionRequired),
    HrmRuntimeAvailability.unsupported => MonitorAppState.actionRequired(ActionRequiredKind.unsupportedDevice),
    // Defect: backgroundRestricted / scanRestricted fall through to stopped(runtimeUnavailable)
    _ => MonitorAppState.stopped(reason: StoppedReason.runtimeUnavailable),
  };
}
// Task: Explain the defect and output the corrected Dart code block.
`
  },
  arch: {
    title: "Loop Lifecycle & Role Handoff",
    prompt: `Explain the handoff contract in an autonomous coding loop between:
1. Implementer (maker)
2. Reviewer / Assurance (checker)
3. Gardener (ticket backfill)
4. Decision Desk (human gates)

State plainly what an implementer must do when encountering a stale test or an adjacent bug.
`
  }
};

async function loadOpencodeConfig() {
  const candidates = [
    path.join(os.homedir(), ".config/opencode/opencode.json"),
    path.join(os.homedir(), ".opencode/opencode.json")
  ];
  for (const file of candidates) {
    try {
      const text = await fs.readFile(file, "utf8");
      return JSON.parse(text);
    } catch {}
  }
  return {};
}

export async function resolveBenchConfig() {
  const cfg = await loadOpencodeConfig();
  const p10 = cfg.provider?.["10router"] || {};
  const models = [];
  for (const [id, m] of Object.entries(p10.models || {})) {
    models.push({
      id: `10router/${id}`,
      name: id,
      variants: Object.keys(m.variants || {})
    });
  }
  return {
    engines: [
      { id: "opencode", name: "OpenCode CLI (Real Agent Runtime)" },
      { id: "gateway", name: "Direct Gateway (Raw API Baseline)" }
    ],
    models,
    presets: PRESETS
  };
}

export async function resolveGatewayConfig() {
  const cfg = await loadOpencodeConfig();
  const p10 = cfg.provider?.["10router"] || {};
  const baseURL = (p10.options?.baseURL || "https://ai.zcloud.my/v1").replace(/\/$/, "");
  const apiKey = p10.options?.apiKey || process.env.OPENCODE_API_KEY || "";
  const models = Object.keys(p10.models || {});
  return { baseURL, apiKey, models };
}

export async function handleBench(request, response) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 65536) {
      response.writeHead(413, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "Prompt too large (max 64KB)" }));
    }
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    return response.end(JSON.stringify({ error: "Malformed JSON" }));
  }

  const {
    engine = "opencode",
    model = "10router/combo-coding",
    variant = "high",
    thinkingLevel = "high",
    prompt = ""
  } = body;

  if (!prompt.trim()) {
    response.writeHead(400, { "content-type": "application/json" });
    return response.end(JSON.stringify({ error: "Missing prompt" }));
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  const sendEvent = (event, data) => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (engine === "opencode") {
    return runOpencodeBench({ model, variant, thinkingLevel, prompt, sendEvent, request, response });
  } else {
    return runGatewayBench({ model, thinkingLevel, prompt, sendEvent, response });
  }
}

async function runOpencodeBench({ model, variant, thinkingLevel, prompt, sendEvent, request, response }) {
  const tStart = Date.now();
  let tFirstStep = null;
  let tFirstContent = null;
  let tFirstChunk = null;

  let stepCount = 0;
  let toolsUsed = [];
  let totalReasoningTokens = 0;
  let totalOutputTokens = 0;
  let totalInputTokens = 0;
  let fullContent = "";

  const opencodeBin = process.env.OPENCODE_BIN || "/Users/zafar/.opencode/bin/opencode";
  const title = `bench-${Date.now().toString(36)}`;

  let modelArg = model;
  if (!modelArg.startsWith("10router/") && !modelArg.includes("/")) {
    modelArg = `10router/${modelArg}`;
  }

  const benchDir = "/tmp/bench-isolated";
  await fs.mkdir(benchDir, { recursive: true }).catch(() => {});

  const args = ["run", "--dir", benchDir, "--pure", "--model", modelArg];
  const chosenVariant = variant || (thinkingLevel !== "none" ? thinkingLevel : "");
  if (chosenVariant && chosenVariant !== "none") {
    args.push("--variant", chosenVariant);
  }
  args.push("--format", "json", "--title", title, "--", prompt);

  sendEvent("start", { engine: "opencode", model: modelArg, variant: chosenVariant, tStart });

  const env = {
    ...process.env,
    OPENCODE_DB: "/tmp/bench-opencode.db",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      plugin: [],
      mcp: { "google-docs": { enabled: false } }
    }),
    OPENCODE_PERMISSION: JSON.stringify({
      edit: "deny",
      task: "deny",
      external_directory: "deny",
      bash: "deny"
    })
  };

  const child = spawn(opencodeBin, args, {
    cwd: benchDir,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });

  let killed = false;
  const cleanupChild = () => {
    if (!killed) {
      killed = true;
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
        }, 1000);
      } catch {}
    }
  };

  request.on("close", cleanupChild);

  let stdoutBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const now = Date.now();
      if (tFirstChunk === null) tFirstChunk = now;

      const type = event.type;
      const part = event.part || {};

      if (type === "step_start") {
        stepCount++;
        if (tFirstStep === null) {
          tFirstStep = now;
          const startupSec = (tFirstStep - tStart) / 1000;
          sendEvent("startup", { startup_sec: Number(startupSec.toFixed(3)) });
        }
        sendEvent("step_start", { step: stepCount });
      } else if (type === "text") {
        if (tFirstContent === null) {
          tFirstContent = now;
          const ttftSec = (tFirstContent - tStart) / 1000;
          sendEvent("ttft", { ttft_sec: Number(ttftSec.toFixed(3)) });
        }
        const txt = part.text || "";
        if (txt) {
          fullContent += txt;
          sendEvent("content", { text: txt });
        }
      } else if (type === "tool_use") {
        if (tFirstContent === null) {
          tFirstContent = now;
          const ttftSec = (tFirstContent - tStart) / 1000;
          sendEvent("ttft", { ttft_sec: Number(ttftSec.toFixed(3)) });
        }
        const toolName = part.tool || part.name || "unknown";
        toolsUsed.push(toolName);
        sendEvent("tool", { step: stepCount, tool: toolName, input: part.input });
      } else if (type === "step_finish") {
        const tokens = part.tokens || {};
        totalReasoningTokens += tokens.reasoning || 0;
        totalOutputTokens += tokens.output || 0;
        totalInputTokens = Math.max(totalInputTokens, tokens.input || 0);

        sendEvent("step_finish", {
          step: stepCount,
          tokens: {
            reasoning: tokens.reasoning || 0,
            output: tokens.output || 0,
            input: tokens.input || 0,
            total: tokens.total || 0
          }
        });
      }
    }
  });

  let stderrLog = "";
  child.stderr.on("data", (chunk) => {
    stderrLog += chunk.toString("utf8");
  });

  child.on("error", (err) => {
    sendEvent("error", { message: `Failed to spawn OpenCode: ${err.message}` });
    response.end();
  });

  child.on("close", (code) => {
    const tEnd = Date.now();
    const totalSec = Math.max(0.001, (tEnd - tStart) / 1000);
    const startupSec = tFirstStep ? Math.max(0, (tFirstStep - tStart) / 1000) : 0;
    const ttftSec = tFirstContent ? Math.max(0, (tFirstContent - tStart) / 1000) : totalSec;

    const totalGeneratedTokens = totalReasoningTokens + totalOutputTokens;
    const genSec = Math.max(0.001, totalSec - startupSec);
    const tps = totalGeneratedTokens / genSec;

    if (code !== 0 && !fullContent && !toolsUsed.length) {
      sendEvent("error", {
        message: `OpenCode exited with code ${code}. Stderr: ${stderrLog.slice(0, 500) || "none"}`
      });
      return response.end();
    }

    sendEvent("done", {
      engine: "opencode",
      model: modelArg,
      variant: chosenVariant,
      startup_sec: Number(startupSec.toFixed(3)),
      ttft_sec: Number(ttftSec.toFixed(3)),
      thinking_dur_sec: Number(Math.max(0, ttftSec - startupSec).toFixed(3)),
      thinking_tokens: totalReasoningTokens,
      output_dur_sec: Number(Math.max(0, totalSec - ttftSec).toFixed(3)),
      output_tokens: totalOutputTokens,
      input_tokens: totalInputTokens,
      total_dur_sec: Number(totalSec.toFixed(3)),
      total_tokens: totalGeneratedTokens,
      steps: stepCount,
      tools: toolsUsed,
      tps: Number(tps.toFixed(1)),
      exit_code: code
    });
    response.end();
  });
}

async function runGatewayBench({ model, thinkingLevel, prompt, sendEvent, response }) {
  const { baseURL, apiKey } = await resolveGatewayConfig();
  if (!apiKey) {
    sendEvent("error", { message: "No API key configured in ~/.config/opencode/opencode.json" });
    return response.end();
  }

  let targetModel = model.replace(/^10router\//, "");
  if (targetModel.startsWith("ag/gemini-") && ["low", "medium", "high"].includes(thinkingLevel)) {
    const parts = targetModel.split("-");
    if (["low", "medium", "high"].includes(parts[parts.length - 1])) {
      parts[parts.length - 1] = thinkingLevel;
      targetModel = parts.join("-");
    } else {
      targetModel = `${targetModel}-${thinkingLevel}`;
    }
  }

  const payload = {
    model: targetModel,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    max_tokens: 1500
  };

  if (["low", "medium", "high"].includes(thinkingLevel)) {
    payload.reasoning_effort = thinkingLevel;
    payload.thinkingConfig = { thinkingLevel };
  }

  const tStart = Date.now();
  let tFirstToken = null;
  let tFirstContent = null;
  let tReasoningStart = null;
  let tReasoningEnd = null;

  let reasoningText = "";
  let contentText = "";
  let reportedReasoningTokens = null;
  let reportedOutputTokens = null;

  try {
    sendEvent("start", { engine: "gateway", model: targetModel, thinkingLevel, tStart });

    const upstream = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "opencode/1.18.25"
      },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      sendEvent("error", { message: `Gateway responded with ${upstream.status}: ${errText}` });
      return response.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          if (dataStr === "[DONE]") break;

          let chunk;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const now = Date.now();
          if (tFirstToken === null) {
            tFirstToken = now;
            sendEvent("ttft", { ttft_sec: Number(((tFirstToken - tStart) / 1000).toFixed(3)) });
          }

          const delta = chunk.choices?.[0]?.delta || {};
          const r = delta.reasoning_content || delta.thinking || "";
          const c = delta.content || "";

          if (r) {
            if (tReasoningStart === null) tReasoningStart = now;
            tReasoningEnd = now;
            reasoningText += r;
            sendEvent("reasoning", { text: r });
          }

          if (c) {
            if (tFirstContent === null) tFirstContent = now;
            contentText += c;
            sendEvent("content", { text: c });
          }

          const usage = chunk.usage;
          if (usage) {
            if (usage.completion_tokens_details?.reasoning_tokens !== undefined) {
              reportedReasoningTokens = usage.completion_tokens_details.reasoning_tokens;
            }
            if (usage.completion_tokens !== undefined) {
              reportedOutputTokens = usage.completion_tokens;
            }
          }
        }
      }
    }

    const tEnd = Date.now();
    const totalSec = Math.max(0.001, (tEnd - tStart) / 1000);
    const ttftSec = tFirstToken ? (tFirstToken - tStart) / 1000 : totalSec;

    const rTokens = reportedReasoningTokens ?? Math.max(Math.round(reasoningText.length / 4), reasoningText ? 1 : 0);
    const oTokens = reportedOutputTokens ?? Math.max(Math.round(contentText.length / 4), contentText ? 1 : 0);

    let thinkingDurSec = 0;
    if (reasoningText && tFirstContent) {
      thinkingDurSec = Math.max(0, (tFirstContent - tFirstToken) / 1000);
    } else if (reasoningText && tReasoningEnd && tReasoningStart) {
      thinkingDurSec = Math.max(0, (tReasoningEnd - tReasoningStart) / 1000);
    }

    const outputDurSec = Math.max(0, (tEnd - (tFirstContent || tFirstToken || tEnd)) / 1000);
    const totalTokens = rTokens + oTokens;
    const tps = totalTokens / totalSec;

    sendEvent("done", {
      engine: "gateway",
      model: targetModel,
      thinkingLevel,
      startup_sec: 0,
      ttft_sec: Number(ttftSec.toFixed(3)),
      thinking_dur_sec: Number(thinkingDurSec.toFixed(3)),
      thinking_tokens: rTokens,
      output_dur_sec: Number(outputDurSec.toFixed(3)),
      output_tokens: oTokens,
      total_dur_sec: Number(totalSec.toFixed(3)),
      total_tokens: totalTokens,
      steps: 1,
      tools: [],
      tps: Number(tps.toFixed(1))
    });
  } catch (err) {
    sendEvent("error", { message: err.message || "Streaming failed" });
  } finally {
    response.end();
  }
}
