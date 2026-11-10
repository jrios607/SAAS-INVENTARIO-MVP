"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  getStockAgrupado,
  createProducto,
  updateProducto,
  deleteProducto,
  importarCatalogoArchivo,
  ingresarStockCatalogo,
  generarCodigoInternoPlu,
  Producto,
  LoteDetalleFEFO,
  CatalogoImportSummaryResponse,
} from "@/services/api";

export interface CatalogProduct {
  sku: string;
  nombre: string;
  ean: string;
  dun14?: string | null;
  unidades_por_caja: number;
  unidad_medida: string;
  temperatura_requerida: string;
  stock_minimo: number;
  dias_alerta_vencimiento: number;
  tolerancia_vencimiento_dias: number;
  controla_vencimiento: boolean;
  dias_vida_util?: number | null;
  costo_unitario: number;
  es_ghost_sku: boolean;
  proveedor_marca: string;
  familia: string;
  subFamilia: string;
  stockSubFamilia: number;
  stock: number;
  stockVitrina: number;
  stockBodega: number;
  proximaFechaVencimiento?: string | null;
  alertaVencimiento: string;
  stockGlobalFamilia: number;
  clase_abc?: "A" | "B" | "C" | string;
  es_perecible_corto?: boolean;
  venta_valorizada_ventana?: number;
  lotes: LoteDetalleFEFO[];
}

const FAMILIAS_CATALOGO = [
  "Abarrotes",
  "Lácteos",
  "Lácteos y Huevos",
  "Carnes y Fiambrería",
  "Fiambrería y Lácteos",
  "Carnicería y Pescadería",
  "Frutas y Verduras",
  "Panadería",
  "Panadería y Pastelería",
  "Congelados",
  "Bebidas y Licores",
  "Bebidas y Líquidos",
  "Aseo y Limpieza",
  "Limpieza y Hogar",
  "Cuidado Personal y Mascotas",
];

const INITIAL_FORM: Producto = {
  sku: "",
  nombre: "",
  ean: "",
  dun14: "",
  unidades_por_caja: 12,
  unidad_medida: "UN",
  temperatura_requerida: "SECO",
  stock_minimo: 5,
  dias_alerta_vencimiento: 7,
  familia: "Abarrotes",
  sub_familia: "",
  proveedor_marca: "",
  categoria: "Abarrotes",
  tolerancia_vencimiento_dias: 5,
  controla_vencimiento: true,
  es_perecible_corto: false,
  dias_vida_util: undefined,
  costo_unitario: 0,
  stock_inicial: 0,
  modo_stock_inicial: "UNIDADES",
  estado_stock_inicial: "Vitrina",
};

interface TourStep {
  targetId: string;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-kpis",
    title: "1. Resumen de tu inventario",
    desc: "Revisa de un vistazo las unidades totales sumando vitrina y bodega, la variedad de productos activos, los lotes próximos a vencer y los productos listos para reposición.",
  },
  {
    targetId: "tour-filters",
    title: "2. Búsqueda y filtros rápidos",
    desc: "Encuentra cualquier producto escribiendo su nombre o código, o filtra por familia, tipo de conservación (seco, refrigerado, congelado) y estado de existencias.",
  },
  {
    targetId: "tour-table",
    title: "3. Listado y opciones por producto",
    desc: "Consulta la categoría y fecha de vencimiento de cada artículo. Pulsa 'Más detalle' para ver códigos EAN/DUN-14, disponibilidad en vitrina/bodega o imprimir etiquetas, y '+ Stock' para ingresar un nuevo lote.",
  },
];

const PAGE_SIZE = 10;

function formatConservationLabel(temp: string): string {
  const t = (temp || "SECO").toUpperCase();
  if (t.includes("CONGELADO")) return "Congelado";
  if (t.includes("REFRIGER")) return "Refrigerado";
  return "Ambiente seco";
}

function formatShortDate(isoDate?: string | null): string {
  if (!isoDate || isoDate === "Sin vencimiento") return "Sin vencimiento";
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const meses = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  if (Number.isNaN(day) || monthIdx < 0 || monthIdx > 11 || Number.isNaN(year)) {
    return isoDate;
  }
  return `${day} ${meses[monthIdx]} ${year}`;
}

export default function CatalogoPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Búsqueda y Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [familiaFilter, setFamiliaFilter] = useState("all");
  const [coldFilter, setColdFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Filas expandidas ("Más detalle")
  const [expandedSkus, setExpandedSkus] = useState<Record<string, boolean>>({});

  // Toast de notificación
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal: Nuevo / Editar Producto
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [formData, setFormData] = useState<Producto>(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPlu, setIsGeneratingPlu] = useState(false);

  // Modal: Ingresar Stock / Nuevo Lote
  const [stockModalProduct, setStockModalProduct] = useState<CatalogProduct | null>(null);
  const [stockForm, setStockForm] = useState({
    cantidad: 1,
    modo_ingreso: "CAJAS" as "UNIDADES" | "CAJAS",
    unidades_por_caja_custom: 12,
    estado_destino: "Vitrina" as "Vitrina" | "Bodega",
    ubicacion_id: "",
    lote: "",
    fecha_vencimiento: "",
    motivo: "Ingreso Rápido desde Catálogo",
  });
  const [isSavingStock, setIsSavingStock] = useState(false);
  const [stockModalError, setStockModalError] = useState<string | null>(null);

  // Modal: Subir archivo (Importación de Catálogo)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<CatalogoImportSummaryResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Modal: Imprimir etiqueta y Eliminar producto
  const [labelModalProduct, setLabelModalProduct] = useState<CatalogProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<CatalogProduct | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Estado del Tour Guiado ("¿Cómo funciona?")
  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({
    top: 0,
    left: 0,
  });

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const handleCopyCode = useCallback(
    (code: string, label: string) => {
      if (!code) return;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(code).catch(() => {});
      }
      showToast(`${label} copiado: ${code}`);
    },
    [showToast]
  );

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getStockAgrupado();

      const flatProducts: CatalogProduct[] = [];
      (data || []).forEach((grupo) => {
        (grupo.sub_familias || []).forEach((sub) => {
          (sub.productos || []).forEach((prod) => {
            const rawTemp = (prod.temperatura_requerida || "SECO").toUpperCase();
            const normTemp =
              rawTemp.includes("CONGELADO") || rawTemp.includes("FROZEN") || rawTemp.includes("18")
                ? "CONGELADO"
                : rawTemp.includes("REFRIGER") || rawTemp.includes("FRIO") || rawTemp.includes("0_5")
                ? "REFRIGERADO"
                : "SECO";

            flatProducts.push({
              sku: prod.sku || "",
              nombre: prod.nombre || "",
              ean: prod.ean || "",
              dun14: prod.dun14 || null,
              unidades_por_caja: prod.unidades_por_caja || 12,
              unidad_medida: prod.unidad_medida || "UN",
              temperatura_requerida: normTemp,
              stock_minimo: prod.stock_minimo ?? 5,
              dias_alerta_vencimiento: prod.dias_alerta_vencimiento ?? 7,
              tolerancia_vencimiento_dias: prod.tolerancia_vencimiento_dias ?? 0,
              controla_vencimiento: prod.controla_vencimiento ?? false,
              dias_vida_util: prod.dias_vida_util ?? null,
              costo_unitario: prod.costo_unitario ?? 0,
              es_ghost_sku: prod.es_ghost_sku ?? false,
              proveedor_marca: prod.proveedor_marca || "",
              familia: grupo.familia || "Abarrotes",
              subFamilia: sub.nombre_sub_familia || "General",
              stockSubFamilia: sub.stock_sub_familia || 0,
              stock: prod.stock_individual || 0,
              stockVitrina: prod.stock_vitrina || 0,
              stockBodega: prod.stock_bodega || 0,
              proximaFechaVencimiento: prod.proxima_fecha_vencimiento || null,
              alertaVencimiento: prod.alerta_vencimiento || "OK",
              stockGlobalFamilia: grupo.stock_global_familia || 0,
              clase_abc: prod.clase_abc || "B",
              es_perecible_corto: prod.es_perecible_corto ?? false,
              venta_valorizada_ventana: prod.venta_valorizada_ventana ?? 0,
              lotes: prod.lotes || [],
            });
          });
        });
      });

      setProducts(flatProducts);
    } catch (err) {
      console.error("Error cargando catálogo:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, familiaFilter, coldFilter, statusFilter]);

  // Posicionamiento del Tour Guiado
  const repositionTour = useCallback((stepIdx: number) => {
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;
    const targetEl = document.getElementById(step.targetId);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const padding = 8;

    setSpotlightStyle({
      top: `${rect.top - padding}px`,
      left: `${rect.left - padding}px`,
      width: `${rect.width + padding * 2}px`,
      height: `${rect.height + padding * 2}px`,
    });

    const tooltipHeight = 190;
    const spaceBelow = window.innerHeight - rect.bottom;
    let tooltipLeft = Math.max(16, rect.left + rect.width / 2 - 180);
    if (tooltipLeft + 360 > window.innerWidth) {
      tooltipLeft = window.innerWidth - 380;
    }

    let tooltipTop: number;
    if (spaceBelow > tooltipHeight || rect.top < 220) {
      tooltipTop = rect.bottom + padding + 14;
    } else {
      tooltipTop = rect.top - padding - tooltipHeight - 10;
    }

    setTooltipStyle({
      top: `${Math.max(16, tooltipTop)}px`,
      left: `${Math.max(16, tooltipLeft)}px`,
    });
  }, []);

  const updateTourStep = useCallback(
    (stepIdx: number) => {
      const step = TOUR_STEPS[stepIdx];
      if (!step) return;
      const targetEl = document.getElementById(step.targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      repositionTour(stepIdx);
      setTimeout(() => repositionTour(stepIdx), 180);
      setTimeout(() => repositionTour(stepIdx), 360);
    },
    [repositionTour]
  );

  const startTour = () => {
    setCurrentStepIndex(0);
    setIsTourActive(true);
    setTimeout(() => updateTourStep(0), 20);
  };

  const endTour = () => {
    setIsTourActive(false);
  };

  const nextTourStep = () => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      updateTourStep(nextIdx);
    } else {
      endTour();
    }
  };

  const prevTourStep = () => {
    if (currentStepIndex > 0) {
      const prevIdx = currentStepIndex - 1;
      setCurrentStepIndex(prevIdx);
      updateTourStep(prevIdx);
    }
  };

  useEffect(() => {
    if (!isTourActive) return;
    const handleReposition = () => repositionTour(currentStepIndex);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isTourActive, currentStepIndex, repositionTour]);

  // Familias dinámicas para el filtro
  const familiasDisponibles = useMemo(() => {
    const set = new Set<string>(["Abarrotes", "Lácteos", "Carnes"]);
    products.forEach((p) => {
      if (p.familia && p.familia !== "Sin Familia") {
        set.add(p.familia);
      }
    });
    return Array.from(set);
  }, [products]);

  // Filtrado de productos
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const term = searchTerm.trim().toLowerCase();
      const matchesSearch =
        !term ||
        p.nombre.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.ean.toLowerCase().includes(term) ||
        (p.dun14 || "").toLowerCase().includes(term) ||
        (p.proveedor_marca || "").toLowerCase().includes(term);

      const matchesFamilia =
        familiaFilter === "all" ||
        p.familia.toLowerCase().includes(familiaFilter.toLowerCase());

      let matchesCold = true;
      if (coldFilter === "Seco / Ambiente") matchesCold = p.temperatura_requerida === "SECO";
      else if (coldFilter === "Refrigerado") matchesCold = p.temperatura_requerida === "REFRIGERADO";
      else if (coldFilter === "Congelado") matchesCold = p.temperatura_requerida === "CONGELADO";

      let matchesStatus = true;
      if (statusFilter === "disponible") matchesStatus = p.stock > 0;
      else if (statusFilter === "vencido")
        matchesStatus = ["VENCIDO", "CRITICO", "PROXIMO"].includes(p.alertaVencimiento);
      else if (statusFilter === "agotado") matchesStatus = p.stock === 0;
      else if (statusFilter === "bajo_minimo") matchesStatus = p.stock <= p.stock_minimo;

      return matchesSearch && matchesFamilia && matchesCold && matchesStatus;
    });
  }, [products, searchTerm, familiaFilter, coldFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const paginatedProducts = filteredProducts.slice(startIdx, startIdx + PAGE_SIZE);

  // KPIs
  const totalUnidadesGlobal = useMemo(
    () => products.reduce((acc, p) => acc + p.stock, 0),
    [products]
  );
  const totalAlertasFEFO = useMemo(
    () =>
      products.filter((p) => ["VENCIDO", "CRITICO", "PROXIMO"].includes(p.alertaVencimiento))
        .length,
    [products]
  );
  const totalBajoMinimo = useMemo(
    () => products.filter((p) => p.stock <= p.stock_minimo).length,
    [products]
  );

  const toggleDetail = (sku: string) => {
    setExpandedSkus((prev) => ({
      ...prev,
      [sku]: !prev[sku],
    }));
  };

  // Acciones Modal Nuevo / Editar Producto
  const openNewProductModal = () => {
    setEditingSku(null);
    setFormData(INITIAL_FORM);
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (product: CatalogProduct) => {
    setEditingSku(product.sku);
    setFormData({
      sku: product.sku,
      nombre: product.nombre.includes("PRODUCTO DESCONOCIDO") ? "" : product.nombre,
      ean: product.ean.startsWith("GHOST-") ? "" : product.ean,
      dun14: product.dun14 || "",
      unidades_por_caja: product.unidades_por_caja || 12,
      unidad_medida: product.unidad_medida || "UN",
      temperatura_requerida: product.temperatura_requerida || "SECO",
      stock_minimo: product.stock_minimo ?? 5,
      dias_alerta_vencimiento: product.dias_alerta_vencimiento ?? 7,
      familia: product.familia === "Sin Familia" ? "Abarrotes" : product.familia,
      sub_familia: product.subFamilia === "Sin Sub-familia" ? "" : product.subFamilia,
      proveedor_marca: product.proveedor_marca === "Desconocido" ? "" : product.proveedor_marca,
      categoria: product.familia === "Sin Familia" ? "Abarrotes" : product.familia,
      tolerancia_vencimiento_dias: product.tolerancia_vencimiento_dias ?? 5,
      controla_vencimiento: product.controla_vencimiento ?? true,
      es_perecible_corto: product.es_perecible_corto ?? false,
      dias_vida_util: product.dias_vida_util ?? undefined,
      costo_unitario: product.costo_unitario ?? 0,
      stock_inicial: 0,
      modo_stock_inicial: "UNIDADES",
      estado_stock_inicial: "Vitrina",
    });
    setError(null);
    setIsModalOpen(true);
  };

  const generateInternalCode = async () => {
    setIsGeneratingPlu(true);
    setError(null);
    try {
      const res = await generarCodigoInternoPlu("PLU");
      setFormData((prev) => ({
        ...prev,
        sku: editingSku ? prev.sku : res.sku_sugerido,
        ean: res.ean_interno,
        nombre: prev.nombre || "Queso Mantecoso Laminado",
      }));
      showToast("Código interno y PLU generados para balanza/caja");
    } catch {
      const randomPlu = Math.floor(1000 + Math.random() * 9000);
      const eanInternal = "200" + Math.floor(1000000000 + Math.random() * 9000000000);
      setFormData((prev) => ({
        ...prev,
        sku: editingSku ? prev.sku : `PLU-${randomPlu}`,
        ean: eanInternal,
        nombre: prev.nombre || "Queso Mantecoso Laminado",
      }));
      showToast("Código interno y PLU generados para balanza/caja");
    } finally {
      setIsGeneratingPlu(false);
    }
  };

  const saveNewProduct = async () => {
    const skuClean = (formData.sku || "").trim();
    const nombreClean = (formData.nombre || "").trim();
    const eanClean = (formData.ean || "").trim();

    if (!skuClean || !nombreClean || !eanClean) {
      setError("El nombre comercial, código interno (SKU) y código de barra (EAN-13) son obligatorios.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        ...formData,
        sku: skuClean,
        nombre: nombreClean,
        ean: eanClean,
        dun14: formData.dun14?.trim() || null,
        categoria: formData.familia || "Abarrotes",
        tolerancia_vencimiento_dias: Number(formData.tolerancia_vencimiento_dias) || 0,
        unidades_por_caja: Math.max(1, Number(formData.unidades_por_caja) || 1),
        stock_minimo: Math.max(0, Number(formData.stock_minimo) || 0),
        dias_alerta_vencimiento: Math.max(0, Number(formData.dias_alerta_vencimiento) || 0),
        costo_unitario: Math.max(0, Number(formData.costo_unitario) || 0),
      };

      if (editingSku) {
        const res = await updateProducto(editingSku, payload);
        showToast(res.mensaje || "¡Producto actualizado con éxito!");
      } else {
        const res = await createProducto(payload);
        showToast(res.mensaje || "¡Producto registrado con éxito en el catálogo!");
      }

      setIsModalOpen(false);
      setFormData(INITIAL_FORM);
      setEditingSku(null);
      await loadData();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el producto.");
    } finally {
      setIsSaving(false);
    }
  };

  // Acciones Modal Ingresar Stock / Nuevo Lote
  const handleOpenAddStock = (product: CatalogProduct) => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = String(today.getFullYear()).slice(-2);

    setStockModalProduct(product);
    setStockForm({
      cantidad: 1,
      modo_ingreso: product.unidades_por_caja > 1 ? "CAJAS" : "UNIDADES",
      unidades_por_caja_custom: product.unidades_por_caja > 1 ? product.unidades_por_caja : 12,
      estado_destino: "Vitrina",
      ubicacion_id: "",
      lote: `L-CAT-${day}${month}${year}`,
      fecha_vencimiento: new Date(Date.now() + (product.dias_vida_util || 365) * 86400000)
        .toISOString()
        .slice(0, 10),
      motivo: "Ingreso Rápido desde Catálogo",
    });
    setStockModalError(null);
  };

  const addedUnitsPreview = useMemo(() => {
    if (!stockModalProduct) return 0;
    const qty = Math.max(0, Number(stockForm.cantidad) || 0);
    if (stockForm.modo_ingreso === "CAJAS") {
      return qty * (stockModalProduct.unidades_por_caja || 1);
    }
    return qty;
  }, [stockModalProduct, stockForm.cantidad, stockForm.modo_ingreso]);

  const confirmAddStock = async () => {
    if (!stockModalProduct) return;
    if (!stockForm.cantidad || stockForm.cantidad < 1) {
      setStockModalError("Ingresa una cantidad mayor o igual a 1.");
      return;
    }

    setIsSavingStock(true);
    setStockModalError(null);
    try {
      const res = await ingresarStockCatalogo(stockModalProduct.sku, {
        cantidad: Number(stockForm.cantidad),
        modo_ingreso: stockForm.modo_ingreso,
        estado_destino: stockForm.estado_destino,
        ubicacion_id: stockForm.ubicacion_id.trim() || undefined,
        lote: stockForm.lote.trim() || undefined,
        fecha_vencimiento: stockForm.fecha_vencimiento || undefined,
        motivo: stockForm.motivo,
      });
      setStockModalProduct(null);
      showToast(res.mensaje || "¡Stock y lote ingresados con éxito al inventario!");
      await loadData();
    } catch (e: any) {
      setStockModalError(e?.message || "Error al ingresar stock.");
    } finally {
      setIsSavingStock(false);
    }
  };

  // Acciones Importar Archivo
  const triggerImport = () => {
    setImportFile(null);
    setImportResult(null);
    setImportError(null);
    setIsImportModalOpen(true);
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      "sku,nombre,ean,dun14,unidades_por_caja,unidad_medida,temperatura_requerida,familia,sub_familia,proveedor_marca,stock_minimo,tolerancia_vencimiento_dias,dias_alerta_vencimiento,costo_unitario,stock_inicial",
      "SKU-LECHE-COL-1L,Leche Entera Colun 1L,7802920001016,17802920001013,12,UN,REFRIGERADO,Lácteos,Leches,Colun,12,5,7,950,24",
      "SKU-JAMON-PF-250,Jamón Pierna Artesanal PF 250g,7801900002211,17801900002218,10,UN,REFRIGERADO,Carnes y Fiambrería,Cecinas,PF Alimentos,8,4,6,1890,20",
      "SKU-HELADO-SAV-1L,Helado Trisabor Savory 1L,7802200008813,17802200008810,6,UN,CONGELADO,Congelados,Helados,Savory,6,15,30,2450,12",
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_catalogo_supermercado.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async () => {
    if (!importFile) {
      setImportError("Selecciona un archivo .csv, .txt o .json.");
      return;
    }
    const lower = importFile.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt") && !lower.endsWith(".json")) {
      setImportError("Solo se permiten archivos .csv, .txt o .json.");
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await importarCatalogoArchivo(importFile);
      setImportResult(res);
      showToast("¡Archivo de catálogo procesado con éxito!");
      await loadData();
    } catch (e: any) {
      setImportError(e?.message || "Error al importar el archivo de catálogo.");
    } finally {
      setIsImporting(false);
    }
  };

  // Eliminar producto
  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    setIsDeleting(true);
    try {
      const res = await deleteProducto(productToDelete.sku);
      showToast(res.mensaje || "Producto dado de baja correctamente");
      setProductToDelete(null);
      await loadData();
    } catch (e: any) {
      showToast(e?.message || "No fue posible dar de baja el producto");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="text-slate-800 min-h-full flex-1 flex flex-col selection:bg-rose-500 selection:text-white pb-12"
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 40%, #f8fafc 100%)",
      }}
    >
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");

        .card-soft {
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(254, 202, 202, 0.65);
          box-shadow: 0 10px 30px -5px rgba(239, 68, 68, 0.07);
        }

        .card-stat {
          background: #ffffff;
          border: 1px solid rgba(254, 205, 205, 0.6);
          box-shadow: 0 4px 15px -2px rgba(225, 29, 72, 0.05);
          transition: all 0.2s ease;
        }
        .card-stat:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px -4px rgba(225, 29, 72, 0.1);
        }

        #tourSpotlight {
          position: fixed;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75);
          border: 2px solid #ef4444;
          border-radius: 1.25rem;
          pointer-events: none;
          z-index: 100;
        }

        #tourTooltip {
          position: fixed;
          z-index: 101;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes tourPulse {
          0%,
          100% {
            border-color: #ef4444;
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75), 0 0 20px rgba(239, 68, 68, 0.5);
          }
          50% {
            border-color: #fda4af;
            box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75), 0 0 35px rgba(239, 68, 68, 0.8);
          }
        }
        .tour-active-highlight {
          animation: tourPulse 2s infinite ease-in-out;
        }
      `}</style>

      {/* Header Superior Amigable y Despejado */}
      <header className="bg-white/90 backdrop-blur-md border-b border-rose-100 px-6 py-4 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Título amigable sin etiquetas técnicas innecesarias */}
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Catálogo de Productos
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Revisa existencias, fechas de vencimiento y organiza tu mercadería con calma.
            </p>
          </div>

          {/* Acciones directas y limpias sin íconos redundantes */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={startTour}
              title="Ver explicación paso a paso"
              className="px-3.5 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition active:scale-95 shadow-sm cursor-pointer"
            >
              ¿Cómo funciona?
            </button>

            <button
              type="button"
              onClick={triggerImport}
              className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold transition shadow-sm cursor-pointer"
            >
              Subir archivo
            </button>

            <button
              type="button"
              onClick={openNewProductModal}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold transition shadow-md shadow-rose-200 active:scale-98 cursor-pointer"
            >
              + Nuevo Producto
            </button>

            {/* Avatar Administrador */}
            <div className="flex items-center pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-rose-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                A
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Fila de Tarjetas Métricas (Limpio, sin íconos innecesarios, lenguaje humano) */}
        <div id="tour-kpis" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Stock Global */}
          <div
            onClick={() => setStatusFilter("all")}
            className="card-stat rounded-3xl p-5 cursor-pointer"
          >
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Unidades en total
            </span>
            <div className="text-2xl font-black text-slate-900 tracking-tight">
              {totalUnidadesGlobal.toLocaleString("es-CL")}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Sumando vitrina y bodega
            </span>
          </div>

          {/* SKUs Activos */}
          <div
            onClick={() => setStatusFilter("all")}
            className="card-stat rounded-3xl p-5 cursor-pointer"
          >
            <span className="text-xs font-semibold text-slate-500 block mb-1">
              Variedad de productos
            </span>
            <div className="text-2xl font-black text-slate-900 tracking-tight">
              {products.length.toLocaleString("es-CL")}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Artículos registrados hoy
            </span>
          </div>

          {/* Lotes por Vencer */}
          <div
            onClick={() => setStatusFilter(statusFilter === "vencido" ? "all" : "vencido")}
            className="card-stat rounded-3xl p-5 border-amber-200/90 bg-amber-50/20 cursor-pointer"
          >
            <span className="text-xs font-semibold text-amber-800 block mb-1">
              Próximos a vencer
            </span>
            <div className="text-2xl font-black text-amber-700 tracking-tight">
              {totalAlertasFEFO} {totalAlertasFEFO === 1 ? "lote" : "lotes"}
            </div>
            <span className="text-[11px] text-amber-600 mt-1 block">
              Revisar según fecha de salida
            </span>
          </div>

          {/* Bajo Mínimo / Agotados */}
          <div
            onClick={() => setStatusFilter(statusFilter === "bajo_minimo" ? "all" : "bajo_minimo")}
            className="card-stat rounded-3xl p-5 border-rose-200 bg-rose-50/40 cursor-pointer"
          >
            <span className="text-xs font-semibold text-rose-800 block mb-1">
              Poco o sin stock
            </span>
            <div className="text-2xl font-black text-rose-600 tracking-tight">
              {totalBajoMinimo} {totalBajoMinimo === 1 ? "producto" : "productos"}
            </div>
            <span className="text-[11px] text-rose-500 mt-1 block">
              Listos para reposición
            </span>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros Amigables */}
        <div id="tour-filters" className="card-soft rounded-3xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Input de búsqueda amigable */}
            <div className="lg:col-span-2">
              <input
                type="text"
                id="searchInput"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Escribe el nombre del producto o su código..."
                className="w-full px-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              />
            </div>

            {/* Filtro Familia */}
            <div>
              <select
                id="familyFilter"
                value={familiaFilter}
                onChange={(e) => setFamiliaFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              >
                <option value="all">Todas las familias</option>
                {familiasDisponibles.map((fam) => (
                  <option key={fam} value={fam}>
                    {fam}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro Cadena de Frío */}
            <div>
              <select
                id="coldFilter"
                value={coldFilter}
                onChange={(e) => setColdFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              >
                <option value="all">Todo tipo de conservación</option>
                <option value="Seco / Ambiente">Seco o ambiente</option>
                <option value="Refrigerado">Refrigerado</option>
                <option value="Congelado">Congelado</option>
              </select>
            </div>

            {/* Filtro Estado */}
            <div>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:outline-none focus:border-rose-400 focus:bg-white transition"
              >
                <option value="all">Cualquier estado</option>
                <option value="disponible">Con existencias</option>
                <option value="vencido">Lote vencido / próximo</option>
                <option value="agotado">Agotados</option>
                <option value="bajo_minimo">Poco o sin stock</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tabla del Catálogo Maestro (Visualmente limpia y humana) */}
        <div id="tour-table" className="card-soft rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-rose-100 flex items-center justify-between bg-white/60">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-slate-900">Listado de productos</h2>
              <span
                id="resultsCount"
                className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full"
              >
                {filteredProducts.length} disponibles
              </span>
            </div>
          </div>

          {/* Tabla simplificada sin sobrecarga visual */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-slate-400 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200/60">
                  <th className="py-3.5 px-4 pl-6">Producto</th>
                  <th className="py-3.5 px-4">Categoría</th>
                  <th className="py-3.5 px-4">Vencimiento</th>
                  <th className="py-3.5 px-4 pr-6 text-right">Opciones</th>
                </tr>
              </thead>
              <tbody
                id="catalogTableBody"
                className="divide-y divide-slate-100 text-slate-700 font-medium"
              >
                {isLoading ? (
                  [1, 2, 3, 4, 5].map((sk) => (
                    <tr key={sk} className="animate-pulse">
                      <td className="py-4 px-4 pl-6">
                        <div className="h-4 w-48 bg-slate-200/80 rounded-lg mb-2" />
                        <div className="h-3 w-32 bg-rose-100/70 rounded-md" />
                      </td>
                      <td className="py-4 px-4">
                        <div className="h-5 w-24 bg-slate-100 rounded-xl mb-1.5" />
                        <div className="h-2.5 w-20 bg-slate-100 rounded" />
                      </td>
                      <td className="py-4 px-4">
                        <div className="h-6 w-28 bg-emerald-50 rounded-xl" />
                      </td>
                      <td className="py-4 px-4 pr-6 text-right">
                        <div className="inline-flex gap-2">
                          <div className="h-7 w-20 bg-slate-100 rounded-xl" />
                          <div className="h-7 w-16 bg-rose-100/70 rounded-xl" />
                        </div>
                      </td>
                    </tr>
                  ))
                ) : paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400 text-xs">
                      No se encontraron productos con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((prod) => {
                    const isExpanded = Boolean(expandedSkus[prod.sku]);
                    const isVencido = prod.alertaVencimiento === "VENCIDO";
                    const isProximo =
                      prod.alertaVencimiento === "CRITICO" ||
                      prod.alertaVencimiento === "PROXIMO";
                    const isAgotado = prod.stock <= 0;
                    const abcClass = (prod.clase_abc || "B").toUpperCase();
                    const abcBadgeStyle =
                      abcClass === "A"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : abcClass === "C"
                        ? "bg-slate-100 text-slate-600 border-slate-200"
                        : "bg-sky-50 text-sky-700 border-sky-200";
                    const abcLabel =
                      abcClass === "A"
                        ? "Clase A · Más vendido"
                        : abcClass === "C"
                        ? "Clase C · Baja rotación"
                        : "Clase B · Rotación media";

                    return (
                      <React.Fragment key={prod.sku}>
                        <tr
                          className={`product-row hover:bg-rose-50/30 transition group ${
                            isVencido ? "bg-rose-50/15" : ""
                          }`}
                        >
                          <td className="py-4 px-4 pl-6">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-slate-900 text-sm font-bold">
                                  {prod.nombre}
                                </strong>
                                <span
                                  title={abcLabel}
                                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border ${abcBadgeStyle}`}
                                >
                                  {abcLabel}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span>{prod.proveedor_marca || "Genérico"}</span>
                                <span>•</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyCode(prod.sku, "SKU")}
                                  title="Haz clic para copiar el SKU"
                                  className="font-mono text-slate-500 hover:text-rose-600 underline decoration-dotted underline-offset-2 transition cursor-pointer"
                                >
                                  {prod.sku}
                                </button>
                                {prod.ean && (
                                  <>
                                    <span>•</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyCode(prod.ean, "Código EAN")}
                                      title="Haz clic para copiar el código de barras EAN"
                                      className="font-mono text-slate-500 hover:text-rose-600 underline decoration-dotted underline-offset-2 transition cursor-pointer"
                                    >
                                      EAN: {prod.ean}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-medium">
                              {prod.familia}
                            </span>
                            <span className="text-[10px] text-slate-400 block mt-1">
                              {formatConservationLabel(prod.temperatura_requerida)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            {isAgotado ? (
                              <span className="inline-block px-2.5 py-1 rounded-xl bg-slate-100 text-slate-500 text-xs font-semibold">
                                Agotado
                              </span>
                            ) : isVencido ? (
                              <span className="inline-block px-2.5 py-1 rounded-xl bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold">
                                {formatShortDate(prod.proximaFechaVencimiento)} (Vencido)
                              </span>
                            ) : isProximo ? (
                              <span className="inline-block px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                                {formatShortDate(prod.proximaFechaVencimiento)}
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                                {formatShortDate(prod.proximaFechaVencimiento)}
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-4 pr-6 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleDetail(prod.sku)}
                                className={`px-3 py-1.5 rounded-xl border transition text-[11px] font-semibold shadow-2xs cursor-pointer ${
                                  isExpanded
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                                }`}
                              >
                                {isExpanded ? "Ocultar detalle" : "Más detalle"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenAddStock(prod)}
                                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition text-[11px] font-bold cursor-pointer"
                              >
                                + Stock
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Apartado: Más Detalle Producto */}
                        {isExpanded && (
                          <tr className="bg-rose-50/20 border-b border-rose-100/80">
                            <td colSpan={4} className="p-4 pl-6 pr-6">
                              <div className="bg-white/90 border border-rose-100 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs shadow-2xs">
                                {/* Códigos */}
                                <div className="space-y-1">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                                    Códigos (clic para copiar)
                                  </span>
                                  <div className="text-slate-800">
                                    <span className="text-slate-500">Barra (EAN):</span>{" "}
                                    {prod.ean ? (
                                      <button
                                        type="button"
                                        onClick={() => handleCopyCode(prod.ean, "Código EAN")}
                                        className="font-mono font-bold text-slate-900 hover:text-rose-600 underline decoration-dotted cursor-pointer"
                                      >
                                        {prod.ean}
                                      </button>
                                    ) : (
                                      <strong className="font-mono text-slate-400">Sin EAN</strong>
                                    )}
                                  </div>
                                  <div className="text-slate-800">
                                    <span className="text-slate-500">SKU interno:</span>{" "}
                                    <button
                                      type="button"
                                      onClick={() => handleCopyCode(prod.sku, "SKU")}
                                      className="font-mono font-bold text-slate-900 hover:text-rose-600 underline decoration-dotted cursor-pointer"
                                    >
                                      {prod.sku}
                                    </button>
                                  </div>
                                  <div className="text-slate-800">
                                    <span className="text-slate-500">Empaque:</span>{" "}
                                    <span className="font-mono text-slate-700">
                                      {prod.dun14 ? `${prod.dun14} ` : "DUN-14 "}
                                      (Caja x {prod.unidades_por_caja || 1}{" "}
                                      {(prod.unidad_medida || "UN").toLowerCase()})
                                    </span>
                                  </div>
                                </div>

                                {/* Disponibilidad */}
                                <div className="space-y-1 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                                    Disponibilidad ({prod.stock} un totales)
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <div>
                                      <span className="text-slate-500 block text-[11px]">
                                        En vitrina
                                      </span>
                                      <strong
                                        className={`text-sm font-bold ${
                                          prod.stock === 0 ? "text-rose-600" : "text-slate-900"
                                        }`}
                                      >
                                        {prod.stockVitrina} un
                                      </strong>
                                    </div>
                                    <div className="h-6 w-px bg-slate-200" />
                                    <div>
                                      <span className="text-slate-500 block text-[11px]">
                                        En bodega
                                      </span>
                                      <strong
                                        className={`text-sm font-bold ${
                                          prod.stock === 0
                                            ? "text-rose-600"
                                            : prod.stockBodega > 0
                                            ? "text-slate-700"
                                            : "text-slate-400"
                                        }`}
                                      >
                                        {prod.stockBodega} un
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                {/* Acciones adicionales */}
                                <div className="flex flex-wrap items-center md:justify-end gap-2 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4">
                                  <button
                                    type="button"
                                    onClick={() => setLabelModalProduct(prod)}
                                    className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] transition cursor-pointer"
                                  >
                                    Imprimir etiqueta
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(prod)}
                                    className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-[11px] transition cursor-pointer"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setProductToDelete(prod)}
                                    className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-[11px] transition cursor-pointer"
                                  >
                                    Dar de baja
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación sencilla */}
          <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Mostrando <strong>{paginatedProducts.length}</strong> de{" "}
              <strong>{filteredProducts.length}</strong> productos
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className={`px-3 py-1.5 rounded-xl bg-white border border-slate-200 ${
                  safePage <= 1
                    ? "text-slate-400 cursor-not-allowed"
                    : "text-slate-700 hover:bg-slate-100 cursor-pointer"
                }`}
              >
                Anterior
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .slice(Math.max(0, safePage - 3), Math.max(0, safePage - 3) + 5)
                .map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={
                      pageNum === safePage
                        ? "px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 text-white font-bold shadow-xs cursor-pointer"
                        : "px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 cursor-pointer"
                    }
                  >
                    {pageNum}
                  </button>
                ))}
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className={`px-3 py-1.5 rounded-xl bg-white border border-slate-200 ${
                  safePage >= totalPages
                    ? "text-slate-400 cursor-not-allowed"
                    : "text-slate-700 hover:bg-slate-100 cursor-pointer"
                }`}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Modal: Nuevo / Editar Producto (Completo, Simplificado y Humanizado) */}
      {isModalOpen && (
        <div
          id="newProductModal"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        >
          <div className="card-soft rounded-3xl max-w-2xl w-full p-6 sm:p-7 space-y-6 shadow-2xl bg-white my-auto max-h-[92vh] overflow-y-auto">
            {/* Encabezado del modal */}
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editingSku
                    ? `Editar producto (${editingSku})`
                    : "Nuevo producto para tu local"}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ingresa los datos esenciales. Si tienes dudas, los campos avanzados son opcionales.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-rose-600 text-xl font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-rose-50 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {error}
              </div>
            )}

            {/* Banner amigable para productos sin código de fábrica (Granel / Panadería) */}
            <div className="bg-gradient-to-r from-rose-50/90 via-pink-50/50 to-amber-50/60 border border-rose-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="space-y-1">
                <strong className="text-xs font-bold text-slate-900 block">
                  ¿Es un producto a granel, panadería o fiambrería?
                </strong>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Si no tiene código de barra de fábrica, podemos crearle un código interno (EAN-13 / PLU) listo para imprimir.
                </p>
              </div>
              <button
                type="button"
                disabled={isGeneratingPlu}
                onClick={generateInternalCode}
                className="shrink-0 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-xs transition shadow-sm active:scale-95 cursor-pointer"
              >
                {isGeneratingPlu ? "Generando..." : "Generar código interno"}
              </button>
            </div>

            {/* Bloque 1: Identificación del Producto */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600 block">
                1. Identificación básica
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nombre comercial *
                  </label>
                  <input
                    type="text"
                    id="newProdName"
                    value={formData.nombre}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    placeholder="Ej: Leche Entera Soprole 1L"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Código interno (SKU) *
                  </label>
                  <input
                    type="text"
                    id="newSkuInput"
                    disabled={Boolean(editingSku)}
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="Ej: SKU-LECHE-1L"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none font-mono transition disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Código de barra de unidad (EAN-13) *
                  </label>
                  <input
                    type="text"
                    id="newEanInput"
                    value={formData.ean || ""}
                    onChange={(e) => setFormData({ ...formData, ean: e.target.value })}
                    placeholder="Ej: 7802900001012"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none font-mono transition"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Código caja mayorista (DUN-14)
                  </label>
                  <input
                    type="text"
                    value={formData.dun14 || ""}
                    onChange={(e) => setFormData({ ...formData, dun14: e.target.value })}
                    placeholder="Opcional: 178029000010"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none font-mono transition"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Unidades que trae la caja
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={formData.unidades_por_caja ?? 12}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          unidades_por_caja: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      placeholder="12"
                      className="w-20 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-center focus:border-rose-400 focus:bg-white focus:outline-none font-semibold transition"
                    />
                    <select
                      value={formData.unidad_medida || "UN"}
                      onChange={(e) => setFormData({ ...formData, unidad_medida: e.target.value })}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                    >
                      <option value="UN">Unidades (UN)</option>
                      <option value="KG">Kilos (KG)</option>
                      <option value="PACK">Packs</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Bloque 2: Clasificación y Almacenaje */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600 block">
                2. Categoría y tipo de conservación
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Familia o categoría
                  </label>
                  <select
                    value={formData.familia || "Abarrotes"}
                    onChange={(e) => setFormData({ ...formData, familia: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  >
                    {FAMILIAS_CATALOGO.map((fam) => (
                      <option key={fam} value={fam}>
                        {fam}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Cadena de frío / Almacenaje
                  </label>
                  <select
                    value={formData.temperatura_requerida || "SECO"}
                    onChange={(e) =>
                      setFormData({ ...formData, temperatura_requerida: e.target.value })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  >
                    <option value="SECO">Seco / Ambiente (Bodega general)</option>
                    <option value="REFRIGERADO">Refrigerado (0° a 5°C)</option>
                    <option value="CONGELADO">Congelado (-18°C)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Subfamilia o sección
                  </label>
                  <input
                    type="text"
                    value={formData.sub_familia || ""}
                    onChange={(e) => setFormData({ ...formData, sub_familia: e.target.value })}
                    placeholder="Ej: Leches Líquidas, Cecinas, Aceites..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Proveedor o marca
                  </label>
                  <input
                    type="text"
                    value={formData.proveedor_marca || ""}
                    onChange={(e) => setFormData({ ...formData, proveedor_marca: e.target.value })}
                    placeholder="Ej: Soprole, Colun, Agrosuper, Carozzi..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  />
                </div>
              </div>
            </div>

            {/* Bloque 3: Control Sanitario y Vencimientos */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-600 block">
                3. Parámetros de vencimiento y reposición
              </span>

              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-rose-50/40 border border-rose-100 cursor-pointer hover:bg-rose-50/70 transition">
                  <input
                    type="checkbox"
                    checked={formData.controla_vencimiento ?? true}
                    onChange={(e) =>
                      setFormData({ ...formData, controla_vencimiento: e.target.checked })
                    }
                    className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 h-4 w-4"
                  />
                  <div>
                    <strong className="text-slate-900 block font-semibold">
                      Control sanitario de vencimiento (FEFO)
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Solicita registrar el lote y la fecha de vencimiento cada vez que ingrese mercadería a bodega.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-white transition">
                  <input
                    type="checkbox"
                    checked={formData.es_perecible_corto ?? false}
                    onChange={(e) =>
                      setFormData({ ...formData, es_perecible_corto: e.target.checked })
                    }
                    className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 h-4 w-4"
                  />
                  <div>
                    <strong className="text-slate-800 block font-semibold">
                      Perecible de vida corta
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Prioriza este producto en los conteos frecuentes de inventario.
                    </span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Tolerancia recepción
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      value={formData.tolerancia_vencimiento_dias ?? 5}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          tolerancia_vencimiento_dias: Math.max(
                            0,
                            parseInt(e.target.value, 10) || 0
                          ),
                        })
                      }
                      className="w-full bg-transparent focus:outline-none font-semibold text-slate-800 text-center"
                    />
                    <span className="text-[10px] text-slate-400">días</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Alerta preventiva
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      value={formData.dias_alerta_vencimiento ?? 7}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dias_alerta_vencimiento: Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="w-full bg-transparent focus:outline-none font-semibold text-slate-800 text-center"
                    />
                    <span className="text-[10px] text-slate-400">días</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Stock mínimo
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      value={formData.stock_minimo ?? 5}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          stock_minimo: Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="w-full bg-transparent focus:outline-none font-semibold text-slate-800 text-center"
                    />
                    <span className="text-[10px] text-slate-400">un</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Costo unitario neto
                  </label>
                  <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2">
                    <span className="text-[11px] text-slate-400 mr-1">$</span>
                    <input
                      type="number"
                      min={0}
                      value={formData.costo_unitario ?? 0}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          costo_unitario: Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="w-full bg-transparent focus:outline-none font-semibold text-slate-800 text-center"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bloque 4: Stock Inicial en el Local (Opcional - Día 1) */}
            {!editingSku && (
              <div className="pt-2 border-t border-slate-100">
                <div className="bg-rose-50/30 border border-rose-100 rounded-2xl p-4 space-y-3 text-xs">
                  <div className="space-y-0.5">
                    <strong className="font-bold text-slate-900 block">
                      Stock inicial en el local (Opcional)
                    </strong>
                    <p className="text-[11px] text-slate-500">
                      Si ya tienes este producto en estantería hoy, puedes anotarlo de inmediato para comenzar con stock real.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Cantidad inicial
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={formData.stock_inicial ?? 0}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            stock_inicial: Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-center font-bold text-slate-800 focus:outline-none focus:border-rose-400 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Formato de conteo
                      </label>
                      <select
                        value={formData.modo_stock_inicial || "UNIDADES"}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            modo_stock_inicial: e.target.value as "UNIDADES" | "CAJAS",
                          })
                        }
                        className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 focus:outline-none focus:border-rose-400 transition"
                      >
                        <option value="UNIDADES">Unidades Sueltas (UN)</option>
                        <option value="CAJAS">Cajas Cerradas</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        ¿Dónde está ubicado?
                      </label>
                      <select
                        value={formData.estado_stock_inicial || "Vitrina"}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            estado_stock_inicial: e.target.value as "Vitrina" | "Bodega",
                          })
                        }
                        className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 focus:outline-none focus:border-rose-400 transition"
                      >
                        <option value="Vitrina">En Sala de Venta (Vitrina)</option>
                        <option value="Bodega">En Bodega</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Botones de Acción */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition active:scale-95 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={saveNewProduct}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 disabled:opacity-60 text-white text-xs font-bold shadow-md shadow-rose-200 transition active:scale-95 cursor-pointer"
              >
                {isSaving ? "Guardando..." : "Guardar Producto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ingresar Stock / Nuevo Lote */}
      {stockModalProduct && (
        <div
          id="addStockModal"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        >
          <div className="card-soft rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl bg-white my-auto">
            {/* Encabezado del modal */}
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="space-y-0.5">
                <h3 id="modalStockTitle" className="text-base font-bold text-slate-900">
                  Ingresar Stock / Nuevo Lote — {stockModalProduct.nombre}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Actualiza las existencias manteniendo la trazabilidad FEFO.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStockModalProduct(null)}
                className="text-slate-400 hover:text-rose-600 text-xl font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-rose-50 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {stockModalError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {stockModalError}
              </div>
            )}

            {/* Resumen de SKU y Stock Actual */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block">SKU / Código de barra</span>
                <strong id="modalStockInfo" className="font-mono text-slate-800">
                  {stockModalProduct.sku} • {stockModalProduct.ean}
                </strong>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400 block">Stock actual</span>
                <strong id="modalCurrentStock" className="text-slate-900 text-sm font-bold">
                  {stockModalProduct.stock} {stockModalProduct.unidad_medida}
                </strong>
              </div>
            </div>

            {/* Formulario de ingreso de stock */}
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Modo de conteo</label>
                  <select
                    id="modalCountMode"
                    value={stockForm.modo_ingreso}
                    onChange={(e) =>
                      setStockForm({
                        ...stockForm,
                        modo_ingreso: e.target.value as "UNIDADES" | "CAJAS",
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition font-medium"
                  >
                    <option value="CAJAS">
                      Cajas Cerradas (× {stockModalProduct.unidades_por_caja || 1}{" "}
                      {stockModalProduct.unidad_medida}/caja)
                    </option>
                    <option value="UNIDADES">
                      Unidades Sueltas ({stockModalProduct.unidad_medida})
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {stockForm.modo_ingreso === "CAJAS"
                      ? "Cantidad de cajas"
                      : "Cantidad de unidades"}
                  </label>
                  <input
                    type="number"
                    id="modalBoxesQty"
                    min={1}
                    value={stockForm.cantidad}
                    onChange={(e) =>
                      setStockForm({
                        ...stockForm,
                        cantidad: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none font-semibold text-slate-800 transition"
                  />
                </div>
              </div>

              {/* Tarjeta de vista previa de unidades sumadas */}
              <div className="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-200 flex items-center justify-between">
                <span className="text-slate-700 font-medium">
                  Unidades reales que se sumarán al inventario:
                </span>
                <strong
                  id="modalAddedUnitsPreview"
                  className="text-rose-600 font-extrabold text-sm"
                >
                  +{addedUnitsPreview} un
                </strong>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Destino en el local
                  </label>
                  <select
                    value={stockForm.estado_destino}
                    onChange={(e) =>
                      setStockForm({
                        ...stockForm,
                        estado_destino: e.target.value as "Vitrina" | "Bodega",
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition"
                  >
                    <option value="Vitrina">Sala de Ventas (Vitrina)</option>
                    <option value="Bodega">Bodega Principal</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Fecha de vencimiento (FEFO)
                  </label>
                  <input
                    type="date"
                    value={stockForm.fecha_vencimiento}
                    onChange={(e) =>
                      setStockForm({ ...stockForm, fecha_vencimiento: e.target.value })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none transition font-medium text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Código de lote</label>
                  <input
                    type="text"
                    id="modalBatchCode"
                    value={stockForm.lote}
                    onChange={(e) => setStockForm({ ...stockForm, lote: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none font-mono text-slate-800 transition"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Ubicación / Góndola (Opcional)
                  </label>
                  <input
                    type="text"
                    value={stockForm.ubicacion_id}
                    onChange={(e) => setStockForm({ ...stockForm, ubicacion_id: e.target.value })}
                    placeholder="Ej: GOND-LACTEOS-01"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:border-rose-400 focus:bg-white focus:outline-none placeholder-slate-400 transition"
                  />
                </div>
              </div>
            </div>

            {/* Botones de Acción */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={isSavingStock}
                onClick={() => setStockModalProduct(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition active:scale-95 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingStock}
                onClick={confirmAddStock}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 disabled:opacity-60 text-white text-xs font-bold shadow-md shadow-rose-200 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              >
                <span>
                  {isSavingStock ? "Ingresando stock..." : "Confirmar Ingreso de Stock"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Subir archivo (Importación de Catálogo) */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="card-soft rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl bg-white my-auto">
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Subir archivo de productos
                </h3>
                <p className="text-[11px] text-slate-400">
                  Carga o actualiza tu catálogo desde un archivo .CSV, .TXT o .JSON.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-rose-600 text-xl font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-rose-50 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-rose-50/40 border border-rose-100 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs">
              <div>
                <strong className="text-slate-900 block">Plantilla de ejemplo (.CSV)</strong>
                <span className="text-[11px] text-slate-500">
                  Descárgala para ver el orden de las columnas.
                </span>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-rose-200 text-rose-700 font-semibold text-xs transition shrink-0 cursor-pointer"
              >
                Descargar plantilla
              </button>
            </div>

            <div className="border-2 border-dashed border-rose-200 rounded-2xl p-5 text-center bg-slate-50/60">
              <input
                type="file"
                accept=".csv,.txt,.json"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] || null);
                  setImportError(null);
                }}
                className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-rose-600 file:text-white hover:file:bg-rose-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-400 mt-2">
                Formatos permitidos: .csv, .txt o .json (máximo 5 MB).
              </p>
            </div>

            {importError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs text-slate-700">
                <p className="font-bold text-emerald-800">{importResult.mensaje}</p>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                    <span className="text-slate-400 block text-[11px]">Creados</span>
                    <strong className="text-base text-emerald-700">
                      {importResult.productos_creados}
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                    <span className="text-slate-400 block text-[11px]">Actualizados</span>
                    <strong className="text-base text-slate-800">
                      {importResult.productos_actualizados}
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                    <span className="text-slate-400 block text-[11px]">Con error</span>
                    <strong className="text-base text-rose-600">
                      {importResult.filas_fallidas}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={!importFile || isImporting}
                onClick={handleImportSubmit}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-rose-200 transition cursor-pointer"
              >
                {isImporting ? "Subiendo..." : "Procesar archivo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Imprimir Etiqueta PLU / Código de Barras */}
      {labelModalProduct && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
          <div className="card-soft rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl bg-white">
            <div className="flex items-center justify-between border-b border-rose-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Imprimir etiqueta</h3>
                <p className="text-[11px] text-slate-400">
                  Lista para impresora de etiquetas o balanza.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLabelModalProduct(null)}
                className="text-slate-400 hover:text-rose-600 text-xl font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-rose-50 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-white text-slate-900 rounded-2xl p-5 border-2 border-dashed border-rose-200 flex flex-col items-center text-center space-y-2">
              <div className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1.5">
                <span>{labelModalProduct.familia}</span>
                <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-mono">
                  {labelModalProduct.unidad_medida || "UN"}
                </span>
              </div>

              <div className="text-base font-extrabold text-slate-900 leading-snug pt-1">
                {labelModalProduct.nombre}
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200">
                  {labelModalProduct.sku}
                </span>
                {labelModalProduct.proveedor_marca && (
                  <span className="text-xs text-slate-500 font-medium">
                    {labelModalProduct.proveedor_marca}
                  </span>
                )}
              </div>

              <div className="pt-2 pb-1 w-full flex flex-col items-center">
                <svg
                  viewBox="0 0 240 68"
                  className="w-60 h-16"
                  aria-label={`Código de barras ${labelModalProduct.ean}`}
                >
                  <rect x="0" y="0" width="240" height="68" fill="#ffffff" />
                  {(() => {
                    const rawCode = (
                      labelModalProduct.ean ||
                      labelModalProduct.sku ||
                      "2000000000015"
                    ).trim();
                    const chars = rawCode.split("");
                    const bars: React.ReactElement[] = [];
                    let cursorX = 12;
                    bars.push(
                      <rect key="g-s-1" x={cursorX} y={4} width={2} height={58} fill="#000" />
                    );
                    cursorX += 4;
                    bars.push(
                      <rect key="g-s-2" x={cursorX} y={4} width={2} height={58} fill="#000" />
                    );
                    cursorX += 5;

                    chars.forEach((ch, idx) => {
                      const code = ch.charCodeAt(0);
                      const w1 = (code % 3) + 1.5;
                      const gap1 = ((code >> 1) % 2) + 1.5;
                      const w2 = ((code + idx) % 3) + 1.2;
                      const gap2 = ((code + idx * 3) % 2) + 1.8;
                      if (cursorX < 218) {
                        bars.push(
                          <rect
                            key={`b1-${idx}`}
                            x={cursorX}
                            y={4}
                            width={w1}
                            height={50}
                            fill="#000"
                          />
                        );
                        cursorX += w1 + gap1;
                      }
                      if (cursorX < 218) {
                        bars.push(
                          <rect
                            key={`b2-${idx}`}
                            x={cursorX}
                            y={4}
                            width={w2}
                            height={50}
                            fill="#000"
                          />
                        );
                        cursorX += w2 + gap2;
                      }
                    });

                    bars.push(
                      <rect
                        key="g-e-1"
                        x={Math.min(222, cursorX)}
                        y={4}
                        width={2}
                        height={58}
                        fill="#000"
                      />
                    );
                    bars.push(
                      <rect
                        key="g-e-2"
                        x={Math.min(226, cursorX + 4)}
                        y={4}
                        width={2}
                        height={58}
                        fill="#000"
                      />
                    );
                    return bars;
                  })()}
                </svg>
                <div className="font-mono text-sm font-bold tracking-[0.28em] text-slate-900 mt-0.5">
                  {labelModalProduct.ean}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLabelModalProduct(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  showToast(`Imprimiendo etiqueta para: ${labelModalProduct.nombre}`);
                  window.print();
                }}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold shadow-md shadow-rose-200 transition cursor-pointer"
              >
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Baja / Eliminación de Producto */}
      {productToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5">
          <div className="card-soft rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl bg-white">
            <h3 className="text-base font-bold text-slate-900">
              Dar de baja producto del catálogo
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              ¿Estás seguro que deseas dar de baja{" "}
              <strong className="text-slate-900">{productToDelete.nombre}</strong> (
              <span className="font-mono text-rose-600">{productToDelete.sku}</span>)?
            </p>
            <p className="text-[11px] text-slate-500 bg-rose-50/50 border border-rose-100 p-3 rounded-2xl">
              Si el producto tiene unidades disponibles ({productToDelete.stock}{" "}
              {productToDelete.unidad_medida}), primero debe quedar en 0 stock antes de retirarlo.
            </p>
            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setProductToDelete(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold transition cursor-pointer"
              >
                {isDeleting ? "Procesando..." : "Confirmar baja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Toast de Notificación */}
      {toastMessage && (
        <div
          id="toastNotification"
          className="fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-semibold py-3 px-4 rounded-2xl shadow-2xl z-50 flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span id="toastMessage">{toastMessage}</span>
        </div>
      )}

      {/* Overlay & Spotlight del Tour Guiado */}
      {isTourActive && (
        <div id="tourOverlay" className="fixed inset-0 z-50">
          <div
            id="tourSpotlight"
            style={spotlightStyle}
            className="tour-active-highlight"
          />
          <div
            id="tourTooltip"
            style={tooltipStyle}
            className="bg-white border border-rose-200 shadow-2xl rounded-2xl p-5 max-w-sm w-[90vw] text-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span
                id="tourStepBadge"
                className="text-[11px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md"
              >
                Paso {currentStepIndex + 1} de {TOUR_STEPS.length}
              </span>
              <button
                type="button"
                onClick={endTour}
                className="text-slate-400 hover:text-slate-600 text-xs font-semibold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
            <div>
              <h3 id="tourTitle" className="text-base font-bold text-slate-900">
                {TOUR_STEPS[currentStepIndex]?.title}
              </h3>
              <p id="tourDescription" className="text-xs text-slate-600 leading-relaxed mt-1">
                {TOUR_STEPS[currentStepIndex]?.desc}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              {currentStepIndex > 0 ? (
                <button
                  type="button"
                  id="tourPrevBtn"
                  onClick={prevTourStep}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5 transition cursor-pointer"
                >
                  Anterior
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                id="tourNextBtn"
                onClick={nextTourStep}
                className="bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow cursor-pointer"
              >
                {currentStepIndex === TOUR_STEPS.length - 1 ? "¡Entendido!" : "Siguiente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
