"use client";

import React, { useRef, useState, useEffect } from "react";
import { Camera, X, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import dynamic from "next/dynamic";

// Carga dinámica para evitar problemas de SSR con objetos como window/navigator
const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then(mod => mod.Scanner), {
  ssr: false,
});

interface HybridInputProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function HybridInput({ 
  value, 
  onChange, 
  onEnter,
  placeholder = "Escanear o escribir...", 
  autoFocus = false 
}: HybridInputProps) {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleScan = (detectedCodes: any[]) => {
    if (detectedCodes.length > 0) {
      const code = detectedCodes[0].rawValue;
      onChange(code);
      setIsCameraOpen(false);
      if (onEnter) {
        onEnter(code);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (onEnter) {
        onEnter(value);
      }
    }
  };

  return (
    <div className="flex gap-1.5 w-full">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="font-mono flex-1"
      />
      <button
        type="button"
        onClick={() => {
          setCameraError(null);
          setIsCameraOpen(true);
        }}
        title="Escanear con cámara del dispositivo"
        className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border transition-colors bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-emerald-600"
      >
        <Camera size={15} />
      </button>

      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl w-full max-w-sm border border-slate-800 relative flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
              <span className="text-sm text-slate-200 font-medium">Cámara de Escaneo</span>
              <button
                onClick={() => setIsCameraOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center hover:bg-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative aspect-square w-full bg-black">
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <AlertCircle size={32} className="text-red-400 mb-3" />
                  <p className="text-sm text-red-300 leading-relaxed">{cameraError}</p>
                </div>
              ) : (
                <Scanner
                  onScan={handleScan}
                  components={{ finder: true }}
                />
              )}
            </div>

            <div className="px-4 py-3 bg-slate-800 text-center border-t border-slate-700">
              <p className="text-emerald-400 text-xs font-medium">
                Apunta al código para escanear
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
