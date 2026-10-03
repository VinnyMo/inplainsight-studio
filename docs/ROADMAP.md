# Development priorities

Implemented locally: editable export/recovery filenames; Plain PNG and reversible Glitch profiles with profile-3 exports and legacy recovery; source-first format selection; WAV streaming export/recovery; experimental FLAC via an installed FFmpeg; bounded cancellation, authenticated publication and uniform format summaries. All GUI source caps remain 16 MiB.

## Release gates

A released package must work without users installing FFmpeg. Include suitable codec support or an appropriately packaged dependency only after applicable licensing/source/notice obligations, supported-platform packaging and clean-machine recovery tests are resolved. No new release is authorized by the current source checkpoint. Existing development builds with optional external FFmpeg do not satisfy this gate.

Remaining work includes independent security review, native platform/dialog/accessibility QA, crash/power-loss cleanup, explicit disk budgets, stronger native-process resource isolation, clean-machine packaging/signing and wider corrupt-media tests. Never disable Electron sandboxing or weaken authentication to make a build work.

## Future carriers and budgets

JPEG is unimplemented. The isolated MP4 visible-symbol prototype demonstrates small exact round trips and density tradeoffs, not GUI-ready video support or robust arbitrary transcode recovery. Keep its 64 KiB cap; do not infer larger capacity from measured expansion alone.

Approved output design targets (decimal units), not current capacity: PNG 100/500 MB; JPEG 25/100 MB; WAV and FLAC 1/4 GB; video 5/50 GB for default/advanced. Any future accepted source limit must also satisfy implementation, dimensions/duration, memory, scratch disk and filesystem constraints. At the measured 4px video packing, 2.5 hours carries about 270 MB of original data; 50 GB encoded is not a promise of practical multi-GB input support.

Folder support, alternative key modes and lossy carriers remain future work. Preserve hierarchy only inside authenticated metadata and require safe, explicit recovery destinations. No stealth, plausible-deniability or quantum-safety guarantee is implied.
