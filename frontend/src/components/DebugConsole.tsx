"use client";

import React, { useState, useEffect } from "react";
import { Terminal, X, AlertCircle, Trash2, Bug } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface LogEntry {
  id: string;
  type: "error" | "warn" | "log";
  message: string;
  timestamp: Date;
  details?: string;
}

export function DebugConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Intercept console.error
    const originalError = console.error;
    console.error = (...args: any[]) => {
      const message = args.map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
      }).join(' ');
      setTimeout(() => addLog({ type: "error", message }), 0);
      originalError.apply(console, args);
    };

    // Intercept console.warn
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      const message = args.map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
      }).join(' ');

      // Ignorar el warning inofensivo de Recharts
      if (!message.includes('The width(-1) and height(-1) of chart should be greater than 0')) {
        setTimeout(() => addLog({ type: "warn", message }), 0);
      }
      
      originalWarn.apply(console, args);
    };

    // Catch global unhandled errors
    const handleError = (event: ErrorEvent) => {
      addLog({ type: "error", message: event.message, details: event.error?.stack });
    };

    // Catch global unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      addLog({ type: "error", message: "Unhandled Promise Rejection", details: String(event.reason) });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  const addLog = (log: Omit<LogEntry, "id" | "timestamp">) => {
    setLogs(prev => {
      const newLog: LogEntry = {
        ...log,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date()
      };
      // Keep only last 100 logs
      return [newLog, ...prev].slice(0, 100);
    });
    
    setIsOpen(currentIsOpen => {
      if (!currentIsOpen) {
        setUnreadCount(prev => prev + 1);
      }
      return currentIsOpen;
    });
  };

  const clearLogs = () => {
    setLogs([]);
    setUnreadCount(0);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setUnreadCount(0);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between py-2 text-sm text-gray-400 hover:text-white transition-colors"
        title="Consola de Depuración"
      >
        <div className="flex items-center gap-3">
          <Terminal size={16} className={unreadCount > 0 ? "text-amber-400" : "text-slate-400"} />
          <span className="font-medium">Consola Depuración</span>
        </div>
        {unreadCount > 0 && (
          <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col bg-[#0a0a0a] border-[#1f1f1f] text-gray-300">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-[#1f1f1f] pb-4">
            <DialogTitle className="text-white flex items-center gap-2">
              <Bug size={18} className="text-emerald-500" />
              Consola de Depuración del Sistema
            </DialogTitle>
            <button
              onClick={clearLogs}
              className="flex items-center gap-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md transition-colors"
            >
              <Trash2 size={14} />
              Limpiar Logs
            </button>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-4 space-y-3 font-mono text-sm">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
                <AlertCircle size={24} />
                <p>No hay errores registrados.</p>
              </div>
            ) : (
              logs.map(log => (
                <div 
                  key={log.id} 
                  className={`p-3 rounded-lg border ${
                    log.type === 'error' 
                      ? 'bg-red-950/30 border-red-900/50 text-red-400' 
                      : 'bg-amber-950/30 border-amber-900/50 text-amber-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-semibold break-words flex-1">
                      [{log.type.toUpperCase()}] {log.message}
                    </span>
                    <span className="text-xs opacity-50 shrink-0">
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  {log.details && (
                    <pre className="mt-2 text-xs opacity-80 whitespace-pre-wrap overflow-x-auto bg-black/20 p-2 rounded">
                      {log.details}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
