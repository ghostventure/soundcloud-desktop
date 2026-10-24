# SoundCloud API-backed UX scope

## Provenance and scope

The repository and retained agent handoffs do not contain the original itemized 50-idea UX list. Its individual titles cannot be reconstructed reliably, so this document does not assign new features to those ranks or claim that a particular number of the 50 is supported. The earlier claim that exactly 12 ideas were supported is unverified without that list.

For this cleanup, an item stays active only when the SoundCloud Public API OpenAPI document describes the resource or action. Do not scrape web pages, call private endpoints, infer private analytics, or claim SoundCloud Team messages are available through the API. Local-only ideas are outside this SoundCloud-supported list.

## API-backed features already in the 0.3.0 source

- **Activity feed:** Read-only authenticated `GET /me/feed`, bounded pagination, local filters, freshness labels, and account-scoped in-memory results.
- **Listener comments:** User-initiated comments review for one track from the active account's synced catalog. One bounded request; no replies, moderation, or catalog-wide fanout.
- **Performance milestones and digest:** Thresholds checked after a successful manual sync and export of saved API snapshots with observed adjacent-snapshot differences. These are not real-time analytics.
Existing SoundCloud-backed capabilities include the account profile and catalog sync, catalog metrics and snapshot comparisons, upload receipts, and SoundCloud track links. These are not counted as new features in this pass.

## Additional API-backed implementation on the follower-review branch

- **Recent tracks from followed artists:** A user-initiated, one-page `GET /me/followings/tracks` snapshot of up to 25 tracks, scoped to the active account and held in memory only. This feature is implemented in the isolated feature branch and is not part of the already-built 0.3.0 installer.

## Excluded from the active list

- SoundCloud Team announcements or inbox: no such resource is documented in the public API.
- Remote track processing-status refresh/history: the published Track schema does not expose a processing-state field, and no supported processing-history endpoint is documented.
- Local-only workflow suggestions: not SoundCloud API capabilities, so they are not part of this API-supported pass.

## Verification boundary

Use only documented SoundCloud API endpoints and fields, bound request size and frequency, and show when data was retrieved. Skip smoke tests as requested; package/install verification is handled separately from this scope document.
