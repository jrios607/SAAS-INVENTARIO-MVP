from typing import List
from sqlalchemy.orm import Session
from app.models import Patente, Sato

def calcular_compliance_patente(patente: Patente, satos_vitrina: List[Sato]) -> dict:
    submapeo = patente.submapeo_grid
    
    if not submapeo or not isinstance(submapeo, dict) or "celdas" not in submapeo:
        return {"cumplimiento_porcentaje": None, "discrepancias": ["Sin planograma asignado"]}

    celdas_esperadas = [c for c in submapeo.get("celdas", []) if c.get("sku_asignado")]
    
    if not celdas_esperadas:
        return {"cumplimiento_porcentaje": 100.0, "discrepancias": []}

    aciertos = 0
    discrepancias = []
    
    # MEDIO-09: Pre-indexar los SATOs en un set (O(1) lookup en vez de O(N))
    sato_positions = set()
    for s in satos_vitrina:
        if s.sku and s.nivel_estante is not None and s.frente_posicion is not None:
            sato_positions.add((s.sku, s.nivel_estante, s.frente_posicion))
    
    for celda in celdas_esperadas:
        sku = celda["sku_asignado"]
        r, c = celda["coordenadas"]
        nivel_esperado = r + 1
        frente_esperado = c + 1
        
        encontrado = (sku, nivel_esperado, frente_esperado) in sato_positions
        
        if encontrado:
            aciertos += 1
        else:
            discrepancias.append(f"Falta SKU {sku} en Nivel {nivel_esperado}, Frente {frente_esperado}")
            
    esperados_set = set(
        (celda["sku_asignado"], celda["coordenadas"][0] + 1, celda["coordenadas"][1] + 1)
        for celda in celdas_esperadas
    )
    
    sobrantes_count = 0
    sobrantes_vistos = set()
    for sato in satos_vitrina:
        if not sato.sku:
            continue
        key = (sato.sku, sato.nivel_estante, sato.frente_posicion)
        if key not in esperados_set:
            if key not in sobrantes_vistos:
                sobrantes_count += 1
                discrepancias.append(f"Sobrante: SKU {sato.sku} en Nivel {sato.nivel_estante}, Frente {sato.frente_posicion}")
                sobrantes_vistos.add(key)

    total_esperados = len(celdas_esperadas)
    porcentaje = (aciertos / total_esperados) * 100.0 if total_esperados > 0 else 100.0
    
    porcentaje -= sobrantes_count * 5.0
    porcentaje = max(0.0, min(100.0, round(porcentaje, 1)))

    return {
        "cumplimiento_porcentaje": porcentaje,
        "discrepancias": discrepancias
    }

def get_compliance_batch(db: Session) -> dict:
    """CRÍTICO-08: N+1 Query Fix. Calcula el compliance de todas las patentes en 2 queries SQL."""
    patentes = db.query(Patente).all()
    satos_vitrina = db.query(Sato).filter(Sato.estado == "Vitrina").all()
    
    satos_por_patente = {}
    for s in satos_vitrina:
        satos_por_patente.setdefault(s.ubicacion_id, []).append(s)
    
    result = {}
    for p in patentes:
        satos = satos_por_patente.get(p.id_patente, [])
        result[p.id_patente] = calcular_compliance_patente(p, satos)
    
    return result
