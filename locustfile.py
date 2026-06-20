import random
import uuid
from locust import HttpUser, task, between

class WMSOperatorUser(HttpUser):
    # Simula el tiempo que le toma a un operador real procesar entre escaneos y taps en la app (1 a 3 segundos)
    wait_time = between(1, 3)

    def on_start(self):
        """
        Setup inicial por operario simulado.
        Si la aplicación tuviera autenticación activada en MVP, aquí haríamos el login.
        Actualmente los endpoints de FastAPI tienen Depends(get_current_user) configurado 
        sin obligatoriedad para el MVP, por lo que podemos golpear la API directamente.
        """
        pass

    @task(3)
    def ver_catalogo(self):
        """Simula abrir la app y cargar el catálogo de productos (GET masivo)."""
        self.client.get("/catalogo/productos", name="Ver Catálogo")

    @task(3)
    def ver_mapa_2d(self):
        """Simula abrir o interactuar con el Gemelo Digital 2D de la bodega (GET masivo)."""
        self.client.get("/api/v1/mapa/bodega/", name="Cargar Mapa 2D")
        
    @task(2)
    def recepcionar_pallet(self):
        """
        Simula escaneos de cámara móvil muy rápidos en el endpoint de Recepción.
        Usamos catch_response=True para no fallar el test si el sistema 
        arroja un HTTP 400 válido de lógica de negocio (por ej. EAN no encontrado
        o lógica custom del payload), pero que confirma que la infraestructura soportó el Request.
        """
        payload = {
            # Se usa el EAN masivo creado por seed_massive_data.py
            "barcode_text": "EAN-MASSIVE-TEST", 
            "ubicacion_id": f"PAT-MASSIVE-0-{uuid.uuid4().hex[:6]}" 
        }
        
        with self.client.post("/bodega/recepcion/pallet", json=payload, name="Recepción Pallet (Scan)", catch_response=True) as response:
            # Toleramos 400 Bad Request lógicos y 404 Not Found como procesamientos exitosos de infraestructura
            if response.status_code in [200, 201, 400, 404]:
                response.success()
            else:
                response.failure(f"Fallo Infraestructura HTTP {response.status_code}")

    @task(2)
    def venta_salida(self):
        """
        Simula la Venta/Salida de cajas forzando el motor de inventario.
        Pone a prueba nuestros bloqueos transaccionales (SELECT FOR UPDATE) al forzar
        que múltiples operarios intenten descontar stock del mismo EAN concurrentemente.
        """
        payload = {
            "ean_producto": "EAN-MASSIVE-TEST",
            "cantidad_vendida": random.randint(1, 5)
        }
        with self.client.post("/caja/vender", json=payload, name="Venta/Salida Cajas", catch_response=True) as response:
            if response.status_code in [200, 201, 400, 404]:
                response.success()
            else:
                response.failure(f"Fallo Infraestructura HTTP {response.status_code}")
