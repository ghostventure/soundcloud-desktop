# SC Artist / Soundcloud Desktop User Guide

**For version 0.2.9 on Windows**

This guide covers first-time setup, connecting SoundCloud, finding your current SoundCloud tracks, preparing uploads, and organizing releases. Your local music library and your online SoundCloud catalog are separate views.

## Quick start

1. Open the app and complete the artist or studio profile if prompted. Only the name is required.
2. Open **SoundCloud** in the left navigation and connect your account.
3. Select **Sync catalog** to load your SoundCloud tracks.
4. Open **Overview** to see the current-tracks preview, or use **SoundCloud** to browse the complete synced catalog.
5. To upload music from this PC, import it into **Music library**, then prepare and review the upload before sending it.

## First launch and artist profile

The splash screen appears while the local workspace loads. A new, empty workspace asks for an artist or studio name. Genre, location, and a short introduction are optional. The app remembers the profile on this PC for later launches.

Use **Settings** to edit your name, genre, location, tagline, bio, SoundCloud profile URL, and website. The profile preview shows how those details fit together. **Copy artist bio** copies a formatted version to the clipboard; it does not publish the profile.

## Connect your SoundCloud account

This personal build uses credentials from your own SoundCloud API application.

1. Open SoundCloud's [API app registration page](https://developers.soundcloud.com/docs/api/register-app) and create an app or open one you already registered. SoundCloud's registration instructions currently require an Artist Pro account.
2. Set the app's redirect URI to exactly:

   `http://127.0.0.1:49832/callback`

3. In SC Artist, open **SoundCloud**. Enter the app's **Client ID** and **Client secret**, then select **Save credentials**.
4. Select **Connect with SoundCloud**. In the browser, sign in to the intended account and approve access.
5. Return to SC Artist. It completes the connection and syncs the catalog.

The Client secret is encrypted for your Windows account on this PC. Do not share it in chat or include it in a workspace backup. The app does not import your browser cookies or password.

### If the browser request is hard to find

If SC Artist says an authorization request is already open, switch to the browser with **Alt+Tab** or select it on the taskbar, then check its open tabs for SoundCloud's authorization page. Finish that request instead of selecting Connect again. If no authorization page is present, the pending request expires after five minutes; then start a fresh connection attempt.

## See your current SoundCloud tracks

After a successful connection and catalog sync:

- **Overview** shows account followers and track totals, catalog plays and likes, the catalog's public/private counts, and the three most-played tracks. It also shows up to five current tracks with visibility, plays, and likes.
- Select **Sync catalog** to refresh the snapshot, or **View full catalog** to open the complete list.
- The **SoundCloud** page shows the synced catalog in pages of up to 100 tracks, along with follower and catalog totals.
- Open **Artist Insights** for SoundCloud's detailed time-based analytics.

The preview and catalog are snapshots from the last sync, not a live feed. Catalog play and like totals are summed from the tracks returned by that sync. The account profile also keeps a local daily history of follower and track counts when a complete sync succeeds, for up to 366 days. It does not provide time-series play or like analytics. Confirm that you connected the intended SoundCloud account if the figures or track list do not look right.

### Catalog controls and sync history

On **Overview**, use **Customize Overview cards** to hide or reorder the summary cards. On **SoundCloud**, the catalog tools support sortable columns, optional columns, metadata search, grouping, saved filters, removable filter chips, and multi-selection. These choices are saved on this PC. The sync comparison and catalog change history compare saved snapshots; they do not provide a live feed or a complete SoundCloud activity log.

Catalog sync follows SoundCloud's sequential `next_href` pagination, with up to 200 tracks per page, 50 pages, and 10,000 tracks total. Each API response is limited to 16 MiB. A full sync has a five-minute deadline; an individual API call times out after 30 seconds. If the catalog exceeds the cap or a sync is interrupted, the last completed snapshot is preserved. Settings can show the sanitized checkpoint status, but this build cannot resume from a cursor or reliably detect page gaps in a changing remote catalog. Local absence tombstones become confirmed only after a track is absent from two complete successful syncs; this is not proof that SoundCloud deleted the track.

### Track toolkit

Open **Track toolkit** to review local tracks before upload, check for missing metadata, inspect local or synced track details, and manage pinned and recently opened tracks. Details can include a local audio waveform or an inline SoundCloud preview when the file, account, and track permissions allow it. You can copy a SoundCloud URL or share card, open the track on SoundCloud, and use the keyboard shortcut reference. Batch upload review requires a separate confirmation before any upload begins; choosing Public can make a track visible to everyone.

### Workspace navigation and accessibility

Use **Ctrl+K** to open the command palette and search for pages or available actions. Display preferences include higher contrast, compact spacing, and text scaling. Overview metric explanations clarify whether counts come from the local workspace or the last SoundCloud sync. Sync status and activity summaries are local convenience information.

The activity history records a limited number of recent local actions. One-step undo is available for edits to existing track, release, and campaign records; it does not undo newly added or removed records.

### Multiple SoundCloud accounts

After saving your SoundCloud app credentials, you can add and switch between saved account logins from the SoundCloud page. Each saved account is bound to its verified SoundCloud identity; the app checks that identity when connecting and syncing. Account tokens, OAuth scopes, and catalog snapshots are kept separately and encrypted for your Windows account. Finish any upload, sync, or authorization operation before switching or removing an account. The same saved app credentials are used for the accounts in this app.

## Import and organize music on this PC

The **Music library** contains local audio files that you add to the workspace. It does not automatically mirror your online SoundCloud catalog.

1. Open **Music library** and select **Import tracks**, or drag audio files into the workspace.
2. Supported extensions are MP3, WAV, FLAC, OGG, M4A, AAC, and AIFF.
3. Search by title, genre, or notes. Use the status filters to find drafts, mixes, masters, or released tracks.
4. Play a track, edit its workspace metadata, or reveal its original file in Explorer.

Importing adds a reference to the original file; it does not move, upload, or duplicate the audio. New imports are hashed and compared with cached hashes to skip exact-byte duplicates. Existing library records without a cached hash are not read and hashed in bulk, so they are not deduplicated until re-imported or otherwise given a digest. This is exact file-content matching, not audio fingerprinting: re-encoded copies can differ. Playback depends on the codec supported by the app.

The **Upload desk** adds a library organizer for sorting and bulk metadata updates, upload presets, reusable description/credits templates, a draft queue, and local reminders. A reminder is only for your own planning; it does not schedule a SoundCloud publication.

## Prepare and upload a track

1. Connect SoundCloud, then open **Upload music** or **Upload desk**.
2. Choose a local library track and review its title, artist, genre, description/credits, artwork, and visibility. **Upload desk** shows this as a preflight review; **Upload music** opens the upload details dialog.
3. **Private** is the default. A private track is only available to you and people with its link.
4. If you choose **Public**, confirm that you understand the track will be visible to everyone when SoundCloud finishes processing it.
5. To prepare without sending, choose **Save to draft queue** in **Upload desk**. When ready, select **Upload now** there, or use **Upload track** in **Upload music** and submit the upload dialog.

The upload screen reports transfer progress and can cancel an in-progress transfer. After SoundCloud accepts the upload, processing may continue on SoundCloud. If a file was uploaded before, the app warns that another upload creates a separate SoundCloud track; review the existing catalog before retrying.

When the app window is hidden, the desktop can show a system alert when an upload is accepted, an upload needs review, or a catalog sync succeeds or fails. Alerts use general wording and do not show track titles or account details. Select an alert to reopen the workspace. Windows notification settings control whether system alerts are shown; in-app notices continue to appear while the window is open.

The app saves local upload attempts and receipts. If the app closes mid-transfer or the response is ambiguous, **Upload desk** keeps the attempt for review and blocks another attempt for the same local track and account. Check your SoundCloud catalog before selecting **I checked SoundCloud** to clear an unknown result. If SoundCloud already has the track, do not retry. This is a local duplicate safeguard only; the API does not guarantee remote idempotency, and clearing the review item does not cancel or remove a SoundCloud upload. Confirmed receipts should be saved into the workspace before clearing their review item. Uploads are streamed from files up to 4 GiB; a transfer is not automatically retried after an ambiguous outcome.

## Plan releases

Use **Releases** for a simple release plan or **Release planner** for the board, calendar, templates, task ownership, due dates, artwork preview, and upload activity.

- Create a single, EP, or album plan.
- Link a track from the local Music library.
- Add artwork and work through the checklist.
- Use board stages and task dates to organize your work.

Release dates, stages, tasks, and reminders are local planning information. They do not schedule or publish tracks on SoundCloud.

## Plan promotion

Use **Promotion** to save campaign drafts, captions, channels, dates, contacts, and links. **Promotion tools** includes reusable announcement and pitch templates, organized links, and local follow-up notes. These tools prepare material for you; the app does not send messages or collect link-click analytics.

## Save and restore your workspace

The workspace is stored for your Windows user. Use **Settings → Export workspace backup** to save profile and workspace metadata. New JSON backups include a SHA-256 checksum to detect accidental changes; the checksum does not prove who created the file and is not a signature. Older raw JSON backups remain supported, but have no checksum and are still structurally validated. Backups include audio file paths, not the audio files themselves; copy audio and artwork separately when moving to another PC. Credentials and SoundCloud tokens are excluded. Backup files are limited to 32 MiB.

**Restore a backup** replaces the current workspace after confirmation. Before replacing it, the app creates a copy of the current workspace metadata.

The restore preview shows the records that will be added, changed, or removed. Before replacing the workspace, the app saves a local copy of the current metadata. The preview and pre-restore copy are local safeguards; they do not include audio/artwork bytes or SoundCloud credentials.

### Automatic workspace recovery

Use **Settings → Review recovery points** to inspect available local recovery candidates by timestamp, profile name, and record counts. Restoring requires a confirmation preview and preserves the current workspace copy first. The app keeps up to eight automatic history files plus the separate previous-workspace copy; it only creates a new history point at most once every 30 minutes, caps stored recovery data at 256 MiB, and limits candidate enumeration to 256 MiB. Recovery points contain workspace metadata and file references only. Audio and artwork remain in their original locations and are not embedded.

### Health checks and support bundle

In **Settings → System health & support**, select **Refresh system health** to check workspace readability/writability and credential-vault/connection status. The view may also show a sanitized catalog sync checkpoint. These checks report current access and do not change Windows folder permissions.

Select **Export support bundle** to save a JSON file containing app/system versions, projected health checks, and recent sanitized event categories/codes. It excludes workspace contents, credentials, account identifiers, local paths, and raw error messages. Review the file before sharing it.

The **SoundCloud access & quotas** panel shows the active account's reported OAuth scope string and any recent per-route quota observations returned in SoundCloud response headers. The observations may include limit, remaining requests, reset time, and observation time. They vary by endpoint and can expire; the app does not set or display invented local quotas. See SoundCloud's [API guide](https://developers.soundcloud.com/docs/api/guide) for OAuth responses and [rate-limit reference](https://developers.soundcloud.com/docs/api/rate-limits.html) for header semantics.

### Check for app updates

In **Settings**, select **Check GitHub for updates** when you want to check the latest stable release. The installed 64-bit Windows build can download the official NSIS setup file and verify its SHA-256 digest against GitHub's release metadata. After verification, setup opens visibly only after you confirm; the app does not install it silently. This check does not verify an Authenticode publisher signature, so Windows may report an unknown publisher for the unsigned installer.

Portable builds can check the stable release and open its validated official GitHub page, but cannot replace themselves in place. Download the portable build and replace the existing executable manually. Update checks are user initiated; there is no background polling or automatic download.

## Common issues

| What you see | What to do |
| --- | --- |
| The SoundCloud track panel is empty | Connect the account, then select **Sync catalog**. The local Music library is a separate list. |
| The account appears connected, but tracks are old | Select **Sync catalog** and check the last-synced time. |
| “Authorization request is already open” | Find and finish the existing SoundCloud browser request. If it is missing, wait for the five-minute request to expire, then reconnect. |
| Authorization returns to the app without connecting | Confirm that the registered app's redirect URI exactly matches `http://127.0.0.1:49832/callback`, and check that the Client ID and secret belong to that app. |
| Upload is unavailable | Connect SoundCloud first. You can still save an upload draft locally while disconnected. |
| A track will not play | Playback depends on Chromium's support for that file's audio codec. The original remains in its source folder. |

## Keyboard and navigation tips

- **Ctrl+I** opens the audio import flow.
- **Ctrl+N** starts a new release.
- **Space** plays or pauses local audio when focus is not in a form control.
- Use **Tab** and **Shift+Tab** to move between controls; press **Enter** or **Space** to activate the focused control.
- **Help & connection** contains searchable workflow tips and the connection status saved on this PC.

## Related documentation

- [Version 0.2.7 release notes](RELEASE-0.2.7.md)
- [Version 0.2.8 backend coverage and limits](RELEASE-0.2.8.md)
- [Version 0.2.9 backend coverage and limits](RELEASE-0.2.9.md)
- [Version 0.2.6 release notes](RELEASE-0.2.6.md)
- [Version 0.2.5 release notes](RELEASE-0.2.5.md)
- [Startup and first-run profile](STARTUP-0.2.4.md)
- [Artist profile details](ARTIST-PROFILE-0.2.3.md)
- [Project README](../README.md)

## SoundCloud listener comments

Open **SoundCloud → Comments**, choose a track from the active account’s last synced SoundCloud catalog, then select **Load comments**. Loading is user initiated; opening the page does not request comments. Each click sends one documented `GET /tracks/{track_urn}/comments` request with `linked_partitioning=true&limit=100`. The app displays up to 100 results for that request and does not automatically fetch additional pages. Search matches listener names and comment text; the All, Timed, and General filters distinguish comments with or without an API timestamp. When SoundCloud returns a creation date or track position, the app displays it. Use **Open track** to visit the track on SoundCloud.

This feature only allows tracks in the active account’s synced `/me/tracks` catalog. It does not fetch comments across the catalog, post or edit comments, scrape SoundCloud pages, or provide SoundCloud sentiment analysis. The OpenAPI schema allows a `limit` up to 200; this app deliberately requests 100 per action. SoundCloud publishes a general default budget of about 100 API requests per application per minute, with live limits reported in response headers; it does not publish a comments-specific quota in its rate-limit guide. The app also limits the comments IPC action to 12 calls per minute from this window. If SoundCloud responds with rate limiting, wait for the service’s retry interval before trying again.
