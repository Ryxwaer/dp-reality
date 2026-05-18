from __future__ import annotations

import sys

from src.scraper import (
    _CATEGORY_MAIN_TO_PRICE,
    _CATEGORY_SUB_TO_PROPERTY,
    _INVALID_CATEGORY_COMBOS,
    _build_category_matrix,
)


def run() -> int:
    matrix = _build_category_matrix()
    matrix_tuples = {(c.category_main, c.category_sub) for c in matrix}
    failed = 0

    def case(name: str, predicate: bool, detail: str = "") -> None:
        nonlocal failed
        marker = "PASS" if predicate else "FAIL"
        suffix = f"  ({detail})" if detail else ""
        print(f"  [{marker}] {name}{suffix}")
        if not predicate:
            failed += 1

    case(
        "no invalid combo appears in the built matrix",
        _INVALID_CATEGORY_COMBOS.isdisjoint(matrix_tuples),
        detail=str(_INVALID_CATEGORY_COMBOS & matrix_tuples),
    )

    expected_size = (
        len(_CATEGORY_MAIN_TO_PRICE) * len(_CATEGORY_SUB_TO_PROPERTY)
        - len(_INVALID_CATEGORY_COMBOS)
    )
    case(
        "matrix size equals full product minus invalid combos",
        len(matrix) == expected_size,
        detail=f"got {len(matrix)}, expected {expected_size}",
    )

    case(
        "matrix entries are unique",
        len(matrix_tuples) == len(matrix),
    )

    for main, sub in _INVALID_CATEGORY_COMBOS:
        case(
            f"invalid combo absent: ({main}, {sub})",
            (main, sub) not in matrix_tuples,
        )

    print()
    print(f"{len(matrix) - failed}/{len(matrix)} matrix entries kept; {failed} assertion(s) failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
