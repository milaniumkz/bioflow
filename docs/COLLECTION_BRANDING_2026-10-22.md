# Collection branding — 2026-10-22

User approved the supplied green/turquoise organic C symbol and collection wordmark.
Application display name: Collection. Technical package IDs, API identifiers and database names remain unchanged.

The transparent symbol was reconstructed from the supplied image with image generation; it is not an original vector export. The UI uses live lowercase text alongside the symbol, with white lettering on the existing dark background. The reference number 01 is excluded.

Assets:
- apps/mobile/assets/branding/collection-symbol.png: transparent source symbol.
- apps/web/public/branding/: matching Web symbol and browser icon.
- Android legacy launcher icons in all five existing densities.
- Android API 26+ adaptive icon with a white background and padded foreground.

Validation: Next production build; 11 Web tests; Flutter analysis and 17 tests; actual production Web login at 1440x900 and 390x844, image decoding and horizontal overflow checks. Screenshots are local review artifacts at /workspace/artifacts/collection-brand-2026-10-22/.

No APK build or publication was performed, as explicitly requested by the user. Automatic CI is skipped on this branding commit because the current CI unconditionally builds an APK. Existing installed APKs retain the previous branding until a future authorized update. Server deployment was not performed for this change; full CI is required before merge under AGENTS.md.
