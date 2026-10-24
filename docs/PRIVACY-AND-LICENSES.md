# Privacy, product identity, and third-party software

## Publisher and SoundCloud relationship

Black Lion Studios created and publishes SC-DS and supports SoundCloud. SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud. This relationship status may change. SoundCloud owns and operates its platform, API, and marks. This app does not imply SoundCloud endorsement.

## Data and service use

- The app stores its workspace and recovery history in `%APPDATA%\Soundcloud Desktop`. The workspace, recovery copies, SoundCloud account vault, sync checkpoints, and upload receipts are encrypted for the current Windows account with Electron `safeStorage` backed by Windows DPAPI. On upgrade, valid older plaintext workspace, recovery, and upload-receipt files are converted in place; files that cannot be safely validated are preserved and the Settings health check reports encryption needs attention. The app does not send workspace files to Black Lion Studios.
- The app stores the user's SoundCloud app credentials and OAuth tokens in the same DPAPI-protected account vault. This is not Windows Credential Manager. The app does not import browser cookies or passwords. Some interface preferences and history remain in Chromium local storage in the same Windows profile; these are not separately encrypted by SC-DS. Artwork copies are also local files and are not separately encrypted. Audio remains in its original folders. SoundCloud authorization/API access begins only when the user starts a related action; SoundCloud's [Terms of Use](https://soundcloud.com/terms-of-use) and [API Terms](https://developers.soundcloud.com/docs/api/terms-of-use) apply.
- Workspace backup export is user initiated. The exported JSON is readable and is not encrypted by SC-DS; it includes workspace metadata and local paths but excludes credentials and audio bytes. Before export, the app explains what the file contains and asks the user to choose a location. Its SHA-256 checksum detects changes or corruption but does not prove who created the file.
- **Export support bundle** is optional and user initiated. It includes app/system versions, health results, and sanitized event categories. It excludes workspace contents, credentials, account identifiers, local paths, and raw error messages. Review the JSON before sharing.
- GitHub is the update source. User initiated checks read the fixed official repository's GitHub Releases API and download its matching setup asset. Before setup can open, SC-DS checks the release SHA-256, then requires a valid Windows Authenticode signature whose publisher identifies as Black Lion Studios. Both checks are repeated immediately before launching setup. These controls protect the updater's trust path; they do not make the user's Windows account immune to malware running as that user.
- App alerts use Windows notifications. Their wording is general and excludes track names and account details. SoundCloud data is shown only for API capabilities present in this release. Unsupported API capabilities, including Team messages and remote processing status, cannot be enabled by this app; future additions require an official supported API capability and a later published app release.
- The installer stores the user's versioned consent record locally in HKCU. It is not sent to SoundCloud, GitHub, or Black Lion Studios.
- The installed SC-DS app includes this notice in its resources. Open **Settings → Privacy & third-party notices** to view it in the default text viewer; it is also present in the source documentation.
- **Security build requirement:** Windows release builds fail unless a Black Lion Studios code-signing certificate is available to electron-builder. The certificate and its private key are not included in source or package files.

## Included third-party runtime and license information

The Windows x64 package bundles Electron 44.3.0, Chromium 152.0.7977.78, and Node.js 24.21.0. Electron's runtime is part of the application; no separate Electron, Chromium, Node.js, .NET, WebView2, or Visual C++ installer is launched. Windows provides built-in services such as DPAPI, networking, notifications, and file dialogs. Other project development tools are not included as app runtime dependencies.

The packaged runtime and bundled third-party components remain subject to their respective licenses and notices. Electron's [license](https://github.com/electron/electron/blob/v44.3.0/LICENSE) and upstream [third-party notices](https://github.com/electron/electron/tree/v44.3.0) are maintained by Electron. The installed app's `resources\LICENSES.chromium.html` contains Chromium component notices. The Node.js project publishes its [license and notices](https://github.com/nodejs/node/tree/v24.21.0). Review the notices shipped with each runtime release for the exact versions and terms.

The setup does not add user-selected third-party OS packages. It installs the app per user and preserves workspace and credential files when the app is uninstalled.

## Links

- [SoundCloud Terms of Use](https://soundcloud.com/terms-of-use)
- [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use)
- [Electron 44.3.0 license](https://github.com/electron/electron/blob/v44.3.0/LICENSE)
- [Electron third-party notices](https://github.com/electron/electron/tree/v44.3.0)
- [Node.js license and notices](https://github.com/nodejs/node/tree/v24.21.0)
