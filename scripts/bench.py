#!/usr/bin/env python3
"""
scripts/bench.py — OpenCode Model + Thinking Speed & Latency Benchmark

Measures:
- OpenCode startup / bootstrap time
- TTFT (Time to First Token)
- Thinking / Reasoning duration & token count
- Output generation duration & token count
- Step count & Agent tool calls
- Throughput (tokens/sec)
- Total wall-clock turnaround

Supports:
- --engine opencode (default: runs real OpenCode agent runtime)
- --engine gateway (direct API baseline)
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

PRESETS = {
    "spec": """# Kokolog Monitor: BLE Auto-Connect & Fault Recovery Specification
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
""",
    "bug": """// Identify the bug and fix the missing state mapping in this Dart reducer snippet:
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
// Task: Explain the defect in 2 sentences and output the corrected Dart code block.
""",
    "arch": """Explain the handoff contract in an autonomous coding loop between:
1. Implementer (maker)
2. Reviewer / Assurance (checker)
3. Gardener (ticket backfill)
4. Decision Desk (human gates)

State plainly what an implementer must do when encountering a stale test or an adjacent bug.
"""
}

def load_opencode_config():
    paths = [
        os.path.expanduser("~/.config/opencode/opencode.json"),
        os.path.expanduser("~/.opencode/opencode.json"),
    ]
    for p in paths:
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {}

def resolve_gateway():
    cfg = load_opencode_config()
    p10 = cfg.get("provider", {}).get("10router", {})
    opts = p10.get("options", {})
    base_url = opts.get("baseURL", "https://ai.zcloud.my/v1").rstrip("/")
    api_key = opts.get("apiKey", os.environ.get("OPENCODE_API_KEY", ""))
    return base_url, api_key

def run_opencode_bench(model, variant="high", prompt="hi", verbose=False):
    opencode_bin = os.environ.get("OPENCODE_BIN", "/Users/zafar/.opencode/bin/opencode")
    if not os.path.isfile(opencode_bin):
        print(f"Error: OpenCode binary not found at {opencode_bin}", file=sys.stderr)
        return None

    model_arg = model
    if not model_arg.startswith("10router/") and "/" not in model_arg:
        model_arg = f"10router/{model_arg}"

    os.makedirs("/tmp/bench-isolated", exist_ok=True)
    cmd = [
        opencode_bin,
        "run",
        "--dir", "/tmp/bench-isolated",
        "--pure",
        "--model", model_arg
    ]
    if variant and variant != "none":
        cmd.extend(["--variant", variant])
    cmd.extend(["--format", "json", "--title", f"bench-{int(time.time())}", "--", prompt])

    env = os.environ.copy()
    env["OPENCODE_DB"] = "/tmp/bench-opencode.db"
    env["OPENCODE_CONFIG_CONTENT"] = '{"plugin":[],"mcp":{"google-docs":{"enabled":false}}}'
    env["OPENCODE_PERMISSION"] = '{"edit":"deny","task":"deny","external_directory":"deny","bash":"deny"}'

    t_start = time.time()
    t_first_step = None
    t_first_content = None

    step_count = 0
    tools_used = []
    total_reasoning_tokens = 0
    total_output_tokens = 0
    full_content = []

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            env=env,
            text=True
        )

        for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except Exception:
                continue

            now = time.time()
            ev_type = event.get("type")
            part = event.get("part", {})

            if ev_type == "step_start":
                step_count += 1
                if t_first_step is None:
                    t_first_step = now
                if verbose:
                    sys.stdout.write(f"\n\033[36m[Step {step_count} Start]\033[0m\n")
                    sys.stdout.flush()
            elif ev_type == "text":
                if t_first_content is None:
                    t_first_content = now
                txt = part.get("text", "")
                if txt:
                    full_content.append(txt)
                    if verbose:
                        sys.stdout.write(txt)
                        sys.stdout.flush()
            elif ev_type == "tool_use":
                if t_first_content is None:
                    t_first_content = now
                tool_name = part.get("tool") or part.get("name") or "tool"
                tools_used.append(tool_name)
                if verbose:
                    sys.stdout.write(f"\033[33m[Tool: {tool_name}]\033[0m ")
                    sys.stdout.flush()
            elif ev_type == "step_finish":
                toks = part.get("tokens", {})
                total_reasoning_tokens += toks.get("reasoning", 0)
                total_output_tokens += toks.get("output", 0)
                if verbose:
                    sys.stdout.write(f"\n\033[90m[Step {step_count} Finish: {toks.get('reasoning',0)} r-tok, {toks.get('output',0)} out-tok]\033[0m\n")
                    sys.stdout.flush()

        proc.wait()
    except Exception as e:
        print(f"\nOpenCode execution error: {e}", file=sys.stderr)
        return None

    t_end = time.time()
    total_time = max(0.001, t_end - t_start)
    startup_sec = (t_first_step - t_start) if t_first_step else 0.0
    ttft_sec = (t_first_content - t_start) if t_first_content else total_time

    total_tokens = total_reasoning_tokens + total_output_tokens
    gen_time = max(0.001, total_time - startup_sec)
    tps = (total_tokens / gen_time) if gen_time > 0 else 0.0

    return {
        "engine": "opencode",
        "model": model_arg,
        "variant": variant,
        "startup_sec": startup_sec,
        "ttft_sec": ttft_sec,
        "thinking_dur_sec": max(0.0, ttft_sec - startup_sec),
        "thinking_tokens": total_reasoning_tokens,
        "output_dur_sec": max(0.0, total_time - ttft_sec),
        "output_tokens": total_output_tokens,
        "steps": step_count,
        "tools": tools_used,
        "total_dur_sec": total_time,
        "total_tokens": total_tokens,
        "tps": tps,
        "exit_code": proc.returncode,
        "content": "".join(full_content)
    }

def run_gateway_bench(model, thinking_level="high", prompt="hi", verbose=False):
    base_url, api_key = resolve_gateway()
    if not api_key:
        print("Error: No API key found in ~/.config/opencode/opencode.json or OPENCODE_API_KEY", file=sys.stderr)
        return None

    target_model = model.replace("10router/", "")
    if target_model.startswith("ag/gemini-") and thinking_level in ("low", "medium", "high"):
        parts = target_model.split("-")
        if parts[-1] in ("low", "medium", "high"):
            parts[-1] = thinking_level
            target_model = "-".join(parts)
        else:
            target_model = f"{target_model}-{thinking_level}"

    payload = {
        "model": target_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "max_tokens": 1500
    }

    if thinking_level in ("low", "medium", "high"):
        payload["reasoning_effort"] = thinking_level
        payload["thinkingConfig"] = {"thinkingLevel": thinking_level}

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "opencode/1.18.25"
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)

    t_start = time.time()
    t_first_token = None
    t_first_content = None
    t_reasoning_start = None
    t_reasoning_end = None

    reasoning_text = []
    content_text = []
    reasoning_tokens_reported = None
    output_tokens_reported = None

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except Exception:
                        continue

                    now = time.time()
                    if t_first_token is None:
                        t_first_token = now

                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        r = delta.get("reasoning_content") or delta.get("thinking") or ""
                        c = delta.get("content") or ""

                        if r:
                            if t_reasoning_start is None:
                                t_reasoning_start = now
                            t_reasoning_end = now
                            reasoning_text.append(r)
                            if verbose:
                                sys.stdout.write(f"\033[90m{r}\033[0m")
                                sys.stdout.flush()

                        if c:
                            if t_first_content is None:
                                t_first_content = now
                            content_text.append(c)
                            if verbose:
                                sys.stdout.write(c)
                                sys.stdout.flush()

                    usage = chunk.get("usage")
                    if usage:
                        comp_details = usage.get("completion_tokens_details", {})
                        reasoning_tokens_reported = comp_details.get("reasoning_tokens")
                        output_tokens_reported = usage.get("completion_tokens")
    except Exception as e:
        print(f"\nGateway API Error: {e}", file=sys.stderr)
        return None

    t_end = time.time()
    total_time = max(0.001, t_end - t_start)
    ttft = (t_first_token - t_start) if t_first_token else total_time

    full_reasoning = "".join(reasoning_text)
    full_content = "".join(content_text)

    r_tokens = reasoning_tokens_reported if reasoning_tokens_reported is not None else max(len(full_reasoning) // 4, 1 if full_reasoning else 0)
    o_tokens = output_tokens_reported if output_tokens_reported is not None else max(len(full_content) // 4, 1 if full_content else 0)

    if full_reasoning and t_first_content:
        thinking_dur = max(0.0, t_first_content - t_first_token)
    elif full_reasoning and t_reasoning_end and t_reasoning_start:
        thinking_dur = max(0.0, t_reasoning_end - t_reasoning_start)
    else:
        thinking_dur = 0.0

    output_dur = max(0.0, t_end - (t_first_content or t_first_token or t_end))
    total_tokens = r_tokens + o_tokens
    tps = (total_tokens / total_time) if total_time > 0 else 0.0

    return {
        "engine": "gateway",
        "model": target_model,
        "variant": thinking_level,
        "startup_sec": 0.0,
        "ttft_sec": ttft,
        "thinking_dur_sec": thinking_dur,
        "thinking_tokens": r_tokens,
        "output_dur_sec": output_dur,
        "output_tokens": o_tokens,
        "steps": 1,
        "tools": [],
        "total_dur_sec": total_time,
        "total_tokens": total_tokens,
        "tps": tps,
        "exit_code": 0,
        "content": full_content
    }

def print_table(results):
    header = f"{'Engine':8s} | {'Model':30s} | {'Variant':7s} | {'Startup':7s} | {'TTFT':6s} | {'Think(s)':8s} | {'R-Tok':7s} | {'Gen(s)':6s} | {'Out-Tok':7s} | {'Steps':5s} | {'Total':6s} | {'Speed':8s}"
    sep = "-" * len(header)
    print("\n" + header)
    print(sep)
    for r in results:
        if not r: continue
        startup_str = f"{r['startup_sec']:5.2f}s" if r['startup_sec'] > 0 else "   -   "
        print(f"{r['engine']:8s} | {r['model']:30s} | {r['variant']:7s} | {startup_str:7s} | {r['ttft_sec']:5.2f}s | {r['thinking_dur_sec']:7.2f}s | {r['thinking_tokens']:7d} | {r['output_dur_sec']:5.2f}s | {r['output_tokens']:7d} | {r.get('steps',1):5d} | {r['total_dur_sec']:5.2f}s | {r['tps']:6.1f} t/s")
    print(sep + "\n")

def main():
    parser = argparse.ArgumentParser(description="OpenCode Model + Thinking Speed & Latency Benchmark")
    parser.add_argument("--engine", "-e", choices=["opencode", "gateway"], default="opencode", help="Engine to benchmark: 'opencode' (default) or 'gateway'")
    parser.add_argument("--model", "-m", default="combo-coding", help="Model name (e.g. combo-coding, 10router/ag/gemini-3.8-flash-high, cx/gpt-5.6-sol)")
    parser.add_argument("--variant", "-t", default="high", help="Model variant / thinking level (e.g. high, medium, low, max, none)")
    parser.add_argument("--preset", "-p", choices=["spec", "bug", "arch"], default="bug", help="Use preset prompt (spec, bug, arch)")
    parser.add_argument("--prompt", help="Custom prompt string")
    parser.add_argument("--compare", "-c", action="store_true", help="Run comparison matrix of popular models & thinking levels")
    parser.add_argument("--verbose", "-v", action="store_true", help="Stream response live to terminal")

    args = parser.parse_args()
    prompt = args.prompt or PRESETS[args.preset]

    if args.compare:
        print(f"=== Running Comparison Matrix [{args.engine.upper()}] on Preset '{args.preset}' ===")
        combos = [
            ("10router/ag/gemini-3.8-flash-high", "high"),
            ("10router/ag/gemini-3.8-flash-medium", "medium"),
            ("10router/ag/gemini-3.7-flash-high", "high"),
            ("10router/combo-coding", "high"),
        ]
        results = []
        for mod, vr in combos:
            print(f"Testing {mod} [{vr}]...", end="", flush=True)
            if args.engine == "opencode":
                res = run_opencode_bench(mod, vr, prompt=prompt, verbose=False)
            else:
                res = run_gateway_bench(mod, vr, prompt=prompt, verbose=False)

            if res:
                print(f" done in {res['total_dur_sec']:.2f}s ({res['tps']:.1f} tps)")
                results.append(res)
            else:
                print(" FAILED")
        print_table(results)
    else:
        print(f"Testing [{args.engine.upper()}] {args.model} [variant={args.variant}] on preset '{args.preset}'...")
        if args.engine == "opencode":
            res = run_opencode_bench(args.model, args.variant, prompt=prompt, verbose=args.verbose)
        else:
            res = run_gateway_bench(args.model, args.variant, prompt=prompt, verbose=args.verbose)

        if res:
            print_table([res])
        else:
            print("Benchmark failed.")

if __name__ == "__main__":
    main()
