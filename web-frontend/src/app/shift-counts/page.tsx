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

// The shift counts management page for Tab "7. Shift Counts"
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { FiHelpCircle, FiAlertCircle } from 'react-icons/fi';
import { useSchedulingData } from '@/hooks/useSchedulingData';
import {
  DataType,
  HoursContract,
  HoursContractUnit,
  Preference,
  ShiftCountPreference,
  SHIFT_COUNT,
  SUPPORTED_EXPRESSIONS
} from '@/types/scheduling';
import { CheckboxList } from '@/components/CheckboxList';
import { CountShiftTypeCoefficientFields } from '@/components/CountShiftTypeCoefficientFields';
import { DraggableCardList } from '@/components/DraggableCardList';
import { LeaveCreditAdvisory, LeaveCreditBadge } from '@/components/LeaveCreditAdvisory';
import ToggleButton from '@/components/ToggleButton';
import NumberInput from '@/components/NumberInput';
import { isValidWeightValue, getWeightWithPositivePrefix, isWeightNonPositive } from '@/utils/numberParsing';
import WeightInput from '@/components/WeightInput';
import { saveScrollPosition, restoreScrollPosition } from '@/utils/scrolling';
import { useTabSwitchWarning } from '@/utils/unsavedEditingState';
import { isImeCompositionKeyEvent } from '@/utils/keyboardEvents';
import { sortIdsByEntryOrder } from '@/utils/entityOrdering';
import { isReservedKeyword, LEAVE, LEAVE_CREDIT_MINUTES } from '@/utils/keywords';
import { findUncreditedLeaveWarnings } from '@/utils/leaveCreditWarning';
import {
  DraftShiftCountTypeCoefficient,
  getLeaveCreditCoefficient,
  getUnitMinutes,
  HOURS_CONTRACT_UNITS,
  syncCoefficientPairs,
  upsertCoefficientPair,
  validateCoefficientPairs,
} from '@/utils/countShiftTypeCoefficients';

interface ShiftCountForm {
  description: string;
  person: string[];
  count_dates: string[];
  count_shift_types: string[];
  count_shift_type_coefficients: DraftShiftCountTypeCoefficient[];
  // Present iff the count is marked as an hours contract. Its unit is the single
  // control over the count's coefficient unit (drives auto-fill + conversion).
  hours_contract?: HoursContract;
  expression: typeof SUPPORTED_EXPRESSIONS[number];
  target: number | string;
  weight: number | string;
}

// Rescale a value from one unit to another (e.g. half-hour→hour halves it).
// Returns null when the result is not a whole number, so an unsafe conversion
// can be blocked rather than silently rounding.
function convertUnitValue(value: number, fromMinutes: number, toMinutes: number): number | null {
  const scaled = (value * fromMinutes) / toMinutes;
  return Number.isInteger(scaled) ? scaled : null;
}

type UnitConversionResult =
  | { ok: true; coefficients: DraftShiftCountTypeCoefficient[]; target: number | string }
  | { ok: false; blocked: string[] };

// Atomically convert a count's coefficients AND target between contract units.
// Every converted value must land on a whole number >= 1; otherwise the whole
// switch is rejected so no mixed-unit state can occur (D8 permits blocking).
//
// Only EXPLICIT authored coefficients are converted. Blank/`""` slots are left
// untouched — a blank CONCRETE shift type is an implicit backend-default 1 that
// cannot be re-expressed in the new unit without either changing its meaning or
// (for group/`ALL` cover slots) manufacturing overlapping pairs, so its presence
// blocks the switch instead. Group/`ALL` cover slots (`syncCoefficientPairs`
// exposes them alongside concrete items) are never emitted or blocked on when
// blank; only their explicit values, if any, convert.
function convertCountToUnit(
  coefficients: DraftShiftCountTypeCoefficient[],
  target: number | string,
  fromUnit: HoursContractUnit,
  toUnit: HoursContractUnit,
  concreteShiftTypeIds: Set<string>
): UnitConversionResult {
  const fromMinutes = getUnitMinutes(fromUnit);
  const toMinutes = getUnitMinutes(toUnit);
  const blocked: string[] = [];

  const convertedCoefficients = coefficients.map(([id, value]): DraftShiftCountTypeCoefficient => {
    if (typeof value === 'number') {
      const scaled = convertUnitValue(value, fromMinutes, toMinutes);
      if (scaled === null || scaled < 1) {
        blocked.push(id);
        return [id, value];
      }
      return [id, scaled];
    }
    // A blank concrete shift type is an implicit 1 that cannot be safely
    // converted — block. A blank group/ALL cover slot is not backend-defaulted,
    // so leave it as-is without blocking. Non-empty mid-edit strings are invalid
    // and left for save validation.
    if (value === '' && concreteShiftTypeIds.has(id)) {
      blocked.push(id);
    }
    return [id, value];
  });

  let convertedTarget = target;
  if (typeof target === 'number') {
    const scaledTarget = convertUnitValue(target, fromMinutes, toMinutes);
    if (scaledTarget === null || scaledTarget < 0) {
      blocked.push('target');
    } else {
      convertedTarget = scaledTarget;
    }
  }

  if (blocked.length > 0) {
    return { ok: false, blocked };
  }
  return { ok: true, coefficients: convertedCoefficients, target: convertedTarget };
}

// Project the in-progress form onto a ShiftCountPreference so the edit-form
// advisory reflects live edits (adding LEAVE clears it immediately), not the
// last-saved count. Only the fields the guard reads matter; mid-edit string
// target/weight collapse to a harmless number for the detection pass.
function toDetectionShiftCount(formData: ShiftCountForm): ShiftCountPreference {
  return {
    type: SHIFT_COUNT,
    person: formData.person,
    countDates: formData.count_dates,
    countShiftTypes: formData.count_shift_types,
    ...(formData.hours_contract ? { hoursContract: formData.hours_contract } : {}),
    expression: formData.expression,
    target: typeof formData.target === 'number' ? formData.target : 0,
    weight: typeof formData.weight === 'number' ? formData.weight : 0,
  };
}

// Swap the count under edit (or append the new draft) into the full preference
// list so detection sees leave requests alongside the live draft. The draft's
// shift-count sublist index is preserved (same position when editing; appended
// at the end when adding).
function withDraftShiftCount(
  preferences: Preference[],
  editingIndex: number | null,
  draft: ShiftCountPreference
): Preference[] {
  if (editingIndex === null) {
    return [...preferences, draft];
  }
  let shiftCountIndex = -1;
  return preferences.map(pref => {
    if (pref.type !== SHIFT_COUNT) {
      return pref;
    }
    shiftCountIndex += 1;
    return shiftCountIndex === editingIndex ? draft : pref;
  });
}

interface ShiftCountErrors {
  person?: string;
  count_dates?: string;
  count_shift_types?: string;
  count_shift_type_coefficients?: string;
  count_shift_type_coefficients_by_id?: Record<string, string>;
  expression?: string;
  target?: string;
  weight?: string;
}

export default function ShiftCountsPage() {
  const {
    getPreferencesByType,
    updatePreferencesByType,
    duplicatePreferenceByType,
    preferences,
    shiftTypeData,
    peopleData,
    dateData
  } = useSchedulingData();

  // Get shift counts from the flattened preferences
  const shiftCounts = getPreferencesByType<ShiftCountPreference>(SHIFT_COUNT);
  const updateShiftCounts = (newPrefs: ShiftCountPreference[]) =>
    updatePreferencesByType(SHIFT_COUNT, newPrefs);

  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [formData, setFormData] = useState<ShiftCountForm>({
    description: '',
    person: [],
    count_dates: [],
    count_shift_types: [],
    count_shift_type_coefficients: [],
    hours_contract: undefined,
    expression: 'x >= T',
    target: 0,
    weight: -1
  });
  const [errors, setErrors] = useState<ShiftCountErrors>({});
  // Set when a contract-unit switch is blocked because a value cannot convert to
  // a whole number; the switch is not applied until the author reconciles.
  const [unitConversionError, setUnitConversionError] = useState<string | null>(null);
  // The coefficient editor's current unit while unmarked — only ever a starting
  // guess for the mark-time declaration below, never an authoritative truth (an
  // unmarked count persists no unit, so a reopened one has no real signal).
  const [privateUnit, setPrivateUnit] = useState<HoursContractUnit>(HOURS_CONTRACT_UNITS[0]);
  // True right after marking, until the author declares which unit the existing
  // coefficients are already in. In this mode the unit selector is a declaration
  // (no rescale); once declared, switching it converts. This keeps a wrong unit
  // visible and user-owned instead of silently inheriting a stale guess.
  const [isDeclaringUnit, setIsDeclaringUnit] = useState(false);
  useTabSwitchWarning(isFormVisible);
  const shiftTypeEntries = [...shiftTypeData.items, ...shiftTypeData.groups];
  // Concrete shift-type ids (excludes groups and the reserved ALL), so the unit
  // conversion can tell a real implicit-1 slot from a group/ALL cover slot.
  const concreteShiftTypeIds = useMemo(
    () => new Set(shiftTypeData.items.map(shiftType => shiftType.id)),
    [shiftTypeData]
  );

  // The universes and group lists the uncredited-leave guard needs, built from
  // the store fragments. Item universes exclude the reserved OFF/LEAVE/ALL
  // states so `ALL` expands to worked shift types only (backend scheduler.py:91).
  const allPreferences = useMemo(() => preferences ?? [], [preferences]);
  const leaveWarningEnv = useMemo(() => ({
    allPersonIds: peopleData.items
      .map(person => person.id)
      .filter(id => !isReservedKeyword(DataType.PEOPLE, id)),
    allWorkedShiftTypeIds: shiftTypeData.items
      .map(shiftType => shiftType.id)
      .filter(id => !isReservedKeyword(DataType.SHIFT_TYPES, id)),
    peopleGroups: peopleData.groups,
    dateGroups: dateData.groups,
    shiftTypeGroups: shiftTypeData.groups,
    dateRange: dateData.range,
  }), [peopleData, shiftTypeData, dateData]);

  // List-card badges read the saved preferences: sublist index → warning.
  const savedLeaveWarningsByIndex = useMemo(() => {
    const warnings = findUncreditedLeaveWarnings({ preferences: allPreferences, ...leaveWarningEnv });
    return new Map(warnings.map(warning => [warning.shiftCountListIndex, warning]));
  }, [allPreferences, leaveWarningEnv]);

  // The edit-form advisory reflects the live draft, so the fix clears it at once.
  // Only marked counts can warn, so skip the work entirely for unmarked ones.
  const editingLeaveWarning = useMemo(() => {
    if (!isFormVisible || !formData.hours_contract) {
      return undefined;
    }
    const draft = toDetectionShiftCount(formData);
    const draftIndex = editingIndex ?? shiftCounts.length;
    const warnings = findUncreditedLeaveWarnings({
      preferences: withDraftShiftCount(allPreferences, editingIndex, draft),
      ...leaveWarningEnv,
    });
    return warnings.find(warning => warning.shiftCountListIndex === draftIndex);
  }, [isFormVisible, formData, editingIndex, allPreferences, leaveWarningEnv, shiftCounts.length]);

  const instructions = [
    "Set up shift count rules for people (e.g., \"Working shifts should be close to the average\")",
    "Select one or more people that this constraint applies to",
    "Select which dates to count shifts for",
    "Select which shift types to count",
    "Choose a mathematical expression to evaluate (e.g., 'x >= T' means count should be at least the target)",
    "Set the numeric target value",
    "Set positive weight to encourage constraint matches and negative weight to discourage them",
    "Navigate using the tabs or keyboard shortcuts (1, 2, etc.) to continue setup"
  ];

  const resetForm = () => {
    setFormData({
      description: '',
      person: [],
      count_dates: [],
      count_shift_types: [],
      count_shift_type_coefficients: [],
      hours_contract: undefined,
      expression: 'x >= T',
      target: 0,
      weight: -1
    });
    setErrors({});
    setUnitConversionError(null);
    setPrivateUnit(HOURS_CONTRACT_UNITS[0]);
    setIsDeclaringUnit(false);
    setEditingIndex(null);
  };

  const handleStartAdd = () => {
    resetForm();
    setIsFormVisible(true);
  };

  const handleStartEdit = (index: number) => {
    const shiftCount = shiftCounts[index];
    setFormData({
      description: shiftCount.description ?? '',
      person: shiftCount.person,
      count_dates: shiftCount.countDates,
      count_shift_types: shiftCount.countShiftTypes,
      count_shift_type_coefficients: syncCoefficientPairs(
        shiftCount.countShiftTypes,
        shiftCount.countShiftTypeCoefficients ?? [],
        shiftTypeData
      ),
      hours_contract: shiftCount.hoursContract,
      expression: shiftCount.expression,
      target: shiftCount.target,
      weight: shiftCount.weight
    });
    setEditingIndex(index);
    setIsFormVisible(true);
    setErrors({});
    setUnitConversionError(null);
    // A saved marked count already carries a persisted, declared unit — trust it
    // (no re-declaration). Switching it later converts.
    setIsDeclaringUnit(false);
    // Keep the private toggle in step with how the coefficients are stored so an
    // unmark never changes their meaning: a marked count's coefficients are in
    // its contract unit; an unmarked count defaults to the base unit.
    setPrivateUnit(shiftCount.hoursContract?.unit ?? HOURS_CONTRACT_UNITS[0]);
    // Save current scroll position and scroll to top
    saveScrollPosition();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  function handleCancel() {
    const wasEditing = editingIndex !== null;
    setIsFormVisible(false);
    resetForm();
    // Restore scroll position if we were editing
    if (wasEditing) {
      restoreScrollPosition();
    }
  }

  const validateForm = (): boolean => {
    const newErrors: ShiftCountErrors = {};
    const newCoefficientErrors: {[shiftTypeId: string]: string} = {};

    if (formData.person.length === 0) {
      newErrors.person = 'At least one person must be selected';
    }

    if (formData.count_dates.length === 0) {
      newErrors.count_dates = 'At least one date must be selected';
    }

    if (formData.count_shift_types.length === 0) {
      newErrors.count_shift_types = 'At least one shift type must be selected';
    }

    const coefficientValidation = validateCoefficientPairs(
      formData.count_shift_types,
      formData.count_shift_type_coefficients,
      shiftTypeData
    );
    Object.assign(newCoefficientErrors, coefficientValidation.errorsById);
    if (Object.keys(newCoefficientErrors).length > 0) {
      newErrors.count_shift_type_coefficients = Object.values(newCoefficientErrors).join('\n');
      newErrors.count_shift_type_coefficients_by_id = newCoefficientErrors;
    } else if (coefficientValidation.overlapError) {
      newErrors.count_shift_type_coefficients = coefficientValidation.overlapError;
    }

    if (!SUPPORTED_EXPRESSIONS.includes(formData.expression)) {
      newErrors.expression = 'Please select a valid expression';
    }

    if (typeof formData.target !== 'number' || !Number.isInteger(formData.target) || formData.target < 0) {
      newErrors.target = 'Target must be a non-negative integer';
    }

    if (!isValidWeightValue(formData.weight)) {
      newErrors.weight = 'Weight must be a valid number, Infinity, or -Infinity';
    } else {
      // Additional check for |x - T|^2 expression: weight must be non-positive
      if (formData.expression === '|x - T|^2' && !isWeightNonPositive(formData.weight)) {
        newErrors.weight = 'Weight must be non-positive for shift count with "|x - T|^2"';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildShiftCountFromForm = (): ShiftCountPreference => {
    const sortedCountShiftTypes = sortIdsByEntryOrder(formData.count_shift_types, shiftTypeEntries);
    const { coefficients: countShiftTypeCoefficients } = validateCoefficientPairs(
      sortedCountShiftTypes,
      formData.count_shift_type_coefficients,
      shiftTypeData
    );

    return {
      type: SHIFT_COUNT,
      description: formData.description,
      person: formData.person,
      countDates: formData.count_dates,
      // updatePreferencesByType normalizes this and countShiftTypeCoefficients to canonical entry order.
      countShiftTypes: formData.count_shift_types,
      ...(countShiftTypeCoefficients.length > 0 ? { countShiftTypeCoefficients } : {}),
      ...(formData.hours_contract ? { hoursContract: formData.hours_contract } : {}),
      expression: formData.expression,
      target: formData.target as number,
      weight: formData.weight as number
    };
  };

  function saveDraft() {
    // A just-marked count must have its contract unit explicitly confirmed before
    // it can persist — otherwise the prefilled guess (possibly wrong for a
    // reopened unmarked count) would be saved with no author decision. Gates the
    // Save button AND the Enter-key path.
    if (isDeclaringUnit) return;
    if (!validateForm()) return;

    const newShiftCount = buildShiftCountFromForm();

    const wasEditing = editingIndex !== null;
    if (wasEditing) {
      // Edit existing shift count
      const newShiftCounts = [...shiftCounts];
      newShiftCounts[editingIndex] = newShiftCount;
      updateShiftCounts(newShiftCounts);
    } else {
      // Add new shift count
      updateShiftCounts([...shiftCounts, newShiftCount]);
    }

    setIsFormVisible(false);
    resetForm();
    // Restore scroll position if we were editing
    if (wasEditing) {
      restoreScrollPosition();
    }
  }

  function handleSave() {
    saveDraft();
  }

  // Handle global keydown for Enter/Escape when form is visible
  useEffect(() => {
    if (!isFormVisible) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isImeCompositionKeyEvent(e)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  });

  const dismissEditingDraft = () => {
    if (isFormVisible) {
      handleCancel();
    }
  };

  const handleDuplicate = (index: number) => {
    dismissEditingDraft();
    duplicatePreferenceByType(SHIFT_COUNT, index);
  };

  const handleDelete = (index: number) => {
    dismissEditingDraft();
    const newShiftCounts = shiftCounts.filter((_, i) => i !== index);
    updateShiftCounts(newShiftCounts);
  };

  const handleReorder = (newShiftCounts: ShiftCountPreference[]) => {
    dismissEditingDraft();
    updateShiftCounts(newShiftCounts);
  };

  const handleArrayFieldToggle = (field: 'person' | 'count_dates' | 'count_shift_types', id: string) => {
    setErrors(prev => ({
      ...prev,
      [field]: '',
      ...(field === 'count_shift_types' ? {
        count_shift_type_coefficients: '',
        count_shift_type_coefficients_by_id: {},
      } : {})
    }));
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].includes(id)
        ? prev[field].filter(v => v !== id)
        : [...prev[field], id],
      ...(field === 'count_shift_types' ? {
        count_shift_type_coefficients: syncCoefficientPairs(
          prev.count_shift_types.includes(id)
            ? prev.count_shift_types.filter(v => v !== id)
            : [...prev.count_shift_types, id],
          prev.count_shift_type_coefficients,
          shiftTypeData
        )
      } : {})
    }));
  };

  const clearCoefficientError = (shiftTypeId: string) => {
    setErrors(prev => {
      const nextCoefficientErrors = { ...prev.count_shift_type_coefficients_by_id };
      delete nextCoefficientErrors[shiftTypeId];

      return {
        ...prev,
        count_shift_type_coefficients: Object.values(nextCoefficientErrors).join('\n'),
        count_shift_type_coefficients_by_id: nextCoefficientErrors
      };
    });
  };

  const handleToggleHoursContract = () => {
    setUnitConversionError(null);
    if (formData.hours_contract) {
      // Unmark: drop the metadata but keep the private toggle on the contract's
      // unit, so the coefficients (stored in that unit) don't silently change
      // meaning; the toggle governs the unit again for this now-unmarked count.
      setPrivateUnit(formData.hours_contract.unit);
      setIsDeclaringUnit(false);
      setFormData(prev => ({ ...prev, hours_contract: undefined }));
      return;
    }
    // Mark: enter declaration mode. Pre-fill the session's best-guess unit, but
    // it is NOT authoritative (a reopened unmarked count has no real signal) —
    // the author confirms/declares which unit the existing coefficients are in,
    // with the LEAVE-credit preview making a wrong pick immediately visible.
    setIsDeclaringUnit(true);
    setFormData(prev => ({ ...prev, hours_contract: { unit: privateUnit } }));
  };

  const handleSelectContractUnit = (nextUnit: HoursContractUnit) => {
    const currentUnit = formData.hours_contract?.unit;
    if (!currentUnit) return;

    // Declaration: while confirming the mark-time unit, picking a unit states
    // which unit the existing coefficients are already in — no rescale, so a
    // correction (e.g. hour-authored values wrongly pre-filled as half-hour)
    // never corrupts them.
    if (isDeclaringUnit) {
      setIsDeclaringUnit(false);
      setUnitConversionError(null);
      setPrivateUnit(nextUnit);
      if (nextUnit !== currentUnit) {
        setFormData(prev => ({ ...prev, hours_contract: { unit: nextUnit } }));
      }
      return;
    }

    if (currentUnit === nextUnit) return;

    // Conversion: re-express the same hours in the new unit. If any value cannot
    // land on a whole number (or a blank concrete slot's implicit 1 cannot), block
    // and keep the count in its current unit — never a mixed-unit intermediate.
    const conversion = convertCountToUnit(
      formData.count_shift_type_coefficients,
      formData.target,
      currentUnit,
      nextUnit,
      concreteShiftTypeIds
    );
    if (!conversion.ok) {
      setUnitConversionError(
        `Cannot switch to ${nextUnit}: ${conversion.blocked.join(', ')} do not convert to a whole number in ${nextUnit} units. Adjust them first.`
      );
      return;
    }

    setUnitConversionError(null);
    setPrivateUnit(nextUnit);
    setErrors(prev => ({ ...prev, target: '', count_shift_type_coefficients: '', count_shift_type_coefficients_by_id: {} }));
    setFormData(prev => ({
      ...prev,
      hours_contract: { unit: nextUnit },
      count_shift_type_coefficients: conversion.coefficients,
      target: conversion.target,
    }));
  };

  // Guard fix: credit LEAVE in the count's own (read-only) contract unit. Adds
  // LEAVE to the counted shift types and upserts its coefficient, preserving
  // every existing pair (guard-tech-plan "The fix"; D6). The advisory clears on
  // the next render because LEAVE is now present.
  const handleAddLeaveCredit = () => {
    const unit = formData.hours_contract?.unit;
    if (!unit) return;
    // The credit amount depends on the contract unit; don't act on an
    // unconfirmed declaration (the advisory is hidden in that state too).
    if (isDeclaringUnit) return;
    const coefficient = getLeaveCreditCoefficient(unit);
    clearCoefficientError(LEAVE);
    setFormData(prev => ({
      ...prev,
      count_shift_types: prev.count_shift_types.includes(LEAVE)
        ? prev.count_shift_types
        : [...prev.count_shift_types, LEAVE],
      count_shift_type_coefficients: upsertCoefficientPair(
        prev.count_shift_type_coefficients,
        LEAVE,
        coefficient
      ),
    }));
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-800">Shift Counts</h1>
          {instructions.length > 0 && (
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              title="Toggle instructions"
            >
              <FiHelpCircle className="h-6 w-6" />
            </button>
          )}
        </div>
        <div className="flex gap-4">
          <ToggleButton
            label="Add Shift Count"
            isToggled={isFormVisible}
            onToggle={() => {
              if (isFormVisible) {
                handleCancel();
              } else {
                handleStartAdd();
              }
            }}
          />
        </div>
      </div>

      {showInstructions && instructions.length > 0 && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-blue-800 mb-3">Instructions</h3>
          <ul className="space-y-2 text-sm text-blue-700">
            {instructions.map((instruction, index) => (
              <li key={index}>• {instruction}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Add/Edit Form */}
      {isFormVisible && (
        <div className="mb-6 bg-white shadow-md rounded-lg overflow-hidden">
          <div className="px-6 py-4">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">
              {editingIndex !== null ? 'Edit Shift Count' : 'Add New Shift Count'}
            </h2>

            <div className="space-y-6">
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="block w-full px-4 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg shadow-sm transition-colors duration-200 ease-in-out focus:border-blue-500 focus:ring-blue-200 placeholder-gray-400 focus:outline-none focus:ring-2 hover:border-gray-400"
                  placeholder="e.g., Working shifts should be close to the average"
                />
              </div>

              {/* People */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  People *
                </label>
                {peopleData.items.length === 0 && peopleData.groups.length === 0 ? (
                  <div className="text-sm text-gray-500 italic p-4 text-center border border-gray-200 rounded-lg bg-gray-50">
                    No people available. Please set up people in the{' '}
                    <Link href="/people" className="text-blue-600 hover:text-blue-800 underline">
                      People
                    </Link>{' '}
                    tab first.
                  </div>
                ) : (
                  <CheckboxList
                    items={[
                      ...peopleData.items.map(person => ({
                        id: person.id,
                        description: person.description
                      })),
                      ...peopleData.groups.map(group => ({
                        id: group.id,
                        description: group.description
                      }))
                    ]}
                    selectedIds={formData.person}
                    onToggle={(id) => handleArrayFieldToggle('person', id)}
                    label=""
                  />
                )}
                {errors.person && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <FiAlertCircle className="h-4 w-4" />
                    {errors.person}
                  </p>
                )}
              </div>

              {/* Count Dates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Count Dates *
                </label>
                <div className="max-h-32 overflow-y-auto">
                  {dateData.items.length === 0 && dateData.groups.length === 0 ? (
                    <div className="text-sm text-gray-500 italic p-4 text-center border border-gray-200 rounded-lg bg-gray-50">
                      No dates available. Please set up dates in the{' '}
                      <Link href="/dates" className="text-blue-600 hover:text-blue-800 underline">
                        Dates
                      </Link>{' '}
                      tab first.
                    </div>
                  ) : (
                    <CheckboxList
                      items={[
                        ...dateData.items.map(date => ({
                          id: date.id,
                          description: date.description
                        })),
                        ...dateData.groups.map(group => ({
                          id: group.id,
                          description: group.description
                        }))
                      ]}
                      selectedIds={formData.count_dates}
                      onToggle={(id) => handleArrayFieldToggle('count_dates', id)}
                      label=""
                    />
                  )}
                </div>
                {errors.count_dates && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <FiAlertCircle className="h-4 w-4" />
                    {errors.count_dates}
                  </p>
                )}
              </div>

              {/* Count Shift Types */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Count Shift Types *
                </label>
                {shiftTypeData.items.length === 0 && shiftTypeData.groups.length === 0 ? (
                  <div className="text-sm text-gray-500 italic p-4 text-center border border-gray-200 rounded-lg bg-gray-50">
                    No shift types available. Please set up shift types in the{' '}
                    <Link href="/shift-types" className="text-blue-600 hover:text-blue-800 underline">
                      Shift Types
                    </Link>{' '}
                    tab first.
                  </div>
                ) : (
                  <CheckboxList
                    items={[
                      ...shiftTypeData.items.map(shiftType => ({
                        id: shiftType.id,
                        description: shiftType.description
                      })),
                      ...shiftTypeData.groups.map(group => ({
                        id: group.id,
                        description: group.description
                      }))
                    ]}
                    selectedIds={formData.count_shift_types}
                    onToggle={(id) => handleArrayFieldToggle('count_shift_types', id)}
                    label=""
                                      />
                )}
                {errors.count_shift_types && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <FiAlertCircle className="h-4 w-4" />
                    {errors.count_shift_types}
                  </p>
                )}
              </div>

              {/* Hours contract */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!formData.hours_contract}
                    onChange={handleToggleHoursContract}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  This count enforces contracted monthly hours
                </label>
                {formData.hours_contract && (
                  <div className="mt-3">
                    <span className="block text-xs font-medium text-gray-600 mb-1">
                      {isDeclaringUnit ? 'Which unit are these coefficients already in?' : 'Contract unit'}
                    </span>
                    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="group" aria-label="Contract unit">
                      {HOURS_CONTRACT_UNITS.map(unit => (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => handleSelectContractUnit(unit)}
                          className={`px-3 py-1.5 text-sm transition-colors ${
                            formData.hours_contract?.unit === unit
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs font-medium text-gray-700">
                      LEAVE will count {LEAVE_CREDIT_MINUTES / 60}h = {getLeaveCreditCoefficient(formData.hours_contract.unit)} {formData.hours_contract.unit} units
                    </p>
                    <p className="mt-1 text-xs text-gray-500 italic">
                      {isDeclaringUnit
                        ? 'Confirm the unit your coefficients are already in — the values are not changed.'
                        : 'This unit governs every coefficient on the count. Switching it converts the coefficients and target together.'}
                    </p>
                    {unitConversionError && (
                      <p className="mt-2 text-sm text-amber-700 flex items-center gap-1">
                        <FiAlertCircle className="h-4 w-4" />
                        {unitConversionError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <CountShiftTypeCoefficientFields
                  selectedShiftTypeIds={formData.count_shift_types}
                  coefficients={formData.count_shift_type_coefficients}
                  shiftTypeEntries={shiftTypeEntries}
                  shiftTypeData={shiftTypeData}
                  errorsById={errors.count_shift_type_coefficients_by_id}
                  enableDurationAutofill
                  autofillDisabled={isDeclaringUnit}
                  controlledUnit={formData.hours_contract?.unit}
                  privateUnit={privateUnit}
                  onPrivateUnitChange={setPrivateUnit}
                  onChange={(coefficients, changedShiftTypeId) => {
                    clearCoefficientError(changedShiftTypeId);
                    setFormData(prev => ({
                      ...prev,
                      count_shift_type_coefficients: coefficients,
                    }));
                  }}
                />
                {errors.count_shift_type_coefficients && (
                  <div className="mt-2 space-y-1">
                    {errors.count_shift_type_coefficients.split('\n').map(error => (
                      <p key={error} className="text-sm text-red-600 flex items-center gap-1">
                        <FiAlertCircle className="h-4 w-4" />
                        {error}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Uncredited-leave advisory: amber, non-blocking — never gates save.
                  Withheld while the unit is still being declared, since the credit
                  amount depends on the (unconfirmed) contract unit. */}
              {editingLeaveWarning && formData.hours_contract && !isDeclaringUnit && (
                <LeaveCreditAdvisory
                  affectedPeople={editingLeaveWarning.affectedPeople}
                  unit={formData.hours_contract.unit}
                  coefficient={getLeaveCreditCoefficient(formData.hours_contract.unit)}
                  onAddLeave={handleAddLeaveCredit}
                />
              )}

              {/* Expression and Target */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Expression *
                  </label>
                  <select
                    value={formData.expression}
                    onChange={(e) => {
                      setErrors(prev => ({ ...prev, expression: '' }));
                      setFormData(prev => ({ ...prev, expression: e.target.value as typeof SUPPORTED_EXPRESSIONS[number] }));
                    }}
                    className={`block w-full px-4 py-2 text-sm text-gray-900 bg-white border rounded-lg shadow-sm transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 hover:border-gray-400 ${
                      errors.expression
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                        : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'
                    }`}
                  >
                    {SUPPORTED_EXPRESSIONS.map(expr => (
                      <option key={expr} value={expr}>{expr}</option>
                    ))}
                  </select>
                  {errors.expression && (
                    <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                      <FiAlertCircle className="h-4 w-4" />
                      {errors.expression}
                    </p>
                  )}
                </div>

                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Value *
                  </label>
                  <NumberInput
                    min="0"
                    step="1"
                    value={formData.target}
                    onChange={(e) => {
                      const value = e.target.value;
                      setErrors(prev => ({ ...prev, target: '' }));
                      if (value === '') {
                        setFormData(prev => ({ ...prev, target: value }));
                      } else {
                        const numValue = Number(value);
                        if (Number.isInteger(numValue)) {
                          setFormData(prev => ({ ...prev, target: numValue }));
                        } else {
                          setFormData(prev => ({ ...prev, target: value }));
                        }
                      }
                    }}
                    className={`block w-full px-4 py-2 text-sm text-gray-900 bg-white border rounded-lg shadow-sm transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 hover:border-gray-400 ${
                      errors.target
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                        : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'
                    }`}
                    placeholder="e.g., 5"
                  />
                  {errors.target && (
                    <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                      <FiAlertCircle className="h-4 w-4" />
                      {errors.target}
                    </p>
                  )}
                </div>
              </div>

              {/* Weight */}
              <WeightInput
                value={formData.weight}
                onChange={(value) => {
                  setErrors(prev => ({ ...prev, weight: '' }));
                  setFormData(prev => ({ ...prev, weight: value }));
                }}
                error={errors.weight}
                placeholder="e.g., -1, -10, ∞"
              />

              {/* Action Buttons */}
              <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {isDeclaringUnit && (
                    <p className="text-sm text-amber-700 flex items-center gap-1">
                      <FiAlertCircle className="h-4 w-4" />
                      Confirm the coefficient unit to continue.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isDeclaringUnit}
                    className={`px-6 py-2 rounded-md transition-colors ${
                      isDeclaringUnit
                        ? 'bg-blue-300 text-white cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {editingIndex !== null ? 'Update' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shift Counts List */}
      <DraggableCardList
        title="Current Shift Counts"
        items={shiftCounts}
        emptyMessage='No shift counts defined yet. Click "Add Shift Count" to get started.'
        onEdit={handleStartEdit}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onReorder={handleReorder}
        renderContent={(shiftCount, index) => (
          <>
            {savedLeaveWarningsByIndex.has(index) && (
              <div className="mb-3">
                <LeaveCreditBadge />
              </div>
            )}
            {shiftCount.description && (
              <h4 className="font-medium text-gray-900 mb-3">{shiftCount.description}</h4>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm text-gray-600">
              <div>
                <span className="font-medium">People:</span>{' '}
                {shiftCount.person.join(', ')}
              </div>
              <div>
                <span className="font-medium">Expression:</span> <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm font-mono">{shiftCount.expression.replace('T', shiftCount.target.toString())}</code>
              </div>
              <div>
                <span className="font-medium">Weight:</span> {getWeightWithPositivePrefix(shiftCount.weight)}
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <span className="font-medium">Count Dates:</span>{' '}
                {shiftCount.countDates.join(', ')}
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <span className="font-medium">Count Shift Types:</span>{' '}
                {shiftCount.countShiftTypes.join(', ')}
              </div>
              {shiftCount.countShiftTypeCoefficients && (
                <div className="md:col-span-2 lg:col-span-3">
                  <span className="font-medium">Coefficients:</span>{' '}
                  {shiftCount.countShiftTypeCoefficients.map(([id, coefficient]) => `[${id}, ${coefficient}]`).join(', ')}
                </div>
              )}
            </div>
          </>
        )}
      />
    </div>
  );
}
