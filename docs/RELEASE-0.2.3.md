# Soundcloud Desktop 0.2.3

## What's new

- Reorganized the sidebar into Home, Create, Catalog & Releases, Promotion, and SoundCloud groups, with Settings at the bottom.
- Expanded Settings with an artist profile editor for display name, tagline, short bio, primary genre, location, SoundCloud URL, and website.
- Added a profile preview and a command to copy a formatted artist bio.
- Saved profile values with local workspace metadata and included them in workspace metadata backups.

## Install or upgrade

Use the Windows setup installer for a per-user installation, or the portable executable for a portable run. Close the app before updating an existing installation, then run the versioned package from the GitHub release page. The per-user setup installs the program files separately from the local workspace data, so an upgrade retains that data. Workspace metadata backups are still recommended before restoring or moving workspace data.

Download only the assets published on the project's GitHub Releases page and verify them against the checksum file when one is included. This document describes the 0.2.3 release; it does not imply that a GitHub release or particular package asset is currently published.

## Data notes

Profile fields remain on this machine as workspace metadata and are not sent to SoundCloud. Backups include the profile and other workspace records, but exclude audio/artwork bytes and credentials. Profile links are saved and copied; the app does not publish them. See [artist profile details](ARTIST-PROFILE-0.2.3.md) and the [workspace and privacy notes](../README.md).
