# Soundcloud Desktop

Native Windows artist uploader and workspace. Not affiliated with or endorsed by SoundCloud.

## Run and build

The native release is the compatibility build. See [native/START-HERE.txt](native/START-HERE.txt) for prerequisites and first-run instructions.

## Included

- Direct audio uploads with title, artist, genre, description, artwork, private/public visibility, streamed transfer progress, cancellation and saved upload receipts.
- Local audio import, drag and drop, playback, seeking, volume, media-session controls, track metadata and Explorer reveal.
- Release planning, artwork, linked tracks, checklists and copyable release briefs.
- Promotion campaigns with contacts, dates, captions, links and clipboard export.
- Artist Studio, Amplify, Insights, and Monetization pages with official SoundCloud management links.
- Explicit speaker/headphone consent with Allow/Deny and reset. Microphone, camera, and location are not used.
- Dark, light and system appearance, native Windows window controls, minimize to tray.
- Atomic local workspace saves, metadata backup and restore with a pre-restore copy.
- Personal SoundCloud app credentials encrypted with Windows DPAPI, verified account identity, and direct streamed uploads.

Compatibility target: 64-bit Windows Vista SP2, 7 SP1, 8, 10, and 11. Requires .NET Framework 4 Full or later and Microsoft Universal CRT. Windows 11 native UI, persistence, account gating, hardware consent, integrity checks, and HTTPS transport were smoke-tested here; older operating systems and live OAuth/upload still require verification on the target machine.

After browser authorization, the localhost callback is detected by the EXE, the returned account is verified, and encrypted refresh tokens enable automatic sign-in on later launches. Browser cookies and passwords are never imported. For automatic local library import, put supported audio in `Music\Soundcloud Desktop Inbox`; the startup scan references files in place and does not move or upload them.

The native release is unsigned. Embedded SHA-256 checks resist changed bundled dependencies but cannot make an unsigned executable tamper-proof. One instance is enforced per Windows session.

## Connect SoundCloud

1. Use your Artist Pro account to register an API app following https://developers.soundcloud.com/docs/api/register-app.
2. Configure its redirect URI as `http://127.0.0.1:49832/callback`.
3. Enter the Client ID and secret in the app's SoundCloud page. Never send the secret in chat.
4. Select Connect with SoundCloud and authorize in your browser.

This personal build accepts user-owned credentials; it does not ship a shared client secret. Public distribution should use a properly secured server-side integration. Live OAuth requires valid credentials and an accepted registered redirect URI; it has not been verified against the user's account. Uploads run inside the desktop app. Detailed Artist Insights open SoundCloud in your browser. Release dates do not schedule publication. Catalog counters are snapshots, not time-series analytics.

Local workspace metadata is stored under the app's Windows roaming app-data directory. Audio stays in its original location. Backups include file paths, not audio/artwork bytes or credentials. AIFF and other codec playback depends on Chromium support. Removing workspace records preserves source files. Disconnect removes this app's local tokens; revoke the app through SoundCloud to revoke authorization remotely.

## Design references

- https://learn.microsoft.com/en-us/windows/apps/develop/ui/windows-app-sdk-app-structure
- https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics
- https://learn.microsoft.com/en-us/windows/apps/design/style/mica
- https://www.electronjs.org/docs/latest/api/browser-window
- https://developers.soundcloud.com/docs

Windows-inspired layout uses Segoe UI, sidebar navigation, native caption buttons, restrained cards, orange accents, inline status messages, and a persistent media bar. This is Electron, not a WinUI application.
