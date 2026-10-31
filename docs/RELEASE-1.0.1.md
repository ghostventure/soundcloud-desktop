# SoundHub 1.0.1

This release updates the application, installer, user interface, and updater prompts to use the unified SoundHub name.

The installer keeps the existing Windows application identity, consent registry key, and data locations so upgrades continue to use the workspace, encrypted SoundCloud account data, consent record, and local audio import folder already on this PC. The existing `%APPDATA%\Soundcloud Desktop` folder name remains as an internal compatibility path. Existing GitHub releases that use the previous installer filename remain recognized by the updater.

Build the Windows x64 installer with `npm run dist:installer`. The output is `dist/SoundHub Installation Manager-Setup-1.0.1.exe`.
