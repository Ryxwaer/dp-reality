"""Bezrealitky notification card composition.

Same anchor-free contract as the other two bots: the structured `url`
on the notification row is wrapped by each consumer in a tile-wide
<a>. The HTML body itself contains no anchors.

Bezrealitky-specific touch: the card optionally includes a single
thumbnail (`<img>`) when the detail fetch returned at least one photo
URL. The shared sanitiser whitelists `<img>` with `src`, `alt`,
`width`, `height`, so the image renders in the inbox and in the
email envelope without further work.
"""
from __future__ import annotations

import html as html_lib
from typing import Any

from .models import Listing

_PRICE_LABELS = {"sale": "Sale", "rent": "Rent / mo"}
_PROPERTY_LABELS = {
    "apartment": "Apartment",
    "house": "House",
    "land": "Land",
    "commercial": "Commercial",
    "other": "Other",
}

_DESC_MAX_CHARS = 220


def _esc(value: str | None) -> str:
    return html_lib.escape(value) if value else ""


def _format_price(value: int | None, price_type: str) -> str:
    if value is None:
        return "Price on request"
    formatted = f"{value:,}".replace(",", " ")
    label = _PRICE_LABELS.get(price_type, price_type.title())
    return f"{formatted} CZK · {label}"


def _format_locality(listing: Listing) -> str:
    bits: list[str] = []
    if listing.city:
        bits.append(listing.city)
    if listing.district:
        bits.append(listing.district)
    return " · ".join(bits) if bits else "Czechia"


def _format_meta(listing: Listing) -> str:
    """Right-aligned chip: property type · disposition · surface."""
    bits: list[str] = []
    label = _PROPERTY_LABELS.get(listing.property_type.value, "")
    if label:
        bits.append(label)
    if listing.disposition:
        bits.append(listing.disposition)
    if listing.surface_m2:
        bits.append(f"{listing.surface_m2} m\u00b2")
    if listing.energy_class:
        bits.append(f"PENB {listing.energy_class}")
    return " · ".join(bits)


def _truncate(text: str, limit: int) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "\u2026"


def render_card(listing: Listing) -> str:
    """Return the inline-styled HTML card for one matched listing."""
    title = _esc(listing.title) or "(untitled listing)"
    locality = _esc(_format_locality(listing))
    meta = _esc(_format_meta(listing))
    price_line = _esc(_format_price(listing.price, listing.price_type.value))

    image_html = ""
    if listing.photos:
        src = _esc(listing.photos[0])
        if src:
            image_html = (
                f'<img src="{src}" alt="" width="480" '
                'style="display:block;max-width:100%;height:auto;'
                'border-radius:8px;margin:0 0 10px" />'
            )

    desc_html = ""
    if listing.description:
        desc = _esc(_truncate(listing.description, _DESC_MAX_CHARS))
        desc_html = (
            f'<p style="margin:8px 0 0;font-size:13px;color:#475569;'
            f'line-height:1.45">{desc}</p>'
        )

    return (
        '<div style="max-width:600px;margin:0 0 12px;padding:14px 16px;'
        'border:1px solid #e2e8f0;border-radius:10px;'
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
        'background:#ffffff">'
        f'{image_html}'
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">'
        f'<span style="font-weight:600;font-size:15px;color:#0f172a">{title}</span>'
        f'<span style="font-size:12px;color:#64748b;white-space:nowrap">{meta}</span>'
        '</div>'
        f'<div style="margin-top:6px;font-size:13px;color:#1e293b">{price_line}</div>'
        f'<div style="margin-top:2px;font-size:12px;color:#64748b">{locality}</div>'
        f'{desc_html}'
        '</div>'
    )


def build_notification(
    *, user_id: str, bot_id: str, config_id: str, listing: Listing
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "bot_id": bot_id,
        "config_id": config_id,
        "source_ref": f"bezrealitky:{listing.source_id}",
        "title": listing.title,
        "url": listing.source_url,
        "html": render_card(listing),
    }
