# Audio test fixtures

Short, varied clips for the Multimodal Arena. The ready-to-upload WAV files are
16 kHz mono PCM so both live comparison models receive a consistent input
format. Original downloads are retained in `sources/`.

| Fixture | Content | Duration | Source and license |
| --- | --- | ---: | --- |
| `01-speech.wav` | Spoken Wikimedia Foundation “Free to use” PSA | 10.00 s | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Free_to_use_10_sec.ogg), CC BY-SA 3.0 |
| `02-shorebirds.wav` | Shorebird/seabird calls at a tern colony | 11.98 s | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Shorebirds.ogg), U.S. Fish and Wildlife Service public domain |
| `03-applause.wav` | Children and a crowd applauding | 10.76 s | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Applause_ii.ogg), released into the public domain by thore |
| `04-ragtime.wav` | Instrumental excerpt from W. C. Handy’s 1917 “Ole Miss Rag” recording | 11.98 s | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:W.C._Handy_-Ole_miss_rag_1917.ogg), public domain |

The speech, shorebird, and applause sources were converted without extending
their duration. The ragtime fixture is the first 12 seconds of the longer
public-domain recording. All conversions were made with FFmpeg using
`-ar 16000 -ac 1`.
