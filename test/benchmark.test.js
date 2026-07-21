import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROMPT, aggregateInstances, createMultimodalMessages, createVisionMessages, defaultPromptFor, historyScore, mediaKindFromType, summarizeTiming, usageFromStreamEvent, validateConcurrency, validateImage, validateImageDataUrl, validateMedia, validateMediaDataUrl, videoFrameTimestamps } from "../src/benchmark.js";

test("uses a short default image prompt", () => {
  assert.equal(DEFAULT_PROMPT, "Describe this image. Include the main subjects, actions, setting, visible text, and important details.");
  assert.ok(DEFAULT_PROMPT.length < 120);
});

test("creates an OpenAI-compatible multimodal message", () => {
  assert.deepEqual(createVisionMessages(" describe ", "data:image/png;base64,abc"), [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,abc", detail: "high" } }] }]);
});

test("creates modality-specific image, audio, and video messages", () => {
  assert.deepEqual(createMultimodalMessages("look", "data:image/png;base64,abc", "image/png"), createVisionMessages("look", "data:image/png;base64,abc"));
  assert.deepEqual(createMultimodalMessages("listen", "data:audio/wav;base64,UklGRg==", "audio/wav"), [{ role: "user", content: [{ type: "text", text: "listen" }, { type: "input_audio", input_audio: { data: "UklGRg==", format: "wav" } }] }]);
  assert.deepEqual(createMultimodalMessages("watch", "data:video/mp4;base64,AAAA", "video/mp4"), [{ role: "user", content: [{ type: "text", text: "watch" }, { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } }] }]);
  assert.deepEqual(createMultimodalMessages("watch", "data:video/mp4;base64,AAAA", "video/mp4", ["data:image/jpeg;base64,one", "data:image/jpeg;base64,two"]), [{ role: "user", content: [{ type: "text", text: "watch" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,one", detail: "high" } }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,two", detail: "high" } }] }]);
});

test("selects up to four representative video timestamps", () => {
  assert.deepEqual(videoFrameTimestamps(0.4), [0]);
  assert.deepEqual(videoFrameTimestamps(3.2), [0, 1, 2, 3]);
  assert.deepEqual(videoFrameTimestamps(4.9), [0, 1.3, 2.6, 3.9000000000000004]);
  assert.deepEqual(videoFrameTimestamps(10), [0, 3, 6, 9]);
});

test("identifies supported media and selects concise prompts", () => {
  assert.equal(mediaKindFromType("image/jpeg"), "image");
  assert.equal(mediaKindFromType("audio/mpeg"), "audio");
  assert.equal(mediaKindFromType("video/mp4"), "video");
  assert.match(defaultPromptFor("audio"), /audio/i);
  assert.match(defaultPromptFor("video"), /video/i);
});

test("calculates TTFT, total duration, and output rate", () => {
  assert.deepEqual(summarizeTiming({ startedAt: 100, firstTokenAt: 350, finishedAt: 2350, content: "hello", usage: { completion_tokens: 20 } }), { ttftMs: 250, totalMs: 2250, generationMs: 2000, outputCharacters: 5, outputTokens: 20, tokensPerSecond: 10 });
});

test("preserves missing token usage without inventing a rate", () => {
  const result = summarizeTiming({ startedAt: 0, firstTokenAt: null, finishedAt: 500, content: "hello" });
  assert.equal(result.ttftMs, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.tokensPerSecond, null);
});

test("supports load levels through 16 requests per model", () => {
  for (const value of [1, 2, 4, 8, 16]) assert.equal(validateConcurrency(value), value);
  assert.throws(() => validateConcurrency(3), /must be one of/);
  assert.throws(() => validateConcurrency(32), /must be one of/);
});

test("aggregates concurrent request timing and throughput", () => {
  const instances = [
    { startedAt: 0, firstTokenAt: 100, finishedAt: 1100, content: "one", finished: true, timing: { ttftMs: 100, outputTokens: 20 } },
    { startedAt: 10, firstTokenAt: 210, finishedAt: 1210, content: "two", finished: true, timing: { ttftMs: 200, outputTokens: 30 } }
  ];
  assert.deepEqual(aggregateInstances(instances), { ttftMs: 150, totalMs: 1210, generationMs: 1110, outputCharacters: 6, outputTokens: 50, tokensPerSecond: 50 / 1.11, completed: 2, succeeded: 2, failed: 0, requested: 2 });
});

test("surfaces failures without corrupting successful throughput", () => {
  const result = aggregateInstances([
    { startedAt: 0, firstTokenAt: 100, finishedAt: 1100, content: "good", finished: true, timing: { ttftMs: 100, outputTokens: 20 } },
    { startedAt: 5, firstTokenAt: null, finishedAt: 305, content: "", finished: true, error: "busy", timing: { ttftMs: null, outputTokens: null } }
  ]);
  assert.equal(result.completed, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.tokensPerSecond, 20);
});

test("reads token usage from BenchLocal raw streaming events", () => {
  const usage = { completion_tokens: 24 };
  assert.equal(usageFromStreamEvent({ type: "delta", raw: { usage } }), usage);
  assert.equal(usageFromStreamEvent({ type: "done", usage }), usage);
  assert.equal(usageFromStreamEvent({ type: "delta" }), undefined);
});

test("validates image type and size", () => {
  assert.doesNotThrow(() => validateImage({ type: "image/png", size: 100 }));
  assert.throws(() => validateImage({ type: "text/plain", size: 100 }), /not an image/);
  assert.throws(() => validateImage({ type: "image/png", size: 16 * 1024 * 1024 }), /15 MB/);
});

test("validates supported multimodal files and data URLs", () => {
  assert.doesNotThrow(() => validateMedia({ type: "audio/wav", size: 100 }));
  assert.doesNotThrow(() => validateMedia({ type: "video/mp4", size: 100 }));
  assert.throws(() => validateMedia({ type: "application/pdf", size: 100 }), /image, audio, or video/);
  assert.doesNotThrow(() => validateMediaDataUrl("data:audio/wav;base64,UklGRg=="));
  assert.doesNotThrow(() => validateMediaDataUrl("data:video/mp4;base64,AAAA"));
});

test("validates agent-provided image data URLs", () => {
  assert.doesNotThrow(() => validateImageDataUrl("data:image/png;base64,aGVsbG8="));
  assert.throws(() => validateImageDataUrl("https://example.com/image.png"), /base64 image data URL/);
  assert.throws(() => validateImageDataUrl(`data:image/png;base64,${"a".repeat(21 * 1024 * 1024)}`), /15 MB/);
});

test("records a human verdict as a completion signal, not model quality", () => {
  assert.equal(historyScore(undefined), undefined);
  assert.equal(historyScore("b").categories[0].id, "human-preference-recorded");
});
