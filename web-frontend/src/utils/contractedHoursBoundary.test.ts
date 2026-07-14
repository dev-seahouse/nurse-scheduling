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

import { Preference, ShiftCountPreference } from "@/types/scheduling";
import {
  ContractedHoursBoundary,
  ContractedHoursBoundaryScenario,
  validateContractedHoursBoundary,
} from "@/utils/contractedHoursBoundary";
import { ALL, LEAVE, OFF } from "@/utils/keywords";

const boundaries: ContractedHoursBoundary[] = [
  "yaml-import",
  "yaml-download",
  "clipboard-copy",
  "anonymized-yaml-download",
  "optimize",
  "anonymized-optimize",
  "scenario-serializer",
];

function exact(overrides: Partial<ShiftCountPreference> = {}): ShiftCountPreference {
  return {
    type: "shift count",
    description: "Monthly contract",
    person: ["P1"],
    countDates: [ALL],
    countShiftTypes: ["Work"],
    countShiftTypeCoefficients: [["D", 16], ["E", 17]],
    hoursContract: { unit: "half-hour", policy: "exact" },
    expression: "x = T",
    target: 320,
    weight: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

function range(overrides: Partial<ShiftCountPreference> = {}): ShiftCountPreference {
  return {
    ...exact(),
    hoursContract: { unit: "half-hour", policy: "range" },
    expression: ["x >= T", "x <= T"],
    target: [300, 340],
    ...overrides,
  };
}

function scenario(
  contract: ShiftCountPreference,
  overrides: Partial<ContractedHoursBoundaryScenario> = {},
): ContractedHoursBoundaryScenario {
  return {
    shiftTypes: {
      items: [
        { id: "D", description: "Day", durationMinutes: 480 },
        { id: "E", description: "Evening", durationMinutes: 510 },
      ],
      groups: [
        { id: "Work", description: "", members: ["D", "E"] },
        { id: "WorkAndLeave", description: "", members: [ALL, LEAVE] },
        { id: "Empty", description: "", members: [] },
      ],
    },
    preferences: [
      { type: "at most one shift per day" },
      contract,
    ],
    ...overrides,
  };
}

function errorCode(
  candidate: ContractedHoursBoundaryScenario,
  boundary: ContractedHoursBoundary,
) {
  const result = validateContractedHoursBoundary(candidate, boundary);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected Contracted Hours validation to fail.");
  }
  expect(result.diagnostic.boundary).toBe(boundary);
  expect(result.diagnostic.preferenceIndex).toBe(1);
  expect(result.diagnostic.message).toContain("Monthly contract");
  expect(result.diagnostic.navigationHref).toBe("/shift-counts");
  return result.diagnostic;
}

describe("Contracted Hours named semantic boundaries", () => {
  it.each(boundaries)("accepts Exact and Range with dynamic group/ALL selectors at %s", boundary => {
    expect(validateContractedHoursBoundary(scenario(exact()), boundary)).toEqual({ ok: true });
    expect(validateContractedHoursBoundary(scenario(range({
      countShiftTypes: ["WorkAndLeave"],
      countShiftTypeCoefficients: [["D", 16], ["E", 17], [LEAVE, 16]],
    })), boundary)).toEqual({ ok: true });
  });

  it.each(boundaries)("uses the same failure precedence and exact diagnostics at %s", boundary => {
    const cases: Array<{
      name: string;
      candidate: ContractedHoursBoundaryScenario;
      code: string;
      detail: string;
    }> = [
      {
        name: "missing coefficient",
        candidate: scenario(exact({ countShiftTypeCoefficients: [["D", 16]] })),
        code: "missing_coefficient",
        detail: "'E'",
      },
      {
        name: "extra coefficient",
        candidate: scenario(exact({
          countShiftTypes: ["D"],
          countShiftTypeCoefficients: [["D", 16], ["E", 17]],
        })),
        code: "extra_coefficient",
        detail: "'E'",
      },
      {
        name: "missing before extra coefficient",
        candidate: scenario(exact({
          countShiftTypeCoefficients: [["E", 17], [LEAVE, 16]],
        })),
        code: "missing_coefficient",
        detail: "'D'",
      },
      {
        name: "duplicate coefficient",
        candidate: scenario(exact({
          countShiftTypeCoefficients: [["D", 16], ["D", 16], ["E", 17]],
        })),
        code: "duplicate_coefficient",
        detail: "'D'",
      },
      {
        name: "unresolved selector",
        candidate: scenario(exact({ countShiftTypes: ["Missing"] })),
        code: "unknown_selector",
        detail: "Missing",
      },
      {
        name: "forward reference",
        candidate: scenario(exact(), {
          shiftTypes: {
            items: [{ id: "D", description: "" }],
            groups: [
              { id: "A", description: "", members: ["B"] },
              { id: "B", description: "", members: ["D"] },
            ],
          },
        }),
        code: "group_reference",
        detail: "forward reference",
      },
      {
        name: "cyclic reference",
        candidate: scenario(exact(), {
          shiftTypes: {
            items: [{ id: "D", description: "" }],
            groups: [{ id: "A", description: "", members: ["A"] }],
          },
        }),
        code: "group_reference",
        detail: "cycle",
      },
      {
        name: "empty selectors",
        candidate: scenario(exact({ countShiftTypes: [] })),
        code: "empty_selectors",
        detail: "non-empty",
      },
      {
        name: "empty expansion",
        candidate: scenario(exact({
          countShiftTypes: ["Empty"],
          countShiftTypeCoefficients: [],
        })),
        code: "empty_expansion",
        detail: "at least one",
      },
      {
        name: "OFF",
        candidate: scenario(exact({
          countShiftTypes: [OFF],
          countShiftTypeCoefficients: [[OFF, 1]],
        })),
        code: "off_not_allowed",
        detail: "OFF",
      },
      {
        name: "stale ALL membership",
        candidate: scenario(exact({
          countShiftTypes: [ALL],
          countShiftTypeCoefficients: [["D", 16]],
        })),
        code: "missing_coefficient",
        detail: "'E'",
      },
    ];

    for (const testCase of cases) {
      const diagnostic = errorCode(testCase.candidate, boundary);
      expect(diagnostic.code, testCase.name).toBe(testCase.code);
      expect(diagnostic.detail, testCase.name).toContain(testCase.detail);
    }
  });

  it.each(boundaries)("leaves generic scalar and array Shift Counts unaffected at %s", boundary => {
    const genericPreferences: Preference[] = [
      exact({ hoursContract: undefined, expression: "x >= T", target: 1, weight: 2 }),
      exact({
        hoursContract: undefined,
        expression: ["x >= T", "x <= T", "x = T"],
        target: [1, 4, 2],
        weight: 3,
      }),
    ];
    const brokenUnusedGroupScenario: ContractedHoursBoundaryScenario = {
      shiftTypes: {
        items: [{ id: "D", description: "" }],
        groups: [{ id: "Broken", description: "", members: ["Missing"] }],
      },
      preferences: genericPreferences,
    };

    expect(validateContractedHoursBoundary(brokenUnusedGroupScenario, boundary))
      .toEqual({ ok: true });
  });

  it("gives ordered group-map errors precedence over later policy and coverage errors", () => {
    const diagnostic = errorCode(scenario(exact({
      weight: 1,
      countShiftTypeCoefficients: [],
    }), {
      shiftTypes: {
        items: [{ id: "D", description: "" }],
        groups: [{ id: "A", description: "", members: ["B"] }],
      },
    }), "yaml-import");

    expect(diagnostic.code).toBe("group_reference");
  });
});
