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

import { HoursContract, HoursContractPolicy, Group, Item, ShiftCountTypeCoefficient } from '@/types/scheduling';
import { LEAVE, LEAVE_CREDIT_MINUTES } from '@/utils/keywords';

export type DraftShiftCountTypeCoefficient = [string, number | string];

// The one fixed contract unit (DL09 D1): a half-hour is 30 minutes. There is no
// unit picker, conversion, or "hour"/"minute" fallback — the single owner of the
// unit ↔ minutes relationship so it can never drift.
export const HALF_HOUR_UNIT_MINUTES = 30;

// The LEAVE credit as a half-hour coefficient: a paid leave day credits
// LEAVE_CREDIT_MINUTES (8h) ⇒ 16 half-hour units (DL09 D6 / FR-CH-32). Single
// owner so the guard fix, its preview, and derivation can never disagree.
export const LEAVE_CREDIT_HALF_HOUR_UNITS = Math.round(LEAVE_CREDIT_MINUTES / HALF_HOUR_UNIT_MINUTES);

// The structural result of interpreting an imported `hoursContract` value. WT3
// does STRUCTURAL parsing only (DL09 D13): it accepts exactly the fixed marker
// `{ unit: "half-hour", policy: "exact" | "range" }` and rejects everything else
// (retired "hour"/"minute" units, missing/extra keys, wrong types) with a clear
// reason. It does NOT validate that the count's expression/target/weight match
// the policy — that inbound semantic gate is WT7.
export type HoursContractParseResult =
  | { ok: true; value: HoursContract }
  | { ok: false; reason: string };

const HOURS_CONTRACT_POLICIES: readonly HoursContractPolicy[] = ['exact', 'range'];

export function parseHoursContract(value: unknown): HoursContractParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'hoursContract must be an object with unit and policy' };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.unit !== 'half-hour') {
    return { ok: false, reason: 'hoursContract.unit must be "half-hour"' };
  }
  if (!HOURS_CONTRACT_POLICIES.includes(record.policy as HoursContractPolicy)) {
    return { ok: false, reason: 'hoursContract.policy must be "exact" or "range"' };
  }
  if (keys.length !== 2) {
    return { ok: false, reason: 'hoursContract must have exactly the keys unit and policy' };
  }
  return { ok: true, value: { unit: 'half-hour', policy: record.policy as HoursContractPolicy } };
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

// Fill coefficients from each shift's paid working minutes at the fixed half-hour
// unit (durationMinutes / 30; LEAVE credits 16). There is no unit parameter or
// picker (DL09 D1). Group ids and shift types without a duration keep their
// current value. Marked-contract derivation and Refresh are WT5/WT6; this stays
// a generic convenience for the coefficient editor and export count columns.
export function autoFillCoefficientsFromDurations(
  coefficientShiftTypeIds: string[],
  currentCoefficients: DraftShiftCountTypeCoefficient[],
  shiftTypeData: { items: Item[]; groups: Group[] }
): DraftShiftCountTypeCoefficient[] {
  const durationById = new Map(shiftTypeData.items.map(item => [item.id, item.durationMinutes]));
  return coefficientShiftTypeIds.map((id): DraftShiftCountTypeCoefficient => {
    const durationMinutes = id === LEAVE ? LEAVE_CREDIT_MINUTES : durationById.get(id);
    if (typeof durationMinutes === 'number') {
      return [id, Math.max(1, Math.round(durationMinutes / HALF_HOUR_UNIT_MINUTES))];
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

// The LEAVE coefficient for a marked contract: always 16 half-hour units
// (LEAVE_CREDIT_HALF_HOUR_UNITS). Kept as a function so callers read intent, not
// a bare constant, and so the guard fix and its preview share one source.
export function getLeaveCreditCoefficient(): number {
  return LEAVE_CREDIT_HALF_HOUR_UNITS;
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
