import os
import sys

from app.database import SessionLocal
from app.models import Pedido_Outbound, Detalle_Pedido
from app.services.outbound_service import generar_ola_picking

db = SessionLocal()

print("1. Creando un Pedido_Outbound de prueba...")
nuevo_pedido = Pedido_Outbound(cliente="Juan Perez (E-commerce)", estado="PENDIENTE")
db.add(nuevo_pedido)
db.commit()

detalle1 = Detalle_Pedido(pedido_id=nuevo_pedido.id, sku="LECHE-001", cantidad=2)
detalle2 = Detalle_Pedido(pedido_id=nuevo_pedido.id, sku="AGUA-SABORIZADA", cantidad=3)
db.add_all([detalle1, detalle2])
db.commit()

print(f"Pedido {nuevo_pedido.id} creado con 2 LECHE-001 y 3 AGUA-SABORIZADA.")

print("2. Generando Ola de Picking (Reservando stock)...")
resultado = generar_ola_picking(db, [nuevo_pedido.id])
db.close()

print("\n--- OLA GENERADA EXITOSAMENTE ---")
print(f"ID de la Ola: {resultado['ola_id']}")
print(f"Total Tareas a recoger: {resultado['total_tareas']}")
print("\n=> Ahora puedes abrir el frontend en: http://localhost:3000/picking/ola/" + str(resultado['ola_id']))
