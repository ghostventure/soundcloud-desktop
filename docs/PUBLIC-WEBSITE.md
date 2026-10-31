# SoundHub public website

- **Product release represented:** 1.0.1 · Windows 10/11 x64
- **Public site:** <https://soundhub-by-black-lion-studios.web.app/>
- **Online user guide:** <https://soundhub-by-black-lion-studios.web.app/guide.html>
- **Legal Center:** <https://soundhub-by-black-lion-studios.web.app/legal.html>

## What the website contains

- **Product homepage:** product summary, actual 1.0.1 capabilities, a local-first workflow, SoundCloud connection prerequisites, official track preview, FAQs, and installer/release links.
- **User guide:** illustrated quick start, navigation, profile setup, SoundCloud API registration and connection, catalog sync, audio library, upload review, release and promotion planning, local data, backup/recovery, updates, accessibility, and troubleshooting.
- **Legal Center:** links to privacy, website terms, proposed desktop EULA, acceptable use, data lifecycle, privacy requests, purchases/refunds, copyright/takedown, SoundCloud API attribution, third-party notices, accessibility, security, trademarks, and publisher contact.
- **Discovery assets:** `robots.txt`, `sitemap.xml`, canonical metadata, social-share metadata, and SoftwareApplication structured data.
- **Visual identity:** `soundhub-wave-mark.svg` is the original SoundHub audio-wave badge used for the site mark and favicon. `soundhub-pixel-gallery.png` is the original pixel-art hero image. The wave mark is designed for music and does not reuse SoundCloud's logo or cloud silhouette.

## Product claims and user expectations

The public site now offers the comprehensive 10-page SoundHub 1.0.1 user guide as a direct PDF download at <https://soundhub-by-black-lion-studios.web.app/SoundHub-User-Guide-1.0.1.pdf>. The source guide is `docs/USER-GUIDE.md`; the generated review-ready PDF is `output/pdf/SoundHub-User-Guide-1.0.1.pdf`. The online guide and homepage both link to the PDF.

The public page describes features documented in the current app release: local audio import/playback, release planning, campaign/contact organization, artist profile editing, user-initiated SoundCloud actions, direct uploads, catalog/activity/comments review, and manual-sync snapshots with CSV export. Counts and performance indicators are snapshots rather than real-time analytics. Release dates and reminders are local; SoundHub does not schedule SoundCloud publication. Audio remains at its source location until a user chooses an upload.

SoundHub is independent software from Black Lion Studios. It is not affiliated with, sponsored by, or endorsed by SoundCloud. SoundCloud currently requires an Artist Pro subscription to register an API application and receive credentials. Link to the [current SoundCloud registration instructions](https://developers.soundcloud.com/docs/api/register-app) and review the provider's current terms; access requirements may change.

The current 1.0.1 Windows installer is unsigned and may show a Windows unknown-publisher warning. The GitHub release page includes a SHA-256 checksum. The website's download button should continue to point to the official `releases/latest` page so users see the current installer and release metadata.

## Legal content status

The Legal Center is a topic index, not confirmation that the operator has completed every legal obligation. The linked pages visibly flag the missing publisher legal identity, jurisdiction, mailing address, monitored legal/privacy/security contacts, age audience, provider retention details, and counsel review. The website EULA is marked as proposed and is not currently bundled in the installer. Do not remove or weaken those draft notices until the operator supplies accurate facts, counsel has reviewed the text, and applicable in-app/installer disclosures are updated.

The website does not currently offer account registration, public user uploads, checkout, subscriptions, advertising pixels, analytics, or newsletter signup. It uses Firebase Hosting, requests Google Fonts, and makes user-initiated SoundCloud oEmbed/player requests. Verify those integrations and provider settings whenever the website changes.

## Keep the website and documentation aligned

When publishing a new desktop release:

1. Verify the new stable version, installer filename, operating-system support, checksum, signing state, and release notes from the actual GitHub release.
2. Update the static release badge and release-notes link in `SoundHubMarketingSite/dist/index.html`, its SoftwareApplication `softwareVersion`, the site user-guide version, the online guide metadata, and this document.
3. Recheck each marketing claim against the released application and update the source user guide in `docs/USER-GUIDE.md` plus the online guide page.
4. Update `sitemap.xml`'s `lastmod` values when substantial content changes. Keep `robots.txt` pointed at the public sitemap.
5. Preserve the independence statement, current SoundCloud prerequisites, unsigned-installer disclosure, and legal draft banners until their underlying facts change.
6. Deploy the static source to Firebase Hosting and the owner-private Sites copy; confirm the homepage, guide, artwork, icon, sitemap, and legal routes are live.

## Related source and operations files

- Website source and hosting settings are maintained in the separate `SoundHubMarketingSite` workspace.
- `FIREBASE-DEPLOY.md` in that source directory records the Firebase site, Sites project, and deployment steps.
- `docs/USER-GUIDE.md` remains the source-controlled application manual. The online guide is a web-friendly, illustrated version of the same product instructions.
- `docs/PRIVACY-AND-LICENSES.md` describes disclosures shipped with the desktop application and links to the website Legal Center.
