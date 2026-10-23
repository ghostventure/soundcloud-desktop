# Workspace responsiveness and storage update

This build reduces main-process work during audio import and playback, limits rendered library rows, and moves workspace disk writes onto a serialized asynchronous queue.

- Multi-file imports check each unique path once and use asynchronous file metadata reads.
- Workspace updates write to unique temporary files and are serialized before atomic replacement, avoiding shared temporary-file races.
- Renderer saves validate local file references against the in-memory workspace without first cloning the entire workspace.
- Audio and artwork protocol requests resolve a single stored path instead of cloning every workspace record for each media request.
- Artwork copies and workspace backup/restore file operations use asynchronous filesystem APIs.
- The Music library, Upload desk organizer, and synced SoundCloud catalog render up to 100 rows at a time.

The desktop app remains local-first. The SoundCloud catalog sync still respects the API's paginated response flow and preserves the last successful snapshot if it cannot complete.
