'use strict';

// Pure policy shared by the renderer and main process. Design budgets never
// override implemented/validated capacity. Video remains unavailable; WAV uses bounded PCM streaming.
(function (root) {
  const MiB = 1024 * 1024;
  const carriers = Object.freeze([
    { id: 'png', label: 'PNG', supported: true, inputLimit: 16 * MiB, outputLimit: 36 * MiB, budgets: [100e6, 500e6] },
    { id: 'jpeg', label: 'JPEG', supported: false, budgets: [25e6, 100e6] },
    { id: 'wav', label: 'WAV', supported: true, inputLimit: 16 * MiB, outputLimit: 44 + 2 * (16 * MiB + 16384), budgets: [1e9, 4e9] },
    { id: 'flac', label: 'FLAC', supported: true, inputLimit: 16 * MiB, outputLimit: 36 * MiB, budgets: [1e9, 4e9] },
    { id: 'video', label: 'Video', supported: false, budgets: [5e9, 50e9] },
  ].map(c => Object.freeze({ ...c, budgets: Object.freeze(c.budgets) })));
  function evaluate({ size, carrier = 'png', appearance = 'glitch', flacAvailable = false } = {}) {
    const capability = carriers.find(c => c.id === carrier);
    const result = (eligible, code, reason, extra = {}) => ({ eligible, code, reason, carrier, ...extra });
    if (!capability || !capability.supported) return result(false, 'unsupported', carrier === 'video'
      ? 'Video is not available in this app. Its experimental prototype is not supported here.'
      : `${capability?.label || 'This format'} is not implemented. No capacity estimate is available.`);
    if (carrier === 'flac' && !flacAvailable) return result(false, 'dependency-unavailable', 'FLAC needs an installed FFmpeg with FLAC support. Restart Studio after configuring it; nothing is installed automatically.');
    if (size === null || size === undefined) return result(false, 'source-required', 'Choose a source file first.');
    if (!Number.isSafeInteger(size) || size < 0) return result(false, 'invalid-size', 'Choose a regular file with a valid size.');
    if (carrier === 'png' && !['plain', 'glitch'].includes(appearance)) return result(false, 'invalid-appearance', 'Choose Plain or Glitch appearance.');
    if (size > capability.inputLimit) return result(false, 'input-limit', `${capability.label} supports originals up to 16 MiB in this version. Choose a smaller source file.`);
    // A deliberately generous allowance for sanitized filename metadata and framing.
    // Dimensions are upper planning estimates, not the exact canonical dimensions.
    const envelope = size + 1300 + Math.max(1, Math.ceil(size / 65536)) * 21;
    const preservation = 'Keep the exported file unchanged so it can be recovered.';
    const audioWarning = `${preservation} Noise audio: avoid high playback volume. Studio never plays it. Recovery after conversion has not been verified.`;
    if (carrier === 'wav') return result(true, 'ready', 'Select WAV', {
      estimatedOutputBytes: 44 + 2 * envelope,
      estimateText: `Estimated output size: up to about ${((44 + 2 * envelope) / MiB).toFixed(2)} MiB`,
      durationText: `Duration: about ${(envelope / 48000).toFixed(1)} seconds`,
      limitingFactor: 'Maximum source size: 16 MiB', warningText: audioWarning,
      detailsText: 'WAV: mono 48 kHz, 16-bit PCM. About 2 times the original size plus framing. Current encoded-file ceiling: 33,587,244 bytes.',
    });
    if (carrier === 'flac') return result(true, 'ready', 'Select FLAC', {
      estimatedOutputBytes: Math.ceil(envelope * 2.1 + 65536),
      estimateText: `Estimated output size: up to about ${((envelope * 2.1 + 65536) / MiB).toFixed(2)} MiB (conservative estimate; compression varies)`,
      durationText: `Duration: about ${(envelope / 48000).toFixed(1)} seconds`,
      limitingFactor: 'Maximum source size: 16 MiB', warningText: audioWarning,
      detailsText: 'FLAC: lossless encoding of the same mono PCM samples as WAV. Uses your installed FFmpeg; no binary is bundled. Current encoded-file ceiling: 36 MiB. The estimate is not a guaranteed bound.',
    });
    const height = appearance === 'plain' ? Math.ceil((envelope + 4) / 3072)
      : Math.max(768, 16 * Math.ceil((48 + 2 * envelope) / (3072 * 16)));
    const estimate = Math.ceil(1024 * height * 3 * 1.05 + 65536);
    return result(true, 'ready', 'Select PNG', {
      estimatedOutputBytes: estimate, estimatedMaxHeight: height, width: 1024,
      limitingFactor: 'Maximum source size: 16 MiB', warningText: `${preservation} Image edits, resizing or screenshots can prevent recovery.`, detailsText: `PNG ${appearance === 'plain' ? 'Plain' : 'Glitch'}; current encoded-file ceiling: 36 MiB.`, durationText: '',
      estimateText: `Estimated output size: up to about ${(estimate / MiB).toFixed(2)} MiB. Compression varies; this is not a guaranteed bound.`,
    });
  }
  const api = Object.freeze({ carriers, evaluate });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.studioPreflight = api;
})(typeof window === 'object' ? window : globalThis);
