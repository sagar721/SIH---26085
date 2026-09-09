import React from 'react';
import type { DataConfidence } from '../../types';
import { cn } from '../../lib/utils';

export type ExtendedStatus = DataConfidence | 'UNAVAILABLE' | 'OFFICIAL' | 'MODEL_DERIVED' | 'MODELLED';

interface DataStatusBadgeProps {
  status: ExtendedStatus;
  className?: string;
}

export const DataStatusBadge: React.FC<DataStatusBadgeProps> = ({ status, className }) => {
  let colorClass = '';
  
  switch (status) {
    case 'OBSERVED':
    case 'AUTHORITATIVE':
    case 'OFFICIAL':
      colorClass = 'bg-cyan/10 text-cyan border-cyan/20';
      break;
    case 'MODEL_DERIVED':
    case 'MODELLED':
    case 'SIMULATED':
      colorClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      break;
    case 'INFERRED':
      colorClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      break;
    case 'MOCK':
    case 'SYNTHETIC':
      colorClass = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      break;
    case 'UNAVAILABLE':
    default:
      colorClass = 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono tracking-wider font-semibold", colorClass, className)}>
      <div className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {status}
    </div>
  );
};
