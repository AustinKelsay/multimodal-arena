# Multimodal Arena

[![CI](https://github.com/AustinKelsay/multimodal-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/AustinKelsay/multimodal-arena/actions/workflows/ci.yml)

An independently versioned BenchLocal web pack extracted from the
finitecomputer/spark-cluster monorepo. This repository is the authoritative
source for the pack; the Spark cluster consumes it as a pinned dependency.

A human-first BenchLocal web pack for comparing two models on one image, audio,
or video input. Both models receive the same media and prompt and run
concurrently. The UI shows their streamed analyses side by side with time to
first token, total time, output size, and tokens per second when the provider
reports token usage. Arrow controls navigate every response in a batch. A
load selector runs 1, 2, 4, 8, or 16 requests per model simultaneously (2–32
requests total).

The result is exploratory evidence. The human chooses Model A, Model B, or a
tie; this preference is stored as a verdict, not an objective quality score.

## Run locally

```bash
npm install
npm test
npm run dev
```

In BenchLocal, install the manifest from:

```text
http://127.0.0.1:5176/benchlocal.pack.json
```

Then open **Multimodal Arena**, select two models that support the uploaded
modality, upload an image, audio file, or video, and choose **Compare models**.
BenchLocal 0.3 model records do not advertise input modalities, so the pack
cannot automatically remove incompatible models from the selectors. Unsupported
inputs remain visible as per-request errors and count toward failed requests.

Video comparison uniformly samples up to four frames across the clip in the
browser and sends the same frame set to both models. It evaluates the visual
track only; upload extracted audio separately when soundtrack understanding is
part of the comparison.

The development server must remain running while the pack is open. The
manifest and page use the same `127.0.0.1:5176` origin intentionally; using
`localhost` instead will not match the bridge allowlist.

Tagged releases contain a standalone bundle with the built UI, source, tests,
and manifest. After extracting a release, run `npm install` and
`npm run dev`, then install the loopback manifest URL above. All provider
access still goes through the local BenchLocal bridge; the repository contains
no provider credentials or Spark-cluster configuration.

## Agent operation

Every interactive control has a stable ID:

- `media-input`
- `prompt`
- `model-a`
- `model-b`
- `concurrency`
- `run-comparison`
- `result-a` and `result-b`
- verdict buttons with `data-preference="a|b|tie"`

An in-page agent can also call:

```js
await window.multimodalArena.run({
  mediaDataUrl: "data:video/mp4;base64,...",
  prompt: "Describe this video precisely.",
  modelAId: "registered-model-a",
  modelBId: "registered-model-b",
  concurrency: 8
});

await window.multimodalArena.setPreference("a");
```

`getState()` returns a serializable snapshot without the uploaded `File` or
object URL.

`window.imageDescriptionArena` and the `imageDataUrl` input remain available
as backward-compatible aliases for image automation.

## Evidence and privacy

Provider credentials never enter the web pack. Inference goes through the
BenchLocal bridge. Completed history stores the prompt, model identities,
answers, timings, usage, verdict, and the input media as a local BenchLocal
artifact. The pack declares no remote services.

Because the models run concurrently, the timing comparison reflects the real
side-by-side experience and may include shared-provider or shared-hardware
contention. For concurrent batches, each card shows the first non-empty response
as the representative description, average TTFT across successful requests,
aggregate decode TPS (successful output tokens divided by the wall-clock span
from the first decode token to the last successful completion), total batch wall
time, and completed/failed request counts. Missing provider token usage is shown
as unavailable rather than estimated. Run models individually if you need
isolated throughput evidence.
