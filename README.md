# SC-DS

Created and published by Black Lion Studios. Black Lion Studios supports SoundCloud; SC-DS is currently an independent product and is not affiliated with or endorsed by SoundCloud. This relationship status may change. SoundCloud owns its platform, API, and marks; third-party software remains under its own licenses. See [privacy and third-party licenses](docs/PRIVACY-AND-LICENSES.md).

## Current project version

The current source and package metadata are version 1.0.0. It includes API-backed SoundCloud activity, comments review, followed-artist recent tracks, sync-based performance milestones, and CSV export. The installer is named **SC-DS Installation Manager**; GitHub release availability is tracked separately. See the [1.0.0 release notes](docs/RELEASE-1.0.0.md), [Windows installer and runtime requirements](docs/WINDOWS-INSTALLER.md), [SC Artist user guide](docs/USER-GUIDE.md), and [security and local data protection](docs/SECURITY-1.0.0.md).

Version 0.2.7 added catalog filters and comparison tools, track review and detail tools, workspace accessibility and navigation options, and encrypted multi-account switching. Backend catalog snapshots and workspace saves also use less memory and disk space. See [0.2.7 release notes](docs/RELEASE-0.2.7.md).

For first-run setup and the main workflows, see the [SC Artist user guide](docs/USER-GUIDE.md).

Version 0.2.3 expanded Settings into an artist profile editor with a live preview, tagline, bio, genre, location, SoundCloud and website links, and a copyable formatted bio. Profile details are saved with the local workspace and included in workspace metadata backups. See [artist profile notes](docs/ARTIST-PROFILE-0.2.3.md).

The workspace navigation groups related areas so the main artist tasks are easier to find: Home, Create, Catalog & Releases, Promotion, and SoundCloud, with Settings kept at the bottom. The GUI refresh and profile changes are documented in [GUI and profile release notes](docs/RELEASE-0.2.3.md).

## Run and build

The app is an Electron desktop application targeting 64-bit Windows 10 and 11. Its setup is self-contained and installs the app by default; no separate runtime package or manual component selection is required. See [Windows installer and runtime requirements](docs/WINDOWS-INSTALLER.md) for package contents and build commands.

## Included

- Direct audio uploads with title, artist, genre, description, artwork, private/public visibility, streamed transfer progress, cancellation and saved upload receipts.
- Native desktop alerts for upload and catalog-sync results when the app window is hidden; alerts use generic text and clicking one reopens the workspace.
- Local audio import, drag and drop, playback, seeking, volume, media-session controls, track metadata and Explorer reveal.
- Release planning, artwork, linked tracks, checklists and copyable release briefs.
- Promotion campaigns with contacts, dates, captions, links and clipboard export.
- Artist Studio, Amplify, Insights, and Monetization pages with official SoundCloud management links.
- Explicit speaker/headphone consent with Allow/Deny and reset. Microphone, camera, and location are not used.
- Dark, light and system appearance, native Windows window controls, minimize to tray.
- Atomic local workspace saves, metadata backup and restore with a pre-restore copy.
- Personal SoundCloud app credentials encrypted with Windows DPAPI, verified account identity, and direct streamed uploads.
- Upload desk onboarding, preflight review, local drafts and reminders, reusable metadata presets, duplicate warnings, and batch library editing.
- Release planner board and calendar, single/EP/album templates, per-task ownership, due dates, and local readiness checks.
- Customizable studio dashboard, searchable help, undo/recent-change history, campaign templates, contact follow-ups, and locally organized campaign links.
- Local upload response tracking, artwork crop preview, and audio file details; update scheduling, crop transforms, SoundCloud click analytics, and remote processing history are not provided by the current API.
- Bounded SoundCloud catalog sync with encrypted progress checkpoints, freshness metadata, and local absence tombstones; interrupted syncs preserve the last completed snapshot but do not resume.
- Upload attempt recovery with local receipt journaling and a duplicate-attempt guard. An uncertain result must be checked in SoundCloud before the local review item is cleared; SoundCloud does not provide a remote idempotency guarantee here.
- User-initiated GitHub stable-release checks. Installed Windows builds can download a bounded NSIS installer and compare its SHA-256 digest to GitHub release metadata before opening setup visibly for review. Version 1.0.0 ships through the SC-DS Installation Manager so first use includes compatibility checks and required consent.
- Content-hash duplicate checks for newly imported local audio, checksummed workspace backups with legacy JSON restore support, and bounded local workspace recovery points.
- Per-account identity binding and persisted cooldowns, upload-time audio signature/file identity checks, and Settings display of reported OAuth scopes plus observed per-route quota headers.
- Local daily follower and track-count history captured during successful catalog syncs; this is not SoundCloud time-series analytics.
- Timestamped follower, track, catalog-play and catalog-like snapshots from successful manual syncs, configurable threshold alerts, and a recent CSV digest with adjacent-snapshot observed deltas. These are snapshot comparisons, not real-time or scheduled analytics.
- Read-only, bounded SoundCloud activity feed and user-requested comments review for a selected synced track; results are account-bound and comments are never fetched across the catalog.
- Settings health checks for workspace and credential access, plus an opt-in privacy-safe support bundle containing versions, projected health, and sanitized event categories.
- Responsive 100-row library/catalog pages, asynchronous serialized workspace saves, and faster audio/media file lookups; see [performance notes](docs/PERFORMANCE-0.2.1.md).
- SoundCloud catalog snapshots keep 2,000 description characters per track, normalize pages as they arrive, and remain sequentially paginated; internal workspace JSON is compact while exported backups stay readable.

Windows release builds require a Black Lion Studios Authenticode certificate. The updater checks the installer against GitHub release SHA-256 metadata and validates that publisher signature before visibly opening setup. A signed v1.0.0 installer must be built before distribution; the earlier unsigned package does not pass the updater's publisher check. Silent setup is allowed only for a Windows account that already has a complete, matching consent record; first install requires interactive consent. Uninstall removes the program but preserves workspace and encrypted account data in `%APPDATA%\Soundcloud Desktop`.

After browser authorization, the localhost callback is detected by the app, the returned account is verified, and encrypted refresh tokens enable automatic sign-in on later launches. Browser cookies and passwords are never imported. For automatic local library import, put supported audio in `Music\Soundcloud Desktop Inbox`; the startup scan references files in place and does not move or upload them.

Catalog sync follows SoundCloud's same-origin `next_href` pages sequentially: at most 200 tracks per page, 50 pages and 10,000 tracks total. Each API response is bounded to 16 MiB; a catalog sync has a five-minute deadline and individual API calls have a 30-second timeout. The app does not have a stable SoundCloud cursor or offset-based resume, and it does not resume a partial sync. A complete candidate catalog is held in memory and replaces the encrypted snapshot only after all pages validate; failed or interrupted syncs keep the last completed snapshot. A catalog larger than the limit is rejected with the previous snapshot preserved.

One instance is enforced per Windows session.

## Connect SoundCloud

1. Use your Artist Pro account to register an API app following https://developers.soundcloud.com/docs/api/register-app.
2. Configure its redirect URI as `http://127.0.0.1:49832/callback`.
3. Enter the Client ID and secret in the app's SoundCloud page. Never send the secret in chat.
4. Select Connect with SoundCloud and authorize in your browser.

This personal build accepts user-owned credentials; it does not ship a shared client secret. Public distribution should use a properly secured server-side integration. Live OAuth requires valid credentials and an accepted registered redirect URI; it has not been verified against the user's account. Uploads run inside the desktop app. Detailed Artist Insights open SoundCloud in your browser. Release and upload dates are local planning reminders; they do not schedule SoundCloud publication. Link records do not collect click analytics, upload status only reflects locally available responses, and catalog counters are snapshots rather than time-series analytics.

Local workspace metadata is stored under the app's Windows roaming app-data directory. Audio stays in its original location. Backups include file paths, not audio/artwork bytes or credentials. AIFF and other codec playback depends on Chromium support. Removing workspace records preserves source files. Disconnect removes this app's local tokens; revoke the app through SoundCloud to revoke authorization remotely.

## Design references

- https://learn.microsoft.com/en-us/windows/apps/develop/ui/windows-app-sdk-app-structure
- https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics
- https://learn.microsoft.com/en-us/windows/apps/design/style/mica
- https://www.electronjs.org/docs/latest/api/browser-window
- https://developers.soundcloud.com/docs

Windows-inspired layout uses Segoe UI, sidebar navigation, native caption buttons, restrained cards, orange accents, inline status messages, and a persistent media bar. This is Electron, not a WinUI application.

- Expanded artist profile with tagline, bio, genre, location, SoundCloud and website links, local preview, and copyable artist bio. Profile details are included in workspace metadata backups.

- Startup splash and first-run artist profile setup; profile information is retained in the local workspace for future launches.
