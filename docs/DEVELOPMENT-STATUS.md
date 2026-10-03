# InPlainSight Studio development checkpoint

Updated 2026-10-03. This checkpoint saves current Windows-tested development progress to source control; it is not a release or installer approval.

## Complete in this checkpoint

- Editable encrypted/recovered filenames, portable basename sanitization, extension handling, safe defaults and no overwrite.
- Reversible Glitch transform profile 3, varied muted fault artwork, and unchanged recovery for legacy Plain and earlier Glitch profiles.
- Source-first export format selection, accessible unavailable-format explanations, reset/change/cancel/retry behavior, appearance settings and window fitting.
- Streaming WAV and experimental FLAC export/recovery using the unchanged authenticated encryption envelope. Full verification before publication; recovery authentication before Save; cooperative audio cancellation and cleanup.
- Consistent summaries: estimated output size, audio duration, maximum source size and exported-file preservation warning. Technical details and future budgets are separate.
- Isolated visible-pixel MP4 research source/tests and historical density results. No video GUI support or increased source limit.

## Verified and remaining boundaries

The Windows FLAC checkpoint passed 61 of 63 tests with two existing platform skips, plus syntax/layout checks. User testing reported successful WAV recovery and the revised PNG interface. Publication preparation reran the full Windows suite: 61 passed, 2 platform skips, 0 failures (85.31 seconds), plus syntax checks. Exact PR CI remains authoritative for its commit. See VERIFICATION.md for evidence and limits.

Original-file caps remain 16 MiB for supported GUI carriers; MP4 research remains 64 KiB. FLAC currently requires an installed compatible FFmpeg. No new codec binary is bundled, and no new release is being made.

## Required release gate

Released packages must provide required codec support without asking users to install FFmpeg. Resolve dependency licensing/source/notice obligations, platform support and clean-machine packaging tests before distributing a codec or enabling release claims. Keep Electron sandboxing and authenticated publication protections intact.

## Next work

Finish user FLAC/native dialog/accessibility QA; resolve crash/power-loss staging cleanup, disk budgeting and native-parser resource constraints; select a compliant self-contained codec packaging plan. Large source caps, lossy JPEG/video integration, broader transport tolerance, folder support, signing and independent audit are unfinished.
