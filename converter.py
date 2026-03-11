import sys
import json
import pickle
import csv
import zlib
import gzip
import bz2
import marshal
import os
import re
import io

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def try_decode_text(data: bytes) -> str | None:
    """Try to decode bytes to string using common encodings."""
    for enc in ('utf-8', 'utf-8-sig', 'latin-1', 'cp1252'):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return None


def convert_to_serializable(obj):
    """Recursively convert any Python object to a JSON-serialisable form."""
    if isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    if isinstance(obj, bytes):
        try:
            return obj.decode('utf-8')
        except Exception:
            return obj.hex()
    if isinstance(obj, dict):
        return {str(k): convert_to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [convert_to_serializable(x) for x in obj]
    if hasattr(obj, '__dict__'):
        return convert_to_serializable(obj.__dict__)
    return str(obj)


# ---------------------------------------------------------------------------
# Individual format parsers — each returns a result dict or None on failure
# ---------------------------------------------------------------------------

def parse_json(text: str) -> dict | None:
    try:
        decoded = json.loads(text)
        return {"format": "json", "data": decoded}
    except Exception:
        return None


def parse_csv(text: str) -> dict | None:
    """Parse CSV / TSV / semicolon-separated text into a list of dicts."""
    try:
        text = text.strip()
        if not text:
            return None
        lines = text.splitlines()
        if len(lines) < 1:
            return None

        # Detect delimiter
        sample = "\n".join(lines[:20])
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',\t;|')
        except csv.Error:
            # Fallback: count most likely delimiter
            counts = {d: text.count(d) for d in (',', '\t', ';', '|')}
            delim = max(counts, key=counts.get)
            if counts[delim] == 0:
                return None
            dialect = csv.excel()
            dialect.delimiter = delim

        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        rows = list(reader)

        # Must have at least one row and at least one non-None key
        if not rows:
            return None
        if all(k is None for k in rows[0].keys()):
            return None

        return {"format": "csv", "data": rows}
    except Exception:
        return None


def parse_key_value(text: str) -> dict | None:
    """
    Parse key=value or key:value or 'key value' pairs (one per line).
    Requires at least 2 lines looking like pairs.
    """
    try:
        text = text.strip()
        lines = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith('#')]
        if len(lines) < 2:
            return None

        kv_pattern = re.compile(r'^([A-Za-z_][\w\s\-\.]*?)\s*[=:]\s*(.*)$')
        result = {}
        matched = 0
        for line in lines:
            m = kv_pattern.match(line)
            if m:
                key = m.group(1).strip()
                val = m.group(2).strip()
                # Try to coerce value types
                try:
                    val = int(val)
                except ValueError:
                    try:
                        val = float(val)
                    except ValueError:
                        if val.lower() in ('true', 'yes'):
                            val = True
                        elif val.lower() in ('false', 'no'):
                            val = False
                result[key] = val
                matched += 1

        # At least half the lines should be valid kv pairs
        if matched < max(2, len(lines) // 2):
            return None

        return {"format": "key_value", "data": result}
    except Exception:
        return None


def parse_fixed_width(text: str) -> dict | None:
    """
    Parse fixed-width column files (common in legacy .dat formats).
    Heuristic: multiple lines of equal length with consistent spacing.
    """
    try:
        lines = [l for l in text.splitlines() if l.strip()]
        if len(lines) < 2:
            return None

        lengths = [len(l) for l in lines[:10]]
        if max(lengths) - min(lengths) > 5:
            return None  # Not fixed-width

        # Find column boundaries from spacing in first 2 lines
        header = lines[0]
        # Use whitespace chunks as column positions
        cols = [(m.start(), m.end()) for m in re.finditer(r'\S+', header)]
        if len(cols) < 2:
            return None

        headers = [header[s:e].strip() for s, e in cols]
        rows = []
        for line in lines[1:]:
            row = {}
            for i, (s, e) in enumerate(cols):
                val = line[s:e].strip() if s < len(line) else ""
                row[headers[i]] = val
            rows.append(row)

        if not rows:
            return None

        return {"format": "fixed_width", "data": rows}
    except Exception:
        return None


def parse_pickle(data: bytes) -> dict | None:
    try:
        decoded = pickle.loads(data)
        if isinstance(decoded, (dict, list, tuple)):
            return {"format": "pickle", "data": convert_to_serializable(decoded)}
        return None
    except Exception:
        return None


def parse_marshal(data: bytes) -> dict | None:
    try:
        decoded = marshal.loads(data)
        if isinstance(decoded, (dict, list, tuple, set)):
            return {"format": "marshal", "data": convert_to_serializable(decoded)}
        return None
    except Exception:
        return None


def extract_strings(data: bytes) -> dict | None:
    """Extract all printable ASCII strings of length >= 4 from binary data."""
    # Correct byte-range regex: matches sequences of printable ASCII bytes
    strings = re.findall(rb'[\x20-\x7E]{4,}', data)
    if strings:
        return {
            "format": "extracted_strings",
            "data": [s.decode('ascii', errors='replace') for s in strings],
            "note": "Binary file detected. Extracted printable strings."
        }
    return None


def hex_dump(data: bytes) -> dict:
    return {
        "format": "binary_hex",
        "data": data[:1024].hex(' '),
        "note": "Could not parse data. Showing first 1KB in hex."
    }


# ---------------------------------------------------------------------------
# Main decoder pipeline
# ---------------------------------------------------------------------------

def try_decode_bytes(data: bytes) -> dict:
    """Try each format parser in priority order."""

    # --- Text-based formats (require successful decoding first) ---
    text = try_decode_text(data)
    if text:
        result = parse_json(text)
        if result:
            return result

        result = parse_csv(text)
        if result:
            return result

        result = parse_key_value(text)
        if result:
            return result

        result = parse_fixed_width(text)
        if result:
            return result

    # --- Binary formats ---
    result = parse_pickle(data)
    if result:
        return result

    result = parse_marshal(data)
    if result:
        return result

    # --- Last resort: string extraction / hex dump ---
    result = extract_strings(data)
    if result:
        return result

    return hex_dump(data)


def try_decode(file_path: str) -> dict:
    with open(file_path, 'rb') as f:
        raw_data = f.read()

    if not raw_data:
        return {"error": "File is empty"}

    # Try decompression first
    for decompressor, name in [
        (gzip.decompress, "gzip"),
        (zlib.decompress, "zlib"),
        (bz2.decompress, "bz2"),
    ]:
        try:
            decompressed = decompressor(raw_data)
            inner = try_decode_bytes(decompressed)
            return {"format": f"{name}_compressed", "data": inner}
        except Exception:
            continue

    return try_decode_bytes(raw_data)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    try:
        result = try_decode(file_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
