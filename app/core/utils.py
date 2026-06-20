import re
from datetime import datetime

def parse_gs1_128(barcode: str) -> dict:
    parsed_data = {}
    try:
        # (01) GTIN / EAN — 13 o 14 dígitos
        match_01 = re.search(r'\(?01\)?(\d{13,14})', barcode)
        if match_01:
            parsed_data['ean'] = match_01.group(1)
            
        # Fecha de vencimiento: soportar tanto (15) Best Before como (17) Expiry
        match_venc = re.search(r'\(?(?:15|17)\)?(\d{6})', barcode)
        if match_venc:
            date_str = match_venc.group(1)
            parsed_data['vencimiento'] = datetime.strptime(date_str, "%y%m%d").date()
            
        # (10) Lote
        match_10 = re.search(r'\(?10\)?([^()]{1,20})', barcode)
        if match_10:
            parsed_data['lote'] = match_10.group(1)
            
        # (3102) Peso neto — 6 dígitos con 2 decimales implícitos
        match_3102 = re.search(r'\(?3102\)?(\d{6})', barcode)
        if match_3102:
            raw = match_3102.group(1)
            parsed_data['peso_kg'] = int(raw) / 100.0
            
        # (37) Cantidad variable — 1 a 8 dígitos (opcional, default=1)
        match_37 = re.search(r'\(?37\)?(\d{1,8})', barcode)
        if match_37:
            parsed_data['cantidad'] = int(match_37.group(1))
        else:
            parsed_data['cantidad'] = 1  # Default: 1 unidad si no hay AI(37)
            
        # Validación: EAN es siempre obligatorio. Lote y Vencimiento dependerán del producto en los servicios.
        required_keys = {'ean'}
        if not required_keys.issubset(parsed_data.keys()):
            raise ValueError(f"Falta identificador EAN en el código GS1-128")
            
        return parsed_data
        
    except ValueError as ve:
        raise ve
    except Exception as e:
        raise ValueError(f"Texto malformado. Error: {str(e)}")