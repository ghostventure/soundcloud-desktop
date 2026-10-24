# SC-DS Installation Manager: first-run consent

Before setup copies program files, SC-DS Installation Manager presents the privacy, data, service, copyright, and component summary on its confirmation page. It links to SoundCloud's official [Terms of Use](https://soundcloud.com/terms-of-use) and [API Terms](https://developers.soundcloud.com/docs/api/terms-of-use). The full privacy and third-party notice is included with the installed app and can be opened later from Settings. The user can check the confirmation, continue, or cancel setup. If the user cancels, setup does not copy or install the application files.

The confirmation uses one required checkbox and explains:

- Black Lion Studios created and publishes SC-DS and supports SoundCloud. SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud; this relationship status may change. SoundCloud owns and operates its platform, API, and marks.
- Before uploading content, the user confirms they own it or have the rights, permissions, and licenses needed. The user remains responsible for content and for responding to DMCA/copyright notices or other claims. The app offers neither legal advice nor legal protection.
- Included SoundCloud functions use documented API data for account activity, selected-track comments, followed-artist recent tracks, catalog sync, uploads, and saved metrics. Team messages and processing status are not available through the public API and cannot be enabled by this app.
- SoundCloud account authorization/API use is governed by SoundCloud's terms. Sign-in opens the default browser. GitHub is used for user-initiated update checks and setup downloads, whose bytes are checked against the release SHA-256 metadata before visible setup starts.
- Workspace and recovery files, SoundCloud credentials, and upload receipts stay under the Windows user profile and use Electron `safeStorage` with Windows DPAPI. Some interface preferences/history and artwork copies are not separately encrypted. A workspace backup is readable JSON; setup and Settings explain its contents before export. Optional support export is user initiated and excludes workspace contents, credentials, account IDs, paths, and raw error messages. Consent is saved locally and not transmitted.
- Setup contains Electron 44.3.0, Chromium 152.0.7977.78, and Node.js 24.21.0. These third-party components have their own licenses/notices. The app does not install separate .NET, WebView2, Visual C++, or other runtime packages. Windows supplies DPAPI, networking, and file dialogs.

## Local consent record

After the user checks the box and chooses Next, setup stores the accepted consent version, local acceptance time, and category IDs in this Windows account:

`HKEY_CURRENT_USER\Software\SC-DS\InstallationManager\Consent`

Values are `Version`, `AcceptedAtLocal`, and `Categories`. The acceptance time is local Windows time, not UTC. The record stays on this PC and is not sent to SoundCloud, GitHub, or the app publisher. Consent version `1.0.0` is skipped on future installs while the recorded version matches. If the consent wording or covered categories materially change, setup's consent version must be incremented; the next installer then presents the page again. Canceling or failing to save the record prevents installation from continuing.

Uninstall preserves this record, the user's workspace, and encrypted credentials. The app installer is distinct from Windows/system components: its bundled Electron runtime is part of the app package, while Windows provides the operating-system services listed above.
