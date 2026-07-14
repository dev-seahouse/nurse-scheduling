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

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShiftTypePage from "@/app/shift-types/page";
import { SchedulingDataProvider, useSchedulingData } from "@/hooks/useSchedulingData";
import { createDefaultState } from "@/hooks/schedulingState";
import { saveStateToStorage } from "@/hooks/schedulingStorage";
import { SHIFT_COUNT, type ShiftCountPreference } from "@/types/scheduling";
import { UnsavedEditingStateProvider } from "@/utils/unsavedEditingState";

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => nestedValue === Infinity ? "+Infinity" : nestedValue);
}

function ScenarioProbe() {
  const { preferences, shiftTypeData } = useSchedulingData();
  return (
    <>
      <output data-testid="preferences-state">{stringify(preferences)}</output>
      <output data-testid="shift-types-state">{stringify(shiftTypeData.items)}</output>
    </>
  );
}

describe("Shift Type working-time page integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps marked Contracted Hours byte-exact without notification or coefficient synchronization", async () => {
    const user = userEvent.setup();
    const state = createDefaultState();
    state.shiftTypes = {
      items: [{ id: "D", description: "Day", durationMinutes: 480 }],
      groups: [],
    };
    const markedContract: ShiftCountPreference = {
      type: SHIFT_COUNT,
      person: ["ALL"],
      countDates: ["ALL"],
      countShiftTypes: ["D"],
      countShiftTypeCoefficients: [["D", 16]],
      hoursContract: { unit: "half-hour", policy: "exact" },
      expression: "x = T",
      target: 320,
      weight: Infinity,
    };
    state.preferences = [...state.preferences, markedContract];
    saveStateToStorage({
      state,
      history: [structuredClone(state)],
      currentHistoryIndex: 0,
    });

    render(
      <SchedulingDataProvider>
        <UnsavedEditingStateProvider>
          <ShiftTypePage />
          <ScenarioProbe />
        </UnsavedEditingStateProvider>
      </SchedulingDataProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("preferences-state")).toHaveTextContent("hoursContract"));
    const before = screen.getByTestId("preferences-state").textContent;
    const row = screen.getByText("1. D").closest("tr") as HTMLTableRowElement;
    await user.click(within(row).getByRole("button", { name: /edit/i }));
    await user.selectOptions(screen.getByLabelText("Paid duration minutes"), "30");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(screen.getByTestId("shift-types-state")).toHaveTextContent('"durationMinutes":510'));
    expect(screen.getByTestId("preferences-state").textContent).toBe(before);
    expect(screen.getByTestId("preferences-state")).toHaveTextContent('"countShiftTypeCoefficients":[["D",16]]');
    expect(screen.queryByText(/contracted hours/i)).not.toBeInTheDocument();
  });
});
