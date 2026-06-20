import React, { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="h-full w-full min-h-[300px] flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
      {icon && (
        <div className="text-slate-300 mb-4 scale-150">
          {icon}
        </div>
      )}
      <p className="text-slate-400 font-medium text-sm md:text-base max-w-sm">
        {message}
      </p>
    </div>
  );
}
