# Soundcloud Desktop 0.2.8 source update

This note describes the source and package metadata at version 0.2.8. The Windows x64 setup and portable packages were built and published on GitHub: [v0.2.8 release](https://github.com/ghostventure/soundcloud-desktop/releases/tag/v0.2.8). The first 50 ranks were a priority pass over backend work, not 50 newly added features: several protections already existed, and several capabilities are limited by SoundCloud's API.

## Ranked-pass coverage

The original item-by-item title list was not retained in the repository. The table names exact ranks only where a handoff or integrated code supports that mapping; grouped ranges are identified as such rather than assigned invented titles.

| Rank(s) | Coverage in the integrated source | Status |
| --- | --- | --- |
| 1–6, 9–12 | The top-12 audit found these items already covered in the starting source. Their original titles are unavailable, so this note does not assign feature names to individual numbers. | Existing |
| 7 | Local per-track/account upload-attempt guard. | Implemented locally; remote idempotency is unsupported by this integration. |
| 8 | Persistent upload-attempt journal and receipt recovery. | Implemented locally; ambiguous outcomes require checking the SoundCloud catalog. |
| 13–25 | Integrated restore preview and bounded restore input, upload receipt recovery, and numeric-ID/URN compatibility. The individual rank titles were not preserved. | Implemented or hardened; exact rank-to-feature mapping unavailable. |
| 26 | OAuth state validation and PKCE are present. An OIDC nonce flow is unsupported. | Partial |
| 27 | Versioned encrypted credential-vault migration is present through Windows-protected storage. Custom vault-key rotation is unsupported. | Partial |
| 28 | Stale/revoked local tokens are cleared after invalid authorization responses. | Implemented |
| 29 | Effective data-folder and workspace read/write checks are exposed in health status; the app does not rewrite Windows ACLs. | Implemented |
| 30 | Central redaction is applied to diagnostic errors and startup/IPC reporting. | Implemented |
| 31 | Renderer crash events retain only a bounded reason category; no raw stack or external crash dump is collected. | Partial |
| 32 | An opt-in support bundle exports projected health and sanitized event categories without workspace content or credentials. | Implemented |
| 33 | Backend workspace and credential health checks are exposed to Settings. | Implemented |
| 34 | Workspace writes and restores pass the versioned workspace validator. | Implemented |
| 35 | The API circuit opens after three consecutive transient failures and cools down for 30 seconds. | Implemented; in-memory and process-wide. |
| 36 | API calls, catalog sync, previews, and uploads have bounded operation deadlines. | Implemented with fixed limits. |
| 37 | Network, timeout, rate-limit, response, and authorization failures are normalized to stable error categories/codes. | Implemented |
| 38–50 | Integrated reliability work includes bounded sequential catalog paging and responses, encrypted sync checkpoints, catalog sync metadata/tombstones, upload streaming and receipt validation, and atomic workspace/vault persistence. The original per-rank titles are unavailable. | Mixed: implemented controls with the limitations below; exact rank-to-feature mapping unavailable. |

The integrated source also carries strict IPC argument schemas, sender/main-frame validation, per-channel payload/rate bounds, and record-scoped media protocol authorization. The surviving handoffs disagree on the original rank numbers for these controls, so they are documented by capability without assigning a rank.

## Catalog and API limits

- Catalog pages are requested sequentially using SoundCloud's same-origin `next_href`; each page is limited to 200 tracks, with a maximum of 50 pages or 10,000 tracks per sync.
- Each SoundCloud API response is capped at 16 MiB. Individual API calls time out after 30 seconds, previews have a 60-second deadline, OAuth authorization expires after five minutes, and a full catalog sync has a five-minute deadline. Uploads stream files up to 4 GiB and use a 15-minute default operation deadline.
- There is no stable remote cursor/offset resume, sync resume, or reliable page-gap detection. A bounded encrypted checkpoint reports interrupted progress, but it does not resume the sync. The complete candidate catalog remains in memory until validation finishes, then replaces the saved encrypted snapshot atomically. Failure preserves the last completed snapshot.
- Local tombstones mark a track pending after one complete successful sync omits it, and confirmed absent after a second complete successful sync also omits it. This is local absence history, not proof of deletion by SoundCloud. Tombstone history is capped at 10,000 records.
- Unknown API fields are retained only as bounded primitive values: at most 16 fields per track, 512 characters per string, and 256 KiB total across a catalog snapshot. Secret-like field names are excluded.
- Rate-limit `Retry-After` information is bounded to 24 hours and surfaced as a cooldown. The API circuit breaker is in memory. Upload POST requests are not automatically retried.

## Upload recovery and duplicate safety

Upload receipts, accepted attempts, and uncertain outcomes are stored in a local journal. The journal prevents another attempt for the same local track and account while an attempt is active, accepted, or unresolved. It is a local guard only: SoundCloud does not guarantee remote idempotency for these uploads.

If the app closes during a transfer or cannot confirm its outcome, open **Upload desk** and check the SoundCloud catalog before clearing the review item. If the track is already there, do not retry. Clearing the local item does not cancel or delete a SoundCloud track. A confirmed remote receipt is kept for review until its local workspace details are saved. This app does not expose SoundCloud's full remote processing history.

Restore preview counts the local workspace records that would be added, changed, or removed. Restore reads backups up to 32 MiB and creates a pre-restore copy. These safeguards do not roll back SoundCloud changes and do not include credentials or audio/artwork bytes.

## Unsupported or remote-owned behavior

The app cannot schedule SoundCloud publication, provide time-series analytics beyond SoundCloud's own pages, guarantee remote upload idempotency, or resume catalog sync from a stable cursor. It does not collect SoundCloud's full remote processing history. Confirmed catalog metrics are snapshots from the last successful sync. See the [user guide](USER-GUIDE.md) for the corresponding workflows and recovery steps.
