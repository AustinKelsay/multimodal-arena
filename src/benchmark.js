export const DEFAULT_PROMPT =
  "Describe this image. Include the main subjects, actions, setting, visible text, and important details.";

export const DEFAULT_PROMPTS = {
  image: DEFAULT_PROMPT,
  audio: "Describe this audio. Include speech, speakers, sounds, music, and important details.",
  video: "Describe this video from the sampled frames. Include subjects, actions, setting, visible text, and important visual details."
};

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16];

export function validateConcurrency(value) {
  const concurrency = Number(value);
  if (!CONCURRENCY_OPTIONS.includes(concurrency)) {
    throw new Error(`Concurrency must be one of: ${CONCURRENCY_OPTIONS.join(", ")}.`);
  }
  return concurrency;
}

export function mediaKindFromType(type = "") {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return null;
}

export function defaultPromptFor(kind) {
  return DEFAULT_PROMPTS[kind] || DEFAULT_PROMPT;
}

export function validateMedia(file) {
  if (!file) throw new Error("Choose a media file first.");
  const kind = mediaKindFromType(file.type);
  if (!kind) throw new Error("The selected file must be an image, audio, or video file.");
  const maximum = kind === "image" ? MAX_IMAGE_BYTES : kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maximum) throw new Error(`The ${kind} must be ${maximum / 1024 / 1024} MB or smaller.`);
  return kind;
}

export function validateImage(file) {
  if (!file) throw new Error("Choose an image first.");
  if (mediaKindFromType(file.type) !== "image") throw new Error("The selected file is not an image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The image must be 15 MB or smaller.");
}

export function validateMediaDataUrl(value) {
  const match = typeof value === "string" && value.match(/^data:((?:image|audio|video)\/[a-z0-9.+-]+);base64,/i);
  if (!match) {
    throw new Error("mediaDataUrl must be a base64 image, audio, or video data URL.");
  }
  const kind = mediaKindFromType(match[1].toLowerCase());
  const encoded = value.slice(value.indexOf(",") + 1).replace(/\s/g, "");
  const approximateBytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  const maximum = kind === "image" ? MAX_IMAGE_BYTES : kind === "audio" ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (approximateBytes > maximum) throw new Error(`The ${kind} must be ${maximum / 1024 / 1024} MB or smaller.`);
  return { kind, type: match[1].toLowerCase() };
}

export function validateImageDataUrl(value) {
  if (typeof value !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    throw new Error("imageDataUrl must be a base64 image data URL.");
  }
  validateMediaDataUrl(value);
}

export function createVisionMessages(prompt, imageDataUrl) {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: prompt.trim() },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }
      ]
    }
  ];
}

function audioFormat(type) {
  const subtype = type.split("/")[1]?.toLowerCase() || "wav";
  return ({ "x-wav": "wav", wave: "wav", mpeg: "mp3", "x-m4a": "m4a" })[subtype] || subtype.split(";")[0];
}

export function videoFrameTimestamps(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Video duration is unavailable.");
  const finalCompleteInterval = Math.max(0, durationSeconds - 1);
  if (durationSeconds <= 4) {
    return Array.from({ length: Math.min(4, Math.max(1, Math.ceil(durationSeconds))) }, (_, index) => index);
  }
  return Array.from({ length: 4 }, (_, index) => (finalCompleteInterval * index) / 3);
}

export function createMultimodalMessages(prompt, mediaDataUrl, mediaType, videoFrames = []) {
  const kind = mediaKindFromType(mediaType);
  if (kind === "image") return createVisionMessages(prompt, mediaDataUrl);
  if (kind === "audio") {
    return [{ role: "user", content: [
      { type: "text", text: prompt.trim() },
      { type: "input_audio", input_audio: { data: mediaDataUrl.slice(mediaDataUrl.indexOf(",") + 1), format: audioFormat(mediaType) } }
    ] }];
  }
  if (kind === "video") {
    if (videoFrames.length) {
      return [{ role: "user", content: [
        { type: "text", text: prompt.trim() },
        ...videoFrames.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } }))
      ] }];
    }
    return [{ role: "user", content: [
      { type: "text", text: prompt.trim() },
      { type: "video_url", video_url: { url: mediaDataUrl } }
    ] }];
  }
  throw new Error("Unsupported media type.");
}

export function summarizeTiming({ startedAt, firstTokenAt, finishedAt, content, usage }) {
  const totalMs = Math.max(0, finishedAt - startedAt);
  const ttftMs = firstTokenAt == null ? null : Math.max(0, firstTokenAt - startedAt);
  const generationMs = firstTokenAt == null ? totalMs : Math.max(0, finishedAt - firstTokenAt);
  const outputTokens = Number(
    usage?.completion_tokens ?? usage?.output_tokens ?? usage?.completionTokens ?? usage?.outputTokens
  );
  const hasTokens = Number.isFinite(outputTokens) && outputTokens >= 0;
  return {
    ttftMs,
    totalMs,
    generationMs,
    outputCharacters: content.length,
    outputTokens: hasTokens ? outputTokens : null,
    tokensPerSecond: hasTokens && generationMs > 0 ? outputTokens / (generationMs / 1000) : null
  };
}

export function aggregateInstances(instances = []) {
  const successful = instances.filter((item) => item.finished && !item.error);
  const started = instances.map((item) => item.startedAt).filter(Number.isFinite);
  const firstTokens = successful.map((item) => item.firstTokenAt).filter(Number.isFinite);
  const finished = instances.map((item) => item.finishedAt).filter(Number.isFinite);
  const successfulFinished = successful.map((item) => item.finishedAt).filter(Number.isFinite);
  const ttfts = successful.map((item) => item.timing?.ttftMs).filter(Number.isFinite);
  const tokenCounts = successful.map((item) => item.timing?.outputTokens);
  const hasCompleteTokenUsage = tokenCounts.length > 0 && tokenCounts.every(Number.isFinite);
  const outputTokens = hasCompleteTokenUsage ? tokenCounts.reduce((sum, count) => sum + count, 0) : null;
  const decodeSpanMs = firstTokens.length && successfulFinished.length
    ? Math.max(0, Math.max(...successfulFinished) - Math.min(...firstTokens))
    : null;
  return {
    ttftMs: ttfts.length ? ttfts.reduce((sum, value) => sum + value, 0) / ttfts.length : null,
    totalMs: started.length && finished.length ? Math.max(0, Math.max(...finished) - Math.min(...started)) : null,
    generationMs: decodeSpanMs,
    outputCharacters: instances.reduce((sum, item) => sum + (item.content?.length || 0), 0),
    outputTokens,
    tokensPerSecond: outputTokens != null && decodeSpanMs > 0 ? outputTokens / (decodeSpanMs / 1000) : null,
    completed: instances.filter((item) => item.finished).length,
    succeeded: successful.length,
    failed: instances.filter((item) => item.finished && item.error).length,
    requested: instances.length
  };
}

export function usageFromStreamEvent(event) {
  const usage = event?.usage ?? event?.raw?.usage;
  return usage && typeof usage === "object" ? usage : undefined;
}

export function historyScore(preference) {
  if (!preference) return undefined;
  return {
    totalScore: 100,
    categories: [{ id: "human-preference-recorded", label: "Human preference recorded", score: 100 }]
  };
}

export function formatDuration(value) {
  return value == null ? "—" : `${(value / 1000).toFixed(2)}s`;
}

export function formatRate(value) {
  return value == null ? "—" : value.toFixed(1);
}
