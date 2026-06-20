import re
from datetime import date
from typing import Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException

router = APIRouter()

def parse_gs1_128(barcode: str) -> Dict[str, Any]:
    """
    Analizador sintáctico para GS1-128 enfocado en industria cárnica/frescos.
    Extrae GTIN (01), Fecha de Vencimiento (15), Peso Neto (310x),
    Lote (10) y Cantidad (30) de forma secuencial y mediante regex.
    """
    # Reemplazar representaciones comunes de FNC1
    barcode = barcode.replace("]C1", "\x1d")
    parsed = {}
    
    idx = 0
    while idx < len(barcode):
        if barcode[idx] == '\x1d':
            idx += 1
            continue
            
        # AI 01: GTIN (Fijo: 14 caracteres)
        if barcode[idx:idx+2] == "01":
            parsed["gtin"] = barcode[idx+2:idx+16]
            idx += 16
            
        # AI 15: Best Before / Vencimiento (Fijo: 6 caracteres YYMMDD)
        elif barcode[idx:idx+2] == "15":
            date_str = barcode[idx+2:idx+8]
            if len(date_str) == 6:
                try:
                    # Asumimos años 2000+
                    parsed["vencimiento"] = date(2000 + int(date_str[0:2]), int(date_str[2:4]), int(date_str[4:6]))
                except ValueError:
                    pass
            idx += 8
            
        # AI 310x: Peso Neto en KG (Fijo: 6 caracteres)
        elif barcode[idx:idx+3] == "310":
            decimals = int(barcode[idx+3])
            weight_str = barcode[idx+4:idx+10]
            if len(weight_str) == 6:
                parsed["peso_kg"] = int(weight_str) / (10 ** decimals)
            idx += 10
            
        # AI 10: Lote (Variable: hasta 20 caracteres)
        elif barcode[idx:idx+2] == "10":
            start = idx + 2
            end = barcode.find('\x1d', start)
            
            if end == -1:
                # Heurística para escaneos continuos sin separador FNC1 (\x1d)
                # Buscamos si hay otro AI conocido pegado inmediatamente después (como 21 o 30)
                rest = barcode[start:]
                m = re.search(r'^(.*?)(21\d|30\d)', rest)
                if m:
                    parsed["lote"] = m.group(1)
                    idx = start + len(m.group(1))
                else:
                    parsed["lote"] = rest[:20]
                    idx = start + len(parsed["lote"])
            else:
                parsed["lote"] = barcode[start:end]
                idx = end + 1
                
        # AI 30: Cantidad de piezas (Variable)
        elif barcode[idx:idx+2] == "30":
            start = idx + 2
            end = barcode.find('\x1d', start)
            if end == -1:
                # Asumimos que toma el resto si no hay separador
                rest = barcode[start:]
                m = re.search(r'^(.*?)(10|21)', rest)
                if m:
                    parsed["cantidad"] = int(m.group(1))
                    idx = start + len(m.group(1))
                else:
                    parsed["cantidad"] = int(rest[:8])
                    idx = start + len(str(parsed["cantidad"]))
            else:
                parsed["cantidad"] = int(barcode[start:end])
                idx = end + 1
                
        # AI 21: Serial (Variable)
        elif barcode[idx:idx+2] == "21":
            start = idx + 2
            end = barcode.find('\x1d', start)
            if end == -1:
                parsed["serial"] = barcode[start:start+20]
                idx = start + len(parsed["serial"])
            else:
                parsed["serial"] = barcode[start:end]
                idx = end + 1
                
        else:
            # Si encontramos un AI que no soportamos, avanzamos 1 caracter
            # (En producción esto debería estar mapeado con todas las longitudes GS1)
            idx += 1

    return parsed


# --- ENDPOINT DE RECEPCIÓN (FastAPI Router) ---

class InboundScanPayload(BaseModel):
    raw_barcode: str = Field(..., description="El string continuo del escáner láser GS1-128")
    ubicacion_id: str = Field(..., description="Ubicación destino (ej. 'BODEGA_RECEPCION')")

@router.post("/scan")
async def process_inbound_scan(payload: InboundScanPayload):
    barcode = payload.raw_barcode
    
    # 1. Parsear el código GS1-128
    parsed_data = parse_gs1_128(barcode)
    
    # 2. Validaciones críticas de negocio para frescos
    if "gtin" not in parsed_data or "vencimiento" not in parsed_data or "lote" not in parsed_data:
        raise HTTPException(
            status_code=400,
            detail="El código escaneado no contiene información FEFO/Lote válida para recepción de frescos."
        )
        
    # 3. Simulación: Insertar nuevo SATO en base de datos
    nuevo_sato = {
        "sku": parsed_data["gtin"],
        "lote": parsed_data["lote"],
        "fecha_vencimiento": parsed_data["vencimiento"].isoformat(),
        "peso_kg": parsed_data.get("peso_kg", 0.0),
        "ubicacion_id": payload.ubicacion_id,
        "estado": "RECEPCIONADO"
    }
    
    # db.add(nuevo_sato)
    # db.commit()
    
    return {
        "status": "success",
        "message": "Caja de frescos recepcionada correctamente",
        "data": nuevo_sato
    }

if __name__ == "__main__":
    # Test requerido con el pollo de la imagen
    test_barcode = "0112032532050005310200105115260614103989791210259241"
    print(f"\n[SCANNER LÁSER] Leyendo código: {test_barcode}")
    
    resultado = parse_gs1_128(test_barcode)
    
    print("\n--- RESULTADO DEL PARSER GS1-128 ---")
    for key, value in resultado.items():
        if key == "vencimiento":
            print(f"{key.upper()}: {value.strftime('%d-%m-%Y')} (Formateado)")
        else:
            print(f"{key.upper()}: {value}")
            
    print("\nValidación FEFO:")
    if "vencimiento" in resultado:
        print("✅ Fecha extraída exitosamente. Apto para ingreso.")
    else:
        print("❌ Código rechazado: No contiene fecha de vencimiento.")
