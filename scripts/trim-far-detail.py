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
    parser.add_argument('--source-hierarchy', type=Path,
                        help='original hierarchy for repairing an already-trimmed package')
    args = parser.parse_args()
    manifest = args.far / 'hierarchy.json'
    data = json.loads(manifest.read_text())
    source = None
    if args.source_hierarchy:
        original = json.loads(args.source_hierarchy.read_text())
        source = {node['id']: node for node in original['nodes']}
    removed = 0
    for node in data['nodes']:
        if node['level'] != 'L3':
            continue
        if node.get('public_l3_detail_removed'):
            continue
        original = source.get(node['id']) if source else None
        if original and original['content']['sha256'] != node['content']['sha256']:
            raise ValueError(f'Source geometry differs for {node["id"]}')
        removed_bytes = 0
        if original and len(original.get('attachments', [])) != len(node.get('attachments', [])):
            raise ValueError(f'Source attachments differ for {node["id"]}')
        for i, attachment in enumerate(node.get('attachments', [])):
            bake = attachment.pop('detail_bake', None)
            if bake is None and original:
                bake = original['attachments'][i].get('detail_bake')
            if bake:
                removed += 1
                removed_bytes += bake['resident_bytes_estimate']
        for key in ('resident_bytes_estimate', 'prepare_bytes_estimate'):
            node['content'][key] -= removed_bytes
        if node['content']['resident_bytes_estimate'] < 0 or node['content']['prepare_bytes_estimate'] < node['content']['resident_bytes_estimate']:
            raise ValueError(f'Invalid trimmed footprint for {node["id"]}')
        node['public_l3_detail_removed'] = True
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
