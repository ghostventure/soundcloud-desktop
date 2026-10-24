# SC-DS Installation Manager: first-run consent

Before setup copies program files, SC-DS Installation Manager presents a brief confirmation page. The user can open SoundCloud's current [Terms of Use](https://soundcloud.com/terms-of-use) and [API Terms](https://developers.soundcloud.com/docs/api/terms-of-use) from that page, check the confirmation, continue, or cancel setup. If the user cancels, setup does not copy or install the application files.

The confirmation explains:

- Soundcloud Desktop is independent and is not endorsed by SoundCloud.
- Before uploading content, the user confirms they own it or have the rights, permissions, and licenses needed. The user remains responsible for content and for responding to copyright or other claims. The app offers neither legal advice nor legal protection.
- SoundCloud account authorization and API use are governed by SoundCloud's terms. SoundCloud and GitHub features connect to those services when the user chooses to use them; sign-in opens the user's default browser.
- Workspace and credentials are held in the user's Windows profile, with credentials protected by Windows DPAPI. Optional support export is initiated by the user.
- Setup contains the app and its Electron, Chromium, and Node.js runtime. It does not install separate .NET, WebView2, Visual C++, or other runtime packages. Windows supplies system services such as DPAPI, networking, and file dialogs.

## Local consent record

After the user checks the box and chooses Next, setup stores the accepted consent version, local acceptance time, and category IDs in this Windows account:

`HKEY_CURRENT_USER\Software\SC-DS\InstallationManager\Consent`

Values are `Version`, `AcceptedAtLocal`, and `Categories`. The acceptance time is local Windows time, not UTC. The record stays on this PC and is not sent to SoundCloud, GitHub, or the app publisher. The consent page is skipped on future installs while the recorded version matches the current consent version. If the consent wording or covered categories materially change, setup's consent version must be incremented; the next installer then presents the page again. Canceling or failing to save the record prevents installation from continuing.

Uninstall preserves this record, the user's workspace, and encrypted credentials. The app installer is distinct from Windows/system components: its bundled Electron runtime is part of the app package, while Windows provides the operating-system services listed above.
