# Soundcloud Desktop 0.2.9 source update

This document records the integrated source coverage for backend ranks 51-100 and the limits of those capabilities. The source metadata and visible Settings version are 0.2.9. The Windows x64 setup and portable packages were built and published as the [v0.2.9 GitHub release](https://github.com/ghostventure/soundcloud-desktop/releases/tag/v0.2.9); its [SHA-256 manifest](https://github.com/ghostventure/soundcloud-desktop/releases/download/v0.2.9/SHA256SUMS-0.2.9.txt) lists both executable assets. The prior [v0.2.8 release](https://github.com/ghostventure/soundcloud-desktop/releases/tag/v0.2.8) remains available.

## Second-pass coverage

The original item-by-item titles for ranks 51-100 were not retained in the repository or handoffs. The crosswalk below preserves the verified status by rank and names capabilities only where the integrated source or handoff confirms them. The grouped rows are a derived mapping from integrated commits, not reconstructed original titles. Counts describe coverage, not newly added features: 42 implemented, 2 partial, and 6 unsupported.

| Rank(s) | Status | Verified capability mapping |
| --- | --- | --- |
| 51-74 | Implemented (24) | Integrated second-pass capabilities are described below; original individual rank titles and ordinal assignment were not retained. |
| 75 | Partial | Portable builds can check the latest stable GitHub release and open its validated official release page. In-place portable replacement is unsupported; replace the executable manually. |
| 76-86 | Implemented (11) | Integrated account, upload, workspace, and API-status capabilities are described below; original individual rank titles and ordinal assignment were not retained. |
| 87 | Partial | New imports receive a SHA-256 content hash and can be compared with cached hashes. Existing records without a hash are not backfilled or deduplicated. |
| 88 | Unsupported | Media-inclusive backups are not provided. Workspace backups keep audio/artwork file references only. |
| 89 | Implemented | Workspace backup checksum envelope, with backwards-compatible restore of legacy raw JSON. |
| 90 | Implemented | Settings recovery-candidate review and confirmed restore, with the current workspace preserved first. |
| 91-94 | Implemented (4) | Verified integrated capabilities are described below; original individual rank titles and ordinal assignment were not retained. |
| 95-99 | Unsupported (5) | The source does not resume sync from a remote cursor or guarantee gap detection (95-96); SoundCloud provides no upload idempotency contract or full processing-history endpoint in this integration (97-98); publication scheduling remains local planning only (99). These are verified capability limits, not reconstructed original rank titles. |
| 100 | Implemented | The integrated source keeps a bounded local daily catalog-metric history; the original rank title was not retained. |

## Implemented capability details

### GitHub stable updates

Update checks are user initiated and use the repository's latest stable GitHub release. The installed 64-bit Windows NSIS flow selects the version-matching setup asset, requires GitHub's SHA-256 digest metadata, bounds the downloaded installer to 250 MiB, and compares the downloaded bytes against that digest. It rechecks the staged installer before handing it to Windows. The installer opens visibly only after the user confirms; the app does not install silently.

The portable flow is intentionally partial: it checks the same stable release and provides a validated link to the official release page, but does not replace the running executable. Download and replace a portable copy manually. The updater does not check Authenticode publisher identity. These installers are unsigned, so Windows may show an unknown publisher warning. A SHA-256 match to GitHub release metadata is an integrity check against that metadata, not a publisher signature.

### Imports and upload input checks

For newly imported audio, the app streams a SHA-256 digest and compares it with cached digests for same-size library entries. Only exact-byte matches are duplicates; this is not acoustic fingerprinting and does not identify re-encoded audio. Legacy records without a digest are not hashed en masse, so they are not considered by the content-hash check until they have a digest. The cached file size and modification/change times are also checked before treating a prior hash as usable.

Before upload, supported audio file headers are checked against their extensions (MP3, WAV, FLAC, OGG, M4A, AAC, and AIFF). File identity and size are checked around the streamed transfer so a selected file changing during upload is rejected. These checks do not certify that a file is safe or guarantee SoundCloud will accept its encoding.

### Account binding, scopes, quotas, and circuit cooldowns

Each saved account is bound to the SoundCloud user identity returned by the API; a later login that resolves to a different identity is rejected for that saved account. OAuth scopes are sanitized and stored with the encrypted account vault. Settings displays the active account's reported scope string without exposing tokens.

Settings can show up to 12 recent per-route quota observations, including method/route, limit, remaining count, reset time, and observation time when returned. These are observations from SoundCloud response headers, not limits imposed by the app. Quotas vary by endpoint and application and can change; missing headers produce no invented value, and old reset times identify stale observations. See SoundCloud's [API guide](https://developers.soundcloud.com/docs/api/guide) for OAuth token scope responses and the official [rate-limit reference](https://developers.soundcloud.com/docs/api/rate-limits.html) for `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`, and `Retry-After` semantics.

The API circuit breaker is per saved account. After three consecutive transient failures it opens for up to 30 seconds; its cooldown is persisted and restored with account state. This protects local request flow and does not change SoundCloud's server-side quota.

### Backups and recovery

New workspace JSON backups use a SHA-256 checksum envelope. On restore the app recomputes the digest and validates workspace structure. The checksum detects accidental corruption or changes only; it is embedded alongside the data and does not prove authenticity or identify the backup's author. Legacy raw JSON backups without a checksum remain accepted after structural validation. Backup files are capped at 32 MiB.

Settings can list local recovery candidates with timestamp, profile name, and track/release/campaign counts. Restore requires a confirmation preview and saves a copy of the current workspace first. Automatic recovery keeps up to eight history files plus the separate previous-workspace copy, creates a history point no more often than every 30 minutes, caps stored recovery history at 256 MiB, and bounds candidate enumeration to 256 MiB. Recovery and exported backups contain workspace metadata and paths; they do not embed audio or artwork.

### Local daily catalog history

On a successful complete catalog sync, the app records the account's follower count and track count at most once per date, updating that day's sample if counts change. It retains at most 366 daily samples. This is local history of two profile counts, not SoundCloud's time-series play, like, or listener analytics.

## SoundCloud API and sync boundaries

- Catalog sync follows SoundCloud's same-origin `next_href` pagination sequentially. This app accepts up to 200 tracks per page, 50 pages, and 10,000 tracks per sync; each API response is capped at 16 MiB. Calls have a 30-second deadline and a full sync has a five-minute deadline.
- SoundCloud does not provide this app a stable cursor/offset resume contract. Interrupted syncs are not resumed, and a changing catalog cannot be checked for every possible page gap. A bounded encrypted checkpoint reports progress only. The candidate catalog is held in memory until all pages validate, then replaces the saved snapshot atomically; an interrupted/invalid sync preserves the last completed snapshot.
- Local absence tombstones become confirmed only after two complete successful syncs omit a track. That is local evidence of absence, not proof that SoundCloud deleted the track.
- Quota observations are only what SoundCloud reports in response headers. Endpoint policies, application access, rate limits, and API behavior remain SoundCloud-controlled and may change. On a 429 response the app can surface a bounded `Retry-After`; it cannot reserve quota or guarantee a request will succeed.
- Upload receipt journaling and same-track/account guards are local duplicate safeguards. SoundCloud does not guarantee remote upload idempotency here. If an upload result is uncertain, check the SoundCloud catalog before acknowledging the attempt or retrying. The app does not provide remote processing history.

The official API pagination and authentication behavior is documented in the [SoundCloud API guide](https://developers.soundcloud.com/docs/api/guide). Rate-header details are in [SoundCloud rate limits](https://developers.soundcloud.com/docs/api/rate-limits.html).

## Backup and portability limits

Workspace backups and automatic recovery points contain profile/workspace records and local file references only. They exclude credentials, OAuth tokens, audio bytes, and artwork bytes. Moving a workspace to another PC therefore requires copying local media separately; paths may need to be relinked if they change. The 32 MiB exported-backup cap and 256 MiB recovery-history limits are intentional bounds. There is no media-archive backup mode in this pass.

## Version and verification status

The Windows x64 NSIS setup and portable packages were built locally and published with this source update. The setup installation completed successfully; Windows reported ProductVersion 0.2.9.0, and the installed executable's SHA-256 matched the packaged executable. The local workspace and encrypted SoundCloud account vault hashes remained unchanged. GitHub's reported asset sizes and SHA-256 digests matched the local setup, portable, and checksum files. Tests and smoke launches were skipped as requested; the app remains closed.
