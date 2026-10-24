# SC-DS security and local data protection

SC-DS uses several separate protections. They reduce exposure and detect common tampering or corruption; they do not make a Windows PC immune to malware running as the signed-in user.

## Local files

- The workspace and recognized recovery copies are encrypted for the current Windows account with Electron `safeStorage`, backed by DPAPI. Valid legacy plaintext workspace files migrate to encrypted files at startup. Legacy files that cannot be validated remain untouched and cause the Settings health indicator to report that protection needs attention.
- SoundCloud credentials, OAuth tokens, encrypted sync state, and upload receipts use the same Windows account protection. They are not uploaded to Black Lion Studios.
- Electron local browser storage holds some interface preferences and history. Artwork copies are also local files. SC-DS does not separately encrypt those items.
- Original audio remains in the user's chosen folders and is not copied into the app profile.
- Workspace backups are readable JSON because they are intended to be portable. The app warns before export. A backup checksum detects changes or corruption; it is not a digital signature and does not prove who made the file.

## Tamper and recovery controls

- Workspace saves are validated, size limited, serialized, flushed, and atomically replaced. SC-DS detects when the active workspace file changes outside the app so it does not silently overwrite newer edits.
- Encrypted workspace and account records use DPAPI authenticated encryption; invalid or modified ciphertext cannot be loaded as trusted data. Workspace records also pass structural validation before use.
- Recovery copies are encrypted, bounded, and reviewed before restore. Restore saves the current workspace before replacing it.
- Electron runs the app from an ASAR archive with embedded ASAR integrity validation and `onlyLoadAppFromAsar`; the production renderer is sandboxed, isolated from Node.js, and has DevTools disabled.
- The renderer uses a restrictive content security policy. Main-process IPC validates the sender, frame, request shape, and request rate. Navigation, popups, webviews, downloads, and browser permissions are denied.

## Updates and release signing

Updates are fetched directly from the fixed GitHub repository. Before SC-DS opens an installer, it checks the release's SHA-256 metadata. If a Windows Authenticode signature is present, it must be valid and identify Black Lion Studios. The checks are repeated immediately before launch. An unsigned update relies on the fixed repository's GitHub release metadata and HTTPS transport; the checksum confirms the bytes match the release metadata but does not independently authenticate the publisher.

Windows release builds do not require code signing. Signing is optional; if used, the updater requires a valid Black Lion Studios publisher signature. Never commit a certificate, password, or private key. Unsigned installers may trigger a Windows unknown-publisher warning when opened directly.

## User controls

Settings shows whether workspace and recovery encryption is active. Workspace export presents a plain-language warning before the save dialog. Use **Settings â†’ Privacy & third-party notices** for the complete list of local data and external services.

