# Soundcloud Desktop 0.2.7

## More control over the synced catalog

- Sort catalog columns, choose which columns are visible, and search titles, IDs, URLs, and saved descriptions.
- Save filters, remove individual filter chips, group catalog rows, and select multiple tracks.
- Compare follower, track, play, and like totals with the previous sync and review a bounded catalog change history.
- Hide or reorder Overview cards and use labels that explain how snapshot metrics are calculated.

Catalog values still reflect the latest successful SoundCloud sync. The change history compares those local snapshots and is not a live or complete SoundCloud activity log.

## Track tools and review

- Review local tracks for missing upload metadata and choose visibility before an explicitly confirmed batch upload.
- Open detail panels for local tracks, synced SoundCloud tracks, and release plans.
- Generate a waveform from supported local audio, play available SoundCloud previews, copy track URLs or share cards, and open tracks on SoundCloud.
- Pin frequently used items, return to recently opened items, and view the shortcut reference.

SoundCloud previews depend on account authorization and track availability. Local waveform generation depends on supported audio decoding and file size.

## Workspace controls

- Use **Ctrl+K** for the command palette.
- Set high contrast, compact spacing, and text scaling.
- Review recent local activity and use one-step undo for edits to existing records.
- Add and switch between encrypted SoundCloud account logins.

## Backend efficiency

SoundCloud pages are normalized into snapshot records as they arrive while requests remain sequential. New snapshots keep up to 2,000 description characters per track. At the 10,000-track sync limit, this caps retained description text at 20 million characters per account rather than a possible 120 million. Existing encrypted snapshots keep their saved descriptions until the next successful sync.

Internal workspace JSON is compact to reduce serialization and disk overhead. Workspace backups remain indented and readable. Atomic file replacement and queued asynchronous saves are preserved.

For setup and workflows, see the [user guide](USER-GUIDE.md).
