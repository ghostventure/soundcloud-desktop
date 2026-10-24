# Soundcloud Desktop 0.3.0 local installation

This release adds three groups of SoundCloud API-backed UX features. The installer is built locally; no GitHub release is claimed by this document.

## Added

- **Activity feed:** Read-only authenticated `/me/feed` data with bounded pagination, filters, freshness details, safe item links, and in-memory account-scoped results.
- **Listener comments:** User-initiated review of up to 100 comments on a selected track from the active account's last synced catalog. Includes search, timed/general filters, timestamps when returned, and a link to the track. No catalog-wide fanout, automatic pagination, replies, or moderation actions.
- **Performance milestones and digest:** Per-account thresholds for follower count, track count, catalog plays, and catalog likes. Thresholds are checked after a successful manual sync. CSV export includes up to 100 timestamped SoundCloud API snapshots and differences from the immediately preceding saved sync.
- **Native desktop alerts:** Existing upload and sync result alerts use generic text when the app window is hidden.

## SoundCloud support limits

These features use documented public API resources and fields. Snapshot deltas are not real-time or scheduled analytics. The app does not show SoundCloud Team announcements or private messages. Track processing status is excluded because the documented public Track schema does not provide a processing-state field. Local-only workflow suggestions are outside this SoundCloud API-supported pass.

## Installation and verification

This build increments the app version to 0.3.0 and is packaged as a Windows x64 NSIS installer. The project manager integrated the feature branches and built the installer. Smoke testing was intentionally skipped as requested. See [the user guide](USER-GUIDE.md) and [the implementation plan](PLAN-API-BACKED-UX-0.3.0.md).
