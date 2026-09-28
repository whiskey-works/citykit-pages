"""Package CityKit's far L3 with shared facade arrays and window tables only.

Run after copying a CityKit hierarchy into the public site. The generator still
owns the geometry; this removes redundant per-page detail-bake KTX2 attachments
and unreferenced blobs for the browser's low-memory far stream.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path


def resources(value):
    if isinstance(value, dict):
        uri = value.get('uri')
        if isinstance(uri, str) and uri.startswith('blobs/'):
            yield uri
        for child in value.values():
            yield from resources(child)
    elif isinstance(value, list):
        for child in value:
            yield from resources(child)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('far', type=Path, help='public far hierarchy directory')
    args = parser.parse_args()
    manifest = args.far / 'hierarchy.json'
    data = json.loads(manifest.read_text())
    removed = 0
    for node in data['nodes']:
        if node['level'] != 'L3':
            continue
        for attachment in node.get('attachments', []):
            removed += attachment.pop('detail_bake', None) is not None
    refs = set(resources(data))
    if any(not (args.far / uri).is_file() for uri in refs):
        raise FileNotFoundError('A referenced far resource is missing')
    manifest.write_text(json.dumps(data, separators=(',', ':')))
    pruned = 0
    for blob in (args.far / 'blobs').iterdir():
        if 'blobs/' + blob.name not in refs:
            blob.unlink()
            pruned += 1
    print(f'Far L3: {removed} detail bakes removed; {pruned} unreferenced blobs pruned; {len(refs)} resources retained')


if __name__ == '__main__':
    main()
