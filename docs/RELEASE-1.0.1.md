# SoundHub 1.0.1

This release updates the application window and tray labels, installer catalog and consent page, user interface, and updater prompts to use the unified SoundHub name.

The installer keeps the existing Windows application identity, consent registry key, and `%APPDATA%\Soundcloud Desktop` data directory so upgrades continue to use the workspace, encrypted SoundCloud account data, and consent record already on this PC. The previous product-name fragments in these internal identifiers are compatibility details, not product branding. Existing GitHub releases that use the previous installer filename remain recognized by the updater.

Build the Windows x64 installer with `npm run dist:installer`. The output is `dist/SoundHub Installation Manager-Setup-1.0.1.exe`.
