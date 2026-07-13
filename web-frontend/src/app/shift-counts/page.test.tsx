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

// This test is mostly AI generated.

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShiftCountsPage from '@/app/shift-counts/page';
import { UnsavedEditingStateProvider } from '@/utils/unsavedEditingState';
import { LEAVE } from '@/utils/keywords';

const mockUseSchedulingData = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSchedulingData', () => ({
  useSchedulingData: mockUseSchedulingData,
}));

function renderShiftCountsPage() {
  return render(
    <UnsavedEditingStateProvider>
      <ShiftCountsPage />
    </UnsavedEditingStateProvider>
  );
}

describe('ShiftCountsPage', () => {
  const updatePreferencesByType = vi.fn();
  const duplicatePreferenceByType = vi.fn();

  async function fillRequiredFieldsAndSelectShiftTypes(
    user: ReturnType<typeof userEvent.setup>,
    shiftTypeIds: string[]
  ) {
    await user.click(screen.getByRole('button', { name: /add shift count/i }));
    await user.click(screen.getByRole('checkbox', { name: 'P1' }));
    await user.click(screen.getByRole('checkbox', { name: '2026-01-01' }));
    for (const shiftTypeId of shiftTypeIds) {
      await user.click(screen.getByRole('checkbox', { name: shiftTypeId }));
    }
  }

  function setCoefficient(shiftTypeId: string, coefficient: number) {
    const input = screen.getByRole('spinbutton', { name: shiftTypeId });
    fireEvent.change(input, { target: { value: coefficient.toString() } });
  }

  it('blurs number inputs on wheel so scrolling does not step their value', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'N']);

    const coefficientInput = screen.getByRole('spinbutton', { name: 'D' });
    coefficientInput.focus();
    expect(coefficientInput).toHaveFocus();

    fireEvent.wheel(coefficientInput, { deltaY: 120 });

    expect(coefficientInput).not.toHaveFocus();
  });

  beforeEach(() => {
    updatePreferencesByType.mockReset();
    duplicatePreferenceByType.mockReset();
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [
          { id: 'D', description: 'Day' },
          { id: 'N', description: 'Night' },
        ],
        groups: [{ id: 'WORK', members: ['D', 'N'], description: 'Working shifts' }],
      },
      getPreferencesByType: vi.fn(() => []),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
  });

  it('blocks overlapping coefficients for a shift type and a group containing it', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'WORK']);
    setCoefficient('D', 2);
    setCoefficient('WORK', 3);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Shift type coefficients overlap: D, WORK include D')).toBeInTheDocument();
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  it('allows overlapping selected shift types when their default coefficients are omitted', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'WORK']);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0]).not.toHaveProperty('countShiftTypeCoefficients');
  });

  it('allows overlapping selected shift types when only one has a non-default coefficient', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'WORK']);
    setCoefficient('WORK', 3);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypeCoefficients).toEqual([['WORK', 3]]);
  });

  it('blocks overlapping selected shift types when coefficient one is explicit', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'WORK']);
    setCoefficient('D', 1);
    setCoefficient('WORK', 2);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Shift type coefficients overlap: D, WORK include D')).toBeInTheDocument();
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  it('saves explicit coefficient one', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 1);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypeCoefficients).toEqual([['D', 1]]);
  });

  it('allows non-overlapping non-default coefficients', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'N']);
    setCoefficient('D', 2);
    setCoefficient('N', 3);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypeCoefficients).toEqual([
      ['D', 2],
      ['N', 3],
    ]);
  });

  it('preserves coefficients after deselecting down to one shift type', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'N']);
    setCoefficient('D', 2);
    await user.click(screen.getByRole('checkbox', { name: 'N' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypeCoefficients).toEqual([['D', 2]]);
  });

  it('shows an invalid coefficient error before checking coefficient overlap', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [
          { id: 'D', description: 'Day' },
          { id: 'N', description: 'Night' },
        ],
        groups: [{ id: 'WORK', members: ['D', 'N'], description: 'Working shifts' }],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D', 'WORK'],
        countShiftTypeCoefficients: [['D', 0], ['WORK', 3]],
        expression: 'x >= T',
        target: 0,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(screen.getByText('Coefficient for D must be an integer of at least 1')).toBeInTheDocument();
    expect(screen.queryByText(/Shift type coefficients overlap/)).not.toBeInTheDocument();
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  it('dismisses the edited shift count draft before duplicating a shift count', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day' }],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        description: 'Original count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D'],
        expression: 'x >= T',
        target: 1,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    expect(duplicatePreferenceByType).toHaveBeenCalledWith('shift count', 0);
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  it('dismisses an added shift count draft before duplicating a shift count', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day' }],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        description: 'Original count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D'],
        expression: 'x >= T',
        target: 1,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /add shift count/i }));
    await user.type(screen.getByPlaceholderText('e.g., Working shifts should be close to the average'), 'Unsaved count');
    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Unsaved count')).not.toBeInTheDocument();
    expect(duplicatePreferenceByType).toHaveBeenCalledWith('shift count', 0);
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  it('shows all invalid coefficient errors and clears only the edited coefficient error', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [
          { id: 'D', description: 'Day' },
          { id: 'N', description: 'Night' },
        ],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D', 'N'],
        countShiftTypeCoefficients: [['D', 0], ['N', 0]],
        expression: 'x >= T',
        target: 0,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dayCoefficientInput = screen.getByRole('spinbutton', { name: 'D' });
    const nightCoefficientInput = screen.getByRole('spinbutton', { name: 'N' });

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(screen.getByText('Coefficient for D must be an integer of at least 1')).toBeInTheDocument();
    expect(screen.getByText('Coefficient for N must be an integer of at least 1')).toBeInTheDocument();
    expect(dayCoefficientInput).toHaveClass('border-red-300');
    expect(nightCoefficientInput).toHaveClass('border-red-300');

    await user.type(dayCoefficientInput, '2');

    expect(screen.queryByText('Coefficient for D must be an integer of at least 1')).not.toBeInTheDocument();
    expect(screen.getByText('Coefficient for N must be an integer of at least 1')).toBeInTheDocument();
    expect(dayCoefficientInput).not.toHaveClass('border-red-300');
    expect(nightCoefficientInput).toHaveClass('border-red-300');
  });

  it('clears multiple coefficient errors queued before a render', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [
          { id: 'D', description: 'Day' },
          { id: 'N', description: 'Night' },
        ],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D', 'N'],
        countShiftTypeCoefficients: [['D', 0], ['N', 0]],
        expression: 'x >= T',
        target: 0,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dayCoefficientInput = screen.getByRole('spinbutton', { name: 'D' });
    const nightCoefficientInput = screen.getByRole('spinbutton', { name: 'N' });

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(screen.getByText('Coefficient for D must be an integer of at least 1')).toBeInTheDocument();
    expect(screen.getByText('Coefficient for N must be an integer of at least 1')).toBeInTheDocument();

    act(() => {
      fireEvent.change(dayCoefficientInput, { target: { value: '2' } });
      fireEvent.change(nightCoefficientInput, { target: { value: '3' } });
    });

    expect(screen.queryByText('Coefficient for D must be an integer of at least 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Coefficient for N must be an integer of at least 1')).not.toBeInTheDocument();
    expect(dayCoefficientInput).not.toHaveClass('border-red-300');
    expect(nightCoefficientInput).not.toHaveClass('border-red-300');
  });

  it('allows an empty target while editing and clears its save error only after a value change', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    const targetInput = screen.getByPlaceholderText('e.g., 5');

    await user.clear(targetInput);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Target must be a non-negative integer')).toBeInTheDocument();
    expect(targetInput).toHaveClass('border-red-300');

    await user.type(targetInput, 'abc');

    expect(screen.getByText('Target must be a non-negative integer')).toBeInTheDocument();
    expect(targetInput).toHaveClass('border-red-300');

    await user.type(targetInput, '2');

    expect(screen.queryByText('Target must be a non-negative integer')).not.toBeInTheDocument();
    expect(targetInput).not.toHaveClass('border-red-300');
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['-Infinity', -Infinity],
  ])('allows squared-error expression with non-positive weight %s', async (weightInput, expectedWeight) => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    await user.selectOptions(screen.getByRole('combobox'), '|x - T|^2');
    fireEvent.change(screen.getByPlaceholderText('e.g., -1, -10, ∞'), { target: { value: weightInput } });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].weight).toBe(expectedWeight);
  });

  it.each(['1', 'Infinity'])('rejects squared-error expression with positive weight %s', async (weightInput) => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    await user.selectOptions(screen.getByRole('combobox'), '|x - T|^2');
    fireEvent.change(screen.getByPlaceholderText('e.g., -1, -10, ∞'), { target: { value: weightInput } });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Weight must be non-positive for shift count with "|x - T|^2"')).toBeInTheDocument();
    expect(updatePreferencesByType).not.toHaveBeenCalled();
  });

  const hoursContractCheckbox = () =>
    screen.getByRole('checkbox', { name: /enforces contracted monthly hours/i });

  const contractUnitButton = (unit: string) =>
    within(screen.getByRole('group', { name: 'Contract unit' })).getByRole('button', { name: unit });

  it('makes the contract unit the single control and converts coefficients + target atomically', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 16);
    const targetInput = screen.getByPlaceholderText('e.g., 5');
    fireEvent.change(targetInput, { target: { value: '320' } });

    // Mark as an hours contract → half-hour by default; the private toggle is gone.
    await user.click(hoursContractCheckbox());
    expect(screen.queryByRole('group', { name: 'Coefficient unit' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Contract unit' })).toBeInTheDocument();

    // Declare the unit the coefficients are already in (no rescale).
    await user.click(contractUnitButton('half-hour'));
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(16);

    // Once declared, half-hour → hour halves the coefficient and target together.
    await user.click(contractUnitButton('hour'));
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(8);
    expect(targetInput).toHaveValue(160);

    // hour → half-hour restores them.
    await user.click(contractUnitButton('half-hour'));
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(16);
    expect(targetInput).toHaveValue(320);
  });

  it('blocks an unsafe unit switch and leaves the count in its current unit', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 15);
    await user.click(hoursContractCheckbox());
    await user.click(contractUnitButton('half-hour')); // declare

    await user.click(contractUnitButton('hour'));

    expect(screen.getByText(/Cannot switch to hour/)).toBeInTheDocument();
    // Unchanged: still 15 half-hour units, no mixed-unit intermediate.
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(15);
    expect(contractUnitButton('half-hour')).toHaveClass('bg-blue-600');
  });

  it('persists hoursContract when saving a marked count', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 16);
    await user.click(hoursContractCheckbox());
    await user.click(contractUnitButton('half-hour')); // confirm the declared unit
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0].hoursContract).toEqual({ unit: 'half-hour' });
  });

  it('omits hoursContract for an unmarked count and keeps the private unit toggle', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 16);
    expect(screen.getByRole('group', { name: 'Coefficient unit' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    expect(updatePreferencesByType.mock.calls[0][1][0]).not.toHaveProperty('hoursContract');
  });

  it('hydrates hoursContract when editing a marked count', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day' }],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D'],
        countShiftTypeCoefficients: [['D', 8]],
        hoursContract: { unit: 'hour' },
        expression: 'x >= T',
        target: 160,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(hoursContractCheckbox()).toBeChecked();
    expect(contractUnitButton('hour')).toHaveClass('bg-blue-600');
    expect(screen.queryByRole('group', { name: 'Coefficient unit' })).not.toBeInTheDocument();
  });

  const privateUnitButton = (unit: string) =>
    within(screen.getByRole('group', { name: 'Coefficient unit' })).getByRole('button', { name: unit });

  it('marking adopts the coefficient editor current unit instead of hardcoding half-hour', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    // Author the coefficients in hour units via the private toggle, then mark.
    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    setCoefficient('D', 8);
    await user.click(privateUnitButton('hour'));
    await user.click(hoursContractCheckbox());

    // The declared unit follows the editor's unit (hour), and marking is an
    // identity — the coefficient is not rescaled.
    expect(contractUnitButton('hour')).toHaveClass('bg-blue-600');
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(8);

    const targetInput = screen.getByPlaceholderText('e.g., 5');
    fireEvent.change(targetInput, { target: { value: '160' } });
    await user.click(contractUnitButton('hour')); // confirm the declared unit
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType.mock.calls[0][1][0].hoursContract).toEqual({ unit: 'hour' });
    expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypeCoefficients).toEqual([['D', 8]]);
  });

  it('blocks a unit switch when a blank implicit-1 coefficient cannot convert', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    // D is left blank → an implicit 1 (the backend default).
    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    await user.click(hoursContractCheckbox());
    await user.click(contractUnitButton('half-hour')); // declare

    // half-hour → hour would make the implicit 1 a fractional 0.5, so it blocks
    // instead of silently keeping an effective 1 in the new unit.
    await user.click(contractUnitButton('hour'));

    expect(screen.getByText(/Cannot switch to hour/)).toBeInTheDocument();
    expect(contractUnitButton('half-hour')).toHaveClass('bg-blue-600');
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(null);
  });

  it('blocks a unit switch for an ALL/group count with blank cover slots, and still saves', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    // Selecting the WORK group exposes concrete D, N slots plus the WORK cover
    // slot, all blank — the shape that T8's materialize-all corrupted into
    // overlapping pairs. D=N=WORK="" is a valid implicit-default draft.
    await fillRequiredFieldsAndSelectShiftTypes(user, ['WORK']);
    expect(screen.getByRole('spinbutton', { name: 'D' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'WORK' })).toBeInTheDocument();
    await user.click(hoursContractCheckbox());
    await user.click(contractUnitButton('half-hour')); // declare

    // The concrete blanks (implicit 1) block; the group/ALL cover slot is not
    // materialized, so no overlapping pair is produced.
    await user.click(contractUnitButton('hour'));
    expect(screen.getByText(/Cannot switch to hour/)).toBeInTheDocument();
    expect(contractUnitButton('half-hour')).toHaveClass('bg-blue-600');

    // The formerly valid count is untouched and still saves.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    const saved = updatePreferencesByType.mock.calls[0][1][0];
    expect(saved).not.toHaveProperty('countShiftTypeCoefficients');
    expect(saved.hoursContract).toEqual({ unit: 'half-hour' });
  });

  it('converts and saves a fully-explicit whole-number count', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D', 'N']);
    setCoefficient('D', 16);
    setCoefficient('N', 8);
    const targetInput = screen.getByPlaceholderText('e.g., 5');
    fireEvent.change(targetInput, { target: { value: '320' } });
    await user.click(hoursContractCheckbox());
    await user.click(contractUnitButton('half-hour')); // declare

    // Explicit concrete coefficients convert; the blank WORK cover slot is left
    // alone (not blocked, not emitted).
    await user.click(contractUnitButton('hour'));
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(8);
    expect(screen.getByRole('spinbutton', { name: 'N' })).toHaveValue(4);
    expect(targetInput).toHaveValue(160);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    const saved = updatePreferencesByType.mock.calls[0][1][0];
    expect(saved.countShiftTypeCoefficients).toEqual([['D', 8], ['N', 4]]);
    expect(saved.hoursContract).toEqual({ unit: 'hour' });
  });

  it('declares the unit explicitly at mark time for a reopened unmarked hour-authored count', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day' }],
        groups: [],
      },
      // A saved UNMARKED count authored in hour units (D=8, target=160). It
      // persists no unit, so reopening cannot know it was hour.
      getPreferencesByType: vi.fn(() => [{
        type: 'shift count',
        person: ['P1'],
        countDates: ['2026-01-01'],
        countShiftTypes: ['D'],
        countShiftTypeCoefficients: [['D', 8]],
        expression: 'x >= T',
        target: 160,
        weight: -1,
      }]),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(hoursContractCheckbox());

    // Mark-time declaration surfaces the unit choice + a live credit preview; the
    // stale half-hour pre-fill is visible, not silently authoritative.
    expect(screen.getByText(/LEAVE will count 8h = 16 half-hour units/)).toBeInTheDocument();
    // Save is gated until the unit is confirmed — the prefilled guess cannot slip
    // through with no decision.
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();

    // Declaring hour is a correction, not a conversion: D=8 is NOT rescaled.
    await user.click(contractUnitButton('hour'));
    expect(screen.getByText(/LEAVE will count 8h = 8 hour units/)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(8);

    await user.click(screen.getByRole('button', { name: 'Update' }));
    const saved = updatePreferencesByType.mock.calls[0][1][0];
    // Saved as hour with D=8 ⇒ the read-only Add-LEAVE fix credits 8, not 16.
    expect(saved.hoursContract).toEqual({ unit: 'hour' });
    expect(saved.countShiftTypeCoefficients).toEqual([['D', 8]]);
  });

  it('gates duration auto-fill until the marked unit is confirmed, preventing a mixed-unit persist', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: {
        items: [{ id: 'P1', description: 'Person 1', history: [] }],
        groups: [],
      },
      // D is an 8h shift: 480 min ⇒ 16 half-hour units or 8 hour units.
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day', durationMinutes: 480 }],
        groups: [],
      },
      getPreferencesByType: vi.fn(() => []),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    await user.click(hoursContractCheckbox()); // mark → declaration, prefilled half-hour

    // The repro: auto-fill while declaring would fill D=16 (half-hour) then let
    // "declare hour" skip conversion → mixed unit. It is disabled instead.
    const autofill = screen.getByRole('button', { name: /auto-fill/i });
    expect(autofill).toBeDisabled();
    await user.click(autofill);
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(null);

    // Confirm hour first → auto-fill re-enables and fills in the confirmed unit.
    await user.click(contractUnitButton('hour'));
    const enabledAutofill = screen.getByRole('button', { name: /auto-fill/i });
    expect(enabledAutofill).toBeEnabled();
    await user.click(enabledAutofill);
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(8);

    // Persisted unit matches the unit the coefficients were auto-filled at — no
    // {unit:'hour'} with half-hour-derived values.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    const saved = updatePreferencesByType.mock.calls[0][1][0];
    expect(saved.hoursContract).toEqual({ unit: 'hour' });
    expect(saved.countShiftTypeCoefficients).toEqual([['D', 8]]);
  });

  describe('uncredited-leave guard', () => {
    const markedCount = {
      type: 'shift count',
      description: 'Monthly hours',
      person: ['P1'],
      countDates: ['2026-01-01'],
      countShiftTypes: ['D'],
      countShiftTypeCoefficients: [['D', 16]],
      hoursContract: { unit: 'half-hour' },
      expression: 'x >= T',
      target: 320,
      weight: -1,
    };

    const leaveRequest = {
      type: 'shift request',
      person: ['P1'],
      date: ['2026-01-01'],
      shiftType: [LEAVE],
      weight: Infinity,
    };

    // shiftTypeData mirrors the running app: the reserved LEAVE day-state is a
    // first-class item, so it is filtered out of the worked-shift universe but is
    // still creditable as a coefficient once the fix adds it.
    function mockGuardScenario({
      count = markedCount,
      pinLeave = true,
    }: { count?: object; pinLeave?: boolean } = {}) {
      mockUseSchedulingData.mockReturnValue({
        dateData: {
          range: {
            startDate: new Date('2026-01-01T12:00:00.000Z'),
            endDate: new Date('2026-01-01T12:00:00.000Z'),
          },
          items: [{ id: '2026-01-01', description: 'Jan 1' }],
          groups: [],
        },
        peopleData: {
          items: [{ id: 'P1', description: 'Person 1', history: [] }],
          groups: [],
        },
        shiftTypeData: {
          items: [
            { id: 'D', description: 'Day', durationMinutes: 480 },
            { id: LEAVE, description: 'Paid leave' },
          ],
          groups: [],
        },
        preferences: [...(pinLeave ? [leaveRequest] : []), count],
        getPreferencesByType: vi.fn(() => [count]),
        updatePreferencesByType,
        duplicatePreferenceByType,
      });
    }

    const advisoryText = /paid leave will not\s+count toward contracted hours/i;

    it('badges a marked count that omits LEAVE for a leave-pinned nurse', () => {
      mockGuardScenario();
      renderShiftCountsPage();

      expect(screen.getByText('Leave not credited')).toBeInTheDocument();
    });

    it('shows the edit-form advisory with the read-only unit and previewed credit', async () => {
      const user = userEvent.setup();
      mockGuardScenario();
      renderShiftCountsPage();

      await user.click(screen.getByRole('button', { name: /edit/i }));

      expect(screen.getByText(advisoryText)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add LEAVE (16)' })).toBeInTheDocument();
    });

    it('gates Save and the Add-LEAVE fix until the marked unit is confirmed', async () => {
      const user = userEvent.setup();
      // A reopened UNMARKED count (omits LEAVE) with leave pinned: marking it
      // in-session enters declaration mode and would warn once confirmed.
      mockGuardScenario({ count: { ...markedCount, hoursContract: undefined } });
      renderShiftCountsPage();

      await user.click(screen.getByRole('button', { name: /edit/i }));
      await user.click(hoursContractCheckbox());

      // Declaration mode: Save disabled, reason surfaced, Add-LEAVE withheld.
      const updateButton = screen.getByRole('button', { name: 'Update' });
      expect(updateButton).toBeDisabled();
      expect(screen.getByText(/Confirm the coefficient unit to continue/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add LEAVE/ })).not.toBeInTheDocument();

      // No path persists without an explicit confirmation — neither the disabled
      // button nor the Enter-key shortcut saves.
      await user.click(updateButton);
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(updatePreferencesByType).not.toHaveBeenCalled();

      // Confirming the unit unlocks Save and reveals the Add-LEAVE fix.
      await user.click(contractUnitButton('half-hour'));
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add LEAVE (16)' })).toBeInTheDocument();
    });

    it('does not warn for an unmarked count', () => {
      mockGuardScenario({ count: { ...markedCount, hoursContract: undefined } });
      renderShiftCountsPage();

      expect(screen.queryByText('Leave not credited')).not.toBeInTheDocument();
    });

    it('does not warn when LEAVE is already counted', () => {
      mockGuardScenario({
        count: {
          ...markedCount,
          countShiftTypes: ['D', LEAVE],
          countShiftTypeCoefficients: [['D', 16], [LEAVE, 16]],
        },
      });
      renderShiftCountsPage();

      expect(screen.queryByText('Leave not credited')).not.toBeInTheDocument();
    });

    it('does not warn when no leave is pinned', () => {
      mockGuardScenario({ pinLeave: false });
      renderShiftCountsPage();

      expect(screen.queryByText('Leave not credited')).not.toBeInTheDocument();
    });

    it('never blocks saving while the advisory is shown', async () => {
      const user = userEvent.setup();
      mockGuardScenario();
      renderShiftCountsPage();

      await user.click(screen.getByRole('button', { name: /edit/i }));
      expect(screen.getByText(advisoryText)).toBeInTheDocument();

      // Saving without applying the fix still succeeds — the guard is advisory only.
      await user.click(screen.getByRole('button', { name: 'Update' }));

      expect(updatePreferencesByType).toHaveBeenCalledOnce();
      expect(updatePreferencesByType.mock.calls[0][1][0].countShiftTypes).not.toContain(LEAVE);
    });

    it('credits LEAVE with 16 half-hour units, preserves other coefficients, and clears the advisory', async () => {
      const user = userEvent.setup();
      mockGuardScenario();
      renderShiftCountsPage();

      await user.click(screen.getByRole('button', { name: /edit/i }));
      await user.click(screen.getByRole('button', { name: 'Add LEAVE (16)' }));

      // The advisory clears the moment LEAVE is present.
      expect(screen.queryByText(advisoryText)).not.toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: LEAVE })).toHaveValue(16);

      await user.click(screen.getByRole('button', { name: 'Update' }));

      const saved = updatePreferencesByType.mock.calls[0][1][0];
      expect(saved.countShiftTypes).toContain(LEAVE);
      expect(saved.countShiftTypeCoefficients).toEqual(
        expect.arrayContaining([['D', 16], [LEAVE, 16]])
      );
    });

    it('credits LEAVE with 8 hour units for an hour-unit contract', async () => {
      const user = userEvent.setup();
      mockGuardScenario({
        count: {
          ...markedCount,
          hoursContract: { unit: 'hour' },
          countShiftTypeCoefficients: [['D', 8]],
          target: 160,
        },
      });
      renderShiftCountsPage();

      await user.click(screen.getByRole('button', { name: /edit/i }));
      await user.click(screen.getByRole('button', { name: 'Add LEAVE (8)' }));

      await user.click(screen.getByRole('button', { name: 'Update' }));

      const saved = updatePreferencesByType.mock.calls[0][1][0];
      expect(saved.countShiftTypeCoefficients).toEqual(
        expect.arrayContaining([['D', 8], [LEAVE, 8]])
      );
    });
  });

});
