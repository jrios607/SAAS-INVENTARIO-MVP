import re
from datetime import datetime


def parse_gs1_128(barcode: str) -> dict:
    parsed_data = {}

    barcode = barcode.strip()
    if len(barcode) > 150:
        raise ValueError("Payload del código excede el largo máximo permitido (150 chars).")

    try:
        rest = barcode

        # 1. (01) GTIN / EAN / DUN-14 — 13 o 14 dígitos (extraer y remover primero para no colisionar con 15/17/10)
        match_01 = re.search(r"\(?01\)?(\d{13,14})", rest)
        if match_01:
            parsed_data["ean"] = match_01.group(1)
            rest = rest[: match_01.start()] + " " + rest[match_01.end() :]
        elif re.match(r"^\d{8,14}$", rest):
            parsed_data["ean"] = rest
            rest = ""

        # 2. (3100..3105) Peso neto — 6 dígitos
        match_310x = re.search(r"\(?310([0-5])\)?(\d{6})", rest)
        if match_310x:
            decimales = int(match_310x.group(1))
            raw = int(match_310x.group(2))
            parsed_data["peso_kg"] = raw / (10 ** decimales) if decimales > 0 else float(raw)
            rest = rest[: match_310x.start()] + " " + rest[match_310x.end() :]

        # 3. Fecha de vencimiento: (15) Best Before o (17) Expiry
        match_venc = re.search(r"\((?:15|17)\)(\d{6})", rest) or re.search(r"(?:^|\s)(?:15|17)(\d{6})", rest)
        if match_venc:
            date_str = match_venc.group(1)
            parsed_data["vencimiento"] = datetime.strptime(date_str, "%y%m%d").date()
            rest = rest[: match_venc.start()] + " " + rest[match_venc.end() :]

        # 4. (37) Cantidad variable — 1 a 8 dígitos
        match_37 = re.search(r"\(37\)(\d{1,8})", rest) or re.search(r"(?:^|\s)37(\d{1,8})", rest)
        if match_37:
            parsed_data["cantidad"] = int(match_37.group(1))
            rest = rest[: match_37.start()] + " " + rest[match_37.end() :]
        else:
            parsed_data["cantidad"] = 1

        # 5. (10) Lote
        match_10 = re.search(r"\(10\)([^()\s]{1,20})", rest) or re.search(r"(?:^|\s)10([A-Za-z0-9._-]{1,20})", rest)
        if match_10:
            parsed_data["lote"] = match_10.group(1)

        if "ean" not in parsed_data:
            raise ValueError("Falta identificador EAN/DUN-14 en el código GS1-128")

        return parsed_data

    except ValueError as ve:
        raise ve
    except Exception as e:
        raise ValueError(f"Texto malformado. Error: {str(e)}")
