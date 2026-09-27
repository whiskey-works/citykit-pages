# citykit-pages

The public demo site for CityKit, at **https://citykit.technoascetic.com**.

This repository holds built output only: a static site that GitHub Pages serves from `site/`.

- `site/index.html`: what CityKit is, and where Griffin's data comes from.
- `site/demo/`: Griffin, Georgia, in 3D. Walk the streets or fly over the town (WebGL2).
- `site/data/griffin/`: Griffin's streaming export, the cells the demo loads as you move.
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
