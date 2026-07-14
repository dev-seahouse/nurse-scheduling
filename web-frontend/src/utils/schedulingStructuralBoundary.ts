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

// The WT3 structural import/storage boundary (DL09 D13). One shared owner so YAML
// import and localStorage hydration enforce the same current-schema shape: the
// fixed `{ unit, policy }` hours-contract marker and the 30-minute working-time
// grid. It performs STRUCTURAL parsing only — no selector expansion, coefficient
// coverage, or policy semantics (those belong to WT5/WT7).
//
// A structural failure rejects the WHOLE candidate (import non-replacement /
// storage reset). Callers never delete only the offending field and commit the
// rest, and there is no migration or silent upgrade.

import { SHIFT_COUNT } from '@/types/scheduling';
import { parseWorkingTime, WorkingTimeFields } from '@/utils/shiftWorkingTime';
import { parseHoursContract } from '@/utils/countShiftTypeCoefficients';

interface CandidateShiftType extends WorkingTimeFields {
  id?: unknown;
}

interface CandidatePreference {
  type?: unknown;
  hoursContract?: unknown;
}

interface StructuralCandidate {
  shiftTypes?: { items?: CandidateShiftType[] };
  preferences?: CandidatePreference[];
}

// A working-time field counts as present unless it is null/undefined. A present
// empty clock string is therefore surfaced for validation (and rejected), not
// treated as absence.
function hasWorkingTimeFields(item: CandidateShiftType): boolean {
  return (
    item.durationMinutes != null ||
    item.startTime != null ||
    item.endTime != null ||
    item.restMinutes != null
  );
}

function pickWorkingTime(item: CandidateShiftType): WorkingTimeFields {
  return {
    durationMinutes: item.durationMinutes,
    startTime: item.startTime,
    endTime: item.endTime,
    restMinutes: item.restMinutes,
  };
}

// Collect every structural violation in a candidate state with a path-specific
// diagnostic. An empty array means the candidate satisfies the WT3 boundary.
export function collectStructuralImportErrors(candidate: StructuralCandidate): string[] {
  const errors: string[] = [];

  candidate.shiftTypes?.items?.forEach((item, index) => {
    if (!hasWorkingTimeFields(item)) {
      return;
    }
    const shape = parseWorkingTime(pickWorkingTime(item));
    if (shape.kind === 'invalid') {
      const label = item.id != null ? ` (${String(item.id)})` : '';
      errors.push(
        `shiftTypes.items[${index}]${label} has invalid working time (${shape.path}: ${shape.code}).`
      );
    }
  });

  candidate.preferences?.forEach((pref, index) => {
    if (pref.type !== SHIFT_COUNT || pref.hoursContract == null) {
      return;
    }
    const parsed = parseHoursContract(pref.hoursContract);
    if (!parsed.ok) {
      errors.push(
        `preferences[${index}].hoursContract is not a valid hours contract ` +
        `({ unit: "half-hour", policy: "exact" | "range" }): ${parsed.reason}.`
      );
    }
  });

  return errors;
}

// Remove only the permitted omissions from each Shift Type's working time:
// null/undefined own keys and explicit zero rest. MUST be called only after
// `collectStructuralImportErrors` reports no errors — an invalid shape is left
// untouched defensively rather than silently altered. Mutates in place without
// rebuilding or reordering the remaining authored fields.
export function canonicalizeWorkingTime(items?: CandidateShiftType[]): void {
  items?.forEach(item => {
    const shape = parseWorkingTime(pickWorkingTime(item));
    if (shape.kind === 'invalid') {
      return;
    }

    if (item.durationMinutes == null) delete item.durationMinutes;
    if (item.startTime == null) delete item.startTime;
    if (item.endTime == null) delete item.endTime;
    if (item.restMinutes == null || item.restMinutes === 0) delete item.restMinutes;
  });
}
