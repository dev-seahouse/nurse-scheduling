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

import NumberInput from '@/components/NumberInput';
import { OrderedEntry, sortIdsByEntryOrder } from '@/utils/entityOrdering';
import { Group, Item } from '@/types/scheduling';
import {
  DraftShiftCountTypeCoefficient,
  autoFillCoefficientsFromDurations,
  getCoefficientForShiftType,
  getCoefficientShiftTypeIds,
  updateCoefficientPair,
} from '@/utils/countShiftTypeCoefficients';

interface CountShiftTypeCoefficientFieldsProps {
  selectedShiftTypeIds: string[];
  coefficients: DraftShiftCountTypeCoefficient[];
  shiftTypeEntries: OrderedEntry[];
  shiftTypeData: { items: Item[]; groups: Group[] };
  errorsById?: Record<string, string>;
  label?: string;
  // Show the "auto-fill from durations" control. Coefficients are filled at the
  // one fixed half-hour unit (DL09 D1) — there is no unit picker. Not offered for
  // Shift Type Requirements (coefficients there are staffing weights, not hours).
  enableDurationAutofill?: boolean;
  onChange: (coefficients: DraftShiftCountTypeCoefficient[], changedShiftTypeId: string) => void;
}

export function CountShiftTypeCoefficientFields({
  selectedShiftTypeIds,
  coefficients,
  shiftTypeEntries,
  shiftTypeData,
  errorsById = {},
  label = 'Count Shift Type',
  enableDurationAutofill = false,
  onChange,
}: CountShiftTypeCoefficientFieldsProps) {
  const singularLabel = label.toLowerCase();
  const emptyHint = `Coefficients are not needed when no ${singularLabel} is selected.`;
  const coefficientShiftTypeIds = getCoefficientShiftTypeIds(selectedShiftTypeIds, shiftTypeData);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label} Coefficients
      </label>

      {enableDurationAutofill && coefficientShiftTypeIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() =>
              onChange(
                autoFillCoefficientsFromDurations(coefficientShiftTypeIds, coefficients, shiftTypeData),
                ''
              )
            }
            className="px-3 py-1.5 text-sm font-medium border rounded-lg transition-colors text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100"
          >
            Auto-fill from durations
          </button>
          <span className="text-xs text-gray-500 italic">
            Fills coefficients from each shift&apos;s duration in half-hour units (LEAVE counts 8h); the target stays what you type.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end">
        {coefficientShiftTypeIds.length < 1 ? (
          <div className="text-sm text-gray-500 italic">
            {emptyHint}
          </div>
        ) : (
          sortIdsByEntryOrder(coefficientShiftTypeIds, shiftTypeEntries).map(shiftTypeId => (
            <label key={shiftTypeId} className="block w-28">
              <span className="block truncate text-xs font-medium text-gray-600 mb-1" title={shiftTypeId}>
                {shiftTypeId}
              </span>
              <NumberInput
                min="1"
                step="1"
                value={getCoefficientForShiftType(coefficients, shiftTypeId)}
                onChange={(event) => {
                  const value = event.target.value;
                  const parsedValue = Number.parseInt(value, 10);
                  const coefficient = value === ''
                    ? ''
                    : (Number.isNaN(parsedValue) ? value : Math.max(1, parsedValue));
                  onChange(
                    updateCoefficientPair(coefficientShiftTypeIds, coefficients, shiftTypeId, coefficient),
                    shiftTypeId
                  );
                }}
                className={`block w-24 px-3 py-2 text-sm text-gray-900 bg-white border rounded-lg shadow-sm transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 hover:border-gray-400 ${
                  errorsById[shiftTypeId]
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                    : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'
                }`}
              />
            </label>
          ))
        )}
      </div>
    </div>
  );
}
