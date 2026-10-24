# SC-DS 1.0.0

This is the initial 1.0.0 Windows x64 release of SC-DS. It includes a recent tracks panel for followed artists, an API-backed activity feed, selected-track comments review, sync-based performance milestones, and CSV digest export.

Black Lion Studios created and publishes SC-DS and supports SoundCloud. SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud; this relationship status may change. SoundCloud owns its services, API, and marks.

## Installation Manager

The Windows x64 NSIS setup is self-contained and installs SC-DS by default. Electron 44.3.0, Chromium, and Node.js are included in the packaged application. Setup checks the Windows architecture and version before installing. It requires Windows 10 or 11 x64; on an older Windows version it explains the issue, offers a one-click Windows Update action, and pauses so setup can be retried after an update and restart. It does not require .NET Framework, WebView2, a Visual C++ Redistributable, a separate browser engine, or other add-on runtime packages.

The setup's read-only component catalog distinguishes documented SoundCloud API features, API capabilities that are unavailable, bundled/runtime requirements, and future official entries. Unsupported features have no install action. Future catalog additions must cite an official SoundCloud source and ship with a published SC-DS release; the app does not scrape for features.

Before installing, users see one required confirmation covering DMCA/copyright responsibility, privacy and local storage, third-party SoundCloud/GitHub services, the current supported SoundCloud functions, and bundled Windows/Electron components. The user's confirmation is recorded with a consent version and local timestamp in their HKCU registry; the installer does not install until confirmation has been checked and saved. Canceling leaves program files uninstalled. Later installers skip the page only when the current consent version and its saved record match.

The app's first-run splash now explains account setup and local profile retention in plain language. The SoundCloud account itself remains authenticated separately through the browser flow.

SC-DS protects the workspace, recovery history, account vault, sync checkpoints, and upload receipts at rest with Windows DPAPI through Electron `safeStorage`. Valid legacy workspace and receipt files migrate in place. Settings reports whether workspace and recovery encryption is active. User-exported workspace backups remain readable JSON and receive an explicit privacy warning before save.

The updater reads releases directly from the fixed GitHub repository and verifies the downloaded installer against the release SHA-256 before opening it; it repeats verification at handoff. Signing is optional. If an installer is signed, the signature must be valid and identify Black Lion Studios. Unsigned installers can produce an unknown-publisher warning when opened directly. Uninstall preserves workspace and credential files in the Windows user's app-data folder.

The 1.0.0 release includes the SC-DS Installation Manager setup only. Portable packages are omitted so first use cannot bypass the installer's compatibility check and required consent step.

See the [installer guide](WINDOWS-INSTALLER.md) and the [user guide](USER-GUIDE.md) for exact requirements and package behavior.

Review the [privacy and third-party notices](PRIVACY-AND-LICENSES.md) for local data handling, service connections, and bundled runtime licensing.
