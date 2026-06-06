import re
from datetime import datetime

def parse_gs1_128(barcode: str) -> dict:
    parsed_data = {}
    try:
        match_01 = re.search(r'\(01\)(\d{14})', barcode)
        if match_01: parsed_data['ean'] = match_01.group(1)
            
        match_17 = re.search(r'\(17\)(\d{6})', barcode)
        if match_17:
            date_str = match_17.group(1)
            parsed_data['vencimiento'] = datetime.strptime(date_str, "%y%m%d").date()
            
        match_10 = re.search(r'\(10\)([^()]{1,20})', barcode)
        if match_10: parsed_data['lote'] = match_10.group(1)
            
        match_37 = re.search(r'\(37\)(\d{1,8})', barcode)
        if match_37: parsed_data['cantidad'] = int(match_37.group(1))
            
        required_keys = {'ean', 'lote', 'vencimiento', 'cantidad'}
        if not required_keys.issubset(parsed_data.keys()):
            missing = required_keys - set(parsed_data.keys())
            raise ValueError(f"Faltan identificadores: {missing}")
            
        return parsed_data
        
    except ValueError as ve:
        raise ve
    except Exception as e:
        raise ValueError(f"Texto malformado. Error: {str(e)}")