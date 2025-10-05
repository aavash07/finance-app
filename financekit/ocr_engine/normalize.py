from __future__ import annotations
import re
from typing import Dict, Any, List, Tuple

# $ or bare 12.34 / 1,234.56
_MONEY_ANY = re.compile(r"(?<!\S)\$?\s*([-+]?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2})(?!\S)")

# TOTAL triggers with word boundaries (priority order)
_TOTAL_PATTERNS = [
    re.compile(r"\btotal purchase\b", re.I),
    re.compile(r"\bgrand total\b", re.I),
    re.compile(r"\bamount due\b", re.I),
    re.compile(r"\bbalance due\b", re.I),
    re.compile(r"\btotal\b", re.I),
]

_TOTAL_EXCLUDE = ("subtotal", "tax", "change", "debit tend")

_NON_ITEM_HINTS = (
    "subtotal", "tax", "change", "cash", "debit", "credit", "visa", "mastercard",
    "ref #", "appr code", "terminal #", "auth", "items sold",
    "thank you for shopping", "thank you", "survey", "feedback",
    "save money", "live better", "store receipts", "walmart pay", "signature required",
    "manager", "id #", "to win", "low prices",
)

_PHONE = re.compile(r"\b\d{3}[-\s)]?\d{3}[-\s]?\d{4}\b")
_DATE_ANY = re.compile(r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{4}[/\-]\d{1,2}[/\-]\d{1,2})\b")

_TRAILING_SKU = re.compile(r"(?:\s+\b\d{8,}\b)+\s*$")
_QTY_AT = re.compile(r"\b(\d+)\s*@\s*")
_QTY_EA = re.compile(r"\b(\d+)\s*(ea|each)\b", re.I)
_PER_UNIT = re.compile(r"/\s*(ea|lb|kg|unit)\b", re.I)

def _is_price_only(line: str) -> bool:
    tokens = _MONEY_ANY.findall(line)
    if not tokens:
        return False
    letters = sum(ch.isalpha() for ch in line)
    return len(tokens) == 1 and letters < 3

def _extract_last_price_token(line: str) -> str | None:
    matches = list(_MONEY_ANY.finditer(line))
    if not matches:
        return None
    cand = matches[-1].group(0)
    if _PER_UNIT.search(cand) and len(matches) >= 2:
        cand = matches[-2].group(0)
    return cand

def _strip_trailing_sku(desc: str) -> str:
    return _TRAILING_SKU.sub("", desc)

def _clean_desc(s: str) -> str:
    s = s.strip(" '\"“”•.-\t")
    s = _strip_trailing_sku(s)
    return s

def _parse_total_to_float(token: str) -> float:
    if not token:
        return 0.0
    m = _MONEY_ANY.search(token)
    if m:
        token = m.group(1)
    token = token.replace(",", "").replace(" ", "").replace("$", "")
    try:
        return float(token)
    except Exception:
        return 0.0

def _infer_currency_from_text(text: str | None) -> str:
    if not text:
        return "USD"
    U = text.upper()
    if "$" in text or "USD" in U: return "USD"
    if "€" in text or "EUR" in U: return "EUR"
    if "£" in text or "GBP" in U: return "GBP"
    if "₹" in text or "INR" in U: return "INR"
    return "USD"

def _best_total_from_text(text: str) -> float:
    lines = [ln.strip() for ln in (text or "").splitlines()]
    if not lines:
        return 0.0
    def extract_vals(slice_lines: List[str]) -> List[float]:
        vals: List[float] = []
        for ln in slice_lines:
            for m in _MONEY_ANY.findall(ln):
                try:
                    vals.append(float(m.replace(",", "").strip()))
                except Exception:
                    pass
        return vals
    start = max(0, int(len(lines) * 2 / 3))
    bottom_vals = extract_vals(lines[start:])
    if bottom_vals:
        return max(bottom_vals)
    all_vals = extract_vals(lines)
    return max(all_vals) if all_vals else 0.0

def _first_total_line_and_value(lines: List[str]) -> Tuple[int, float]:
    best_idx, best_val = -1, 0.0
    for i, raw in enumerate(lines):
        low = raw.lower()
        if any(ex in low for ex in _TOTAL_EXCLUDE):
            continue
        if not any(pat.search(raw) for pat in _TOTAL_PATTERNS):
            continue
        m = _MONEY_ANY.search(raw)
        val = _parse_total_to_float(m.group(0)) if m else 0.0
        if i >= best_idx:
            best_idx, best_val = i, (val or best_val)
    return best_idx, best_val

def _looks_like_non_item(line: str) -> bool:
    low = line.lower()
    if any(h in low for h in _NON_ITEM_HINTS):
        return True
    if _PHONE.search(line) or _DATE_ANY.search(line):
        return True
    letters = sum(ch.isalpha() for ch in line)
    if letters < 3:  # mostly numbers/symbols or too short
        return True
    return False

_IGNORE_ITEM_WORDS = (
    "subtotal", "total", "tax", "change", "debit tend",
    "balance", "amount", "due", "ref #", "network id",
)

def _should_ignore_item(desc: str) -> bool:
    low = desc.lower()
    return any(w in low for w in _IGNORE_ITEM_WORDS)

def _itemize(text: str, cutoff_idx: int) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    lines = [ln.rstrip() for ln in (text or "").splitlines()]
    # hard cutoff: ignore TOTAL line and everything after it
    upto = lines[:max(0, cutoff_idx)] if cutoff_idx >= 0 else lines

    desc_buffer: str | None = None
    WINDOW = 3

    i = 0
    while i < len(upto):
        raw = upto[i]
        line = raw.strip()
        i += 1
        if not line:
            continue

        if _looks_like_non_item(line):
            desc_buffer = None
            continue

        last_tok = _extract_last_price_token(line)
        if last_tok:
            price_val = _parse_total_to_float(last_tok)

            # Pair qty@price or per-unit lines with the previous description if present.
            if (_QTY_AT.search(line) or _QTY_EA.search(line) or _PER_UNIT.search(last_tok)) and desc_buffer:
                desc = _clean_desc(desc_buffer)
                desc_buffer = None
                if len(desc) >= 3 and not _should_ignore_item(desc) and price_val > 0:
                    items.append({"desc": desc, "qty": 1.0, "price": price_val})
                continue

            # "desc ... price" on the same line
            desc_part = line[: line.rfind(last_tok)]
            desc = _clean_desc(desc_part) if len(desc_part) >= 3 else (_clean_desc(desc_buffer) if desc_buffer else "")
            desc_buffer = None
            if len(desc) >= 3 and not _should_ignore_item(desc) and price_val > 0:
                items.append({"desc": desc, "qty": 1.0, "price": price_val})
            continue

        # Buffer potential description
        if desc_buffer is None:
            desc_buffer = line
        else:
            if len(line) > 5 and len(desc_buffer) < 28:
                desc_buffer = _clean_desc(f"{desc_buffer} {line}")

        # Lookahead: price-only or qty@price within WINDOW lines
        lookahead_end = min(len(upto), i + WINDOW)
        paired = False
        for j in range(i, lookahead_end):
            la = upto[j].strip()
            if not la:
                continue
            if _looks_like_non_item(la):
                break
            if _QTY_AT.search(la) or _QTY_EA.search(la) or _is_price_only(la):
                tok = _extract_last_price_token(la)
                if tok and desc_buffer:
                    price_val = _parse_total_to_float(tok)
                    desc = _clean_desc(desc_buffer)
                    if len(desc) >= 3 and not _should_ignore_item(desc) and price_val > 0:
                        items.append({"desc": desc, "qty": 1.0, "price": price_val})
                        desc_buffer = None
                        i = j + 1
                        paired = True
                        break
        if paired:
            continue

    # Keep dangling desc as $0.00 (optional; delete to drop)
    if desc_buffer and len(desc_buffer) >= 3:
        desc = _clean_desc(desc_buffer)
        if not _should_ignore_item(desc):
            items.append({"desc": desc, "qty": 1.0, "price": 0.0})

    return items

def normalize_text_to_schema(text: str) -> Dict[str, Any]:
    # Merchant: emulate external detection (simple top lines + hints).
    store_hints = {"walmart","ucb","target","amazon","costco","trader joe","trader joe's","trader","joes","joe's"}
    lines = [ln.strip() for ln in (text or "").splitlines()]
    merchant = "Unknown"
    first_candidate = ""
    for ln in lines[:10]:
        low = ln.lower().strip()
        if not low: 
            continue
        if any(h in low for h in store_hints):
            merchant = ln.title().strip(" '\"“”")
            break
        if len(low) > 3 and "page" not in low and not first_candidate:
            first_candidate = ln.title().strip(" '\"“”")
    if merchant == "Unknown" and first_candidate:
        merchant = first_candidate

    total_idx, total_val = _first_total_line_and_value(lines)
    if total_val == 0.0:
        total_val = _best_total_from_text(text or "")

    items = _itemize(text or "", total_idx)

    return {
        "merchant": merchant,
        "date": None,
        "currency": _infer_currency_from_text(text),
        "total": total_val,
        "items": items,
    }
