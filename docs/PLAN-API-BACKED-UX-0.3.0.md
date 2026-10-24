# SoundCloud API-backed UX plan (0.3.0)

## Scope rule

Keep features that use documented SoundCloud API data or actions. Leave out local-only workflow ideas for this pass, and do not use page scraping, private endpoints, or guesses about SoundCloud Team communications.

The [SoundCloud Public API Explorer](https://developers.soundcloud.com/docs/api/explorer/open-api) documents authenticated activity feeds, track comments, track metadata, uploads, and user/catalog resources. It does not document a separate inbox for official SoundCloud Team announcements.

## Existing capabilities reused

- The catalog stores SoundCloud-provided profile and track counts, captures metric history during sync, and shows snapshot comparisons.
- The UI identifies which data comes from the latest SoundCloud snapshot and already shows upload receipts and available track links.
- Desktop alerts report app upload and catalog-sync outcomes when the window is hidden.

## Implementation wave

1. **Creator activity feed:** Read-only feed from a documented authenticated activity endpoint, with bounded pagination, event filters, freshness labels, and account isolation. No SoundCloud Team messages.
2. **Comments review:** User-initiated review of comments on a selected owned track through the documented track-comments endpoint; bounded results, local filtering/grouping, and safe links back to SoundCloud. No automated replies or moderation actions.
3. **Performance digest and alerts:** Summarize API-provided snapshot changes, let the artist choose milestones, and evaluate alerts only after a user-started sync. Show capture time and observed deltas; do not imply real-time analytics.

## Excluded by SoundCloud API support

- Track processing status: excluded because the documented public Track schema does not provide a processing-state field.
- SoundCloud Team announcements or inbox: no such resource is documented in the public API.
- Local-only workflow ideas: excluded from this API-supported feature wave.

## Verification and delivery

- Agents work in isolated branches; the project manager reviews and integrates each change.
- Run an integrated package build, but skip smoke tests as requested.
- Update the user guide and release notes, build the Windows installer, install it, and verify the installed version and preserved workspace data.
- Do not claim API events or team messages that SoundCloud does not expose.
