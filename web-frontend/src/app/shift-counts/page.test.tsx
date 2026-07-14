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

import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('creates an exact Contracted Hours rule through its separate entry path', async () => {
    const user = userEvent.setup();
    renderShiftCountsPage();

    await user.click(screen.getAllByRole('button', { name: 'Add Contracted Hours' }).at(-1)!);
    expect(screen.getByRole('heading', { name: 'Add Contracted Hours' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Exact' })).toBeChecked();
    expect(screen.getByLabelText('Exact total hours for current window')).toHaveAttribute('step', '0.5');
    await user.click(screen.getByRole('checkbox', { name: 'P1' }));
    await user.click(screen.getByRole('checkbox', { name: '2026-01-01' }));
    await user.click(screen.getByRole('checkbox', { name: 'D' }));
    await user.click(screen.getByRole('button', { name: 'Solver details & overrides' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'D coefficient' }), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Exact total hours for current window'), { target: { value: '160' } });
    await user.click(screen.getAllByRole('button', { name: 'Add Contracted Hours' }).at(-1)!);

    expect(updatePreferencesByType).toHaveBeenCalledWith('shift count', [expect.objectContaining({
      hoursContract: { unit: 'half-hour', policy: 'exact' },
      expression: 'x = T',
      target: 320,
      weight: Infinity,
      countShiftTypeCoefficients: [['D', 16]],
    })]);
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

  // WT3: the generic scalar editor has one fixed half-hour unit — no unit picker,
  // no conversion, no marked-authoring. Auto-fill derives coefficients at 30-min.
  it('auto-fills coefficients from durations at the fixed half-hour unit (no unit picker)', async () => {
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          endDate: new Date('2026-01-01T12:00:00.000Z'),
        },
        items: [{ id: '2026-01-01', description: 'Jan 1' }],
        groups: [],
      },
      peopleData: { items: [{ id: 'P1', description: 'Person 1', history: [] }], groups: [] },
      shiftTypeData: { items: [{ id: 'D', description: 'Day', durationMinutes: 480 }], groups: [] },
      getPreferencesByType: vi.fn(() => []),
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
    const user = userEvent.setup();
    renderShiftCountsPage();

    await fillRequiredFieldsAndSelectShiftTypes(user, ['D']);
    expect(screen.queryByRole('group', { name: 'Coefficient unit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Contract unit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /contracted monthly hours/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /auto-fill/i }));
    expect(screen.getByRole('spinbutton', { name: 'D' })).toHaveValue(16); // 480 / 30

    fireEvent.change(screen.getByPlaceholderText('e.g., 5'), { target: { value: '320' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(updatePreferencesByType).toHaveBeenCalledOnce();
    const saved = updatePreferencesByType.mock.calls[0][1][0];
    expect(saved.countShiftTypeCoefficients).toEqual([['D', 16]]);
    expect(saved).not.toHaveProperty('hoursContract');
  });

  describe('marked and advanced counts are preserved but not scalar-editable (WT3)', () => {
    function mockWithCount(count: object) {
      mockUseSchedulingData.mockReturnValue({
        dateData: {
          range: {
            startDate: new Date('2026-01-01T12:00:00.000Z'),
            endDate: new Date('2026-01-01T12:00:00.000Z'),
          },
          items: [{ id: '2026-01-01', description: 'Jan 1' }],
          groups: [],
        },
        peopleData: { items: [{ id: 'P1', description: 'Person 1', history: [] }], groups: [] },
        shiftTypeData: {
          items: [
            { id: 'D', description: 'Day' },
            { id: 'N', description: 'Night' },
          ],
          groups: [],
        },
        getPreferencesByType: vi.fn(() => [count]),
        updatePreferencesByType,
        duplicatePreferenceByType,
      });
    }

    const exactContract = {
      type: 'shift count',
      person: ['P1'],
      countDates: ['2026-01-01'],
      countShiftTypes: ['D'],
      countShiftTypeCoefficients: [['D', 16]],
      hoursContract: { unit: 'half-hour', policy: 'exact' },
      expression: 'x = T',
      target: 320,
      weight: Infinity,
    };
    const rangeContract = {
      type: 'shift count',
      person: ['P1'],
      countDates: ['2026-01-01'],
      countShiftTypes: ['D'],
      hoursContract: { unit: 'half-hour', policy: 'range' },
      expression: ['x >= T', 'x <= T'],
      target: [300, 340],
      weight: Infinity,
    };
    const advancedList = {
      type: 'shift count',
      person: ['P1'],
      countDates: ['2026-01-01'],
      countShiftTypes: ['D'],
      expression: ['x >= T', 'x <= T'],
      target: [1, 3],
      weight: 1,
    };

    it('badges a Contracted Hours count and renders its policy', () => {
      mockWithCount(exactContract);
      renderShiftCountsPage();
      expect(screen.getByText(/Contracted Hours \(exact\)/)).toBeInTheDocument();
      expect(screen.getByText(/x = 320/)).toBeInTheDocument();
    });

    it('renders a Range contract expression pair without flattening', () => {
      mockWithCount(rangeContract);
      renderShiftCountsPage();
      expect(screen.getByText(/x >= 300, x <= 340/)).toBeInTheDocument();
      expect(screen.getByText(/Contracted Hours \(range\)/)).toBeInTheDocument();
    });

    it('opens a marked count in the guided Contracted Hours editor without changing the store', async () => {
      const user = userEvent.setup();
      mockWithCount(exactContract);
      renderShiftCountsPage();
      await user.click(screen.getByRole('button', { name: /edit/i }));
      expect(screen.getByRole('heading', { name: 'Edit Contracted Hours' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
      expect(screen.queryByText('Edit Shift Count')).not.toBeInTheDocument();
      expect(updatePreferencesByType).not.toHaveBeenCalled();
    });

    it('badges and steers an advanced list count away from the scalar editor', async () => {
      const user = userEvent.setup();
      mockWithCount(advancedList);
      renderShiftCountsPage();
      expect(screen.getByText(/Advanced \(list\)/)).toBeInTheDocument();
      expect(screen.getByText(/x >= 1, x <= 3/)).toBeInTheDocument();
      expect(screen.getByText('Advanced expressions and targets')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Edit in YAML' })).toHaveAttribute('href', '/save-and-load');
      await user.click(screen.getByRole('button', { name: /edit/i }));
      expect(screen.getByText(/advanced list-based shift count/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    });

    it('duplicates a marked count through the store, preserving the marker', async () => {
      const user = userEvent.setup();
      mockWithCount(exactContract);
      renderShiftCountsPage();
      await user.click(screen.getByRole('button', { name: /duplicate/i }));
      expect(duplicatePreferenceByType).toHaveBeenCalledWith('shift count', 0);
    });
  });

  describe('uncredited-leave guard (saved-count badge)', () => {
    const markedCount = {
      type: 'shift count',
      description: 'Monthly hours',
      person: ['P1'],
      countDates: ['2026-01-01'],
      countShiftTypes: ['D'],
      countShiftTypeCoefficients: [['D', 16]],
      hoursContract: { unit: 'half-hour', policy: 'exact' },
      expression: 'x = T',
      target: 320,
      weight: Infinity,
    };

    const leaveRequest = {
      type: 'shift request',
      person: ['P1'],
      date: ['2026-01-01'],
      shiftType: [LEAVE],
      weight: Infinity,
    };

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

    it('badges a marked count that omits LEAVE for a leave-pinned nurse', () => {
      mockGuardScenario();
      renderShiftCountsPage();

      expect(screen.getByText('Leave not credited')).toBeInTheDocument();
    });

    it('does not badge an unmarked count', () => {
      mockGuardScenario({ count: { ...markedCount, hoursContract: undefined } });
      renderShiftCountsPage();

      expect(screen.queryByText('Leave not credited')).not.toBeInTheDocument();
    });

    it('does not badge when LEAVE is already counted', () => {
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

    it('does not badge when no leave is pinned', () => {
      mockGuardScenario({ pinLeave: false });
      renderShiftCountsPage();

      expect(screen.queryByText('Leave not credited')).not.toBeInTheDocument();
    });
  });

});
