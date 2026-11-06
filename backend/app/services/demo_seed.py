"""Seed data for a demo workspace.

The data set mirrors the approved mockups (``assets/js/data.js``, "today" = 2026-11-05) and is replayed
through the real posting services, so stock, average cost, movements and document totals are produced
by the same rules as user operations. Dates are shifted so that the mockup's "today" becomes the day the
demo is created (in the visitor's time zone); events that would land in the future are pulled back to
just before "now", keeping their order.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, tzinfo
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Category, Document, DocumentLine, Product, User
from app.services import inventory as inv

D = Decimal
MOCK_TODAY = date(2026, 11, 5)

CATEGORIES = {
    "c1": "Fasteners",
    "c2": "Lumber & Boards",
    "c3": "Paint & Coatings",
    "c4": "Plumbing",
    "c5": "Electrical",
    "c6": "Tools",
    "c7": "Adhesives & Sealants",
    "c8": "Cleaning Supplies",
    "c9": "Garden",
}

# id, sku, name, category, unit, final stock, min, purchase, sale, description, archived
PRODUCTS = [
    (
        "p1",
        "FST-0012",
        "Galvanized nails 50 mm",
        "c1",
        "kg",
        "42.5",
        "20",
        "3.20",
        "5.40",
        "Hot-dip galvanized round-head nails, sold by weight.",
        False,
    ),
    (
        "p2",
        "FST-0015",
        "Wood screws 4×40 mm (box of 200)",
        "c1",
        "pack",
        "64",
        "25",
        "6.80",
        "11.50",
        "Countersunk pozi drive, yellow zinc.",
        False,
    ),
    (
        "p3",
        "FST-0021",
        "Drywall screws 3.5×35 mm (box of 500)",
        "c1",
        "pack",
        "18",
        "20",
        "5.90",
        "9.90",
        "Fine thread, black phosphate.",
        False,
    ),
    (
        "p4",
        "FST-0034",
        "Hex bolt M10×60 zinc",
        "c1",
        "pcs",
        "340",
        "100",
        "0.42",
        "0.85",
        "Grade 8.8, fully threaded.",
        False,
    ),
    (
        "p5",
        "FST-0038",
        "Concrete anchor 8×60 mm",
        "c1",
        "pcs",
        "0",
        "50",
        "0.55",
        "1.10",
        "Nylon expansion anchor with screw.",
        False,
    ),
    (
        "p6",
        "LMB-0102",
        "Plywood 18 mm",
        "c2",
        "m²",
        "86.4",
        "40",
        "14.20",
        "21.90",
        "Birch plywood, 2440×1220 mm sheets (2.88 m² each).",
        False,
    ),
    (
        "p7",
        "LMB-0110",
        "Pine board 25×150 mm",
        "c2",
        "m",
        "412",
        "150",
        "2.35",
        "3.80",
        "Planed all round, kiln dried.",
        False,
    ),
    (
        "p8",
        "LMB-0117",
        "OSB board 12 mm",
        "c2",
        "m²",
        "52.08",
        "60",
        "8.40",
        "12.90",
        "OSB/3, 2500×1250 mm sheets (3.125 m² each).",
        False,
    ),
    (
        "p9",
        "PNT-0201",
        "Exterior paint white",
        "c3",
        "l",
        "37.5",
        "40",
        "9.80",
        "16.50",
        "Acrylic masonry paint, smooth finish.",
        False,
    ),
    (
        "p10",
        "PNT-0204",
        "Interior emulsion matt",
        "c3",
        "l",
        "120",
        "50",
        "7.20",
        "12.40",
        "Brilliant white, low odour.",
        False,
    ),
    (
        "p11",
        "PNT-0212",
        "Wood stain walnut",
        "c3",
        "l",
        "14.25",
        None,
        "12.60",
        "21.00",
        "Water-based, interior and exterior.",
        False,
    ),
    (
        "p12",
        "PNT-0219",
        "Paint roller 230 mm",
        "c3",
        "pcs",
        "46",
        "20",
        "4.10",
        "7.50",
        "Medium pile, with frame.",
        False,
    ),
    (
        "p13",
        "PLB-0301",
        "PVC pipe 32 mm",
        "c4",
        "m",
        "148",
        "50",
        "1.85",
        "3.20",
        "Solvent weld waste pipe, white.",
        False,
    ),
    (
        "p14",
        "PLB-0306",
        "Copper elbow 15 mm",
        "c4",
        "pcs",
        "210",
        "80",
        "0.95",
        "1.80",
        "End-feed 90° elbow.",
        False,
    ),
    (
        "p15",
        "PLB-0312",
        "PTFE thread tape",
        "c4",
        "pcs",
        "9",
        "30",
        "0.60",
        "1.40",
        "12 mm × 12 m roll.",
        False,
    ),
    (
        "p16",
        "PLB-0318",
        'Ball valve 1/2"',
        "c4",
        "pcs",
        "38",
        "15",
        "6.40",
        "11.90",
        "Full bore, lever handle, brass.",
        False,
    ),
    (
        "p17",
        "ELC-0401",
        "Copper wire 2.5 mm²",
        "c5",
        "m",
        "186.5",
        "100",
        "0.68",
        "1.15",
        "Single core, PVC insulated, cut to length.",
        False,
    ),
    (
        "p18",
        "ELC-0405",
        "LED bulb E27 9 W",
        "c5",
        "pcs",
        "152",
        "60",
        "1.90",
        "3.99",
        "Warm white 2700 K, 806 lm.",
        False,
    ),
    (
        "p19",
        "ELC-0411",
        "Double socket outlet",
        "c5",
        "pcs",
        "27",
        "30",
        "3.70",
        "6.90",
        "Switched, white, 13 A.",
        False,
    ),
    (
        "p20",
        "ELC-0417",
        "Electrical tape 19 mm",
        "c5",
        "pcs",
        "85",
        None,
        "0.80",
        "1.75",
        "PVC insulating tape, black, 20 m.",
        False,
    ),
    (
        "p21",
        "TLS-0501",
        "Claw hammer 16 oz",
        "c6",
        "pcs",
        "12",
        "5",
        "9.50",
        "17.90",
        "Fibreglass handle.",
        False,
    ),
    (
        "p22",
        "TLS-0508",
        "Cordless drill 18 V",
        "c6",
        "pcs",
        "4",
        "3",
        "64.00",
        "109.00",
        "Two batteries and charger included.",
        False,
    ),
    (
        "p23",
        "TLS-0512",
        "Tape measure 5 m",
        "c6",
        "pcs",
        "31",
        "10",
        "3.20",
        "6.50",
        "Metric/imperial, belt clip.",
        False,
    ),
    (
        "p24",
        "ADH-0601",
        "Floor tile adhesive",
        "c7",
        "kg",
        "287.5",
        "100",
        "0.48",
        "0.89",
        "Cement-based, sold from 25 kg bags or loose by weight.",
        False,
    ),
    (
        "p25",
        "ADH-0604",
        "Silicone sealant clear 300 ml",
        "c7",
        "pcs",
        "58",
        "24",
        "3.10",
        "5.80",
        "Sanitary grade, mould resistant.",
        False,
    ),
    (
        "p26",
        "CLN-0701",
        "Heavy-duty degreaser",
        "c8",
        "l",
        "22.75",
        "10",
        "4.30",
        "7.90",
        "Concentrate, dilute 1:20.",
        False,
    ),
    (
        "p27",
        "CLN-0705",
        "Microfiber cloths (10 pack)",
        "c8",
        "pack",
        "33",
        None,
        "5.60",
        "9.90",
        "40×40 cm, assorted colours.",
        False,
    ),
    (
        "p28",
        "LMB-0099",
        "Hardboard 3 mm",
        "c2",
        "m²",
        "0",
        None,
        "4.10",
        "6.50",
        "Discontinued by supplier.",
        True,
    ),
    (
        "p29",
        "PNT-0198",
        "Oil-based primer grey",
        "c3",
        "l",
        "6.5",
        None,
        "8.90",
        "14.50",
        "Replaced by water-based primer; remaining stock to be sold.",
        True,
    ),
]

OPENING_COST = {
    "p1": "3.05",
    "p2": "6.55",
    "p3": "5.70",
    "p4": "0.40",
    "p6": "13.80",
    "p7": "2.25",
    "p8": "8.10",
    "p9": "9.45",
    "p10": "6.90",
    "p11": "12.20",
    "p12": "3.95",
    "p13": "1.79",
    "p14": "0.92",
    "p15": "0.62",
    "p16": "6.10",
    "p17": "0.64",
    "p18": "1.84",
    "p19": "3.55",
    "p20": "0.76",
    "p21": "9.20",
    "p22": "61.50",
    "p23": "3.10",
    "p24": "0.46",
    "p25": "2.95",
    "p26": "4.15",
    "p27": "5.40",
}

# number, created, posted|None, supplier, note, lines (pid, qty, price), reversed_by
RECEIPTS = [
    (
        117,
        "2026-09-11T16:22",
        "2026-09-11T16:40",
        "",
        "Cash purchase at a local hardware store, no supplier invoice.",
        [("p15", "10", "0.55")],
    ),
    (
        118,
        "2026-09-16T09:38",
        "2026-09-16T10:12",
        "Builders Depot Ltd",
        "",
        [
            ("p1", "50", "3.20"),
            ("p2", "40", "6.80"),
            ("p4", "200", "0.42"),
            ("p5", "150", "0.55"),
            ("p3", "30", "5.90"),
        ],
    ),
    (
        119,
        "2026-09-23T09:33",
        "2026-09-23T09:40",
        "Pacific Timber",
        "Delivered on pallet, invoice PT-55821.",
        [("p6", "64.8", "14.20"), ("p7", "300", "2.35"), ("p8", "37.5", "8.40")],
    ),
    (
        120,
        "2026-10-01T13:13",
        "2026-10-01T14:05",
        "CleanPro Distribution",
        "",
        [("p26", "12", "4.30"), ("p27", "20", "5.60")],
    ),
    (
        121,
        "2026-10-06T10:55",
        "2026-10-06T11:20",
        "ElectroParts Co.",
        "Entered with wrong wire price.",
        [("p17", "200", "0.86"), ("p18", "100", "1.90")],
    ),
    (
        122,
        "2026-10-08T08:34",
        "2026-10-08T09:15",
        "ElectroParts Co.",
        "Corrected copy of RC-000121.",
        [("p17", "200", "0.68"), ("p18", "100", "1.90"), ("p19", "24", "3.70")],
    ),
    (
        123,
        "2026-10-14T13:18",
        "2026-10-14T13:30",
        "Coastal Paints Supply",
        "",
        [
            ("p9", "40", "9.80"),
            ("p10", "80", "7.20"),
            ("p11", "10", "12.60"),
            ("p12", "30", "4.10"),
        ],
    ),
    (
        124,
        "2026-10-21T10:32",
        "2026-10-21T10:50",
        "Builders Depot Ltd",
        "",
        [
            ("p24", "250", "0.48"),
            ("p25", "48", "3.10"),
            ("p21", "6", "9.50"),
            ("p23", "12", "3.20"),
        ],
    ),
    (
        125,
        "2026-10-28T14:36",
        "2026-10-28T15:10",
        "FlowRight Plumbing",
        "",
        [("p13", "100", "1.85"), ("p14", "150", "0.95"), ("p16", "20", "6.40")],
    ),
    (
        126,
        "2026-11-03T08:48",
        "2026-11-03T08:55",
        "Builders Depot Ltd",
        "",
        [("p22", "2", "64.00"), ("p20", "50", "0.80")],
    ),
    (
        127,
        "2026-11-05T08:47",
        None,
        "Pacific Timber",
        "Waiting for delivery note.",
        [("p6", "32.4", "14.20"), ("p8", "46.875", "8.40"), ("p7", "150", "2.40")],
    ),
]

WRITE_OFFS = [
    (
        40,
        "2026-09-18T16:02",
        "2026-09-18T16:20",
        "Damaged",
        "Water damage in storage bay 3.",
        [("p6", "4.32"), ("p25", "3")],
    ),
    (
        41,
        "2026-09-25T10:31",
        "2026-09-25T11:05",
        "Sale",
        "Contractor order #4471.",
        [("p5", "120"), ("p4", "80"), ("p1", "12.5")],
    ),
    (
        42,
        "2026-10-02T09:23",
        "2026-10-02T09:30",
        "Expired",
        "Past shelf life.",
        [("p25", "6"), ("p26", "2.5")],
    ),
    (
        43,
        "2026-10-07T14:18",
        "2026-10-07T15:10",
        "Sale",
        "Walk-in customer sale.",
        [("p18", "20"), ("p13", "12")],
    ),
    (
        44,
        "2026-10-13T17:20",
        "2026-10-13T17:45",
        "Lost / Theft",
        "Missing after shelf check.",
        [("p22", "1"), ("p23", "2")],
    ),
    (
        45,
        "2026-10-22T11:19",
        "2026-10-22T12:00",
        "Internal use",
        "Shop maintenance.",
        [("p12", "2"), ("p20", "5"), ("p15", "6")],
    ),
    (
        46,
        "2026-10-30T10:13",
        "2026-10-30T10:25",
        "Damaged",
        "Leaking cans after forklift incident.",
        [("p9", "12.5"), ("p10", "4")],
    ),
    (
        47,
        "2026-11-04T14:02",
        "2026-11-04T14:20",
        "Sale",
        "Northside Renovations order.",
        [("p5", "30"), ("p3", "14"), ("p1", "18"), ("p19", "9"), ("p17", "25.5")],
    ),
    (
        48,
        "2026-11-04T16:35",
        None,
        "Other",
        "Samples for trade show.",
        [("p27", "2"), ("p20", "3")],
    ),
]

# reverses (kind, number), posted, note
REVERSALS = [
    (
        "receipt",
        121,
        "2026-10-07T09:30",
        "Wrong purchase price for copper wire; re-entered as RC-000122.",
    ),
    ("write_off", 44, "2026-10-15T10:05", "Items found in the delivery van."),
]

# number, created, posted|None, category|None, note, deltas (posted) / actuals (draft; None = not counted)
STOCK_COUNTS = [
    (
        6,
        "2026-08-30T17:42",
        "2026-08-30T18:00",
        None,
        "Quarterly full count.",
        {"p7": "-6", "p13": "2", "p26": "-0.75"},
    ),
    (
        7,
        "2026-09-30T17:06",
        "2026-09-30T17:40",
        "c3",
        "",
        {"p10": "-3", "p11": "0.25", "p12": "-1"},
    ),
    (
        8,
        "2026-10-31T17:08",
        "2026-10-31T17:15",
        "c1",
        "Month-end count.",
        {"p1": "-0.5", "p4": "6", "p2": "-2"},
    ),
    (
        9,
        "2026-11-05T07:55",
        None,
        None,
        "Counting in progress.",
        {
            "p1": "41.8",
            "p7": "415",
            "p15": "7",
            "p23": "30",
            "p26": "23.25",
            "p22": None,
            "p24": None,
            "p25": None,
            "p27": None,
        },
    ),
]

OPENING_AT = "2026-08-12T09:00"
PRODUCTS_CREATED_AT = "2026-08-12T08:30"


@dataclass(order=True)
class _Event:
    at: datetime
    order: int
    kind: str = field(compare=False)
    payload: tuple = field(compare=False)


def _net_changes() -> dict[str, Decimal]:
    """Net stock change of every product over all posted mock documents (to derive opening stock)."""
    net: dict[str, Decimal] = {p[0]: D(0) for p in PRODUCTS}
    reversed_receipts = {n for k, n, *_ in REVERSALS if k == "receipt"}
    reversed_wos = {n for k, n, *_ in REVERSALS if k == "write_off"}
    for num, _c, posted, _s, _n, lines in RECEIPTS:
        if posted and num not in reversed_receipts:
            for pid, qty, _price in lines:
                net[pid] += D(qty)
    for num, _c, posted, _r, _n, lines in WRITE_OFFS:
        if posted and num not in reversed_wos:
            for pid, qty in lines:
                net[pid] -= D(qty)
    for _num, _c, posted, _cat, _n, deltas in STOCK_COUNTS:
        if posted:
            for pid, d in deltas.items():
                net[pid] += D(d)
    return net


def seed_demo(db: Session, user: User, now: datetime, tz: tzinfo) -> None:
    local_today = now.astimezone(tz).date()
    shift = local_today - MOCK_TODAY
    events: list[_Event] = []
    seq = 0

    def ts(s: str) -> datetime:
        d, t = s.split("T")
        local = datetime.combine(date.fromisoformat(d) + shift, time.fromisoformat(t), tz)
        return local

    def add(at: str, kind: str, payload: tuple) -> None:
        nonlocal seq
        seq += 1
        events.append(_Event(ts(at), seq, kind, payload))

    created = ts(PRODUCTS_CREATED_AT)
    cats: dict[str, Category] = {}
    for cid, name in CATEGORIES.items():
        c = Category(user_id=user.id, name=name, created_at=created)
        db.add(c)
        cats[cid] = c
    db.flush()

    prods: dict[str, Product] = {}
    for pid, sku, name, cid, unit, _stock, mn, pp, sp, desc, _arch in PRODUCTS:
        p = Product(
            user_id=user.id,
            sku=sku,
            name=name,
            category_id=cats[cid].id,
            unit=unit,
            description=desc,
            purchase_price=D(pp),
            sale_price=D(sp),
            min_stock=D(mn) if mn is not None else None,
            stock=D(0),
            avg_cost=None,
            created_at=created,
            updated_at=created,
        )
        db.add(p)
        prods[pid] = p
    db.flush()

    final = {p[0]: D(p[5]) for p in PRODUCTS}
    net = _net_changes()
    opening = [(pid, final[pid] - net[pid]) for pid in final if final[pid] - net[pid] > 0]
    add(
        OPENING_AT,
        "receipt",
        (
            116,
            OPENING_AT,
            OPENING_AT,
            "Opening balance",
            "Opening stock transferred from the previous spreadsheet.",
            [
                (pid, str(q), OPENING_COST.get(pid) or next(x[7] for x in PRODUCTS if x[0] == pid))
                for pid, q in opening
            ],
        ),
    )
    for r in RECEIPTS:
        add(r[2] or r[1], "receipt", r)
    for w in WRITE_OFFS:
        add(w[2] or w[1], "write_off", w)
    for rv in REVERSALS:
        add(rv[2], "reversal", rv)
    for sc in STOCK_COUNTS:
        add(sc[2] or sc[1], "stock_count", sc)
    events.sort()

    # pull future events back to just before "now", preserving order
    latest = now - timedelta(minutes=2)
    for i in range(len(events) - 1, -1, -1):
        if events[i].at > latest:
            events[i].at = latest
        latest = events[i].at - timedelta(minutes=3)

    docs: dict[tuple[str, int], Document] = {}
    inv.set_counter(db, user.id, "RV", 6)  # mockup reversals are RV-000007 and RV-000008
    for ev in events:
        if ev.kind == "receipt":
            num, c_at, posted, supplier, note, lines = ev.payload
            doc = _doc(
                db,
                user,
                "receipt",
                f"RC-{num:06d}",
                min(ts(c_at), ev.at),
                supplier=supplier,
                note=note,
            )
            for i, (pid, qty, price) in enumerate(lines):
                doc.lines.append(
                    DocumentLine(position=i, product_id=prods[pid].id, qty=D(qty), price=D(price))
                )
            db.flush()
            if posted:
                inv.post_receipt(db, user, doc.id, at=ev.at)
            docs[("receipt", num)] = doc
        elif ev.kind == "write_off":
            num, c_at, posted, reason, note, lines = ev.payload
            doc = _doc(
                db,
                user,
                "write_off",
                f"WO-{num:06d}",
                min(ts(c_at), ev.at),
                reason=reason,
                note=note,
            )
            for i, (pid, qty) in enumerate(lines):
                doc.lines.append(DocumentLine(position=i, product_id=prods[pid].id, qty=D(qty)))
            db.flush()
            if posted:
                inv.post_write_off(db, user, doc.id, at=ev.at)
            docs[("write_off", num)] = doc
        elif ev.kind == "reversal":
            kind, num, _posted, note = ev.payload
            inv.reverse_document(db, user, docs[(kind, num)].id, note=note, at=ev.at)
        else:
            num, c_at, posted, cid, note, values = ev.payload
            scope = [
                p
                for pid, p in prods.items()
                if not next(x[10] for x in PRODUCTS if x[0] == pid)
                and (cid is None or p.category_id == cats[cid].id)
            ]
            label = "All active products" if cid is None else f"Category: {CATEGORIES[cid]}"
            doc = _doc(db, user, "stock_count", f"SC-{num:06d}", min(ts(c_at), ev.at), note=note)
            doc.scope_category_id = cats[cid].id if cid else None
            doc.scope_label = label
            for i, p in enumerate(sorted(scope, key=lambda x: x.sku)):
                pid = next(k for k, v in prods.items() if v is p)
                if posted:
                    actual = p.stock + D(values.get(pid, "0"))
                elif pid in values:
                    actual = D(values[pid]) if values[pid] is not None else None
                else:
                    actual = p.stock
                doc.lines.append(DocumentLine(position=i, product_id=p.id, actual_qty=actual))
            db.flush()
            if posted:
                inv.post_stock_count(db, user, doc.id, at=ev.at)
    for pid, *_rest in PRODUCTS:
        if _rest[-1]:
            prods[pid].archived_at = ts("2026-10-20T12:00") if ts("2026-10-20T12:00") < now else now
    inv.set_counter(db, user.id, "RC", 127)
    inv.set_counter(db, user.id, "WO", 48)
    inv.set_counter(db, user.id, "RV", 8)
    inv.set_counter(db, user.id, "SC", 9)
    db.flush()


def _doc(db: Session, user: User, kind: str, number: str, at: datetime, **kw) -> Document:
    doc = Document(user_id=user.id, kind=kind, number=number, status="draft", created_at=at, **kw)
    db.add(doc)
    return doc
