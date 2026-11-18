# Dependency audit triage

Production remains gated by `npm audit --omit=dev --audit-level=high`, with **no exceptions**.

## Temporary development-only exception

- Advisory: [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), picomatch ReDoS in repeated extglobs.
- Verified 2026-11-18: GitHub reports every published version through 4.0.7 affected and no first patched release; npm latest is 4.0.7. This advisory was updated 2026-11-17, after the previous successful release.
- Current lockfile installations (2.3.2 / 4.0.4) are exclusively development dependencies. Production dependency audit reports no high/critical vulnerabilities. Glob patterns in development tooling come from repository configuration, not application requests.
- This is triage, not a claim that picomatch has been patched. No package versions are disguised or advisories globally disabled.
- The exception is limited to that exact advisory, high severity, and installations verified `dev: true` in the lockfile. Other high/critical findings, unknown reports and network errors still fail CI. It expires at **2026-12-02 00:00 UTC**.
- `infrastructure/audit-development.test.mjs` verifies production reachability, unrelated findings, expiry and malformed reports fail closed. Replace vulnerable versions and remove the exception when an upstream fix is published.

This temporary exception concerns the development toolchain only. The laboratory calculation and Collection business rules do not import or execute glob matching.
