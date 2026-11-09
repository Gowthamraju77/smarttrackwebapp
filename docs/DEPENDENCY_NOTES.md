# Dependency audit for this source copy

`npm ci --ignore-scripts` installed the existing project's locked dependencies
successfully. `npm audit --json` on 2026-11-05 reported four affected packages:

| Package | Severity | Audit finding |
| --- | --- | --- |
| `next` | Critical | Image optimization SVG issue and App Router denial of service, plus inherited PostCSS advisories |
| `maplibre-gl` | Critical | DOM sanitizer bypass; the audit's proposed fix is the major version 6.16.0 |
| `postcss` | High | CSS output/source-map handling advisories |
| `sharp` | High | Inherited image-library advisories |

References:

- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-p3m5-59mp-jv5r
- https://github.com/advisories/GHSA-jrc7-96c5-q579
- https://github.com/advisories/GHSA-qx2v-qp2m-jg93
- https://github.com/advisories/GHSA-6g55-p6wh-862q
- https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
- https://github.com/advisories/GHSA-r28c-9q8g-f849
- https://github.com/advisories/GHSA-f88m-g3jw-g9cj
- https://github.com/advisories/GHSA-rgj7-g3m4-5g8c
- https://github.com/advisories/GHSA-wq5f-xc86-pv6w

This handoff retains the original application dependency versions and lockfile.
The successful build is not a clean security audit. Assess and remediate these
advisories before a new public production deployment; a MapLibre major upgrade
needs checks of map rendering, terrain, camera controls and route interaction.
Run `npm audit` again for current advisory/fix availability. Do not blindly run
`npm audit fix --force` against a working deployment.
