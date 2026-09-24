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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShiftTypeCoveringsPage from '@/app/shift-type-coverings/page';
import { UnsavedEditingStateProvider } from '@/utils/unsavedEditingState';

const mockUseSchedulingData = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSchedulingData', () => ({
  useSchedulingData: mockUseSchedulingData,
}));

function renderShiftTypeCoveringsPage() {
  return render(
    <UnsavedEditingStateProvider>
      <ShiftTypeCoveringsPage />
    </UnsavedEditingStateProvider>
  );
}

describe('ShiftTypeCoveringsPage', () => {
  const updatePreferencesByType = vi.fn();
  const duplicatePreferenceByType = vi.fn();

  beforeEach(() => {
    updatePreferencesByType.mockReset();
    duplicatePreferenceByType.mockReset();
    mockUseSchedulingData.mockReturnValue({
      dateData: {
        range: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-03'),
        },
        items: [{ id: '2024-01-01', description: 'Mon' }],
        groups: [],
      },
      peopleData: {
        items: [
          { id: 'Anna', description: '' },
          { id: 'Lil', description: '' },
        ],
        groups: [],
      },
      shiftTypeData: {
        items: [{ id: 'D', description: 'Day' }],
        groups: [],
      },
      getPreferencesByType: () => [],
      updatePreferencesByType,
      duplicatePreferenceByType,
    });
  });

  it('opens the form when clicking Add Shift Type Covering', async () => {
    const user = userEvent.setup();
    renderShiftTypeCoveringsPage();

    const addBtn = screen.getByRole('button', { name: /add shift type covering/i });
    await user.click(addBtn);

    expect(screen.getByRole('heading', { level: 2, name: /add shift type covering/i })).toBeInTheDocument();
    expect(screen.getByText(/preceptors/i)).toBeInTheDocument();
    expect(screen.getByText(/preceptees/i)).toBeInTheDocument();
    expect(screen.getByText(/shift types \*/i)).toBeInTheDocument();
  });

  it('renders the weight field with a single label (not duplicated)', async () => {
    const user = userEvent.setup();
    renderShiftTypeCoveringsPage();

    const addBtn = screen.getByRole('button', { name: /add shift type covering/i });
    await user.click(addBtn);

    // WeightInput renders its own label. There must be exactly one occurrence
    // of "Weight (priority)" inside the weight field.
    const matches = screen.getAllByText(/weight \(priority\)/i);
    expect(matches).toHaveLength(1);
  });

  async function addRule(user: ReturnType<typeof userEvent.setup>, selectDate: boolean) {
    await user.click(screen.getByRole('button', { name: /add shift type covering/i }));
    if (selectDate) await user.click(screen.getByRole('checkbox', { name: '2024-01-01' }));
    await user.click(screen.getAllByRole('checkbox', { name: 'Anna' })[0]);
    await user.click(screen.getAllByRole('checkbox', { name: 'Lil' })[1]);
    await user.click(screen.getByRole('checkbox', { name: 'D' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
  }

  it('saves the selected dates with the rule', async () => {
    const user = userEvent.setup();
    renderShiftTypeCoveringsPage();

    await addRule(user, true);

    const saved = updatePreferencesByType.mock.calls.at(-1)?.at(-1);
    expect(saved).toEqual([expect.objectContaining({ date: ['2024-01-01'], preceptors: [['Anna']], preceptees: [['Lil']] })]);
  });

  it('omits the date field when no date is selected, meaning all dates', async () => {
    const user = userEvent.setup();
    renderShiftTypeCoveringsPage();

    await addRule(user, false);

    const saved = updatePreferencesByType.mock.calls.at(-1)?.at(-1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty('date');
  });

  it('renders existing rules in the list', () => {
    const existing = {
      type: 'shift type covering',
      description: 'Ana covers Ana on Day',
      preceptors: [['Ana (senior staff)']],
      preceptees: [['Ana (senior staff)']],
      shiftTypes: [['Day']],
      weight: 1,
    };
    mockUseSchedulingData.mockReturnValueOnce({
      ...mockUseSchedulingData(),
      getPreferencesByType: () => [existing],
    });
    renderShiftTypeCoveringsPage();

    expect(screen.getByText('Ana covers Ana on Day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
