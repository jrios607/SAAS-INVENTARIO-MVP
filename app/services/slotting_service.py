from typing import List, Dict, Any, Optional
from datetime import date
from sqlalchemy.orm import Session
from app.models import Patente, Sato

def calcular_compliance_patente(patente: Patente, satos_vitrina: List[Sato]) -> dict:
    """
    Calcula el nivel de cumplimiento del planograma (Micro-Slotting o Surtido Simple)
    y enriquece con métricas operativas de stock y vencimiento FEFO para la góndola.
    """
    hoy = date.today()
    satos_activos = [s for s in satos_vitrina if s.cantidad and s.cantidad > 0 and s.tipo_sato == "PRODUCTO"]
    stock_total = sum(s.cantidad for s in satos_activos)
    
    # Contadores de vencimiento FEFO en góndola
    alertas_vencimiento_count = 0
    vencidos_count = 0
    for s in satos_activos:
        if s.fecha_vencimiento:
            dias = (s.fecha_vencimiento - hoy).days
            if dias < 0:
                vencidos_count += 1
            elif dias <= 7:
                alertas_vencimiento_count += 1

    submapeo = patente.submapeo_grid
    tiene_submapeo = (
        isinstance(submapeo, dict)
        and "celdas" in submapeo
        and isinstance(submapeo["celdas"], list)
        and any(c.get("sku_asignado") for c in submapeo["celdas"] if isinstance(c, dict))
    )

    # ── MODO 1: Micro-Slotting con Cuadrícula (celdas r, c) ───────────────────
    if tiene_submapeo:
        celdas_esperadas = [c for c in submapeo.get("celdas", []) if isinstance(c, dict) and c.get("sku_asignado")]
        if not celdas_esperadas:
            return {
                "cumplimiento_porcentaje": 100.0,
                "discrepancias": [],
                "stock_total": stock_total,
                "skus_asignados_count": len(patente.productos_asignados or []),
                "skus_con_stock_count": len(set(s.sku for s in satos_activos if s.sku)),
                "alertas_vencimiento_count": alertas_vencimiento_count,
                "vencidos_count": vencidos_count,
            }

        sato_positions = set()
        for s in satos_activos:
            if s.sku and s.nivel_estante is not None and s.frente_posicion is not None:
                sato_positions.add((s.sku, s.nivel_estante, s.frente_posicion))

        aciertos = 0
        discrepancias = []
        for celda in celdas_esperadas:
            sku = celda.get("sku_asignado")
            coords = celda.get("coordenadas", [0, 0])
            r, c = coords[0], coords[1]
            nivel_esperado = r + 1
            frente_esperado = c + 1

            if (sku, nivel_esperado, frente_esperado) in sato_positions:
                aciertos += 1
            else:
                discrepancias.append(f"Falta SKU {sku} en Nivel {nivel_esperado}, Frente {frente_esperado}")

        esperados_set = set(
            (c.get("sku_asignado"), c.get("coordenadas", [0, 0])[0] + 1, c.get("coordenadas", [0, 0])[1] + 1)
            for c in celdas_esperadas
        )

        sobrantes_count = 0
        sobrantes_vistos = set()
        for sato in satos_activos:
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
            "discrepancias": discrepancias,
            "stock_total": stock_total,
            "skus_asignados_count": len(patente.productos_asignados or []),
            "skus_con_stock_count": len(set(s.sku for s in satos_activos if s.sku)),
            "alertas_vencimiento_count": alertas_vencimiento_count,
            "vencidos_count": vencidos_count,
        }

    # ── MODO 2: Macro-Slotting por Surtido Asignado (productos_asignados) ──────
    productos_asignados = patente.productos_asignados or []
    if productos_asignados:
        skus_presentes = set(s.sku for s in satos_activos if s.sku)
        aciertos = sum(1 for sku in productos_asignados if sku in skus_presentes)
        total_asignados = len(productos_asignados)
        porcentaje = (aciertos / total_asignados) * 100.0 if total_asignados > 0 else 100.0

        discrepancias = []
        for sku in productos_asignados:
            if sku not in skus_presentes:
                discrepancias.append(f"Agotado en góndola: Falta reponer SKU {sku}")

        # Sobrantes: SKUs en vitrina que no pertenecen al surtido asignado
        sobrantes_count = 0
        for sku in skus_presentes:
            if sku not in productos_asignados:
                sobrantes_count += 1
                discrepancias.append(f"Sobrante: SKU {sku} no pertenece al surtido de esta góndola")

        porcentaje -= sobrantes_count * 5.0
        porcentaje = max(0.0, min(100.0, round(porcentaje, 1)))

        return {
            "cumplimiento_porcentaje": porcentaje,
            "discrepancias": discrepancias,
            "stock_total": stock_total,
            "skus_asignados_count": total_asignados,
            "skus_con_stock_count": len(skus_presentes),
            "alertas_vencimiento_count": alertas_vencimiento_count,
            "vencidos_count": vencidos_count,
        }

    # ── MODO 3: Góndola sin surtido ni planograma asignado ─────────────────────
    if stock_total > 0:
        return {
            "cumplimiento_porcentaje": 100.0,
            "discrepancias": ["Góndola con stock físico pero sin surtido configurado"],
            "stock_total": stock_total,
            "skus_asignados_count": 0,
            "skus_con_stock_count": len(set(s.sku for s in satos_activos if s.sku)),
            "alertas_vencimiento_count": alertas_vencimiento_count,
            "vencidos_count": vencidos_count,
        }

    return {
        "cumplimiento_porcentaje": None,
        "discrepancias": ["Sin planograma ni surtido asignado"],
        "stock_total": 0,
        "skus_asignados_count": 0,
        "skus_con_stock_count": 0,
        "alertas_vencimiento_count": 0,
        "vencidos_count": 0,
    }


def get_compliance_batch(db: Session) -> dict:
    """Calcula el compliance de todas las patentes de Sala de Ventas en 2 queries SQL."""
    patentes = db.query(Patente).filter(Patente.tipo_ubicacion == "SALA_VENTA").all()
    satos_vitrina = db.query(Sato).filter(
        Sato.estado == "Vitrina",
        Sato.tipo_sato == "PRODUCTO",
        Sato.cantidad > 0
    ).all()
    
    satos_por_patente = {}
    for s in satos_vitrina:
        satos_por_patente.setdefault(s.ubicacion_id, []).append(s)
    
    result = {}
    for p in patentes:
        satos = satos_por_patente.get(p.id_patente, [])
        result[p.id_patente] = calcular_compliance_patente(p, satos)
    
    return result
