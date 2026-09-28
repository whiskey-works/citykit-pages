"""Keep distant textured L3 pages and let the existing city backdrop cover beyond them.

This is a Pages packaging step; the CityKit hierarchy still supplies the tree
structure, but no GROUP, HORIZON or resident-ring geometry is published.
"""
import argparse
import hashlib
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
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    manifest_path = args.directory / 'hierarchy.json'
    manifest = json.loads(manifest_path.read_text())
    root = next(node for node in manifest['nodes'] if node['id'] == manifest['root'])
    empty = root['content'].copy()
    empty_path = args.directory / empty['uri']
    if empty['bytes'] != empty_path.stat().st_size or hashlib.sha256(empty_path.read_bytes()).hexdigest() != empty['sha256']:
        raise ValueError('The root is not a verified empty cover')
    if len(manifest['nodes']) <= 1 or not any(node['level'] == 'L3' for node in manifest['nodes']):
        raise ValueError('No far L3 pages to publish')
    replaced = 0
    for node in manifest['nodes']:
        if node['level'] in ('GROUP', 'HORIZON'):
            node['content'] = empty.copy()
            replaced += 1
    ring_count = len(manifest.get('resident_layers', []))
    manifest['resident_layers'] = []
    refs = set(resources(manifest))
    missing = [uri for uri in refs if not (args.directory / uri).is_file()]
    if missing:
        raise FileNotFoundError(missing[:5])
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    removed = 0
    for path in (args.directory / 'blobs').iterdir():
        if f'blobs/{path.name}' not in refs:
            path.unlink()
            removed += 1
    print(f'Far L3: {replaced} structural covers emptied, {ring_count} resident rings omitted, '
          f'{removed} unused blobs removed, {len(refs)} resources retained')


if __name__ == '__main__':
    main()
