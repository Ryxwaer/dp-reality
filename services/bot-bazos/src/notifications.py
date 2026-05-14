"""Bot-authored notification card composition.

Each match becomes one row in the shared `notifications` collection.
The row carries:
  - structured fields (title, url, source_ref) used by the inbox list
    view and by the BFF's deduplication;
  - a self-contained HTML card (`html`) — the *visual* content of the
    notification (title, price, locality, labels, description). The
    listing URL is intentionally NOT embedded as an anchor inside
    this HTML: each consumer (email envelope, inbox detail view) wraps
    the whole card in a single tile-wide <a> using the structured
    `url` field. Nesting another <a> here would make HTML5 parsers
    collapse the outer wrapper, breaking the tile click target.

The HTML uses inline styles only — required because email clients
ignore external stylesheets — and adheres to the platform's HTML
conventions document (max width 600px, image cap 480px, neutral palette).
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


def _esc(s: str | None) -> str:
    return html_lib.escape(s) if s else ""


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
    if listing.psc:
        bits.append(listing.psc)
    return " · ".join(bits) if bits else "Czechia"


def render_card(listing: Listing) -> str:
    """Return the inline-styled HTML card for one matched listing.

    Anchor-free by contract: the consumer wraps the returned HTML in a
    single tile-wide <a>. See module docstring.
    """
    title = _esc(listing.title) or "(untitled listing)"
    locality = _esc(_format_locality(listing))
    property_label = _esc(_PROPERTY_LABELS.get(listing.property_type.value, ""))
    price_line = _esc(_format_price(listing.price, listing.price_type.value))
    description = _esc(listing.description or "")

    desc_html = (
        f'<p style="margin:8px 0 0;font-size:13px;color:#475569;line-height:1.45">'
        f'{description}</p>'
        if description
        else ""
    )

    return (
        '<div style="max-width:600px;margin:0 0 12px;padding:14px 16px;'
        'border:1px solid #e2e8f0;border-radius:10px;'
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
        'background:#ffffff">'
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">'
        '<span style="font-weight:600;font-size:15px;color:#0f172a">'
        f'{title}</span>'
        f'<span style="font-size:12px;color:#64748b;white-space:nowrap">{property_label}</span>'
        '</div>'
        f'<div style="margin-top:6px;font-size:13px;color:#1e293b">{price_line}</div>'
        f'<div style="margin-top:2px;font-size:12px;color:#64748b">{locality}</div>'
        f'{desc_html}'
        '</div>'
    )


def build_notification(
    *, user_id: str, bot_id: str, config_id: str, listing: Listing
) -> dict[str, Any]:
    """Compose the per-match payload consumed by `insert_notifications`.

    Only the identifying + rendered fields are returned; the repository
    layer is responsible for `$setOnInsert` of `created_at`/`unread`/
    `sent_at` and the `$addToSet` on `config_ids`.
    """
    return {
        "user_id": user_id,
        "bot_id": bot_id,
        "config_id": config_id,
        "source_ref": f"bazos:{listing.source_id}",
        "title": listing.title,
        "url": listing.source_url,
        "html": render_card(listing),
    }
