# Collection video tutorials

The catalog is `apps/web/app/collection/tutorial-catalog.json`: 6 owner,
6 collector, 6 warehouse, 7 factory and 9 Driver lessons. The authenticated
catalog endpoint and the UI both filter by the current role. The separate
`/collection/tutorial-downloads` page intentionally offers all roles for
individual downloads.

Recordings use actual application UI against disposable synthetic data.
`fixture.ts` refuses a database whose name does not end in `_tutorial_spec`
and refuses a non-loopback API. Never point recording tools at a live database.
Fixture credentials and recordings under `work/` must not be committed.

- `voices.py` generates `ru-RU-SvetlanaNeural` narration and timing metadata
  from the catalog. Requires Python `edge-tts`, FFmpeg and FFprobe; the
  optional `CODEX_PROXY_CERT` is added to the normal TLS trust store.
- `record-web.cjs` uses Playwright and a running isolated backend/web proxy.
  Each lesson performs real operations and overlays pointer ripples.
- Dispatch the existing `android-ui` workflow with `tutorial_driver=true`
  to record Driver actions on an isolated Android emulator. Native permission,
  photo-picker, background notification and save dialogs are included.
  Raw synthetic recordings are published to a dedicated prerelease.
- `render.py <lesson-metadata.json>` combines a real recording with narration,
  captions and role/title labels. Outputs H.264/AAC MP4, JPEG and SRT under
  `work/tutorial-final`. Native metadata uses narration paths relative to the
  repository; generate narration locally before rendering the downloaded files.

Publish finished files through the owner-only multipart endpoint
`POST /collection/tutorials/chunks`. Required fields are `filename`, `uploadId`,
`index`, `count`, `sha256` and binary `chunk` (at most 1 MiB). Each complete file
is checked by SHA-256 and renamed atomically. The media volume survives app
releases; publication does not change inventory. A fixed
`collection-tutorials.zip` filename supports the separate full download.
