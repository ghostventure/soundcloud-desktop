# Artist workspace UX update

This update adds three focused workspace areas: Upload desk, Release planner, and Artist workspace tools.

## Upload desk

- Guided first-run setup and an upload preflight review.
- Duplicate warnings, recoverable local drafts, title/genre/visibility presets, and reusable description templates.
- Sortable library details and batch genre, status, and notes editing.
- Local planned upload dates and reminders. These do not schedule publication on SoundCloud.
- Private visibility remains the default; public upload requires explicit confirmation.

## Release planner

- Kanban stages, a release calendar, and single, EP, album, and saved custom templates.
- Per-checklist-item owner and due date, local reminders, and readiness summaries.
- Local audio format, file size, and duration details. Artwork crop controls are a preview; they do not rewrite image files.
- Latest locally saved upload response and a retry path with duplicate-risk confirmation. The current upload API does not provide a complete remote processing or failure history.

## Artist workspace tools

- Customizable dashboard, release readiness/next actions, and searchable contextual help.
- Promotion campaign templates, locally organized links, and contact follow-up notes.
- Undo and recent-change history for supported workspace edits.
- SoundCloud connection summary and reconnect navigation based on the locally available account snapshot.

## Service boundaries

The SoundCloud API available to this desktop client does not expose publication scheduling, click analytics, complete processing events, or artwork crop transforms. Planning dates and link records remain local. Upload response history is limited by the responses the current API returns. SoundCloud's detailed analytics remain available through its official Artist Insights page.
