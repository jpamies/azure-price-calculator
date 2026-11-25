"""Service slugs and region keys (docs/data-contract.md, "Layout")."""

from __future__ import annotations

import re
from collections.abc import Iterable

GLOBAL_REGION_KEY = "_global"

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """Lowercase, `&` -> `and`, every run of characters outside [a-z0-9] -> `-`, trim `-`."""
    return _NON_ALNUM.sub("-", text.lower().replace("&", "and")).strip("-")


def assign_slugs(names: Iterable[str], fallback: str = "unnamed") -> dict[str, str]:
    """Map each distinct name to a unique slug.

    Names are processed in sorted order; when a slug is already taken the later name gets
    `-2`, `-3`, ... appended. A name that slugifies to "" uses `fallback`.
    """
    result: dict[str, str] = {}
    used: set[str] = set()
    for name in sorted(set(names)):
        base = slugify(name) or fallback
        slug = base
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        result[name] = slug
    return result


def assign_region_keys(arm_region_names: Iterable[str]) -> dict[str, str]:
    """Map armRegionName -> regionKey: `_global` for an empty name, else its (unique) slug."""
    names = set(arm_region_names)
    keys = assign_slugs((n for n in names if n.strip()), fallback="region")
    for name in names:
        if not name.strip():
            keys[name] = GLOBAL_REGION_KEY
    return keys


def region_key(arm_region_name: str) -> str:
    """regionKey of a single armRegionName (no collision handling)."""
    if not arm_region_name.strip():
        return GLOBAL_REGION_KEY
    return slugify(arm_region_name) or "region"
