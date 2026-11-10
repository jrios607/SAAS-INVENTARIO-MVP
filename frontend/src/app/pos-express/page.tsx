"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Camera, CameraOff, Flashlight, RefreshCw, ShoppingCart, Trash2,
  Plus, Minus, Check, CheckCircle2, DollarSign, CreditCard,
  ArrowRight, Zap, Volume2, VolumeX, Barcode, Store,
  AlertTriangle, Sparkles, X, HelpCircle, ArrowLeft, History
} from "lucide-react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";

// ─── Catálogo Inicial Rápido de Don Pedro ────────────────────────────────────

interface ProductoPOS {
  sku: string;
  ean: string;
  nombre: string;
  categoria: string;
  precio: number;
  stockActual: number;
  unidad: string;
  icono?: string;
  esFavoritoSinCodigo?: boolean;
}

const CATALOGO_DEMO: ProductoPOS[] = [
  // Con código de barras (EAN-13 / EAN-8)
  { sku: "QUIX-750", ean: "7791290789906", nombre: "Lavavajillas Quix Limón 750ml", categoria: "Aseo", precio: 1890, stockActual: 24, unidad: "UN" },
  { sku: "LEC-301", ean: "7801234567890", nombre: "Leche Entera Colun 1L Tetra", categoria: "Lácteos", precio: 1290, stockActual: 48, unidad: "UN" },
  { sku: "ARR-001", ean: "7809876543210", nombre: "Arroz Grado 1 Tucapel 1kg", categoria: "Abarrotes", precio: 1550, stockActual: 35, unidad: "UN" },
  { sku: "ACE-003", ean: "7805551234567", nombre: "Aceite Vegetal Maravilla 900ml", categoria: "Abarrotes", precio: 1890, stockActual: 20, unidad: "UN" },
  { sku: "BEB-101", ean: "7801620000000", nombre: "Coca-Cola Original 1.5L", categoria: "Bebidas", precio: 1650, stockActual: 30, unidad: "UN" },
  { sku: "GAL-010", ean: "7802222333444", nombre: "Galletas Oreo Pack 6un", categoria: "Abarrotes", precio: 850, stockActual: 40, unidad: "UN" },
  { sku: "FID-002", ean: "7804444555666", nombre: "Fideos Spaghetti Carozzi 400g", categoria: "Abarrotes", precio: 920, stockActual: 25, unidad: "UN" },

  // Favoritos sin código de barra (Pan, Cecinas, Granel)
  { sku: "PAN-001", ean: "FAV-PAN-1000", nombre: "Pan Hallulla / Marraqueta ($1.000)", categoria: "Panadería", precio: 1000, stockActual: 120, unidad: "UN", icono: "🥖", esFavoritoSinCodigo: true },
  { sku: "PAN-002", ean: "FAV-PAN-1500", nombre: "Bolsa Pan Especial ($1.500)", categoria: "Panadería", precio: 1500, stockActual: 80, unidad: "UN", icono: "🍞", esFavoritoSinCodigo: true },
  { sku: "QUE-001", ean: "FAV-QUE-1800", nombre: "Queso Gauda Trozo (~200g)", categoria: "Fiambrería", precio: 1800, stockActual: 35, unidad: "UN", icono: "🧀", esFavoritoSinCodigo: true },
  { sku: "JAM-001", ean: "FAV-JAM-1200", nombre: "Jamón Pierna Laminado (150g)", categoria: "Fiambrería", precio: 1200, stockActual: 30, unidad: "UN", icono: "🥓", esFavoritoSinCodigo: true },
  { sku: "HUE-001", ean: "FAV-HUE-2400", nombre: "Bandeja 6 Huevos Campo", categoria: "Abarrotes", precio: 2400, stockActual: 50, unidad: "UN", icono: "🥚", esFavoritoSinCodigo: true },
  { sku: "EMP-001", ean: "FAV-EMP-2500", nombre: "Empanada de Pino Horno", categoria: "Comidas", precio: 2500, stockActual: 15, unidad: "UN", icono: "🥟", esFavoritoSinCodigo: true },
];

interface CartItem {
  producto: ProductoPOS;
  cantidad: number;
}

interface VentaRegistrada {
  id: string;
  hora: string;
  total: number;
  metodo: "EFECTIVO" | "TRANSBANK";
  itemsCount: number;
}

export default function PosExpressPage() {
  const [catalogo, setCatalogo] = useState<ProductoPOS[]>(CATALOGO_DEMO);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sonidoHabilitado, setSonidoHabilitado] = useState<boolean>(true);

  // ── Cámara y Escáner Web ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [videoDevices, setVideoDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [lastScannedEan, setLastScannedEan] = useState<string | null>(null);
  const lastScanTimestamp = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Feedback en vivo del último escaneo
  const [ultimoEscaneo, setUltimoEscaneo] = useState<{
    ean: string;
    nombre: string;
    precio: number;
    hora: string;
    tipo: "ENCONTRADO" | "NO_REGISTRADO";
  } | null>(null);

  // Modal para registrar al vuelo un producto nuevo no catalogado
  const [modalNuevoProducto, setModalNuevoProducto] = useState<boolean>(false);
  const [nuevoEan, setNuevoEan] = useState<string>("");
  const [nuevoNombre, setNuevoNombre] = useState<string>("");
  const [nuevoPrecio, setNuevoPrecio] = useState<number>(1000);
  const [nuevaCategoria, setNuevaCategoria] = useState<string>("Aseo");

  // Input manual de EAN
  const [inputManualEan, setInputManualEan] = useState<string>("");

  // ── Modales de Cobro ──
  const [modalCobro, setModalCobro] = useState<"EFECTIVO" | "TRANSBANK" | null>(null);
  const [montoRecibido, setMontoRecibido] = useState<number>(0);
  const [transbankStep, setTransbankStep] = useState<"WAITING_CARD" | "PROCESSING" | "APPROVED">("WAITING_CARD");
  const [ventaCompletada, setVentaCompletada] = useState<{ total: number; metodo: string; vuelto?: number } | null>(null);
  const [historialVentas, setHistorialVentas] = useState<VentaRegistrada[]>([]);

  // ── Sintetizador de Audio Web (Cero dependencias de archivos externos) ──
  const playBeep = (freq = 1100, duration = 0.08) => {
    if (!sonidoHabilitado) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {}
  };

  const playSuccessChime = () => {
    if (!sonidoHabilitado) return;
    playBeep(880, 0.08);
    setTimeout(() => playBeep(1320, 0.15), 90);
  };

  // ── Enumerar Cámaras Disponibles ──
  const refreshDevices = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, index) => ({
            deviceId: d.deviceId,
            label: d.label || `Cámara ${index + 1}`,
          }));
        setVideoDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      }
    } catch (e) {
      console.warn("No se pudieron listar cámaras:", e);
    }
  };

  // ── Inicializar Cámara en Vivo ──
  const startCamera = async (deviceId?: string, mode = facingMode) => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = deviceId
        ? {
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          }
        : {
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Fallback genérico para cámaras de escritorio / webcams sin facingMode ni exact deviceId
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      await refreshDevices();

      // Comprobar si la cámara tiene linterna (Flash Torch)
      const track = stream.getVideoTracks()[0];
      const capabilities = (track.getCapabilities && track.getCapabilities()) || {};
      setHasTorch(Boolean((capabilities as any).torch));
    } catch (err: any) {
      console.warn("No se pudo iniciar la cámara web:", err);
      setCameraError(err.message || "No se detectó cámara web o se denegó el permiso en el navegador.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsTorchOn(false);
  };

  const switchCamera = () => {
    if (videoDevices.length > 1) {
      const currentIndex = videoDevices.findIndex((d) => d.deviceId === selectedDeviceId);
      const nextIndex = (currentIndex + 1) % videoDevices.length;
      const nextDevice = videoDevices[nextIndex];
      setSelectedDeviceId(nextDevice.deviceId);
      startCamera(nextDevice.deviceId);
    } else {
      toggleFacingMode();
    }
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    if (isCameraActive) {
      startCamera(undefined, nextMode);
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      const nextTorch = !isTorchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: nextTorch }] });
      setIsTorchOn(nextTorch);
    } catch (err) {
      console.error("No se pudo activar la linterna:", err);
    }
  };

  // Garantizar que el stream de video se enlace de inmediato cuando la cámara se activa
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraActive]);

  // Bucle de Detección Universal de Código de Barras (ZXing + BarcodeDetector API)
  useEffect(() => {
    if (!isCameraActive || !videoRef.current) return;

    let isScanning = true;
    let nativeDetector: any = null;
    let zxingReader: BrowserMultiFormatReader | null = null;

    // 1. Probar BarcodeDetector nativo si existe (teléfonos modernos)
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        nativeDetector = new (window as any).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
        });
      } catch (e) {
        console.warn("BarcodeDetector nativo no disponible, usando motor ZXing:", e);
      }
    }

    // 2. Si no hay BarcodeDetector nativo (Chrome/Edge en Windows, Firefox), inicializar ZXing con formatos EAN/UPC
    if (!nativeDetector) {
      try {
        const hints = new Map<DecodeHintType, any>();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        zxingReader = new BrowserMultiFormatReader(hints);
      } catch (e) {
        console.warn("No se pudo instanciar ZXing reader:", e);
      }
    }

    // Intervalo de escaneo continuo rápido (cada 180ms)
    const intervalId = setInterval(async () => {
      if (!isScanning || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

      if (nativeDetector) {
        try {
          const barcodes = await nativeDetector.detect(video);
          if (barcodes && barcodes.length > 0) {
            handleDetectedEan(barcodes[0].rawValue);
          }
        } catch {}
      } else if (zxingReader) {
        try {
          const result = zxingReader.decode(video);
          if (result) {
            const raw = result.getText();
            if (raw) {
              handleDetectedEan(raw);
            }
          }
        } catch {
          // Normal: frame intermedio sin código en foco
        }
      }
    }, 180);

    return () => {
      isScanning = false;
      clearInterval(intervalId);
      if (zxingReader) {
        try {
          zxingReader.reset();
        } catch {}
      }
    };
  }, [isCameraActive]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // ── Lógica de Detección de Código EAN (Con Debounce y Auto-Registro) ──
  const handleDetectedEan = (codigoBruto: string) => {
    if (!codigoBruto) return;
    const ean = codigoBruto.trim().replace(/\s+/g, "");
    const now = Date.now();

    // Debounce: si es el mismo código escaneado hace menos de 2.5s, ignorar para evitar duplicados
    if (lastScannedEan === ean && now - lastScanTimestamp.current < 2500) {
      return;
    }

    lastScanTimestamp.current = now;
    setLastScannedEan(ean);

    // Buscar en catálogo
    const prod = catalogo.find((p) => p.ean === ean || p.sku === ean);

    if (prod) {
      playBeep(1200, 0.09);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(60);
      }
      addToCart(prod);
      setUltimoEscaneo({
        ean,
        nombre: prod.nombre,
        precio: prod.precio,
        hora: new Date().toLocaleTimeString(),
        tipo: "ENCONTRADO",
      });
    } else {
      // Producto nuevo / no registrado: Sonido amigable y abrir modal en caliente
      playBeep(650, 0.12);
      setUltimoEscaneo({
        ean,
        nombre: "Producto No Registrado",
        precio: 0,
        hora: new Date().toLocaleTimeString(),
        tipo: "NO_REGISTRADO",
      });
      setNuevoEan(ean);
      setNuevoNombre("");
      setNuevoPrecio(1500);
      setModalNuevoProducto(true);
    }
  };

  // ── Registrar Producto al Vuelo sin Salir del POS ──
  const handleRegistrarNuevoProducto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoEan.trim() || !nuevoNombre.trim() || nuevoPrecio <= 0) return;

    const limpioEan = nuevoEan.trim().replace(/\s+/g, "");
    const nuevoProd: ProductoPOS = {
      sku: `PROD-${Date.now().toString().slice(-5)}`,
      ean: limpioEan,
      nombre: nuevoNombre.trim(),
      categoria: nuevaCategoria || "Abarrotes",
      precio: Number(nuevoPrecio),
      stockActual: 30,
      unidad: "UN",
    };

    setCatalogo((prev) => [nuevoProd, ...prev]);
    addToCart(nuevoProd);
    playSuccessChime();
    setModalNuevoProducto(false);

    setUltimoEscaneo({
      ean: nuevoProd.ean,
      nombre: nuevoProd.nombre,
      precio: nuevoProd.precio,
      hora: new Date().toLocaleTimeString(),
      tipo: "ENCONTRADO",
    });
  };

  // ── Ingreso Manual por Teclado (Para emergencias con códigos borrosos) ──
  const handleIngresoManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputManualEan.trim()) return;
    handleDetectedEan(inputManualEan.trim());
    setInputManualEan("");
  };

  // ── Manejo del Carrito ──
  const addToCart = (prod: ProductoPOS) => {
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.producto.sku === prod.sku);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx].cantidad += 1;
        return copy;
      }
      return [...prev, { producto: prod, cantidad: 1 }];
    });
  };

  const updateQuantity = (sku: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.producto.sku === sku) {
            const newQty = item.cantidad + delta;
            return newQty > 0 ? { ...item, cantidad: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (sku: string) => {
    setCart((prev) => prev.filter((item) => item.producto.sku !== sku));
  };

  const clearCart = () => {
    setCart([]);
  };

  // Totales
  const totalItems = useMemo(() => cart.reduce((acc, i) => acc + i.cantidad, 0), [cart]);
  const totalPagar = useMemo(() => cart.reduce((acc, i) => acc + i.producto.precio * i.cantidad, 0), [cart]);
  const vuelto = useMemo(() => Math.max(0, montoRecibido - totalPagar), [montoRecibido, totalPagar]);

  // ── Cierre de Venta (Efectivo / Transbank) ──
  const handleIniciarCobroEfectivo = () => {
    if (cart.length === 0) return;
    setMontoRecibido(totalPagar);
    setModalCobro("EFECTIVO");
  };

  const handleIniciarCobroTransbank = () => {
    if (cart.length === 0) return;
    setModalCobro("TRANSBANK");
    setTransbankStep("WAITING_CARD");

    // Simulación del flujo de Transbank POS
    setTimeout(() => {
      setTransbankStep("PROCESSING");
      setTimeout(() => {
        setTransbankStep("APPROVED");
        playSuccessChime();
        finalizarVenta("TRANSBANK");
      }, 1600);
    }, 1200);
  };

  const finalizarVenta = (metodo: "EFECTIVO" | "TRANSBANK") => {
    const total = totalPagar;
    const itemsCount = totalItems;
    const vueltoCalculado = metodo === "EFECTIVO" ? Math.max(0, montoRecibido - total) : 0;

    const nuevaVenta: VentaRegistrada = {
      id: `TX-${Date.now().toString().slice(-4)}`,
      hora: new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      total,
      metodo,
      itemsCount,
    };

    setHistorialVentas((prev) => [nuevaVenta, ...prev.slice(0, 9)]);
    setVentaCompletada({ total, metodo, vuelto: vueltoCalculado });
    setCart([]);
    setModalCobro(null);

    // Auto-cerrar mensaje de éxito en 2.5s para no bloquear al siguiente cliente
    setTimeout(() => {
      setVentaCompletada(null);
    }, 2800);
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 font-sans flex flex-col select-none">
      
      {/* ── HEADER SUPERIOR ── */}
      <header className="px-6 py-3 bg-[#0B1120] border-b border-slate-800 flex items-center justify-between gap-4 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/patentes"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white border border-slate-800 transition-colors"
            title="Volver a Plano de Patentes"
          >
            <ArrowLeft size={16} />
          </Link>

          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center font-black text-slate-950 text-sm shadow-lg shadow-orange-500/20">
            POS
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-white tracking-tight">SG-BVC POS Express</h1>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                Modo Cámara Manos Libres
              </span>
            </div>
            <p className="text-xs text-slate-400">Punto de Venta Ultraligero para Don Pedro • Descuento FEFO Automático</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sonido On / Off */}
          <button
            onClick={() => setSonidoHabilitado(!sonidoHabilitado)}
            className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
              sonidoHabilitado
                ? "bg-slate-900 border-slate-700 text-teal-300"
                : "bg-slate-950 border-slate-800 text-slate-500"
            }`}
            title="Sonido Beep de Escáner"
          >
            {sonidoHabilitado ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Enlace al Mapa */}
          <Link
            href="/patentes/simulacion"
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center gap-1.5"
          >
            <Store size={14} className="text-emerald-400" />
            <span>Ver Mapa Tienda</span>
          </Link>
        </div>
      </header>

      {/* ── CUERPO PRINCIPAL: CÁMARA + FAVORITOS (IZQUIERDA) Y CARRITO (DERECHA) ── */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        
        {/* ── COLUMNA IZQUIERDA: CÁMARA ESCÁNER + BOTONES FAVORITOS (7 Cols) ── */}
        <div className="col-span-12 lg:col-span-7 p-6 flex flex-col gap-5 overflow-y-auto border-r border-slate-800 bg-slate-950/60">
          
          {/* ── BLOQUE DE CÁMARA ESCÁNER CON LÁSER VISUAL ── */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-amber-400" />
                <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                  Lector de Código EAN en Vivo (Cámara)
                </h2>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                {isCameraActive && (
                  <button
                    onClick={switchCamera}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
                    title="Alternar entre cámaras disponibles o frontal/trasera"
                  >
                    <RefreshCw size={14} className="text-amber-400" />
                    <span>Cambiar Cámara</span>
                  </button>
                )}

                {isCameraActive && hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                      isTorchOn
                        ? "bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-400/20"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    <Flashlight size={14} /> Linterna
                  </button>
                )}

                {!isCameraActive ? (
                  <button
                    onClick={() => startCamera(selectedDeviceId || undefined)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-amber-400/20 transition-all"
                  >
                    <Camera size={14} /> Activar Cámara
                  </button>
                ) : (
                  <button
                    onClick={stopCamera}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-700 transition-colors"
                  >
                    Pausar Cámara
                  </button>
                )}
              </div>
            </div>

            {/* Selector de dispositivo si hay múltiples cámaras detectadas */}
            {videoDevices.length > 1 && (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 p-2 rounded-xl border border-slate-800/80">
                <span className="font-semibold text-slate-300">Cámara:</span>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedDeviceId(id);
                    if (isCameraActive) startCamera(id);
                  }}
                  className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 outline-none focus:border-amber-400 flex-1"
                >
                  {videoDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Visor de Video de la Cámara (Con preview en vivo garantizado) */}
            <div className="relative w-full h-64 bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-800 flex items-center justify-center">
              {/* El elemento video SIEMPRE permanece en el DOM para reproducir el stream continuo sin saltos */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    videoRef.current.play().catch(() => {});
                  }
                }}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isCameraActive ? "opacity-100 block" : "opacity-0 hidden"
                }`}
              />

              {isCameraActive ? (
                <>
                  {/* Badge EN VIVO */}
                  <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-slate-950/80 backdrop-blur border border-emerald-500/40 px-2.5 py-1 rounded-full shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">
                      Vista Previa En Vivo
                    </span>
                  </div>

                  {/* Mira / Retícula de Escaneo Táctica */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
                    <div className="w-64 h-32 border-2 border-dashed border-amber-400/80 rounded-2xl relative shadow-2xl">
                      {/* Línea Láser Animada */}
                      <div className="absolute left-2 right-2 h-0.5 bg-red-500 shadow-[0_0_12px_#ef4444] animate-bounce"></div>
                      <div className="absolute top-1 left-2 text-[9px] font-mono text-amber-300 font-bold tracking-widest uppercase">
                        Apunta el código EAN aquí
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center p-6 space-y-2 z-10">
                  <CameraOff size={36} className="mx-auto text-slate-600" />
                  <p className="text-xs text-slate-400 font-medium max-w-sm mx-auto">
                    {cameraError
                      ? cameraError
                      : "Cámara en reposo. Pulsa \"Activar Cámara\" para ver la vista previa en vivo y escanear sin pistola láser."}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    O si estás en computador sin código a mano, usa los botones de simulación abajo:
                  </p>
                </div>
              )}
            </div>

            {/* Feedback Visual Inmediato del Escaneo */}
            {ultimoEscaneo && (
              <div
                className={`mt-3 p-3 rounded-2xl border flex items-center justify-between text-xs transition-all animate-in fade-in duration-200 ${
                  ultimoEscaneo.tipo === "ENCONTRADO"
                    ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                    : "bg-amber-950/40 border-amber-500/40 text-amber-200"
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  {ultimoEscaneo.tipo === "ENCONTRADO" ? (
                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                  )}
                  <div className="truncate">
                    <span className="font-bold block truncate">
                      {ultimoEscaneo.nombre}
                    </span>
                    <span className="text-[10px] opacity-80 font-mono">
                      EAN: {ultimoEscaneo.ean} · {ultimoEscaneo.hora}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  {ultimoEscaneo.tipo === "ENCONTRADO" ? (
                    <span className="font-mono font-bold text-sm text-emerald-300">
                      ${ultimoEscaneo.precio.toLocaleString("es-CL")}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setNuevoEan(ultimoEscaneo.ean);
                        setModalNuevoProducto(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-[10px] hover:bg-amber-300 transition-colors"
                    >
                      + Registrar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Entrada Manual de EAN (Por si el código de barras físico está roto o sucio) */}
            <form onSubmit={handleIngresoManual} className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={inputManualEan}
                  onChange={(e) => setInputManualEan(e.target.value)}
                  placeholder="Escribe o pega código EAN a mano..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors shrink-0"
              >
                + Cargar
              </button>
            </form>

            {/* Botones de Prueba Rápida para Simular Beep (Útil en computador o si no hay producto físico a mano) */}
            <div className="mt-3 pt-3 border-t border-slate-800/80">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                O Simula un Beep de Código EAN con 1 Clic:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  onClick={() => handleDetectedEan("7791290789906")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-amber-500/30 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🧼 Quix Limón 750ml</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$1.890</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7801234567890")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🥛 Leche Colun 1L</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$1.290</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7809876543210")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🌾 Arroz Tucapel</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$1.550</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7805551234567")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🌻 Aceite Maravilla</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$1.890</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7801620000000")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🥤 Coca-Cola 1.5L</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$1.650</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7802222333444")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🍪 Galletas Oreo</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$850</span>
                </button>
                <button
                  onClick={() => handleDetectedEan("7804444555666")}
                  className="p-2 bg-slate-800/80 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-left text-xs font-semibold flex items-center justify-between group transition-all"
                >
                  <span className="truncate">🍝 Fideos Carozzi</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">$920</span>
                </button>
              </div>
            </div>
          </div>

          {/* ── BOTONES FAVORITOS RÁPIDOS (PARA LO QUE NO TIENE CÓDIGO DE BARRA) ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-400" />
                Botones Rápidos (Pan, Cecinas y Granel sin código)
              </span>
              <span className="text-[11px] text-slate-500">Un toque con el dedo = Suma al carrito</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {catalogo.filter(p => p.esFavoritoSinCodigo).map((item) => (
                <button
                  key={item.sku}
                  onClick={() => {
                    playBeep(1100, 0.07);
                    addToCart(item);
                  }}
                  className="p-3.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-amber-400/50 rounded-2xl flex flex-col justify-between text-left shadow-lg transition-all active:scale-95 group"
                >
                  <div className="text-2xl mb-1">{item.icono}</div>
                  <div className="text-xs font-bold text-white leading-tight line-clamp-2 group-hover:text-amber-300">
                    {item.nombre}
                  </div>
                  <div className="text-base font-black text-emerald-400 mt-2 font-mono">
                    ${item.precio.toLocaleString("es-CL")}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── COLUMNA DERECHA: CARRITO Y COBRO TOTAL (5 Cols) ── */}
        <aside className="col-span-12 lg:col-span-5 flex flex-col h-full bg-[#0B1120] p-6 justify-between">
          
          {/* Cabecera del Carrito */}
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <ShoppingCart size={20} className="text-emerald-400" />
                <h3 className="font-bold text-base text-white">Venta en Curso</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300">
                  {totalItems} items
                </span>
              </div>

              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={13} /> Limpiar
                </button>
              )}
            </div>

            {/* Listado de Productos en el Carrito */}
            <div className="max-h-[380px] overflow-y-auto space-y-2.5 pr-1">
              {cart.length === 0 ? (
                <div className="py-16 text-center border-2 border-dashed border-slate-800 rounded-3xl p-6">
                  <Barcode size={36} className="mx-auto text-slate-600 mb-2" />
                  <p className="text-sm font-bold text-slate-400">El carrito está vacío</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Pasa productos con código frente a la cámara o toca los botones de Pan y Cecinas a la izquierda.
                  </p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.producto.sku}
                    className="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-center justify-between gap-3 shadow-md"
                  >
                    <div className="flex-1 truncate">
                      <div className="text-xs font-bold text-white truncate">{item.producto.nombre}</div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        ${item.producto.precio.toLocaleString("es-CL")} c/u
                      </div>
                    </div>

                    {/* Controles de Cantidad (+ / -) */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.producto.sku, -1)}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="font-mono text-sm font-bold text-white w-6 text-center">
                        {item.cantidad}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.producto.sku, 1)}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold"
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    {/* Subtotal del Item */}
                    <div className="text-right font-mono text-sm font-black text-emerald-400 min-w-[70px]">
                      ${(item.producto.precio * item.cantidad).toLocaleString("es-CL")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── SECCIÓN INFERIOR DE TOTAL Y BOTONES DE COBRO GIGANTES ── */}
          <div className="border-t border-slate-800 pt-4 mt-4 space-y-4">
            
            {/* TOTAL GIGANTE */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/90 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 uppercase tracking-widest font-bold block">
                  Total a Cobrar
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">
                  {totalItems} producto(s) en bolsa
                </span>
              </div>
              <div className="text-4xl font-black text-white font-mono tracking-tight">
                ${totalPagar.toLocaleString("es-CL")}
              </div>
            </div>

            {/* BOTONES DE COBRO DE 1 TOQUE (EFECTIVO O TRANSBANK) */}
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={cart.length === 0}
                onClick={handleIniciarCobroEfectivo}
                className="py-4 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 disabled:pointer-events-none text-slate-950 font-black text-base flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
              >
                <div className="flex items-center gap-2">
                  <DollarSign size={20} />
                  <span>EFECTIVO</span>
                </div>
                <span className="text-[10px] font-normal text-slate-900">Calcula el vuelto al instante</span>
              </button>

              <button
                disabled={cart.length === 0}
                onClick={handleIniciarCobroTransbank}
                className="py-4 px-4 rounded-2xl bg-teal-500 hover:bg-teal-400 disabled:opacity-30 disabled:pointer-events-none text-slate-950 font-black text-base flex flex-col items-center justify-center gap-1 shadow-lg shadow-teal-500/20 transition-all active:scale-95"
              >
                <div className="flex items-center gap-2">
                  <CreditCard size={20} />
                  <span>TRANSBANK</span>
                </div>
                <span className="text-[10px] font-normal text-slate-900">Tarjeta Débito / Crédito</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── MODAL: COBRO EN EFECTIVO (CALCULADORA DE VUELTO RÁPIDA) ── */}
      {modalCobro === "EFECTIVO" && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl text-slate-100 space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <DollarSign size={20} className="text-emerald-400" />
                <h3 className="font-bold text-lg text-white">Cobro en Efectivo</h3>
              </div>
              <button onClick={() => setModalCobro(null)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="text-center p-4 bg-slate-950 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400 uppercase tracking-widest font-bold">Total Cuenta</span>
              <div className="text-4xl font-black text-white font-mono mt-1">
                ${totalPagar.toLocaleString("es-CL")}
              </div>
            </div>

            {/* Botones de Billetes Rápidos ($1.000, $2.000, $5.000, $10.000, $20.000) */}
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase block mb-2">
                ¿Con cuánto paga el cliente?
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setMontoRecibido(totalPagar)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold font-mono text-emerald-400 border border-slate-700"
                >
                  Exacto (${totalPagar.toLocaleString("es-CL")})
                </button>
                <button
                  onClick={() => setMontoRecibido(2000)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold font-mono text-white border border-slate-700"
                >
                  $2.000
                </button>
                <button
                  onClick={() => setMontoRecibido(5000)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold font-mono text-white border border-slate-700"
                >
                  $5.000
                </button>
                <button
                  onClick={() => setMontoRecibido(10000)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold font-mono text-white border border-slate-700"
                >
                  $10.000
                </button>
                <button
                  onClick={() => setMontoRecibido(20000)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold font-mono text-white border border-slate-700"
                >
                  $20.000
                </button>
                <button
                  onClick={() => {
                    const ingreso = prompt("Ingresa monto en billetes:", String(totalPagar));
                    if (ingreso) setMontoRecibido(Number(ingreso) || totalPagar);
                  }}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 border border-slate-700"
                >
                  Otro...
                </button>
              </div>
            </div>

            {/* Vuelto a Entregar en Gigante */}
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-300 uppercase block">Vuelto a Don Pedro</span>
                <span className="text-[11px] text-emerald-200/70">
                  Paga con ${montoRecibido.toLocaleString("es-CL")}
                </span>
              </div>
              <div className="text-3xl font-black text-emerald-300 font-mono">
                ${vuelto.toLocaleString("es-CL")}
              </div>
            </div>

            <button
              onClick={() => {
                playSuccessChime();
                finalizarVenta("EFECTIVO");
              }}
              className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-base shadow-xl shadow-emerald-500/20 transition-all"
            >
              ✓ Confirmar Venta y Entregar Vuelto
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: COBRO EN TRANSBANK (SIMULACIÓN DE TERMINAL POS) ── */}
      {modalCobro === "TRANSBANK" && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl text-slate-100 text-center space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 flex items-center justify-center mx-auto animate-pulse">
              <CreditCard size={32} />
            </div>

            <div>
              <h3 className="font-bold text-lg text-white">Terminal Transbank POS</h3>
              <p className="text-xs text-slate-400 mt-1">Monto enviado automáticamente:</p>
              <div className="text-3xl font-black text-teal-300 font-mono mt-1">
                ${totalPagar.toLocaleString("es-CL")}
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-medium text-slate-300">
              {transbankStep === "WAITING_CARD" && "💳 Acerque o inserte tarjeta en la maquinita..."}
              {transbankStep === "PROCESSING" && "⏳ Procesando pago con el banco..."}
              {transbankStep === "APPROVED" && "✓ Transacción Aprobada exitosamente"}
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICACIÓN TOAST DE VENTA EXITOSA (Descuento FEFO en SG-BVC) ── */}
      {ventaCompletada && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 px-6 py-3.5 rounded-2xl font-black text-sm shadow-2xl z-50 flex items-center gap-3 animate-in slide-in-from-top duration-300 border border-emerald-300">
          <CheckCircle2 size={24} />
          <div>
            <div>¡Venta #{Date.now().toString().slice(-4)} Registrada con Éxito!</div>
            <div className="text-xs font-bold text-slate-900">
              Total ${ventaCompletada.total.toLocaleString("es-CL")} ({ventaCompletada.metodo})
              {ventaCompletada.vuelto ? ` • Vuelto: $${ventaCompletada.vuelto.toLocaleString("es-CL")}` : ""}
              {" • Stock descontado por FEFO en SG-BVC"}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: REGISTRAR PRODUCTO NUEVO AL VUELO ── */}
      {modalNuevoProducto && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleRegistrarNuevoProducto}
            className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl text-slate-100 space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={20} className="text-amber-400" />
                <h3 className="font-bold text-base text-white">Nuevo Producto Escaneado</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalNuevoProducto(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              El código <span className="font-mono text-amber-300 font-bold">{nuevoEan}</span> no está en el catálogo.
              Registra su nombre y precio para sumarlo al carrito en 3 segundos:
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                  Nombre del Producto
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: Lavavajillas Quix Limón 750ml"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                    Precio Venta ($)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={nuevoPrecio}
                    onChange={(e) => setNuevoPrecio(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                    Categoría
                  </label>
                  <select
                    value={nuevaCategoria}
                    onChange={(e) => setNuevaCategoria(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="Aseo">Aseo</option>
                    <option value="Abarrotes">Abarrotes</option>
                    <option value="Bebidas">Bebidas</option>
                    <option value="Lácteos">Lácteos</option>
                    <option value="Fiambrería">Fiambrería</option>
                    <option value="Comidas">Comidas</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalNuevoProducto(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-amber-400/20 transition-all"
              >
                <Plus size={14} /> Guardar y Agregar al Carro
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
