import { createBenchLocalClient } from "@benchlocal/web-sdk";
import {
  DEFAULT_PROMPT,
  CONCURRENCY_OPTIONS,
  aggregateInstances,
  createMultimodalMessages,
  defaultPromptFor,
  formatDuration,
  formatRate,
  historyScore,
  summarizeTiming,
  usageFromStreamEvent,
  validateConcurrency,
  validateMedia,
  validateMediaDataUrl,
  videoFrameTimestamps
} from "./benchmark.js";
import "./styles.css";

const benchlocal = createBenchLocalClient({ requestTimeoutMs: 10 * 60 * 1000 });
const app = document.querySelector("#app");

const state = {
  models: [],
  media: null,
  mediaDataUrl: null,
  mediaUrl: null,
  mediaKind: null,
  results: null,
  preference: null,
  running: false,
  stopRequested: false,
  playback: false,
  runContext: null,
  mediaArtifact: null,
  concurrency: 1,
  prompt: DEFAULT_PROMPT,
  responseIndexes: { a: 0, b: 0 },
  videoFrames: null
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function modelOptions(selectedId) {
  return state.models
    .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedId ? "selected" : ""}>${escapeHtml(model.label || model.model)} · ${escapeHtml(model.provider)}</option>`)
    .join("");
}

function resultCard(side, result) {
  const label = side.toUpperCase();
  if (!result) {
    return `<article class="result-card" id="result-${side}"><header><span class="side">${label}</span><span class="status">Ready</span></header><div class="metrics"><div><small>TTFT</small><strong>—</strong></div><div><small>Decode TPS</small><strong>—</strong></div><div><small>Total</small><strong>—</strong></div><div><small>Output</small><strong>—</strong></div></div><div class="answer muted">Analysis appears here.</div></article>`;
  }
  const timing = result.timing || {};
  const instances = result.instances || [result];
  const selectedIndex = Math.min(state.responseIndexes[side] || 0, Math.max(0, instances.length - 1));
  const selected = instances[selectedIndex] || result;
  const progress = timing.requested ? `${timing.completed || 0}/${timing.requested}` : "";
  const outcome = timing.failed ? `${timing.failed} failed` : result.finished ? "Complete" : "Running";
  return `<article class="result-card ${result.error ? "failed" : ""}" id="result-${side}">
    <header><span class="side">${label}</span><strong>${escapeHtml(result.modelLabel)}</strong><span class="status">${progress} ${outcome}</span></header>
    <div class="metrics" aria-label="Speed measurements">
      <div title="Average time to first token across requests"><small>Avg TTFT</small><strong>${formatDuration(timing.ttftMs)}</strong></div>
      <div title="All output tokens divided by the overlapping decode window"><small>Aggregate TPS</small><strong>${formatRate(timing.tokensPerSecond)}</strong></div>
      <div title="Wall time for the concurrent batch"><small>Wall time</small><strong>${formatDuration(timing.totalMs)}</strong></div>
      <div><small>Output</small><strong>${timing.outputTokens ?? timing.outputCharacters ?? 0} ${timing.outputTokens == null ? "chars" : "tokens"}</strong></div>
    </div>
    ${instances.length > 1 ? `<div class="response-nav"><button data-response-nav="${side}" data-direction="-1" aria-label="Previous response" ${selectedIndex === 0 ? "disabled" : ""}>←</button><span>Response ${selectedIndex + 1} of ${instances.length}</span><button data-response-nav="${side}" data-direction="1" aria-label="Next response" ${selectedIndex === instances.length - 1 ? "disabled" : ""}>→</button></div>` : ""}
    <div class="answer">${escapeHtml(selected.error || selected.content || (selected.finished ? "No response text returned." : "Waiting for the first token…"))}</div>
  </article>`;
}

function render() {
  const first = state.models[0]?.id || "";
  const second = state.models[1]?.id || first;
  const selectedA = document.querySelector("#model-a")?.value || first;
  const selectedB = document.querySelector("#model-b")?.value || second;
  const prompt = state.running ? state.runContext?.prompt : state.prompt;
  const canRun = !state.running && state.mediaDataUrl && state.models.length >= 2;
  app.innerHTML = `<section class="shell">
    <header class="hero"><div><h1>Multimodal comparison</h1><p>One media input. Two models.</p></div><span id="bridge-status" class="bridge">${state.playback ? "History" : "Ready"}</span></header>
    <section class="setup ${state.playback ? "hidden" : ""}">
      <label id="media-drop" class="image-drop ${state.mediaUrl ? "has-image" : ""}">
        ${mediaPreview()}
        <input id="media-input" type="file" accept="image/*,audio/*,video/*" />
      </label>
      <div class="controls">
        <label>Prompt<textarea id="prompt" rows="3">${escapeHtml(prompt)}</textarea></label>
        <div class="model-grid">
          <label>Model A<select id="model-a">${modelOptions(selectedA)}</select></label>
          <label>Model B<select id="model-b">${modelOptions(selectedB)}</select></label>
        </div>
        <p class="model-note">Choose models that support this modality. Unsupported media is shown as a request error.</p>
        <label class="concurrency-control">Requests per model
          <select id="concurrency">${CONCURRENCY_OPTIONS.map((value) => `<option value="${value}" ${state.concurrency === value ? "selected" : ""}>${value} per model · ${value * 2} total</option>`).join("")}</select>
        </label>
        <button id="run-comparison" class="run" ${canRun ? "" : "disabled"}>${state.running ? "Comparing…" : "Compare models"}</button>
        <p id="error" class="error" role="alert"></p>
      </div>
    </section>
    <section class="results" aria-live="polite">${resultCard("a", state.results?.a)}${resultCard("b", state.results?.b)}</section>
    <section class="verdict ${state.results && !state.running ? "" : "hidden"}"><h2>Better analysis?</h2><div class="verdict-buttons"><button data-preference="a" class="${state.preference === "a" ? "chosen" : ""}">A</button><button data-preference="tie" class="${state.preference === "tie" ? "chosen" : ""}">Tie</button><button data-preference="b" class="${state.preference === "b" ? "chosen" : ""}">B</button></div><span id="save-status">${state.preference ? "Saved" : ""}</span></section>
  </section>`;
  bindEvents();
}

function mediaPreview() {
  if (!state.mediaUrl) return `<span class="upload-mark">＋</span><strong>Add image, audio, or video</strong><small>Choose or drop a media file</small>`;
  if (state.mediaKind === "image") return `<img src="${state.mediaUrl}" alt="Uploaded image input" />`;
  if (state.mediaKind === "audio") return `<div class="media-player"><span class="media-kind">Audio</span><audio src="${state.mediaUrl}" controls></audio><small>${escapeHtml(state.media?.name)}</small></div>`;
  return `<div class="media-player"><span class="media-kind">Video</span><video src="${state.mediaUrl}" controls></video><small>${escapeHtml(state.media?.name)}</small></div>`;
}

function showError(message) {
  const element = document.querySelector("#error");
  if (element) element.textContent = message;
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read the media file."));
    reader.readAsDataURL(file);
  });
}

async function chooseMedia(file) {
  const kind = validateMedia(file);
  if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
  state.media = file;
  state.mediaDataUrl = await fileToDataUrl(file);
  state.mediaUrl = URL.createObjectURL(file);
  state.mediaKind = kind;
  state.mediaArtifact = null;
  state.videoFrames = null;
  state.prompt = defaultPromptFor(kind);
  state.runContext = null;
  state.results = null;
  state.preference = null;
  render();
}

async function sampleVideoFrames(videoUrl) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = videoUrl;
  await new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("Could not decode the selected video.")), { once: true });
  });
  if (video.readyState < 2) {
    await new Promise((resolve, reject) => {
      video.addEventListener("loadeddata", resolve, { once: true });
      video.addEventListener("error", () => reject(new Error("Could not decode video frames.")), { once: true });
    });
  }
  const timestamps = videoFrameTimestamps(video.duration);
  const longestSide = 960;
  const scale = Math.min(1, longestSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  const frames = [];
  for (const timestamp of timestamps) {
    const targetTime = Math.min(timestamp, Math.max(0, video.duration - 0.05));
    if (Math.abs(video.currentTime - targetTime) > 0.001) {
      video.currentTime = targetTime;
      await new Promise((resolve, reject) => {
        video.addEventListener("seeked", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("Could not seek through the selected video.")), { once: true });
      });
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", 0.86));
  }
  video.removeAttribute("src");
  video.load();
  return frames;
}

function refreshSideResult(side) {
  const result = state.results[side];
  const instances = result.instances;
  const representative = instances.find((item) => item.content) || instances[0] || {};
  const errors = instances.filter((item) => item.error);
  result.content = representative.content || "";
  result.timing = aggregateInstances(instances);
  result.finished = instances.every((item) => item.finished);
  result.error = errors.length === instances.length && instances.length
    ? errors.map((item) => item.error).join(" · ")
    : null;
}

function updateInstance(side, instanceIndex, values) {
  state.results[side].instances[instanceIndex] = {
    ...state.results[side].instances[instanceIndex],
    ...values
  };
  refreshSideResult(side);
}

async function runModelInstance(model, prompt, mediaDataUrl, mediaType, videoFrames, side, instanceIndex) {
  const startedAt = performance.now();
  let firstTokenAt = null;
  let content = "";
  let usage;
  updateInstance(side, instanceIndex, { content, timing: {}, startedAt, firstTokenAt, finishedAt: null, finished: false });
  try {
    for await (const event of benchlocal.inference.streamChat({
      modelId: model.id,
      messages: createMultimodalMessages(prompt, mediaDataUrl, mediaType, videoFrames),
      generation: {
        temperature: 0,
        max_tokens: 1024,
        request_timeout_seconds: 300,
        extra_body: { stream_options: { include_usage: true } }
      },
      metadata: { benchmark: "multimodal-arena", modality: state.mediaKind, side }
    })) {
      if (state.stopRequested) throw new Error("Stopped by user.");
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "delta" && event.content) {
        if (firstTokenAt == null) firstTokenAt = performance.now();
        content += event.content;
      }
      usage = usageFromStreamEvent(event) || usage;
      if (event.type === "done") {
        if (!content && event.content) content = event.content;
        usage = event.usage || usage;
      }
      const finishedAt = performance.now();
      updateInstance(side, instanceIndex, { content, usage, firstTokenAt, finishedAt, timing: summarizeTiming({ startedAt, firstTokenAt, finishedAt, content, usage }) });
      render();
    }
    const finishedAt = performance.now();
    updateInstance(side, instanceIndex, { content, finished: true, usage, firstTokenAt, finishedAt, timing: summarizeTiming({ startedAt, firstTokenAt, finishedAt, content, usage }) });
  } catch (error) {
    const finishedAt = performance.now();
    updateInstance(side, instanceIndex, { content, finished: true, error: error instanceof Error ? error.message : String(error), firstTokenAt, finishedAt, timing: summarizeTiming({ startedAt, firstTokenAt, finishedAt, content, usage }) });
  }
  render();
  return state.results[side].instances[instanceIndex];
}

async function saveHistory(status = "completed") {
  const metadata = {
    prompt: state.runContext?.prompt || state.prompt,
    preference: state.preference,
    media: state.media ? { name: state.media.name, type: state.media.type, size: state.media.size, kind: state.mediaKind } : undefined,
    results: state.results,
    concurrency: state.runContext?.concurrency || state.concurrency
  };
  const artifacts = [];
  if (state.mediaArtifact) {
    artifacts.push(state.mediaArtifact);
  } else if (state.media && status === "completed") {
    state.mediaArtifact = await benchlocal.history.writeArtifact({ kind: state.mediaKind, label: `Compared ${state.mediaKind}`, path: `input-${state.media.name}`, contentType: state.media.type, content: await state.media.arrayBuffer() });
    artifacts.push(state.mediaArtifact);
  }
  await benchlocal.history.save({ status, score: historyScore(state.preference), metadata, artifacts });
}

async function runComparison(input = {}) {
  if (state.running) throw new Error("A comparison is already running.");
  const modelAId = input.modelAId || document.querySelector("#model-a")?.value;
  const modelBId = input.modelBId || document.querySelector("#model-b")?.value;
  let prompt = input.prompt || state.prompt;
  const concurrency = validateConcurrency(input.concurrency ?? state.concurrency);
  const suppliedMediaDataUrl = input.mediaDataUrl || input.imageDataUrl;
  const mediaDataUrl = suppliedMediaDataUrl || state.mediaDataUrl;
  if (!mediaDataUrl) throw new Error("Choose a media file first.");
  if (suppliedMediaDataUrl) {
    const mediaInfo = validateMediaDataUrl(suppliedMediaDataUrl);
    const mediaBlob = await (await fetch(suppliedMediaDataUrl)).blob();
    validateMedia(mediaBlob);
    const extension = mediaBlob.type.split("/")[1]?.replace("jpeg", "jpg").replace("mpeg", "mp3") || "bin";
    state.media = new File([mediaBlob], `agent-input.${extension}`, { type: mediaBlob.type });
    state.mediaDataUrl = suppliedMediaDataUrl;
    state.mediaKind = mediaInfo.kind;
    state.mediaArtifact = null;
    state.videoFrames = null;
    if (!input.prompt) {
      prompt = defaultPromptFor(mediaInfo.kind);
      state.prompt = prompt;
    }
  }
  const mediaType = state.media?.type || mediaDataUrl.slice(5, mediaDataUrl.indexOf(";"));
  if (!modelAId || !modelBId) throw new Error("Choose two models.");
  if (modelAId === modelBId) throw new Error("Choose two different models.");
  const modelA = state.models.find((model) => model.id === modelAId);
  const modelB = state.models.find((model) => model.id === modelBId);
  if (!modelA || !modelB) throw new Error("One of the selected models is unavailable.");
  state.running = true;
  render();
  let videoFrames = [];
  try {
    if (state.mediaKind === "video") {
      state.videoFrames ||= await sampleVideoFrames(mediaDataUrl);
      videoFrames = state.videoFrames;
    }
  } catch (error) {
    state.running = false;
    render();
    throw error;
  }
  state.stopRequested = false;
  state.concurrency = concurrency;
  state.results = {
    a: { modelId: modelA.id, modelLabel: modelA.label || modelA.model, instances: Array.from({ length: concurrency }, () => ({ content: "", timing: {}, finished: false })), timing: { completed: 0, requested: concurrency }, finished: false },
    b: { modelId: modelB.id, modelLabel: modelB.label || modelB.model, instances: Array.from({ length: concurrency }, () => ({ content: "", timing: {}, finished: false })), timing: { completed: 0, requested: concurrency }, finished: false }
  };
  state.preference = null;
  state.responseIndexes = { a: 0, b: 0 };
  state.runContext = { prompt, modelAId, modelBId, concurrency };
  render();
  let runStateStarted = false;
  try {
    await benchlocal.runs.startState({ message: `Running ${concurrency * 2} ${state.mediaKind} analyses.`, metadata: { modelAId, modelBId, concurrency, modality: state.mediaKind } });
    runStateStarted = true;
    const requests = [];
    for (let index = 0; index < concurrency; index += 1) {
      requests.push(runModelInstance(modelA, prompt, mediaDataUrl, mediaType, videoFrames, "a", index));
      requests.push(runModelInstance(modelB, prompt, mediaDataUrl, mediaType, videoFrames, "b", index));
    }
    await Promise.all(requests);
    const results = [state.results.a, state.results.b];
    state.running = false;
    await saveHistory(state.stopRequested ? "cancelled" : "completed");
    const failedRequests = state.results.a.timing.failed + state.results.b.timing.failed;
    await benchlocal.runs.updateProgress({ status: state.stopRequested ? "cancelled" : "completed", progress: 1, message: failedRequests ? `Comparison complete with ${failedRequests} failed request${failedRequests === 1 ? "" : "s"}.` : "Comparison complete. Waiting for human verdict." });
    render();
    return results;
  } finally {
    state.running = false;
    if (runStateStarted) await benchlocal.runs.stopState({ message: state.stopRequested ? "Comparison stopped." : "Comparison complete." });
    render();
  }
}

async function setPreference(preference) {
  if (!["a", "b", "tie"].includes(preference)) throw new Error("Preference must be a, b, or tie.");
  state.preference = preference;
  render();
  await saveHistory("completed");
}

function bindEvents() {
  document.querySelector("#media-input")?.addEventListener("change", (event) => chooseMedia(event.target.files?.[0]).catch((error) => showError(error.message)));
  document.querySelector("#prompt")?.addEventListener("input", (event) => { state.prompt = event.target.value; });
  document.querySelectorAll("audio, video").forEach((player) => player.addEventListener("click", (event) => event.stopPropagation()));
  const drop = document.querySelector("#media-drop");
  drop?.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragging"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("dragging"));
  drop?.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("dragging"); chooseMedia(event.dataTransfer?.files?.[0]).catch((error) => showError(error.message)); });
  document.querySelector("#run-comparison")?.addEventListener("click", () => runComparison().catch((error) => { state.running = false; render(); showError(error.message); }));
  document.querySelector("#concurrency")?.addEventListener("change", (event) => { state.concurrency = validateConcurrency(event.target.value); render(); });
  document.querySelectorAll("[data-response-nav]").forEach((button) => button.addEventListener("click", () => {
    const side = button.dataset.responseNav;
    const count = state.results?.[side]?.instances?.length || 1;
    state.responseIndexes[side] = Math.max(0, Math.min(count - 1, state.responseIndexes[side] + Number(button.dataset.direction)));
    render();
  }));
  document.querySelectorAll("[data-preference]").forEach((button) => button.addEventListener("click", () => setPreference(button.dataset.preference).catch((error) => showError(error.message))));
}

async function initialize() {
  const environment = await benchlocal.environment.detect({ timeoutMs: 800 });
  if (!environment.isInsideBenchLocal) {
    app.innerHTML = `<section class="standalone"><p class="eyebrow">Multimodal Arena</p><h1>Open this pack inside BenchLocal</h1><p>This page uses BenchLocal's private bridge for models, inference, and history. Start the dev server, install <code>benchlocal.pack.json</code>, and open the pack from BenchLocal.</p></section>`;
    return;
  }
  const capabilities = await benchlocal.capabilities();
  if (capabilities.history?.mode === "history") {
    state.playback = true;
    const history = await benchlocal.history.load();
    state.results = history.payload?.metadata?.results || null;
    state.preference = history.payload?.metadata?.preference || null;
    render();
    return;
  }
  const listed = await benchlocal.models.list();
  state.models = listed.models.filter((model) => model.enabled);
  render();
  benchlocal.models.onChanged((event) => { state.models = event.models.filter((model) => model.enabled); render(); });
  benchlocal.runs.onStopRequested(() => { state.stopRequested = true; });
  const agentApi = Object.freeze({ run: runComparison, setPreference, getState: () => structuredClone({ ...state, media: undefined, mediaUrl: undefined }) });
  window.multimodalArena = agentApi;
  // Backward-compatible alias for existing image-only automation.
  window.imageDescriptionArena = agentApi;
}

initialize().catch((error) => { app.innerHTML = `<section class="standalone"><h1>Could not open the pack</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section>`; });
