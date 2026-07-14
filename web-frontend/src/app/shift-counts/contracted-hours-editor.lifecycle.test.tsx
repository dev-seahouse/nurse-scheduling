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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ShiftCountsPage from "@/app/shift-counts/page";
import { SchedulingDataProvider, useSchedulingData } from "@/hooks/useSchedulingData";
import { createDefaultState, SchedulingState } from "@/hooks/schedulingState";
import { saveStateToStorage } from "@/hooks/schedulingStorage";
import { ShiftCountPreference, SHIFT_COUNT } from "@/types/scheduling";
import { UnsavedEditingStateProvider } from "@/utils/unsavedEditingState";

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => nestedValue === Infinity ? "+Infinity" : nestedValue);
}

function ContractedHoursStateProbe() {
  const { getPreferencesByType } = useSchedulingData();
  const contract = getPreferencesByType<ShiftCountPreference>(SHIFT_COUNT)[0];
  return <output data-testid="contract-state">{stringify({
    target: contract?.target,
    coefficients: contract?.countShiftTypeCoefficients,
  })}</output>;
}

function makeState(target: number, coefficient: number): SchedulingState {
  const state = createDefaultState();
  state.dates = {
    range: {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-02T00:00:00.000Z"),
    },
    items: [],
    groups: [{ id: "First block", description: "First two dates", members: ["2026-01-01", "2026-01-02"] }],
  };
  state.people = { items: [{ id: "P1", description: "Person 1", history: [] }], groups: [] };
  state.shiftTypes = { items: [{ id: "D", description: "Day", durationMinutes: 510 }], groups: [] };
  const contract: ShiftCountPreference = {
    type: SHIFT_COUNT,
    description: "Grouped-date contract",
    person: ["P1"],
    countDates: ["First block"],
    countShiftTypes: ["D"],
    countShiftTypeCoefficients: [["D", coefficient]],
    hoursContract: { unit: "half-hour", policy: "exact" },
    expression: "x = T",
    target,
    weight: Infinity,
  };
  state.preferences = [...state.preferences, contract];
  return state;
}

function renderSeededPage() {
  const previous = makeState(300, 16);
  const current = makeState(320, 16);
  saveStateToStorage({
    state: current,
    history: [previous, current],
    currentHistoryIndex: 1,
  });

  return render(
    <SchedulingDataProvider>
      <UnsavedEditingStateProvider>
        <ShiftCountsPage />
        <ContractedHoursStateProbe />
      </UnsavedEditingStateProvider>
    </SchedulingDataProvider>,
  );
}

async function confirmRefresh(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Refresh from Shift Types" }));
  await user.click(screen.getByRole("button", { name: "Confirm Refresh" }));
}

describe("Contracted Hours editor document-history lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("labels grouped date scope as selectors, previews locally, and restores global Undo after Cancel Edit", async () => {
    const user = userEvent.setup();
    renderSeededPage();
    await waitFor(() => expect(screen.getByTestId("contract-state")).toHaveTextContent('"target":320'));

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const scopeCopy = screen.getByText(/Current window:/);
    expect(scopeCopy).toHaveTextContent("Current window: 1 date selector.");
    expect(scopeCopy).not.toHaveTextContent("selected date");

    expect(fireEvent.keyDown(document, { key: "z", ctrlKey: true })).toBe(false);
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"target":320');

    await user.click(screen.getByRole("button", { name: "Refresh from Shift Types" }));
    expect(screen.getByRole("dialog", { name: "Refresh coefficient preview" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel Preview" }));
    expect(screen.queryByRole("dialog", { name: "Refresh coefficient preview" })).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",16]]');

    await confirmRefresh(user);
    await user.click(screen.getByRole("button", { name: "Solver details & overrides" }));
    const coefficientInput = screen.getByRole("spinbutton", { name: "D coefficient" });
    expect(coefficientInput).toHaveValue(17);
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",16]]');

    expect(fireEvent.keyDown(document, { key: "z", ctrlKey: true })).toBe(false);
    expect(coefficientInput).toHaveValue(16);
    expect(fireEvent.keyDown(document, { key: "y", metaKey: true })).toBe(false);
    expect(coefficientInput).toHaveValue(17);
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"target":320');

    await user.click(screen.getByRole("button", { name: "Cancel Edit" }));
    expect(screen.queryByRole("heading", { name: "Edit Contracted Hours" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("contract-state")).toHaveTextContent('"target":300'));
  });

  it("keeps Refresh local until Update, then restores global Undo", async () => {
    const user = userEvent.setup();
    renderSeededPage();
    await waitFor(() => expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",16]]'));

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await confirmRefresh(user);
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",16]]');
    await user.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",17]]'));

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("contract-state")).toHaveTextContent('"coefficients":[["D",16]]'));
    expect(screen.getByTestId("contract-state")).toHaveTextContent('"target":320');
  });
});
