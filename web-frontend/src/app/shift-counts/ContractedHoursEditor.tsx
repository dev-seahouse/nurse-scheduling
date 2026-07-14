/*
 * This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
 *
 * Copyright (C) 2023-2026 Johnson Sun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiAlertCircle, FiAlertTriangle } from "react-icons/fi";

import { CheckboxList } from "@/components/CheckboxList";
import { LeaveCreditAdvisory } from "@/components/LeaveCreditAdvisory";
import NumberInput from "@/components/NumberInput";
import { Group, Item, ShiftCountPreference, SHIFT_COUNT } from "@/types/scheduling";
import {
  compileContractedHoursPolicy,
  confirmRefresh,
  ContractedHoursDraft,
  ContractedHoursError,
  ContractedHoursPreference,
  ContractedHoursRefreshPreview,
  ContractedHoursScenario,
  convertContractedHoursToGeneric,
  expandContractedHoursShiftTypes,
  previewGenericToContractedHours,
  previewRefresh,
  reconcileContractedHoursDraftSelectors,
  validateContractedHours,
} from "@/utils/contractedHours";
import { LEAVE_CREDIT_HALF_HOUR_UNITS } from "@/utils/countShiftTypeCoefficients";
import { ALL, LEAVE, OFF } from "@/utils/keywords";

interface EntityData {
  items: Item[];
  groups: Group[];
}

interface ContractedHoursEditorProps {
  initialPreference?: ShiftCountPreference;
  editing: boolean;
  peopleData: EntityData;
  dateData: EntityData;
  shiftTypeData: EntityData;
  leaveAffectedPeople?: string[];
  onCancel: () => void;
  onCommit: (preference: ShiftCountPreference) => void;
}

interface DraftErrors {
  people?: string;
  dates?: string;
  contract?: ContractedHoursError;
}

interface RefreshHistory {
  undo: ContractedHoursDraft | null;
  redo: ContractedHoursDraft | null;
}

const EMPTY_HISTORY: RefreshHistory = { undo: null, redo: null };

function targetUnits(draft: ContractedHoursDraft): [number, number?] {
  if (Array.isArray(draft.target)) {
    return [draft.target[0], draft.target[1]];
  }
  return [draft.target];
}

function hourValue(units: number | undefined): number | "" {
  return typeof units === "number" && Number.isFinite(units) ? units / 2 : "";
}

function parseHours(value: string): number {
  if (value === "") {
    return Number.NaN;
  }
  return Number(value) * 2;
}

function formatWorkingTime(item: Item | undefined): string {
  if (!item || typeof item.durationMinutes !== "number") {
    return "Not set";
  }
  const hours = Math.floor(item.durationMinutes / 60);
  const minutes = item.durationMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function buildNewDraft(): ContractedHoursDraft {
  return {
    type: SHIFT_COUNT,
    description: "",
    person: [],
    countDates: [],
    countShiftTypes: [],
    countShiftTypeCoefficients: [],
    hoursContract: { unit: "half-hour", policy: "exact" },
    expression: "x = T",
    target: 0,
    weight: Number.POSITIVE_INFINITY,
  };
}

function buildInitialState(
  initialPreference: ShiftCountPreference | undefined,
  scenario: ContractedHoursScenario,
): { draft: ContractedHoursDraft; conversionChanges: string[] | null } {
  if (!initialPreference) {
    return { draft: buildNewDraft(), conversionChanges: null };
  }
  if (initialPreference.hoursContract) {
    return {
      draft: structuredClone(initialPreference) as ContractedHoursDraft,
      conversionChanges: null,
    };
  }

  const scalarTarget = Array.isArray(initialPreference.target) ? 0 : initialPreference.target;
  const preview = previewGenericToContractedHours(
    initialPreference,
    { policy: "exact", totalHours: scalarTarget / 2 },
    scenario,
    { deriveCoefficients: false },
  );
  if (!preview.ok) {
    return {
      draft: {
        ...structuredClone(initialPreference),
        countShiftTypeCoefficients: structuredClone(initialPreference.countShiftTypeCoefficients ?? []),
        hoursContract: { unit: "half-hour", policy: "exact" },
        expression: "x = T",
        target: scalarTarget,
        weight: Number.POSITIVE_INFINITY,
      },
      conversionChanges: [preview.error.message],
    };
  }
  return {
    draft: preview.value.replacementDraft,
    conversionChanges: preview.value.changes.map(change => change.field),
  };
}

function PreviewRows({ preview }: { preview: ContractedHoursRefreshPreview }) {
  const sections = [
    ["Added", preview.added],
    ["Removed", preview.removed],
    ["Changed", preview.changed],
    ["Unchanged", preview.unchanged],
    ["Non-derivable", preview.nonDerivable],
  ] as const;

  return (
    <div className="space-y-3">
      {sections.map(([label, rows]) => (
        <section key={label} aria-label={`${label} coefficients`}>
          <h4 className="text-sm font-semibold text-gray-800">{label} ({rows.length})</h4>
          {rows.length > 0 ? (
            <ul className="mt-1 space-y-1 text-sm text-gray-700">
              {rows.map(row => (
                <li key={`${label}-${row.id}`}>
                  <code className="font-mono">{row.id}</code>: {String(row.before || "—")} → {String(row.after || "—")}
                  {row.blocking ? " (working time or an explicit coefficient is required)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function ContractedHoursEditor({
  initialPreference,
  editing,
  peopleData,
  dateData,
  shiftTypeData,
  leaveAffectedPeople = [],
  onCancel,
  onCommit,
}: ContractedHoursEditorProps) {
  const scenario = useMemo<ContractedHoursScenario>(
    () => ({ shiftTypes: shiftTypeData }),
    [shiftTypeData],
  );
  const initial = useMemo(
    () => buildInitialState(initialPreference, scenario),
    [initialPreference, scenario],
  );
  const [draft, setDraft] = useState<ContractedHoursDraft>(initial.draft);
  const [conversionPending, setConversionPending] = useState(initial.conversionChanges !== null);
  const [conversionChanges] = useState(initial.conversionChanges);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [refreshPreview, setRefreshPreview] = useState<ContractedHoursRefreshPreview | null>(null);
  const [refreshHistory, setRefreshHistory] = useState<RefreshHistory>(EMPTY_HISTORY);
  const [showSolverDetails, setShowSolverDetails] = useState(false);
  const [showConvertConfirmation, setShowConvertConfirmation] = useState(false);

  const expansion = useMemo(
    () => expandContractedHoursShiftTypes(shiftTypeData, draft.countShiftTypes),
    [draft.countShiftTypes, shiftTypeData],
  );
  const selectors = useMemo(() => {
    const choices = [
      ...shiftTypeData.items.filter(item => item.id !== OFF),
      ...shiftTypeData.groups.filter(group => group.id !== OFF),
    ];
    if (!choices.some(choice => choice.id === ALL)) {
      choices.push({ id: ALL, members: [], description: "All worked shift types" });
    }
    if (!choices.some(choice => choice.id === LEAVE)) {
      choices.push({ id: LEAVE, description: "Paid leave" });
    }
    return choices;
  }, [shiftTypeData]);
  const [minimumUnits, maximumUnits] = targetUnits(draft);
  const isRange = draft.hoursContract.policy === "range";
  const currentCoefficientIds = new Set(draft.countShiftTypeCoefficients.map(([id]) => id));
  const displayedCoefficientIds = expansion.ok
    ? [...expansion.value.displayIds, ...draft.countShiftTypeCoefficients
      .map(([id]) => id)
      .filter(id => !expansion.value.displayIds.includes(id))]
    : draft.countShiftTypeCoefficients.map(([id]) => id);
  const creditsLeave = expansion.ok && expansion.value.semanticIds.includes(LEAVE);
  const coefficientCoverage = useMemo(() => {
    if (!expansion.ok) {
      return null;
    }
    const requiredIds = new Set(expansion.value.displayIds);
    const occurrences = new Map<string, number>();
    draft.countShiftTypeCoefficients.forEach(([id]) => {
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    });
    const missing = expansion.value.displayIds.filter(id => !occurrences.has(id));
    const extra = [...occurrences.keys()].filter(id => !requiredIds.has(id));
    const duplicates = [...occurrences.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
    return {
      required: expansion.value.displayIds.length,
      missing,
      extra,
      duplicates,
    };
  }, [draft.countShiftTypeCoefficients, expansion]);
  const hasExactCoefficientCoverage = coefficientCoverage !== null
    && coefficientCoverage.missing.length === 0
    && coefficientCoverage.extra.length === 0
    && coefficientCoverage.duplicates.length === 0;

  const updateDraft = (updater: (current: ContractedHoursDraft) => ContractedHoursDraft) => {
    setDraft(current => updater(current));
    setRefreshHistory(EMPTY_HISTORY);
    setErrors(current => ({ ...current, contract: undefined }));
  };

  const undoRefresh = () => {
    if (!refreshHistory.undo) {
      return;
    }
    setDraft(_current => structuredClone(refreshHistory.undo ?? draft));
    setRefreshHistory({ undo: null, redo: structuredClone(draft) });
  };

  const redoRefresh = () => {
    if (!refreshHistory.redo) {
      return;
    }
    setDraft(_current => structuredClone(refreshHistory.redo ?? draft));
    setRefreshHistory({ undo: structuredClone(draft), redo: null });
  };

  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (key === "z") {
        undoRefresh();
      } else {
        redoRefresh();
      }
    };
    document.addEventListener("keydown", handleEditorShortcut, true);
    return () => document.removeEventListener("keydown", handleEditorShortcut, true);
  });

  const toggleSelector = (id: string) => {
    const nextSelectors = draft.countShiftTypes.includes(id)
      ? draft.countShiftTypes.filter(selector => selector !== id)
      : [...draft.countShiftTypes, id];
    if (nextSelectors.length === 0) {
      updateDraft(current => ({
        ...current,
        countShiftTypes: [],
        countShiftTypeCoefficients: [],
      }));
      return;
    }
    const reconciled = reconcileContractedHoursDraftSelectors(draft, nextSelectors, scenario);
    if (!reconciled.ok) {
      updateDraft(current => ({ ...current, countShiftTypes: nextSelectors }));
      setErrors(current => ({ ...current, contract: reconciled.error }));
      return;
    }
    if (!editing && !initialPreference) {
      const derived = previewRefresh(reconciled.value, scenario);
      updateDraft(() => derived.ok ? derived.value.replacementDraft : reconciled.value);
      return;
    }
    updateDraft(() => reconciled.value);
  };

  const setPolicy = (policy: "exact" | "range") => {
    const currentHours = hourValue(minimumUnits);
    const compiled = compileContractedHoursPolicy(
      policy === "exact"
        ? { policy, totalHours: currentHours === "" ? 0 : currentHours }
        : {
            policy,
            minimumHours: currentHours === "" ? 0 : currentHours,
            maximumHours: hourValue(maximumUnits) === "" ? (currentHours || 0) : hourValue(maximumUnits) as number,
          },
    );
    if (!compiled.ok) {
      setErrors(current => ({ ...current, contract: compiled.error }));
      return;
    }
    updateDraft(current => ({ ...current, ...compiled.value }) as ContractedHoursDraft);
  };

  const setGuidedHours = (index: 0 | 1, value: string) => {
    const units = parseHours(value);
    updateDraft(current => {
      if (current.hoursContract.policy === "exact") {
        return { ...current, target: units };
      }
      const currentTargets = Array.isArray(current.target) ? current.target : [current.target, current.target];
      const nextTargets: [number, number] = [currentTargets[0], currentTargets[1]];
      nextTargets[index] = units;
      return { ...current, target: nextTargets };
    });
  };

  const setRawTarget = (index: 0 | 1, value: string) => {
    const units = value === "" ? Number.NaN : Number(value);
    updateDraft(current => {
      if (current.hoursContract.policy === "exact") {
        return { ...current, target: units };
      }
      const currentTargets = Array.isArray(current.target) ? current.target : [current.target, current.target];
      const nextTargets: [number, number] = [currentTargets[0], currentTargets[1]];
      nextTargets[index] = units;
      return { ...current, target: nextTargets };
    });
  };

  const setCoefficient = (id: string, value: string) => {
    const coefficient = value === "" ? "" : Number(value);
    updateDraft(current => {
      const matches = current.countShiftTypeCoefficients.filter(([coefficientId]) => coefficientId === id);
      if (matches.length === 0) {
        return {
          ...current,
          countShiftTypeCoefficients: [...current.countShiftTypeCoefficients, [id, coefficient]],
        };
      }
      let replaced = false;
      return {
        ...current,
        countShiftTypeCoefficients: current.countShiftTypeCoefficients.map(entry => {
          if (entry[0] !== id || replaced) {
            return entry;
          }
          replaced = true;
          return [id, coefficient];
        }),
      };
    });
  };

  const openRefreshPreview = () => {
    const preview = previewRefresh(draft, scenario);
    if (!preview.ok) {
      setErrors(current => ({ ...current, contract: preview.error }));
      return;
    }
    setRefreshPreview(preview.value);
  };

  const confirmRefreshPreview = () => {
    if (!refreshPreview) {
      return;
    }
    const transaction = confirmRefresh(refreshPreview);
    setDraft(transaction.draft);
    setRefreshHistory({ undo: transaction.undoSnapshot, redo: null });
    setRefreshPreview(null);
    setErrors(current => ({ ...current, contract: undefined }));
  };

  const handleCommit = () => {
    const nextErrors: DraftErrors = {};
    if (draft.person.length === 0) {
      nextErrors.people = "At least one person must be selected.";
    }
    if (draft.countDates.length === 0) {
      nextErrors.dates = "At least one date must be selected.";
    }
    const validation = validateContractedHours(scenario, draft as ShiftCountPreference);
    if (!validation.ok) {
      nextErrors.contract = validation.error;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !validation.ok || validation.value.kind !== "contracted-hours") {
      return;
    }
    onCommit(validation.value.preference);
  };

  const addLeave = () => {
    if (!draft.countShiftTypes.includes(LEAVE)) {
      toggleSelector(LEAVE);
    }
  };

  return (
    <section className="mb-6 overflow-hidden rounded-lg bg-white shadow-md" aria-labelledby="contracted-hours-editor-title">
      <div className="space-y-6 px-6 py-5">
        <div>
          <h2 id="contracted-hours-editor-title" className="text-lg font-semibold text-gray-900">
            {editing ? "Edit Contracted Hours" : "Add Contracted Hours"}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Set a hard total for the selected dates. Values are authored in 30-minute steps.
          </p>
        </div>

        {conversionPending ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4" role="status">
            <h3 className="font-medium text-blue-900">Convert this Shift Count?</h3>
            <p className="mt-1 text-sm text-blue-800">
              The preview changes {conversionChanges?.join(", ")}. Selectors and list position are retained; no saved data changes until Update.
            </p>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={() => setConversionPending(false)} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Continue conversion
              </button>
              <button type="button" onClick={onCancel} className="rounded-md border border-blue-300 px-3 py-2 text-sm text-blue-900 hover:bg-blue-100">
                Cancel conversion
              </button>
            </div>
          </div>
        ) : null}

        <div aria-hidden={conversionPending} className={conversionPending ? "pointer-events-none opacity-50" : "space-y-6"}>
          <div>
            <label htmlFor="contract-description" className="mb-2 block text-sm font-medium text-gray-700">Description (optional)</label>
            <input
              id="contract-description"
              type="text"
              value={draft.description ?? ""}
              onChange={event => updateDraft(current => ({ ...current, description: event.target.value }))}
              className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700">Policy</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                <input type="radio" name="contract-policy" checked={!isRange} onChange={() => setPolicy("exact")} />
                Exact
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-800">
                <input type="radio" name="contract-policy" checked={isRange} onChange={() => setPolicy("range")} />
                Allowed range
              </label>
            </div>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="contract-minimum-hours" className="mb-2 block text-sm font-medium text-gray-700">
                {isRange ? "Minimum hours for current window" : "Exact total hours for current window"}
              </label>
              <NumberInput
                id="contract-minimum-hours"
                aria-describedby="contract-window-help"
                min="0"
                step="0.5"
                value={hourValue(minimumUnits)}
                onChange={event => setGuidedHours(0, event.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            {isRange ? (
              <div>
                <label htmlFor="contract-maximum-hours" className="mb-2 block text-sm font-medium text-gray-700">Maximum hours for current window</label>
                <NumberInput
                  id="contract-maximum-hours"
                  min="0"
                  step="0.5"
                  value={hourValue(maximumUnits)}
                  onChange={event => setGuidedHours(1, event.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            ) : null}
          </div>
          <p id="contract-window-help" className="text-xs text-gray-600">
            Current window: {draft.countDates.length} date selector{draft.countDates.length === 1 ? "" : "s"}. Raw solver values use half-hour counts and never rescale automatically.
          </p>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700">People</legend>
            <CheckboxList items={[...peopleData.items, ...peopleData.groups]} selectedIds={draft.person} onToggle={id => updateDraft(current => ({ ...current, person: current.person.includes(id) ? current.person.filter(value => value !== id) : [...current.person, id] }))} label="" />
            {errors.people ? <p className="mt-2 text-sm text-red-700" role="alert">{errors.people}</p> : null}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700">Count dates</legend>
            <CheckboxList items={[...dateData.items, ...dateData.groups]} selectedIds={draft.countDates} onToggle={id => updateDraft(current => ({ ...current, countDates: current.countDates.includes(id) ? current.countDates.filter(value => value !== id) : [...current.countDates, id] }))} label="" />
            {errors.dates ? <p className="mt-2 text-sm text-red-700" role="alert">{errors.dates}</p> : null}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700">Shift selectors</legend>
            <CheckboxList items={selectors} selectedIds={draft.countShiftTypes} onToggle={toggleSelector} label="" />
            <p className="mt-2 text-xs text-gray-600">
              Groups and ALL remain dynamic. If their membership changes, this contract may require Refresh before it can be updated.
            </p>
          </fieldset>

          <section aria-labelledby="current-expansion-title" className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 id="current-expansion-title" className="text-sm font-semibold text-gray-900">Current concrete expansion</h3>
            {expansion.ok ? (
              <>
                <p className="mt-2 text-sm text-gray-700">{expansion.value.displayIds.join(", ") || "No concrete shifts"}</p>
                {coefficientCoverage ? (
                  <p className={hasExactCoefficientCoverage ? "mt-2 text-sm text-green-800" : "mt-2 text-sm text-red-700"} role="status">
                    {hasExactCoefficientCoverage
                      ? `Exact coefficient coverage for ${coefficientCoverage.required} concrete shift${coefficientCoverage.required === 1 ? "" : "s"}.`
                      : `Coefficient coverage needs repair: ${[
                        coefficientCoverage.missing.length > 0 ? `missing ${coefficientCoverage.missing.join(", ")}` : "",
                        coefficientCoverage.extra.length > 0 ? `extra ${coefficientCoverage.extra.join(", ")}` : "",
                        coefficientCoverage.duplicates.length > 0 ? `duplicate ${coefficientCoverage.duplicates.join(", ")}` : "",
                      ].filter(Boolean).join("; ")}.`}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-red-700" role="alert">{expansion.error.message}</p>
            )}
          </section>

          {!creditsLeave && leaveAffectedPeople.length > 0 ? (
            <LeaveCreditAdvisory affectedPeople={leaveAffectedPeople} unit="half-hour" coefficient={LEAVE_CREDIT_HALF_HOUR_UNITS} onAddLeave={addLeave} />
          ) : !creditsLeave ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Paid leave is not included. <button type="button" className="font-medium underline" onClick={addLeave}>Add LEAVE ({LEAVE_CREDIT_HALF_HOUR_UNITS})</button> if leave should count toward this total.
            </div>
          ) : null}

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="note">
            <div className="flex gap-2">
              <FiAlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <p>This is a hard feasibility rule. A total that cannot be formed from the selected shifts and leave credit can make optimisation infeasible.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={openRefreshPreview} className="rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100">
              Refresh from Shift Types
            </button>
            <button type="button" onClick={undoRefresh} disabled={!refreshHistory.undo} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Undo Refresh
            </button>
            <button type="button" onClick={redoRefresh} disabled={!refreshHistory.redo} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Redo Refresh
            </button>
          </div>

          {refreshPreview ? (
            <div role="dialog" aria-modal="true" aria-labelledby="refresh-preview-title" className="rounded-lg border border-blue-300 bg-white p-5 shadow-lg">
              <h3 id="refresh-preview-title" className="text-base font-semibold text-gray-900">Refresh coefficient preview</h3>
              <p className="mt-1 text-sm text-gray-600">Review the local replacement. Nothing changes until you confirm this preview.</p>
              <div className="mt-4"><PreviewRows preview={refreshPreview} /></div>
              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setRefreshPreview(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel Preview</button>
                <button type="button" onClick={confirmRefreshPreview} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Confirm Refresh</button>
              </div>
            </div>
          ) : null}

          <div className="border-t border-gray-200 pt-4">
            <button type="button" aria-expanded={showSolverDetails} aria-controls="solver-details" onClick={() => setShowSolverDetails(value => !value)} className="text-sm font-medium text-blue-700 underline">
              Solver details &amp; overrides
            </button>
            {showSolverDetails ? (
              <div id="solver-details" className="mt-4 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="contract-expression" className="mb-2 block text-sm font-medium text-gray-700">Expression (hard field)</label>
                    <input id="contract-expression" readOnly aria-readonly="true" value={Array.isArray(draft.expression) ? draft.expression.join(", ") : draft.expression} className="block w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm text-gray-700" />
                  </div>
                  <div>
                    <label htmlFor="contract-weight" className="mb-2 block text-sm font-medium text-gray-700">Weight (hard field)</label>
                    <input id="contract-weight" readOnly aria-readonly="true" value="+Infinity" className="block w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm text-gray-700" />
                  </div>
                </div>
                <p className="text-xs text-gray-600">Convert to a generic Shift Count to edit expression or weight.</p>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700">Raw target half-hour values</legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <NumberInput aria-label={isRange ? "Raw minimum target" : "Raw exact target"} min="0" step="1" value={Number.isFinite(minimumUnits) ? minimumUnits : ""} onChange={event => setRawTarget(0, event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    {isRange ? <NumberInput aria-label="Raw maximum target" min="0" step="1" value={Number.isFinite(maximumUnits) ? maximumUnits : ""} onChange={event => setRawTarget(1, event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /> : null}
                  </div>
                </fieldset>
                <section aria-labelledby="coefficient-details-title">
                  <h4 id="coefficient-details-title" className="text-sm font-medium text-gray-700">Concrete coefficients</h4>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead><tr><th scope="col" className="px-2 py-2 text-left">Shift</th><th scope="col" className="px-2 py-2 text-left">Working time</th><th scope="col" className="px-2 py-2 text-left">Half-hour coefficient</th><th scope="col" className="px-2 py-2 text-left">Repair</th></tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {displayedCoefficientIds.map((id, index) => {
                          const entries = draft.countShiftTypeCoefficients.filter(([entryId]) => entryId === id);
                          const coefficient = entries[0]?.[1] ?? "";
                          const item = shiftTypeData.items.find(entry => entry.id === id);
                          const missingTime = id !== LEAVE && typeof item?.durationMinutes !== "number";
                          return (
                            <tr key={`${id}-${index}`}>
                              <th scope="row" className="px-2 py-2 text-left font-mono font-medium">{id}{entries.length > 1 ? ` (${entries.length} duplicate rows)` : ""}{!currentCoefficientIds.has(id) ? " (missing)" : ""}</th>
                              <td className="px-2 py-2">{id === LEAVE ? "8h leave credit" : formatWorkingTime(item)}</td>
                              <td className="px-2 py-2"><NumberInput aria-label={`${id} coefficient`} min="1" step="1" value={coefficient} onChange={event => setCoefficient(id, event.target.value)} className="w-28 rounded-md border border-gray-300 px-2 py-1.5" /></td>
                              <td className="px-2 py-2">{missingTime ? <Link href="/shift-types" className="text-blue-700 underline">Repair working time for {id}</Link> : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          {errors.contract ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <div className="flex gap-2"><FiAlertCircle className="mt-0.5 h-4 w-4 flex-none" /><div><p className="font-medium">Contracted Hours cannot be updated yet.</p><p>{errors.contract.message}</p>{errors.contract.path ? <p className="mt-1 font-mono text-xs">{errors.contract.path}</p> : null}</div></div>
            </div>
          ) : null}

          {editing && initialPreference?.hoursContract ? (
            <div>
              {!showConvertConfirmation ? (
                <button type="button" onClick={() => setShowConvertConfirmation(true)} className="text-sm text-red-700 underline">Convert to generic Shift Count</button>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-900">This removes only the Contracted Hours marker. Raw expression, target, coefficients, and weight stay unchanged.</p>
                  <div className="mt-3 flex gap-3"><button type="button" onClick={() => onCommit(convertContractedHoursToGeneric(draft as ContractedHoursPreference))} className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white">Confirm conversion</button><button type="button" onClick={() => setShowConvertConfirmation(false)} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-900">Cancel</button></div>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
            <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancel Edit</button>
            <button type="button" onClick={handleCommit} className="rounded-md bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700">{editing ? "Update" : "Add Contracted Hours"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
