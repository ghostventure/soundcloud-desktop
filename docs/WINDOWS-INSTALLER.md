# SC-DS Installation Manager

## What it installs

`SC-DS Installation Manager` is the setup program for **SC-DS**. Black Lion Studios created and publishes SC-DS and supports SoundCloud. SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud; this relationship status may change. It installs the desktop app automatically; the component catalog is informational, and there is no feature-by-feature selection or extra install step.

The Windows x64 setup is self-contained. It carries the app files and Electron 44.3.0 runtime inside the executable. The setup does not download program files or prerequisite packages while installing. It can be copied to an offline PC and used without Node.js, npm, a package manager, or an internet connection.

From the project folder:

- `npm run dist:installer` builds `dist/SC-DS Installation Manager-Setup-1.0.0.exe`.
- `npm run dist` builds the SC-DS Installation Manager setup.

The 1.0.0 release is distributed through the Installation Manager only. Run setup before first use; portable copies are not part of this release because they would bypass the install-time consent and compatibility checks. The consent page shows the privacy summary and links to SoundCloud's official terms. The full [privacy and third-party notice](PRIVACY-AND-LICENSES.md) is bundled with the app and available from Settings after installation.

The desktop app's Windows identity (`appId`) is retained for upgrades. Setup reads the existing per-user install location so the product name change does not create a second install. SC-DS also keeps the existing `%APPDATA%\Soundcloud Desktop` data folder so prior workspace and encrypted connection data remain available.

The assisted setup installs per-user without elevation, allows the install folder to be changed, and creates Start menu and desktop shortcuts. Uninstall removes app files and shortcuts while preserving the user's workspace and encrypted credentials.

## System check and external actions

Setup checks for x64 Windows before changing program files and requires Windows 10 or 11. On an older Windows version, setup explains the requirement and displays **Open Windows Update**. It pauses installation until a supported system is available; after Windows has been updated and restarted if necessary, run setup again. A 32-bit PC receives a clear compatibility message and cannot continue because this app is built only for 64-bit Windows.

Electron bundles Chromium and Node.js. Windows already provides DPAPI credential protection, networking, notifications, and file dialogs. This app has no production npm dependencies or native Node modules and does not need separate .NET Framework, WebView2, Visual C++ Redistributable, Java, or Microsoft Store packages. Setup detects no other external runtime dependency, so it offers no buttons for those packages.

Internet access and a default browser are used by SoundCloud sign-in, SoundCloud API features, and GitHub update checks. They are not needed to install or open the app. Windows launches the browser already selected by the user.

## Component catalog

The read-only setup page groups entries from [`installer/components.json`](../installer/components.json):

- **SoundCloud features included:** capabilities backed by documented public API resources. They are already part of the installed app.
- **Not available through SoundCloud's public API:** Team announcements/private messages and remote track processing status. They are shown with the API limitation and have no install action.
- **App and Windows requirements:** bundled Electron runtime, built-in Windows services, and the Windows version required by this x64 build.
- **Future official releases:** an extensible category for future SoundCloud capabilities, added only when they have an official source and then delivered through a published SC-DS release. The manager does not scrape SoundCloud or install feature modules from SoundCloud.

The catalog generator validates unique entry IDs, known categories, and rejects install actions on unsupported SoundCloud entries. Future entries require an official SoundCloud developer source or the official SoundCloud GitHub organization. Catalog updates ship with SC-DS releases; updates come directly from the fixed GitHub repository. Before setup opens, the updater validates the release SHA-256 and requires a valid Windows Authenticode signature for Black Lion Studios. Both checks are repeated at handoff.

## User data and publisher prompt

The workspace, recovery history, account vault, sync checkpoints, and upload receipts stay under the current Windows user's app-data folder, separate from program files, and are encrypted with Windows DPAPI through Electron `safeStorage`. The uninstaller does not remove these files. Valid legacy workspace and upload-receipt data migrates in place; unverifiable files are preserved and reported as needing attention. Workspace backups are readable JSON and receive a warning before export. Back up workspace metadata before moving it to another PC; credentials are not included in workspace backups.

Windows release builds require a valid Black Lion Studios code-signing certificate. The signing certificate and private key are supplied securely to the build environment and are not included in this repository or installer.

## Build requirements

Creating setup requires `npm ci`, then `npm run dist:installer`. The build machine needs network access to fetch the locked development tools and Electron if they are not cached. The resulting setup executable is self-contained and does not need network access to install.
