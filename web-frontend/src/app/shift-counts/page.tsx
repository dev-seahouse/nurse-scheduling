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
  Expression,
  ShiftCountPreference,
  SHIFT_COUNT,
  SUPPORTED_EXPRESSIONS
} from '@/types/scheduling';
import { CheckboxList } from '@/components/CheckboxList';
import { CountShiftTypeCoefficientFields } from '@/components/CountShiftTypeCoefficientFields';
import { DraggableCardList } from '@/components/DraggableCardList';
import { LeaveCreditBadge } from '@/components/LeaveCreditAdvisory';
import ToggleButton from '@/components/ToggleButton';
import NumberInput from '@/components/NumberInput';
import { isValidWeightValue, getWeightWithPositivePrefix, isWeightNonPositive } from '@/utils/numberParsing';
import WeightInput from '@/components/WeightInput';
import { saveScrollPosition, restoreScrollPosition } from '@/utils/scrolling';
import { useTabSwitchWarning } from '@/utils/unsavedEditingState';
import { isImeCompositionKeyEvent } from '@/utils/keyboardEvents';
import { sortIdsByEntryOrder } from '@/utils/entityOrdering';
import { isReservedKeyword } from '@/utils/keywords';
import { findUncreditedLeaveWarnings } from '@/utils/leaveCreditWarning';
import {
  DraftShiftCountTypeCoefficient,
  syncCoefficientPairs,
  validateCoefficientPairs,
} from '@/utils/countShiftTypeCoefficients';
import { ContractedHoursEditor } from '@/app/shift-counts/ContractedHoursEditor';

// The guided/scalar editor authors only plain generic scalar counts. A marked
// hours contract or an advanced list-based count (array expression/target) is
// preserved losslessly in state but edited elsewhere: the guided Contracted
// Hours editor (WT4–WT7) and the read-only advanced-rule YAML fallback (WT6).
// WT3 keeps those opaque values intact and steers this editor away from them.
interface ShiftCountForm {
  description: string;
  person: string[];
  count_dates: string[];
  count_shift_types: string[];
  count_shift_type_coefficients: DraftShiftCountTypeCoefficient[];
  expression: Expression;
  target: number | string;
  weight: number | string;
}

// True when a count is not a plain generic scalar count — either it carries the
// hours-contract marker, or its expression/target is a backend-valid list. Such
// counts are not editable in this scalar form (WT3); they round-trip untouched.
function isAdvancedShiftCount(shiftCount: ShiftCountPreference): boolean {
  return (
    shiftCount.hoursContract !== undefined ||
    Array.isArray(shiftCount.expression) ||
    Array.isArray(shiftCount.target)
  );
}

// Render a count's expression(s)/target(s) for the summary card, narrowing
// before any string operation and never flattening a valid array. A Range pair
// (`[x >= T, x <= T]` / `[min, max]`) renders each bound; a scalar renders once.
function describeExpressionTarget(
  expression: Expression | Expression[],
  target: number | number[]
): string {
  const expressions = Array.isArray(expression) ? expression : [expression];
  const targets = Array.isArray(target) ? target : [target];
  if (expressions.length === targets.length) {
    return expressions.map((expr, index) => expr.replace('T', String(targets[index]))).join(', ');
  }
  // Shape mismatch (opaque advanced rule): show both sides raw rather than guess.
  return `${expressions.join(', ')} (target ${targets.join(', ')})`;
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
  const [isContractedHoursVisible, setIsContractedHoursVisible] = useState(false);
  const [contractedHoursIndex, setContractedHoursIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  // Set when Edit is invoked on an advanced/marked count the scalar editor does
  // not own; surfaced non-destructively instead of opening (and corrupting) it.
  const [advancedEditNotice, setAdvancedEditNotice] = useState<string | null>(null);
  const [formData, setFormData] = useState<ShiftCountForm>({
    description: '',
    person: [],
    count_dates: [],
    count_shift_types: [],
    count_shift_type_coefficients: [],
    expression: 'x >= T',
    target: 0,
    weight: -1
  });
  const [errors, setErrors] = useState<ShiftCountErrors>({});
  const isEditorOpen = isFormVisible || isContractedHoursVisible;
  useTabSwitchWarning(isEditorOpen);
  const shiftTypeEntries = [...shiftTypeData.items, ...shiftTypeData.groups];

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

  // List-card badges read the saved preferences: sublist index → warning. Only
  // marked counts warn, so imported contracts still surface the footgun even
  // though this scalar editor cannot author the marker.
  const savedLeaveWarningsByIndex = useMemo(() => {
    const warnings = findUncreditedLeaveWarnings({ preferences: allPreferences, ...leaveWarningEnv });
    return new Map(warnings.map(warning => [warning.shiftCountListIndex, warning]));
  }, [allPreferences, leaveWarningEnv]);

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
      expression: 'x >= T',
      target: 0,
      weight: -1
    });
    setErrors({});
    setEditingIndex(null);
  };

  const handleStartAdd = () => {
    setAdvancedEditNotice(null);
    setIsContractedHoursVisible(false);
    setContractedHoursIndex(null);
    resetForm();
    setIsFormVisible(true);
  };

  const handleStartAddContractedHours = () => {
    setAdvancedEditNotice(null);
    setIsFormVisible(false);
    resetForm();
    setContractedHoursIndex(null);
    setIsContractedHoursVisible(true);
  };

  const handleStartEdit = (index: number) => {
    const shiftCount = shiftCounts[index];
    // The scalar editor only owns plain generic scalar counts. A marked or
    // list-based count is preserved untouched and steered to its own surface.
    if (shiftCount.hoursContract) {
      setAdvancedEditNotice(null);
      setIsFormVisible(false);
      resetForm();
      setContractedHoursIndex(index);
      setIsContractedHoursVisible(true);
      saveScrollPosition();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    if (isAdvancedShiftCount(shiftCount)) {
      setAdvancedEditNotice(
        'This is an advanced list-based Shift Count. It is read-only here so every indexed expression and target stays unchanged.'
      );
      return;
    }
    setAdvancedEditNotice(null);
    setIsContractedHoursVisible(false);
    setContractedHoursIndex(null);
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
      expression: Array.isArray(shiftCount.expression) ? 'x >= T' : shiftCount.expression,
      target: typeof shiftCount.target === 'number' ? shiftCount.target : 0,
      weight: shiftCount.weight
    });
    setEditingIndex(index);
    setIsFormVisible(true);
    setErrors({});
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

  function handleCancelContractedHours() {
    const wasEditing = contractedHoursIndex !== null;
    setIsContractedHoursVisible(false);
    setContractedHoursIndex(null);
    if (wasEditing) {
      restoreScrollPosition();
    }
  }

  function handleCommitContractedHours(preference: ShiftCountPreference) {
    const nextShiftCounts = [...shiftCounts];
    if (contractedHoursIndex === null) {
      nextShiftCounts.push(preference);
    } else {
      nextShiftCounts[contractedHoursIndex] = preference;
    }
    updateShiftCounts(nextShiftCounts);
    handleCancelContractedHours();
  }

  function handleConvertGenericToContractedHours() {
    if (editingIndex === null) return;
    setIsFormVisible(false);
    setContractedHoursIndex(editingIndex);
    setIsContractedHoursVisible(true);
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
      expression: formData.expression,
      target: formData.target as number,
      weight: formData.weight as number
    };
  };

  function saveDraft() {
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

  // Handle editor shortcuts before the provider's global history listener. A
  // generic draft has no local history, so Ctrl/Cmd-Z/Y is intentionally consumed.
  useEffect(() => {
    if (!isFormVisible) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === 'z' || key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      } else if (e.key === 'Enter' && !isImeCompositionKeyEvent(e)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  });

  const dismissEditingDraft = () => {
    if (isFormVisible) {
      handleCancel();
    }
    if (isContractedHoursVisible) {
      handleCancelContractedHours();
    }
  };

  const handleDuplicate = (index: number) => {
    dismissEditingDraft();
    // Store-level deep copy preserves the marker and any list expression/target.
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
          <ToggleButton
            label="Add Contracted Hours"
            isToggled={isContractedHoursVisible}
            onToggle={() => {
              if (isContractedHoursVisible) {
                handleCancelContractedHours();
              } else {
                handleStartAddContractedHours();
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

      {advancedEditNotice && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-2">
          <FiAlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800">{advancedEditNotice}</p>
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

              <div>
                <CountShiftTypeCoefficientFields
                  selectedShiftTypeIds={formData.count_shift_types}
                  coefficients={formData.count_shift_type_coefficients}
                  shiftTypeEntries={shiftTypeEntries}
                  shiftTypeData={shiftTypeData}
                  errorsById={errors.count_shift_type_coefficients_by_id}
                  enableDurationAutofill
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
                      setFormData(prev => ({ ...prev, expression: e.target.value as Expression }));
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
              <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-end">
                <div className="flex flex-wrap justify-end gap-3">
                  {editingIndex !== null && (
                    <button
                      type="button"
                      onClick={handleConvertGenericToContractedHours}
                      className="px-4 py-2 text-blue-700 underline"
                    >
                      Convert to Contracted Hours
                    </button>
                  )}
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-6 py-2 rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {editingIndex !== null ? 'Update' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isContractedHoursVisible && (
        <ContractedHoursEditor
          initialPreference={contractedHoursIndex === null ? undefined : shiftCounts[contractedHoursIndex]}
          editing={contractedHoursIndex !== null}
          peopleData={peopleData}
          dateData={dateData}
          shiftTypeData={shiftTypeData}
          leaveAffectedPeople={contractedHoursIndex === null
            ? []
            : savedLeaveWarningsByIndex.get(contractedHoursIndex)?.affectedPeople ?? []}
          onCancel={handleCancelContractedHours}
          onCommit={handleCommitContractedHours}
        />
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
            <div className="mb-3 flex flex-wrap gap-2">
              {savedLeaveWarningsByIndex.has(index) && <LeaveCreditBadge />}
              {shiftCount.hoursContract && (
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
                  Contracted Hours ({shiftCount.hoursContract.policy})
                </span>
              )}
              {!shiftCount.hoursContract && (Array.isArray(shiftCount.expression) || Array.isArray(shiftCount.target)) && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 border border-gray-300">
                  Advanced (list)
                </span>
              )}
            </div>
            {shiftCount.description && (
              <h4 className="font-medium text-gray-900 mb-3">{shiftCount.description}</h4>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm text-gray-600">
              <div>
                <span className="font-medium">People:</span>{' '}
                {shiftCount.person.join(', ')}
              </div>
              <div>
                <span className="font-medium">Expression:</span> <code className="px-1.5 py-0.5 bg-gray-100 rounded text-sm font-mono">{describeExpressionTarget(shiftCount.expression, shiftCount.target)}</code>
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
              {!shiftCount.hoursContract && (Array.isArray(shiftCount.expression) || Array.isArray(shiftCount.target)) && (
                <div className="md:col-span-2 lg:col-span-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="font-medium text-gray-800">Advanced expressions and targets</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 font-mono text-xs text-gray-700">
                    {Array.from({ length: Math.max(
                      Array.isArray(shiftCount.expression) ? shiftCount.expression.length : 1,
                      Array.isArray(shiftCount.target) ? shiftCount.target.length : 1,
                    ) }, (_, pairIndex) => {
                      const expression = Array.isArray(shiftCount.expression)
                        ? shiftCount.expression[pairIndex]
                        : shiftCount.expression;
                      const target = Array.isArray(shiftCount.target)
                        ? shiftCount.target[pairIndex]
                        : shiftCount.target;
                      return <li key={pairIndex}>{String(expression)} → {String(target)}</li>;
                    })}
                  </ol>
                  <Link href="/save-and-load" className="mt-3 inline-block text-sm text-blue-700 underline">
                    Edit in YAML
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      />
    </div>
  );
}
