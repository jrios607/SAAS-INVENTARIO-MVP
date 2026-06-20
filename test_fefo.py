import sys
import os
import json
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

print("--- INICIANDO TEST AUTOMATIZADO ---")

print("\n1. Testeando conexión básica a API:")
response = client.get("/")
print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")

print("\n2. Testeando Alertas de Vencimiento (GET /inventario/alertas-vencimiento):")
response = client.get("/inventario/alertas-vencimiento?dias_alerta=30")
print(f"Status: {response.status_code}")
print(f"Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")

print("\n3. Testeando Trazabilidad de Lotes (GET /trazabilidad/lote/LOTE-INEXISTENTE):")
response = client.get("/trazabilidad/lote/LOTE-INEXISTENTE")
print(f"Status: {response.status_code}")
print(f"Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")

print("\n--- TEST FINALIZADO ---")
