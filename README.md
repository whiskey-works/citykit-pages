# citykit-pages

The public demo site for CityKit, at **https://citykit.technoascetic.com**.

GitHub Pages serves the static output in `site/`. The viewer entry point lives in `src/demo/app.mjs`.

- `site/index.html`: what CityKit is, and where Griffin's data comes from.
- `site/demo/`: Griffin, Georgia, in 3D. Walk the streets or fly over the town (WebGL2).
- `site/data/griffin/`: Griffin's streaming export, the cells the demo loads as you move.
- `site/data/onkyo/`: Onkyō's public central cut and distant textured L3 pages, with the existing city backdrop beyond them.
- `site/onkyo/`: the Onkyō Atlas, a fictional city generated entirely by CityKit. It uses no map data, so the ODbL
  does not apply to it; like the site's code, it is all rights reserved.

## Licences

- **Map data** (`site/data/griffin/`) is derived from OpenStreetMap and is offered under the ODbL 1.0.
  See [LICENSE-DATA](LICENSE-DATA) and [ATTRIBUTION.md](ATTRIBUTION.md). Share-alike applies to the data only.
- **The site's code** (HTML, CSS and JavaScript, including the bundled viewer) is not licensed for reuse. All rights
  reserved. Bundled third-party code keeps its own licence (three.js, MIT: `site/demo/THIRD-PARTY-NOTICES.txt`).

## Checks

`scripts/scrub-check.sh site` fails if a shipped file names an internal host, address or path, or if any image
carries metadata. The deploy workflow runs it before publishing.

To rebuild the viewer, run `npm ci` and then `sh scripts/build-viewer.sh /path/to/CityKit`. The script copies
CityKit's streaming runtime into a temporary build directory and bundles the viewer and worker into `site/demo/`.
The built assets remain committed so deployment does not need the CityKit checkout.
