/*
 * This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
 *
 * Copyright (C) 2023-2026 Johnson Sun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Amber, non-blocking surfaces for the uncredited-leave guard (guard-tech-plan
// "UI surfaces"; decision log D1). Both read the same findUncreditedLeaveWarnings
// result: the badge marks a flagged count in the list; the advisory sits in the
// edit form and offers the one-click "Add LEAVE" fix. Neither ever gates saving.

import { FiAlertTriangle } from 'react-icons/fi';
import { HoursContractUnit } from '@/types/scheduling';

// Lightweight marker for a shift-count card whose hours contract omits LEAVE.
export function LeaveCreditBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
      <FiAlertTriangle className="h-3 w-3" />
      Leave not credited
    </span>
  );
}

interface LeaveCreditAdvisoryProps {
  affectedPeople: string[];
  // The contract unit is shown read-only: the count owns it (D6/D8), so the fix
  // credits LEAVE in that unit rather than offering an independent picker.
  unit: HoursContractUnit;
  coefficient: number;
  onAddLeave: () => void;
}

export function LeaveCreditAdvisory({ affectedPeople, unit, coefficient, onAddLeave }: LeaveCreditAdvisoryProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" role="status" aria-live="polite">
      <div className="flex items-start gap-2">
        <FiAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
        <div className="space-y-2 text-sm text-amber-900">
          <p>
            This hours contract omits{' '}
            <code className="rounded bg-amber-100 px-1 font-mono">LEAVE</code>, so paid leave will not
            count toward contracted hours for{' '}
            <span className="font-medium">{affectedPeople.join(', ')}</span>.
          </p>
          <p className="text-xs text-amber-800">
            Adding <code className="rounded bg-amber-100 px-1 font-mono">LEAVE</code> credits{' '}
            <span className="font-medium">{coefficient}</span> per leave day in this count&apos;s{' '}
            <span className="font-medium">{unit}</span> contract unit.
          </p>
          <button
            type="button"
            onClick={onAddLeave}
            className="rounded-md border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-200"
          >
            Add LEAVE ({coefficient})
          </button>
        </div>
      </div>
    </div>
  );
}
