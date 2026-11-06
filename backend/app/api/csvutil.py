import csv
import io
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi.responses import Response


def csv_response(filename: str, header: Sequence[str], rows: Iterable[Sequence[Any]]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(header)
    for r in rows:
        w.writerow(["" if v is None else _cell(v) for v in r])
    data = "﻿" + buf.getvalue()  # BOM so spreadsheet apps detect UTF-8
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _cell(v: Any) -> Any:
    # neutralise spreadsheet formula injection
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v
