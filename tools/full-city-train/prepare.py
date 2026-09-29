"""Assemble the local Onkyō full-loop train viewer from existing CityKit exports.

Only source and this recipe are committed. The large, generated hierarchy and
fallback stay in the requested output directory, outside the Pages site.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import shutil
import struct
from pathlib import Path


HERE = Path(__file__).resolve().parent
PAGES = HERE.parents[1]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def resources(value: object) -> dict[str, int]:
    refs: dict[str, int] = {}

    def visit(part: object) -> None:
        if isinstance(part, dict):
            uri = part.get("uri")
            if isinstance(uri, str) and uri.startswith("blobs/"):
                size = part.get("bytes")
                if not isinstance(size, int) or (uri in refs and refs[uri] != size):
                    raise ValueError(f"Invalid resource declaration: {uri}")
                refs[uri] = size
            for child in part.values():
                visit(child)
        elif isinstance(part, list):
            for child in part:
                visit(child)

    visit(value)
    return refs


def empty_cover() -> tuple[bytes, dict]:
    doc = {"asset": {"version": "2.0"}, "scene": 0,
           "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
           "buffers": [{"byteLength": 0}], "extras": {"citykit_compact": 1}}
    body = encode(doc)
    body += b" " * (-len(body) % 4)
    data = (struct.pack("<4sII", b"glTF", 2, 28 + len(body))
            + struct.pack("<I4s", len(body), b"JSON") + body
            + struct.pack("<I4s", 0, b"BIN\0"))
    sha = digest(data)
    return data, {"uri": f"blobs/{sha}.glb", "sha256": sha,
                  "bytes": len(data), "resident_bytes_estimate": 0,
                  "prepare_bytes_estimate": 1024}


def nearest(bounds: list, points: list) -> float:
    x0, y0, _, x1, y1, _ = bounds
    return min(math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))
               for x, y, _ in points)


def link_verified(source: Path, target: Path, size: int, sha: str) -> None:
    if not source.is_file() or source.stat().st_size != size:
        raise FileNotFoundError(f"Missing or wrong-sized resource: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size == size and digest(target.read_bytes()) == sha:
            return
        target.unlink()
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)
    if digest(target.read_bytes()) != sha:
        target.unlink()
        raise ValueError(f"Resource checksum mismatch: {source}")


def write_verified(data: bytes, target: Path) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {"uri": f"blobs/{target.name}", "sha256": digest(data), "bytes": len(data)}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--hierarchy", type=Path, required=True, help="full CityKit buildings/hierarchy.json")
    p.add_argument("--blob-root", type=Path, help="directory holding the hierarchy's blobs/ (defaults to hierarchy parent)")
    p.add_argument("--fallback-manifest", type=Path, required=True, help="full-city CityKit streaming manifest.json")
    p.add_argument("--route", type=Path, required=True, help="CityKit transit export with the Nyamanote loop")
    p.add_argument("--out", type=Path, required=True, help="local preview directory, outside site/")
    p.add_argument("--l3", type=float, default=1800)
    p.add_argument("--l2", type=float, default=350)
    p.add_argument("--l1", type=float, default=180)
    p.add_argument("--l0", type=float, default=70)
    p.add_argument("--horizon", type=float, default=2500)
    p.add_argument("--fallback-radius", type=float, default=2000)
    args = p.parse_args()
    out = args.out.resolve()
    if out == PAGES or PAGES in out.parents:
        raise ValueError("Preview output must be outside the Pages repository")
    route = json.loads(args.route.read_text())
    loop = next((r for r in route["routes"] if r.get("id") == "loop/inner"), None)
    if loop is None:
        raise ValueError("Transit export has no loop/inner route")
    points = loop["points"][::10] + loop["points"][-1:]
    source = json.loads(args.hierarchy.read_text())
    by_id = {n["id"]: n for n in source["nodes"]}
    selected: dict[str, dict] = {}
    radii = {"L0": args.l0, "L1": args.l1, "L2": args.l2,
             "L3": args.l3, "GROUP": args.horizon, "HORIZON": args.horizon}

    def visit(ident: str) -> None:
        node = by_id[ident]
        selected[ident] = dict(node)
        children = node["children"]
        if not children:
            return
        child_level = by_id[children[0]]["level"]
        threshold = radii[child_level]
        keep = nearest(node["bounds"], points) <= threshold
        selected[ident]["children"] = list(children) if keep else []
        for child in selected[ident]["children"]:
            visit(child)

    visit(source["root"])
    source["nodes"] = list(selected.values())
    source["authored"] = []
    source["routes"] = []
    source["resident_layers"] = []
    source["source"] = {k: source["source"].get(k) for k in ("city_id", "buildings")}
    empty_data, empty = empty_cover()
    for node in source["nodes"]:
        if node["level"] in ("GROUP", "HORIZON"):
            node["content"] = empty.copy()
        for attachment in node.get("attachments", []):
            if "windows" in attachment:
                attachment["windows"] = {k: v for k, v in attachment["windows"].items() if k != "addresses"}
    buildings = out / "data/onkyo-full/buildings"
    buildings.mkdir(parents=True, exist_ok=True)
    (buildings / empty["uri"]).parent.mkdir(parents=True, exist_ok=True)
    (buildings / empty["uri"]).write_bytes(empty_data)
    refs = resources(source)
    for uri, size in refs.items():
        if uri == empty["uri"]:
            continue
        link_verified((args.blob_root or args.hierarchy.parent) / uri, buildings / uri, size, Path(uri).stem)
    (buildings / "hierarchy.json").write_bytes(encode(source))

    fallback = json.loads(args.fallback_manifest.read_text())
    original_blob = args.fallback_manifest.parent / fallback["fallback"]["uri"]
    if digest(original_blob.read_bytes()) != fallback["fallback"]["sha256"]:
        raise ValueError("Fallback export checksum mismatch")
    cell_data = json.loads(original_blob.read_text())
    kept = []
    for cell in cell_data["cells"]:
        x, y = cell["origin"][:2]
        if nearest([x, y, 0, x + fallback["cell_m"], y + fallback["cell_m"], 0], points) <= args.fallback_radius:
            kept.append(cell)
    if not kept:
        raise ValueError("No route-adjacent fallback cells")
    cell_data["cells"] = kept
    fb_dir = out / "data/onkyo-full"
    fb_bytes = encode(cell_data)
    sha = digest(fb_bytes)
    fallback["fallback"] = write_verified(fb_bytes, fb_dir / "blobs" / f"{sha}.json")
    fallback["cells"] = []
    (fb_dir / "manifest.json").write_bytes(encode(fallback))
    shutil.copy2(HERE / "place.json", fb_dir / "place.json")
    shutil.copy2(args.route, out / "train-route.json")
    demo = out / "demo"
    demo.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "demo.css"):
        shutil.copy2(HERE / name, demo / name)
    for name in ("meshopt_decoder.module.js",):
        shutil.copy2(PAGES / "site/demo" / name, demo / name)
    shutil.copytree(PAGES / "site/demo/basis", demo / "basis", dirs_exist_ok=True)
    shutil.copy2(PAGES / "site/favicon.svg", out / "favicon.svg")
    for name in ("griffin", "onkyo"):
        link = out / "data" / name
        if not link.exists() and not link.is_symlink():
            link.symlink_to(PAGES / "site/data" / name, target_is_directory=True)
    sign_link = fb_dir / "signs"
    if not sign_link.exists() and not sign_link.is_symlink():
        sign_link.symlink_to(PAGES / "site/data/onkyo/signs", target_is_directory=True)
    counts = collections.Counter(n["level"] for n in source["nodes"])
    print(json.dumps({"nodes": len(selected), "levels": counts, "resources": len(refs),
                      "resource_bytes": sum(refs.values()), "fallback_cells": len(kept),
                      "output": str(out)}, indent=2))


if __name__ == "__main__":
    main()
