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

import { Group, HoursContract, HoursContractUnit, Item, ShiftCountTypeCoefficient } from '@/types/scheduling';
import { LEAVE, LEAVE_CREDIT_MINUTES } from '@/utils/keywords';

export type DraftShiftCountTypeCoefficient = [string, number | string];

// Coefficient auto-fill unit: how many minutes one coefficient unit represents.
// Half-hour units keep 12.5h shifts integer (25); hour units are coarser.
export const HALF_HOUR_UNIT_MINUTES = 30;
export const HOUR_UNIT_MINUTES = 60;

// Single owner of the hours-contract unit ↔ minutes conversion. Every place that
// needs to know how many minutes a unit represents, or which units are valid,
// goes through here so the enum and its mapping can never drift apart.
const UNIT_MINUTES_BY_UNIT: Record<HoursContractUnit, number> = {
  'half-hour': HALF_HOUR_UNIT_MINUTES,
  'hour': HOUR_UNIT_MINUTES,
};

export const HOURS_CONTRACT_UNITS = Object.keys(UNIT_MINUTES_BY_UNIT) as HoursContractUnit[];

export function getUnitMinutes(unit: HoursContractUnit): number {
  return UNIT_MINUTES_BY_UNIT[unit];
}

export function isHoursContractUnit(value: unknown): value is HoursContractUnit {
  return typeof value === 'string' && (HOURS_CONTRACT_UNITS as readonly string[]).includes(value);
}

// Runtime guard for an imported hours-contract value. Accepts ONLY the exact
// shape `{ unit: "half-hour" | "hour" }` — empty objects, unknown units, and
// extra keys are rejected (returns undefined) so callers can drop the field
// rather than arm anything on malformed metadata.
export function parseHoursContract(value: unknown): HoursContract | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'unit') {
    return undefined;
  }
  const { unit } = value as { unit: unknown };
  return isHoursContractUnit(unit) ? { unit } : undefined;
}

export interface ShiftCountTypeCoefficientValidation {
  coefficients: ShiftCountTypeCoefficient[];
  errorsById: Record<string, string>;
  overlapError?: string;
}

export function getCoefficientForShiftType(
  coefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeId: string
): number | string {
  return coefficients.find(([id]) => id === shiftTypeId)?.[1] ?? '';
}

function getExpandedShiftTypeIdsById(shiftTypeData: { items: Item[]; groups: Group[] }): Map<string, readonly string[]> {
  return new Map([
    ...shiftTypeData.items.map(shiftType => [shiftType.id, [shiftType.id]] as const),
    ...shiftTypeData.groups.map(group => [group.id, [...new Set(group.members)]] as const),
  ]);
}

export function getCoefficientShiftTypeIds(
  selectedShiftTypeIds: string[],
  shiftTypeData: { items: Item[]; groups: Group[] }
): string[] {
  const expandedShiftTypeIdsById = getExpandedShiftTypeIdsById(shiftTypeData);
  const selectedExpandedShiftTypeIds = new Set(
    selectedShiftTypeIds.flatMap(shiftTypeId => expandedShiftTypeIdsById.get(shiftTypeId) ?? [])
  );

  return [
    ...shiftTypeData.items
      .filter(shiftType => selectedExpandedShiftTypeIds.has(shiftType.id))
      .map(shiftType => shiftType.id),
    ...shiftTypeData.groups
      .filter(group => group.members.length > 0 && group.members.every(member => selectedExpandedShiftTypeIds.has(member)))
      .map(group => group.id),
  ];
}

export function syncCoefficientPairs(
  selectedShiftTypeIds: string[],
  coefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeData: { items: Item[]; groups: Group[] }
): DraftShiftCountTypeCoefficient[] {
  const coefficientShiftTypeIds = getCoefficientShiftTypeIds(selectedShiftTypeIds, shiftTypeData);
  if (coefficientShiftTypeIds.length < 1) {
    return [];
  }

  return coefficientShiftTypeIds.map(id => [id, getCoefficientForShiftType(coefficients, id)]);
}

export function autoFillCoefficientsFromDurations(
  coefficientShiftTypeIds: string[],
  currentCoefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeData: { items: Item[]; groups: Group[] },
  unitMinutes: number
): DraftShiftCountTypeCoefficient[] {
  const durationById = new Map(shiftTypeData.items.map(item => [item.id, item.durationMinutes]));
  return coefficientShiftTypeIds.map((id): DraftShiftCountTypeCoefficient => {
    // LEAVE carries a fixed credit; worked shift types use their durationMinutes.
    // Group ids and shift types without a duration keep their current value.
    const durationMinutes = id === LEAVE ? LEAVE_CREDIT_MINUTES : durationById.get(id);
    if (typeof durationMinutes === 'number' && unitMinutes > 0) {
      return [id, Math.max(1, Math.round(durationMinutes / unitMinutes))];
    }
    return [id, getCoefficientForShiftType(currentCoefficients, id)];
  });
}

export function updateCoefficientPair(
  coefficientShiftTypeIds: string[],
  coefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeId: string,
  coefficient: number | string
): DraftShiftCountTypeCoefficient[] {
  return coefficientShiftTypeIds.map((id): DraftShiftCountTypeCoefficient => [
    id,
    id === shiftTypeId ? coefficient : getCoefficientForShiftType(coefficients, id),
  ]);
}

// Insert or update exactly one pair, preserving every other pair untouched.
// Unlike the bulk sync/auto-fill helpers, this never rewrites duration-backed
// coefficients — the uncredited-leave fix uses it to add LEAVE without disturbing
// the worked-shift coefficients already on the count (guard-tech-plan "The fix").
export function upsertCoefficientPair(
  pairs: DraftShiftCountTypeCoefficient[],
  id: string,
  coefficient: number | string
): DraftShiftCountTypeCoefficient[] {
  const existingIndex = pairs.findIndex(([pairId]) => pairId === id);
  if (existingIndex === -1) {
    return [...pairs, [id, coefficient]];
  }
  return pairs.map((pair, index): DraftShiftCountTypeCoefficient =>
    index === existingIndex ? [id, coefficient] : pair
  );
}

// The LEAVE coefficient in a given contract unit: a paid leave day credits
// LEAVE_CREDIT_MINUTES (8h), so 16 half-hour units or 8 hour units. Single owner
// of this conversion so the guard fix and its preview can never disagree.
export function getLeaveCreditCoefficient(unit: HoursContractUnit): number {
  return Math.max(1, Math.round(LEAVE_CREDIT_MINUTES / getUnitMinutes(unit)));
}

function getCoefficientOverlapError(
  coefficientPairs: ShiftCountTypeCoefficient[],
  shiftTypeData: { items: Item[]; groups: Group[] }
): string | undefined {
  const expandedShiftTypeIdsById = getExpandedShiftTypeIdsById(shiftTypeData);

  const sourceShiftTypeIdByExpandedId = new Map<string, string>();
  for (const [shiftTypeId] of coefficientPairs) {
    for (const expandedShiftTypeId of expandedShiftTypeIdsById.get(shiftTypeId) ?? []) {
      const existingSourceShiftTypeId = sourceShiftTypeIdByExpandedId.get(expandedShiftTypeId);
      if (existingSourceShiftTypeId !== undefined) {
        return `Shift type coefficients overlap: ${existingSourceShiftTypeId}, ${shiftTypeId} include ${expandedShiftTypeId}`;
      }
      sourceShiftTypeIdByExpandedId.set(expandedShiftTypeId, shiftTypeId);
    }
  }

  return undefined;
}

export function validateCoefficientPairs(
  selectedShiftTypeIds: string[],
  coefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeData: { items: Item[]; groups: Group[] }
): ShiftCountTypeCoefficientValidation {
  const syncedCoefficients = syncCoefficientPairs(selectedShiftTypeIds, coefficients, shiftTypeData);
  const errorsById: Record<string, string> = {};

  for (const [shiftTypeId, coefficient] of syncedCoefficients) {
    if (coefficient === '') {
      continue;
    }

    if (typeof coefficient !== 'number' || !Number.isInteger(coefficient) || coefficient < 1) {
      errorsById[shiftTypeId] = `Coefficient for ${shiftTypeId} must be an integer of at least 1`;
    }
  }

  if (Object.keys(errorsById).length > 0) {
    return { coefficients: [], errorsById };
  }

  const normalizedCoefficients = syncedCoefficients.filter(
    ([, coefficient]) => coefficient !== ''
  ) as ShiftCountTypeCoefficient[];

  return {
    coefficients: normalizedCoefficients,
    errorsById,
    overlapError: getCoefficientOverlapError(normalizedCoefficients, shiftTypeData),
  };
}
