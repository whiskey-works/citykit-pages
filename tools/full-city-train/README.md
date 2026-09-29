# Local Onkyō full-city train preview

This is the reviewed 26.23 km, 24-stop Nyamanote loop viewer. It is a local
preview, not a Pages deployment. The generated city is over 3 GB and stays out
of Git and the public `site/` directory. It uses CityKit's textured L0–L3
building hierarchy, the Onkyō sign atlas, and a 2 km terrain/road corridor.
Nonrepresentative GROUP and HORIZON box covers are replaced with empty GLBs.

Prepare from an existing **full-city** CityKit hierarchy, streaming fallback
export, and transit export. The hierarchy's `blobs/` must be beside its JSON.
These inputs are generated from Re:Chord's Onkyō plan by CityKit; they are not
recreated by this fast packaging step. Paths below are examples—use your local
build outputs. The output must be outside this repository.
If the full index and blobs were transferred separately, pass `--blob-root`
with the directory containing `blobs/`.

```sh
python3 tools/full-city-train/prepare.py \
  --hierarchy /path/to/full-city/buildings/hierarchy.json \
  --fallback-manifest /path/to/full-city/manifest.json \
  --route /path/to/full-city/transit.json \
  --out /tmp/onkyo-train-preview
NODE_MODULES=/path/to/node_modules \
  sh tools/full-city-train/build-viewer.sh /path/to/CityKit /tmp/onkyo-train-preview
python3 -m http.server 8897 --directory /tmp/onkyo-train-preview
```

Open <http://127.0.0.1:8897/demo/?city=onkyo&profile=desktop>. Choose a station
to stage its scenery, then **Ride train**. The chase camera follows the train:
drag to orbit, scroll to zoom. Passenger view supports drag-to-look. The 1×
ride is below CityKit's 25 m/s streaming target; 2× and 4× are stress modes.

`prepare.py` verifies referenced blobs, links them into the output when
possible, and leaves the source exports untouched. The route-adjacent fallback
keeps roads and terrain; legacy building boxes are used for navigation and map
outlines but are never drawn. The preview currently shows a proxy train, and
track/platform alignment is unfinished. This is a functional full-loop ride,
not a whole-lap performance certification. Streaming tuning and representative
far impostors remain follow-up work.
