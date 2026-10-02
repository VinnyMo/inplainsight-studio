# Ubuntu test installer

This experimental `.deb` targets **Ubuntu 24.04 or later, Intel/AMD 64-bit (amd64)**, including the requested Ubuntu 26.04 T2 Linux laptop. It does not install T2 drivers, alter the bootloader, or require Node/npm on the laptop. The exact Ubuntu 26.04/T2 hardware combination still needs a real desktop test.

## Install and open

1. Download `inplainsight-studio_0.1.0~experimental.2_amd64.deb` to Downloads.
2. Open it with your graphical Debian-package installer and choose Install. Authenticate using Ubuntu's own system dialog. If double-clicking opens Archive Manager, use **Open With** and choose a package installer such as GDebi or Software Install. Availability depends on your desktop; some App Center versions cannot install local `.deb` files. Do not extract and run the archive.
3. Open **InPlainSight Studio** from the applications menu.

The package manager may need internet access to install missing Ubuntu system libraries. The application itself works offline. This is an unsigned private test installer, not a signed or independently audited release; install only the copy supplied through the expected project channel.

**Security permission:** the package adds `/etc/apparmor.d/inplainsight-studio`, attached only to `/opt/inplainsight-studio/inplainsight-studio`. Its `flags=(unconfined)` profile grants `userns,` so Chromium can create the user namespaces required for its sandbox under Ubuntu's default restrictions. This is an application-specific compatibility allowance, not additional AppArmor confinement. Electron's renderer sandbox remains on. No global sysctl/security setting is changed and no setuid executable is installed. Installation fails visibly if an active AppArmor policy cannot be loaded. Do not disable the sandbox or system protection to work around launch errors.

## Upgrade from experimental.1

Quit the app, keep backups of your files and encrypted PNGs, and install the experimental.2 package with the same package installer. Debian orders `0.1.0~experimental.2` after `0.1.0~experimental.1`, so it upgrades the existing package in place. The package name and install paths are unchanged. The upgrade keeps the existing AppArmor profile active until the new package reloads that same application-specific profile; it does not change global security settings or touch your saved files.

This version adds a quieter interface, restored original filename suggestions for newly created PNGs, and reversible Plain and Glitch carrier styles. Legacy Plain PNGs remain recoverable, and the Plain carrier format is unchanged. Use this version to recover Glitch PNGs and to receive the restored filename suggestions. A native Ubuntu upgrade and launch still need the desktop test below.

## A safe first test

Use a disposable, non-sensitive file smaller than 16 MiB, and keep its original.

- Create PNG: select the file, enter and confirm a long passphrase, and save to a new filename; repeat once with Plain and once with Glitch
- Recover file: choose each original PNG and passphrase, check its suggested original filename, then save to a different filename; compare its contents with the original
- Try a wrong password: recovery must fail without producing a recovered file
- Try Cancel and repeat an operation; close and reopen the app from its menu entry
- Keep the encrypted PNG unchanged. A lost password cannot be recovered

Report the Ubuntu version, install/launch result, and any error text. Never send your passphrase or private test files.

## Uninstall and data

Remove **inplainsight-studio** with your graphical package manager. This removes the installed app, menu entry, icon and application-specific AppArmor profile; it never deletes source files, generated PNGs or recovered files. Quit the app first. Electron's small per-user configuration/cache directory at `$XDG_CONFIG_HOME/inplainsight-studio` (normally `~/.config/inplainsight-studio`) is retained, as is customary. No payloads or passwords are intentionally persisted there. The app runs as your ordinary user and saves files only through its file dialogs, not beside the executable in `/opt`.

## Developer build

On Linux x86_64 with Node 22.12+ (CI uses Node 22), npm, `dpkg-deb` and the Electron system libraries:

```sh
npm ci
npm run setup:electron
npm run check
npm test
npm run package:deb
npm run verify:deb
```

Electron and npm dependencies are version-pinned in package-lock.json. The builder uses Electron's documented prebuilt-binary layout and Debian's native archive tool, with no additional packaging framework (the pinned official `@electron/fuses` build helper disables unused Node-as-runtime, NODE_OPTIONS and inspector features). It includes only source and production dependencies, retains third-party licenses, checks the runtime architecture/version and dependency versions, and never executes Debian package installation scripts while building. `dist/` is ignored by git. `build-info.json` records the source revision and whether the checkout was dirty; publish only a clean-tree build. The `.sha256` file fingerprints the complete installer.

Archive ownership, modes, timestamps and xz threading are normalized. `SOURCE_DATE_EPOCH` defaults to the commit timestamp. Two builds from the same source/runtime/dependencies and dpkg/xz toolchain should match byte-for-byte; this is not a claim of independent reproducible-build certification across all toolchain versions.

Maintainer metadata deliberately uses the project name only: no private contact email or invented address is distributed. This private test package is not Debian archive-policy compliant or submitted to Ubuntu/Debian repositories. No project license has been selected, and packaging adds no license grant.

References: [Electron binary layout](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [Ubuntu user-namespace restriction](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890).
