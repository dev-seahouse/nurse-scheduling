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

import { act, renderHook, waitFor } from "@testing-library/react";
import yaml from "js-yaml";

import {
  SchedulingDataProvider,
  useSchedulingData,
} from "@/hooks/useSchedulingData";
import {
  DataType,
  ShiftCountPreference,
  SHIFT_COUNT,
} from "@/types/scheduling";
import {
  compileContractedHours,
  confirmGenericToContractedHours,
  confirmRefresh,
  ContractedHoursDraft,
  ContractedHoursPreference,
  ContractedHoursResult,
  convertContractedHoursToGeneric,
  expandContractedHoursShiftTypes,
  previewGenericToContractedHours,
  previewRefresh,
  validateContractedHours,
} from "@/utils/contractedHours";
import { ALL, LEAVE, OFF } from "@/utils/keywords";
import { generateYamlFromState } from "@/utils/yamlGenerator";

function valueOf<T>(result: ContractedHoursResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

const initialShiftTypes = {
  items: [
    { id: "D", description: "Day", durationMinutes: 480 },
    { id: "E", description: "Evening", durationMinutes: 510 },
  ],
  groups: [{ id: "Work", description: "", members: ["D"] }],
};

function exact(
  countShiftTypes: string[] = ["D"],
  countDates: string[] = ["01", "02"],
): ContractedHoursPreference {
  return valueOf(compileContractedHours({
    description: "Exact 160h",
    person: ["P1"],
    countDates,
    countShiftTypes,
    target: { policy: "exact", totalHours: 160 },
  }, { shiftTypes: initialShiftTypes }));
}

function range(): ContractedHoursPreference {
  return valueOf(compileContractedHours({
    description: "Allowed range",
    person: ["P1"],
    countDates: ["01", "02"],
    countShiftTypes: ["D", "E"],
    target: { policy: "range", minimumHours: 150, maximumHours: 170 },
  }, { shiftTypes: initialShiftTypes }));
}

function scenario(preferences: ShiftCountPreference[] = []) {
  return {
    apiVersion: "alpha",
    description: "WT5 lifecycle",
    dates: {
      range: { startDate: "2026-07-01", endDate: "2026-07-03" },
      items: [],
      groups: [],
    },
    people: {
      items: [{ id: "P1", description: "", history: [] }],
      groups: [],
    },
    shiftTypes: structuredClone(initialShiftTypes),
    preferences: [
      { type: "at most one shift per day" },
      ...preferences,
    ],
  };
}

function counts(result: { current: ReturnType<typeof useSchedulingData> }) {
  return result.current.getPreferencesByType<ShiftCountPreference>(SHIFT_COUNT);
}

describe("contracted-hours store lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates, saves, emits YAML, reloads, reopens, duplicates, reorders, and deletes Exact/Range losslessly", async () => {
    const first = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => first.result.current.loadFromYaml(scenario()));
    await waitFor(() => expect(first.result.current.descriptionData).toBe("WT5 lifecycle"));

    const exactContract = exact();
    const rangeContract = range();
    act(() => {
      first.result.current.updatePreferencesByType(
        SHIFT_COUNT,
        [exactContract, rangeContract],
      );
    });
    await waitFor(() => expect(counts(first.result)).toEqual([exactContract, rangeContract]));

    act(() => first.result.current.duplicatePreferenceByType(SHIFT_COUNT, 0));
    await waitFor(() => expect(counts(first.result)).toHaveLength(3));
    const duplicated = counts(first.result)[1];
    expect(duplicated).toMatchObject({
      hoursContract: { unit: "half-hour", policy: "exact" },
      expression: "x = T",
      target: 320,
    });
    expect(duplicated).not.toBe(counts(first.result)[0]);
    expect(duplicated.hoursContract).not.toBe(counts(first.result)[0].hoursContract);

    const reordered = [counts(first.result)[2], counts(first.result)[1], counts(first.result)[0]];
    act(() => first.result.current.updatePreferencesByType(SHIFT_COUNT, reordered));
    await waitFor(() => expect(counts(first.result).map(count => count.target)).toEqual([
      [300, 340],
      320,
      320,
    ]));

    const stateForYaml = {
      apiVersion: first.result.current.apiVersionData,
      description: first.result.current.descriptionData,
      dates: first.result.current.dateData,
      people: first.result.current.peopleData,
      shiftTypes: first.result.current.shiftTypeData,
      preferences: first.result.current.preferences,
    };
    const generated = generateYamlFromState(stateForYaml);
    expect(generated).toContain("unit: half-hour");
    expect(generated).toContain("policy: range");
    expect(generated).toContain("target: [300, 340]");

    const second = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => second.result.current.loadFromYaml(yaml.load(generated)));
    await waitFor(() => expect(counts(second.result).map(count => count.target)).toEqual([
      [300, 340],
      320,
      320,
    ]));

    act(() => second.result.current.updatePreferencesByType(
      SHIFT_COUNT,
      counts(second.result).slice(0, 2),
    ));
    await waitFor(() => expect(counts(second.result)).toHaveLength(2));
    act(() => second.result.current.undo());
    await waitFor(() => expect(counts(second.result)).toHaveLength(3));

    first.unmount();
    second.unmount();
  });

  it("cascades rename/delete identities and restores each complete rule with one Undo", async () => {
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => hook.result.current.loadFromYaml(scenario([exact(["D"])])));
    await waitFor(() => expect(counts(hook.result)).toHaveLength(1));

    act(() => hook.result.current.updateItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "D",
      "Day",
    ));
    await waitFor(() => expect(counts(hook.result)[0]).toMatchObject({
      countShiftTypes: ["Day"],
      countShiftTypeCoefficients: [["Day", 16]],
      target: 320,
    }));
    expect(hook.result.current.shiftTypeData.groups[0].members).toEqual(["Day"]);

    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(exact(["D"])));

    act(() => hook.result.current.deleteItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "D",
    ));
    await waitFor(() => expect(counts(hook.result)).toHaveLength(0));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(exact(["D"])));

    hook.unmount();
  });

  it("cascades group rename/delete without changing concrete coefficients or targets", async () => {
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    const stored = exact(["Work"]);
    act(() => hook.result.current.loadFromYaml(scenario([stored])));
    await waitFor(() => expect(counts(hook.result)).toEqual([stored]));

    act(() => hook.result.current.updateGroup(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "Work",
      "Clinical",
    ));
    await waitFor(() => expect(counts(hook.result)[0]).toMatchObject({
      countShiftTypes: ["Clinical"],
      countShiftTypeCoefficients: [["D", 16]],
      target: 320,
    }));

    act(() => hook.result.current.deleteGroup(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "Clinical",
    ));
    await waitFor(() => expect(counts(hook.result)).toHaveLength(0));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0].countShiftTypes).toEqual(["Clinical"]));

    hook.unmount();
  });

  it("keeps targets and coefficients inert across working-time, membership, item-duplicate, and group-duplicate edits", async () => {
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    const stored = exact(["Work"]);
    act(() => hook.result.current.loadFromYaml(scenario([stored])));
    await waitFor(() => expect(counts(hook.result)).toEqual([stored]));

    act(() => hook.result.current.updateItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "D",
      "D",
      undefined,
      undefined,
      { durationMinutes: 510 },
    ));
    await waitFor(() => expect(
      hook.result.current.shiftTypeData.items.find(item => item.id === "D")?.durationMinutes,
    ).toBe(510));
    expect(counts(hook.result)[0]).toEqual(stored);

    act(() => hook.result.current.updateGroup(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "Work",
      "Work",
      ["D", "E"],
    ));
    await waitFor(() => expect(hook.result.current.shiftTypeData.groups[0].members)
      .toEqual(["D", "E"]));
    expect(counts(hook.result)[0]).toEqual(stored);
    expect(validateContractedHours(
      { shiftTypes: hook.result.current.shiftTypeData },
      counts(hook.result)[0],
    )).toMatchObject({ ok: false, error: { code: "missing_coefficient" } });

    act(() => hook.result.current.undo());
    await waitFor(() => expect(hook.result.current.shiftTypeData.groups[0].members)
      .toEqual(["D"]));

    act(() => hook.result.current.duplicateItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "D",
    ));
    await waitFor(() => expect(hook.result.current.shiftTypeData.items.map(item => item.id))
      .toContain("D copy"));
    expect(hook.result.current.shiftTypeData.groups[0].members).toEqual(["D", "D copy"]);
    expect(counts(hook.result)[0]).toEqual(stored);
    expect(validateContractedHours(
      { shiftTypes: hook.result.current.shiftTypeData },
      counts(hook.result)[0],
    )).toMatchObject({ ok: false, error: { code: "missing_coefficient" } });

    act(() => hook.result.current.duplicateGroup(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "Work",
    ));
    await waitFor(() => expect(hook.result.current.shiftTypeData.groups.map(group => group.id))
      .toContain("Work copy"));
    expect(counts(hook.result)[0]).toEqual(stored);

    hook.unmount();
  });

  it("preserves targets on partial date shrink, deletes on total shrink, and restores in one Undo", async () => {
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    const stored = exact(["D"], ["01", "02"]);
    act(() => hook.result.current.loadFromYaml(scenario([stored])));
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(stored));

    act(() => hook.result.current.updateDateRange({
      startDate: new Date("2026-07-02T00:00:00.000Z"),
      endDate: new Date("2026-07-03T00:00:00.000Z"),
    }));
    await waitFor(() => expect(counts(hook.result)[0]).toMatchObject({
      countDates: ["02"],
      target: 320,
    }));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(stored));

    act(() => hook.result.current.updateDateRange({
      startDate: new Date("2026-07-03T00:00:00.000Z"),
      endDate: new Date("2026-07-03T00:00:00.000Z"),
    }));
    await waitFor(() => expect(counts(hook.result)).toHaveLength(0));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(stored));

    hook.unmount();
  });

  it("lets ALL grow dynamically without synthesizing coefficients", async () => {
    const allScenario = scenario();
    const allContract = valueOf(compileContractedHours({
      person: ["P1"],
      countDates: ["01", "02"],
      countShiftTypes: [ALL],
      target: { policy: "exact", totalHours: 160 },
    }, { shiftTypes: initialShiftTypes }));
    allScenario.preferences.push(allContract);

    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => hook.result.current.loadFromYaml(allScenario));
    await waitFor(() => expect(counts(hook.result)).toEqual([allContract]));
    act(() => hook.result.current.addItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "N",
      [],
      "Night",
      { durationMinutes: 480 },
    ));
    await waitFor(() => expect(hook.result.current.shiftTypeData.items.map(item => item.id))
      .toContain("N"));
    expect(counts(hook.result)[0]).toEqual(allContract);
    expect(validateContractedHours(
      { shiftTypes: hook.result.current.shiftTypeData },
      counts(hook.result)[0],
    )).toMatchObject({ ok: false, error: { code: "missing_coefficient" } });
    hook.unmount();
  });

  it("matches backend ALL semantics after the provider adds normalized reserved entries", async () => {
    const normalizedInput = scenario();
    normalizedInput.shiftTypes.groups = [
      { id: "Work", description: "", members: [ALL, LEAVE] },
      { id: "NestedWork", description: "", members: ["Work"] },
    ];
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => hook.result.current.loadFromYaml(normalizedInput));
    await waitFor(() => expect(hook.result.current.shiftTypeData.items.map(item => item.id))
      .toEqual(["D", "E", OFF, LEAVE]));
    expect(hook.result.current.shiftTypeData.groups.map(group => group.id))
      .toEqual(["Work", "NestedWork", ALL]);

    expect(valueOf(expandContractedHoursShiftTypes(
      hook.result.current.shiftTypeData,
      ["NestedWork"],
    ))).toMatchObject({
      semanticIds: [LEAVE, "D", "E"],
      displayIds: ["D", "E", LEAVE],
    });
    hook.unmount();
  });

  it("keeps Refresh local until Update and commits the replacement as one global undo step", async () => {
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    const stored = exact(["D"]);
    act(() => hook.result.current.loadFromYaml(scenario([stored])));
    await waitFor(() => expect(counts(hook.result)).toEqual([stored]));

    act(() => hook.result.current.updateItem(
      DataType.SHIFT_TYPES,
      hook.result.current.shiftTypeData,
      "D",
      "D",
      undefined,
      undefined,
      { durationMinutes: 510 },
    ));
    await waitFor(() => expect(
      hook.result.current.shiftTypeData.items.find(item => item.id === "D")?.durationMinutes,
    ).toBe(510));

    const preview = valueOf(previewRefresh(
      counts(hook.result)[0] as ContractedHoursDraft,
      { shiftTypes: hook.result.current.shiftTypeData },
    ));
    const local = confirmRefresh(preview);
    expect(local.draft.countShiftTypeCoefficients).toEqual([["D", 17]]);
    expect(counts(hook.result)[0]).toEqual(stored);

    act(() => hook.result.current.updatePreferencesByType(
      SHIFT_COUNT,
      [local.draft as ContractedHoursPreference],
    ));
    await waitFor(() => expect(counts(hook.result)[0].countShiftTypeCoefficients)
      .toEqual([["D", 17]]));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(stored));
    expect(hook.result.current.shiftTypeData.items.find(item => item.id === "D")?.durationMinutes)
      .toBe(510);

    hook.unmount();
  });

  it("commits each explicit conversion as one undoable replacement and cancel writes nothing", async () => {
    const generic: ShiftCountPreference = {
      type: SHIFT_COUNT,
      description: "Generic array",
      person: ["P1"],
      countDates: ["01", "02"],
      countShiftTypes: ["D"],
      countShiftTypeCoefficients: [["D", 12]],
      expression: ["x >= T", "x <= T", "x = T"],
      target: [1, 8, 4],
      weight: 5,
    };
    const hook = renderHook(() => useSchedulingData(), { wrapper: SchedulingDataProvider });
    act(() => hook.result.current.loadFromYaml(scenario([generic])));
    await waitFor(() => expect(counts(hook.result)).toEqual([generic]));

    const preview = valueOf(previewGenericToContractedHours(
      counts(hook.result)[0],
      { policy: "exact", totalHours: 160 },
      { shiftTypes: hook.result.current.shiftTypeData },
    ));
    expect(counts(hook.result)[0]).toEqual(generic);

    const marked = valueOf(confirmGenericToContractedHours(preview));
    act(() => hook.result.current.updatePreferencesByType(SHIFT_COUNT, [marked]));
    await waitFor(() => expect(counts(hook.result)[0].hoursContract)
      .toEqual({ unit: "half-hour", policy: "exact" }));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(generic));

    act(() => hook.result.current.updatePreferencesByType(SHIFT_COUNT, [marked]));
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(marked));
    const convertedBack = convertContractedHoursToGeneric(marked);
    act(() => hook.result.current.updatePreferencesByType(SHIFT_COUNT, [convertedBack]));
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(convertedBack));
    act(() => hook.result.current.undo());
    await waitFor(() => expect(counts(hook.result)[0]).toEqual(marked));

    hook.unmount();
  });
});
