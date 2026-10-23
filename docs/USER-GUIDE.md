# SC Artist / Soundcloud Desktop User Guide

**For version 0.2.6 on Windows**

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

The preview and catalog are snapshots from the last sync, not a live feed. Catalog play and like totals are summed from the tracks returned by that sync. Confirm that you connected the intended SoundCloud account if the figures or track list do not look right.

## Import and organize music on this PC

The **Music library** contains local audio files that you add to the workspace. It does not automatically mirror your online SoundCloud catalog.

1. Open **Music library** and select **Import tracks**, or drag audio files into the workspace.
2. Supported extensions are MP3, WAV, FLAC, OGG, M4A, AAC, and AIFF.
3. Search by title, genre, or notes. Use the status filters to find drafts, mixes, masters, or released tracks.
4. Play a track, edit its workspace metadata, or reveal its original file in Explorer.

Importing adds a reference to the original file; it does not move, upload, or duplicate the audio. Playback depends on the codec supported by the app.

The **Upload desk** adds a library organizer for sorting and bulk metadata updates, upload presets, reusable description/credits templates, a draft queue, and local reminders. A reminder is only for your own planning; it does not schedule a SoundCloud publication.

## Prepare and upload a track

1. Connect SoundCloud, then open **Upload music** or **Upload desk**.
2. Choose a local library track and review its title, artist, genre, description/credits, artwork, and visibility. **Upload desk** shows this as a preflight review; **Upload music** opens the upload details dialog.
3. **Private** is the default. A private track is only available to you and people with its link.
4. If you choose **Public**, confirm that you understand the track will be visible to everyone when SoundCloud finishes processing it.
5. To prepare without sending, choose **Save to draft queue** in **Upload desk**. When ready, select **Upload now** there, or use **Upload track** in **Upload music** and submit the upload dialog.

The upload screen reports transfer progress and can cancel an in-progress transfer. After SoundCloud accepts the upload, processing may continue on SoundCloud. If a file was uploaded before, the app warns that another upload creates a separate SoundCloud track; review the existing catalog before retrying.

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

The workspace is stored for your Windows user. Use **Settings → Export workspace backup** to save profile and workspace metadata. Backups include audio file paths, not the audio files themselves; copy audio and artwork separately when moving to another PC. Credentials and SoundCloud tokens are excluded.

**Restore a backup** replaces the current workspace after confirmation. Before replacing it, the app creates a copy of the current workspace metadata.

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

- [Version 0.2.6 release notes](RELEASE-0.2.6.md)
- [Version 0.2.5 release notes](RELEASE-0.2.5.md)
- [Startup and first-run profile](STARTUP-0.2.4.md)
- [Artist profile details](ARTIST-PROFILE-0.2.3.md)
- [Project README](../README.md)
