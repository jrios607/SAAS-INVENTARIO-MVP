// Agrega updatePatente al api.ts existente
export async function updatePatente(
  id_patente: string,
  payload: Partial<Omit<Patente, "id_patente">>
): Promise<Patente | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/patentes/${encodeURIComponent(id_patente)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || res.statusText);
    }
    return await res.json();
  } catch (error) {
    console.error("Error actualizando patente:", error);
    throw error;
  }
}
