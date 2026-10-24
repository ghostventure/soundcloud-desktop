# Privacy, product identity, and third-party software

## Publisher and SoundCloud relationship

Black Lion Studios created and publishes SC-DS and supports SoundCloud. SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud. This relationship status may change. SoundCloud owns and operates its platform, API, and marks. This app does not imply SoundCloud endorsement.

## Data and service use

- The workspace (artist profile, local audio references, release plans, and campaign notes) is stored under the current Windows user's app-data folder. Synced SoundCloud profile and catalog snapshots, account tokens, and metrics are also kept in separate encrypted local connection data. Workspace backups are user initiated and contain workspace metadata and file paths, not the audio files themselves.
- The app stores the user's SoundCloud app credentials and OAuth tokens in an encrypted local file under the Windows user profile. Electron `safeStorage` uses Windows DPAPI to protect the file contents. This is not Windows Credential Manager. The app does not import browser cookies or passwords. It uses SoundCloud authorization and API endpoints only when the user starts a related action; SoundCloud's [Terms of Use](https://soundcloud.com/terms-of-use) and [API Terms](https://developers.soundcloud.com/docs/api/terms-of-use) apply.
- **Export support bundle** is optional and user initiated. It includes app/system versions, health results, and sanitized event categories. It excludes workspace contents, credentials, account identifiers, local paths, and raw error messages. Review the JSON before sharing.
- GitHub is used for user initiated update checks and for downloading the matching setup package. The app checks the downloaded bytes against SHA-256 metadata published with that release before opening setup visibly. Checksums do not establish publisher identity; the v1.0.0 Windows setup is unsigned.
- App alerts use Windows notifications. Their wording is general and excludes track names and account details. SoundCloud data is shown only for API capabilities present in this release. Unsupported API capabilities, including Team messages and remote processing status, cannot be enabled by this app; future additions require an official supported API capability and a later published app release.
- The installer stores the user's versioned consent record locally in HKCU. It is not sent to SoundCloud, GitHub, or Black Lion Studios.
- The installed SC-DS app includes this notice in its resources. Open **Settings → Privacy & third-party notices** to view it in the default text viewer; it is also present in the source documentation.

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
