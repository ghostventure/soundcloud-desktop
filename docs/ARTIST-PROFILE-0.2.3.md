# Artist profile update

The artist profile in Settings now supports a display name, tagline, short bio, primary genre, location, SoundCloud profile URL, and website. The page shows a preview and can copy a formatted bio to the clipboard.

Profile fields are saved locally with the workspace and included in workspace metadata backups. Profile URLs are only stored and copied; they are not opened or published by the app. Existing workspaces and backups remain compatible, with empty values shown for fields they do not contain.

## Storage and backups

The profile is local workspace metadata in the app's per-user Windows roaming app-data folder. It is not sent to SoundCloud. A workspace metadata backup includes these profile fields along with other saved workspace records. Backups do not contain audio or artwork bytes, API credentials, or authentication tokens. Keep the backup file private if you do not want to share the profile or other included workspace metadata.

Restoring a workspace backup restores its profile values as part of the workspace data. The app makes a pre-restore copy of the existing workspace metadata; see the storage notes in the main [README](../README.md).

## Upgrade notes

Version 0.2.3 retains the existing workspace format and reads older workspace data with blank profile fields. Install the versioned Windows setup package over the existing per-user installation to update it; the app's workspace is stored separately from the program files. Use the matching versioned portable package if you use the portable build. Check the GitHub release page for the package assets and published checksums before downloading. Release availability depends on the repository's published assets.
