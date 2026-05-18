from __future__ import annotations

import sys
from dataclasses import dataclass

from src import matcher
from src.models import BotConfig, Listing, PriceType, PropertyType

BRNO_10KM_PSCS: set[str] = {
    "60200", "60300", "61200", "61300", "61400",
    "61500", "61600", "61700", "62300", "62500",
    "63500", "63800", "63900", "64400", "65000",
}

PRAHA_PSC = "11000"
assert PRAHA_PSC not in BRNO_10KM_PSCS


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


def _listing(
    *,
    psc: str | None,
    title: str = "Sample",
    price: int = 1_000_000,
    description: str | None = None,
) -> Listing:
    return Listing(
        title=title,
        property_type=PropertyType.APARTMENT,
        price=price,
        price_type=PriceType.SALE,
        city="Brno",
        source_url="https://reality.bazos.cz/inzerat/12345/",
        source_id="12345",
        description=description,
        category_main="prodam",
        category_sub="byt",
        psc=psc,
    )


def _radius_cfg(**overrides) -> BotConfig:
    base = dict(
        category_main="prodam",
        category_sub="byt",
        price_max=5_000_000,
        psc="60200",
        radius_km=10,
        keywords=["1+kk"],
    )
    base.update(overrides)
    return BotConfig(**base)


def run() -> int:
    results: list[Result] = []

    def case(name: str, predicate: bool, detail: str = "") -> None:
        results.append(Result(name=name, ok=bool(predicate), detail=detail))

    cfg = _radius_cfg()
    allowed = BRNO_10KM_PSCS

    case(
        "listing inside radius + keyword in title matches",
        matcher.matches(
            cfg,
            _listing(psc="60200", title="Prodám 1+kk v centru Brna"),
            allowed_pscs=allowed,
        ),
    )
    case(
        "listing inside radius but wrong PSČ → still matches if PSČ ∈ allowed set",
        matcher.matches(
            cfg,
            _listing(psc="61500", title="Pěkný 1+kk"),
            allowed_pscs=allowed,
        ),
    )
    case(
        "listing outside radius (Prague) is rejected",
        not matcher.matches(
            cfg,
            _listing(psc=PRAHA_PSC, title="Prodám 1+kk Praha"),
            allowed_pscs=allowed,
        ),
    )
    case(
        "listing with no PSČ is rejected when radius is set (fail-closed)",
        not matcher.matches(
            cfg,
            _listing(psc=None, title="Prodám 1+kk neznámá lokalita"),
            allowed_pscs=allowed,
        ),
    )

    case(
        "keyword in description (not title) still matches",
        matcher.matches(
            cfg,
            _listing(
                psc="60200",
                title="Prodám byt v Brně",
                description="Krásný 1+kk s balkonem, 32 m².",
            ),
            allowed_pscs=allowed,
        ),
    )
    case(
        "keyword missing from both title and description is rejected",
        not matcher.matches(
            cfg,
            _listing(
                psc="60200",
                title="Prodám byt 2+1",
                description="Krásný byt, 60 m².",
            ),
            allowed_pscs=allowed,
        ),
    )

    case(
        "price above price_max is rejected",
        not matcher.matches(
            cfg,
            _listing(psc="60200", title="Prodám 1+kk", price=6_000_000),
            allowed_pscs=allowed,
        ),
    )
    case(
        "price below price_min is rejected",
        not matcher.matches(
            _radius_cfg(price_min=2_000_000),
            _listing(psc="60200", title="Prodám 1+kk", price=1_000_000),
            allowed_pscs=allowed,
        ),
    )
    case(
        "listing with no price is rejected when price_max set",
        not matcher.matches(
            cfg,
            Listing(
                title="Prodám 1+kk", property_type=PropertyType.APARTMENT,
                price=None, price_type=PriceType.SALE,
                source_url="https://reality.bazos.cz/inzerat/x/",
                source_id="x", category_main="prodam", category_sub="byt",
                psc="60200",
            ),
            allowed_pscs=allowed,
        ),
    )

    case(
        "wrong category_main is rejected",
        not matcher.matches(
            cfg,
            Listing(
                title="Pronájem 1+kk", property_type=PropertyType.APARTMENT,
                price=20_000, price_type=PriceType.RENT,
                source_url="https://reality.bazos.cz/inzerat/y/",
                source_id="y", category_main="pronajmu", category_sub="byt",
                psc="60200",
            ),
            allowed_pscs=allowed,
        ),
    )

    cfg_exact = BotConfig(psc="60200", keywords=[])
    case(
        "exact-PSČ mode (no radius) accepts matching PSČ",
        matcher.matches(cfg_exact, _listing(psc="60200")),
    )
    case(
        "exact-PSČ mode rejects different PSČ",
        not matcher.matches(cfg_exact, _listing(psc="60300")),
    )

    cfg_anywhere = BotConfig(keywords=[])
    case(
        "no PSČ / no radius accepts listing with no PSČ",
        matcher.matches(cfg_anywhere, _listing(psc=None)),
    )

    cfg_multi_kw = _radius_cfg(keywords=["1+kk", "balkon"])
    case(
        "all keywords must be present (one in title, one in description)",
        matcher.matches(
            cfg_multi_kw,
            _listing(
                psc="60200",
                title="Prodám 1+kk v Brně",
                description="Krásný byt s balkonem, 32 m².",
            ),
            allowed_pscs=allowed,
        ),
    )
    case(
        "missing one of multiple keywords is rejected",
        not matcher.matches(
            cfg_multi_kw,
            _listing(
                psc="60200",
                title="Prodám 1+kk v Brně",
                description="Krásný byt bez balkónu, 32 m².",
            ),
            allowed_pscs=allowed,
        ),
        detail="balkon vs balkónu, no substring match",
    )
    case(
        "keyword matching is case-insensitive",
        matcher.matches(
            _radius_cfg(keywords=["BALKON"]),
            _listing(
                psc="60200",
                title="Prodám 1+kk",
                description="krásný balkon, 32 m²",
            ),
            allowed_pscs=allowed,
        ),
    )

    width = max(len(r.name) for r in results)
    failed = 0
    for r in results:
        marker = "PASS" if r.ok else "FAIL"
        suffix = f"  ({r.detail})" if r.detail else ""
        print(f"  [{marker}] {r.name.ljust(width)}{suffix}")
        if not r.ok:
            failed += 1
    print()
    print(f"{len(results) - failed}/{len(results)} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
