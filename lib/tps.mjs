import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

export function createTpsMeasurement() {
  const steps = new Map();
  let firstText;
  let result;

  return {
    add(event, time) {
      if (event?.event === "result") {
        result = event.result;
        return "";
      }
      if (event?.event !== "step_update") return "";
      const step = event.step_update;
      if (step?.step_type !== "agent_response" || !Number.isInteger(step.step_index)) return "";
      if (step.state !== "ACTIVE" && step.state !== "DONE") return "";

      const key = `${step.conversation_id ?? ""}:${step.step_index}`;
      let record = steps.get(key);
      if (!record) {
        record = {};
        steps.set(key, record);
      }
      if (record.done) return "";

      const text = typeof step.text_delta === "string"
        ? step.text_delta.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "") : "";
      if (text.trim()) {
        record.first ??= time;
        record.last = time;
        firstText ??= time;
      }
      if (step.state === "DONE") {
        record.done = true;
        record.tokens = step.usage?.output_tokens;
      }
      return text;
    },

    summarize() {
      let outputTokens = 0;
      let durationMs = 0;
      let measuredSteps = 0;
      let textSteps = 0;
      for (const { first, last, done, tokens } of steps.values()) {
        if (!done || first == null) continue;
        textSteps += 1;
        if (last <= first || !Number.isSafeInteger(tokens) || tokens <= 0) continue;
        outputTokens += tokens;
        durationMs += last - first;
        measuredSteps += 1;
      }
      return {
        status: result?.status,
        firstText,
        measuredSteps,
        textSteps,
        outputTokens,
        durationMs,
        rate: durationMs > 0 ? 1000 * outputTokens / durationMs : null,
      };
    },
  };
}

export async function runTps({ prompt, model, stdout = process.stdout, stderr = process.stderr }) {
  const args = [`--print=${prompt}`, "--output-format", "stream-json"];
  if (model) args.push("--model", model);
  const start = performance.now();
  const child = spawn("agy", args, { stdio: ["ignore", "pipe", "pipe"] });
  const measurement = createTpsMeasurement();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let streamError;
  let wroteText = false;
  let lastText = "";
  lines.on("line", (line) => {
    const time = performance.now() - start;
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      streamError ??= "agy produced non-JSON output";
      return;
    }
    const text = measurement.add(event, time);
    if (text) {
      stdout.write(text);
      wroteText = true;
      lastText = text;
    }
  });
  lines.on("error", error => { streamError ??= error.message; });
  child.stderr.on("data", chunk => stderr.write(chunk));

  const interrupt = () => { child.kill("SIGINT"); };
  const terminate = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    stderr.write(error.code === "ENOENT" ? "tps: agy was not found on PATH\n" : `tps: ${error.message}\n`);
    return error.code === "ENOENT" ? 127 : 1;
  } finally {
    lines.close();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }

  if (wroteText && !lastText.endsWith("\n")) stdout.write("\n");
  const summary = measurement.summarize();
  if (exit.code !== 0 || streamError || summary.status !== "SUCCESS") {
    const failure = streamError || (exit.signal ? `agy stopped with ${exit.signal}` :
      exit.code ? `agy exited with code ${exit.code}` : `agy result ${summary.status ?? "missing"}`);
    stderr.write(`tps: ${failure}\n`);
    return exit.code || (exit.signal === "SIGINT" ? 130 : exit.signal === "SIGTERM" ? 143 : 1);
  }

  if (summary.firstText != null) stderr.write(`First visible text: ${(summary.firstText / 1000).toFixed(2)} s after agy launch\n`);
  if (summary.rate == null) {
    stderr.write("Average TPS unavailable: no completed response had both timed text chunks and output token counts.\n");
  } else {
    stderr.write(`Estimated average TPS: ${summary.rate.toFixed(2)} tok/s (${summary.outputTokens} output tokens, ${(summary.durationMs / 1000).toFixed(2)} s, ${summary.measuredSteps}/${summary.textSteps} response steps)\n`);
  }
  return 0;
}
