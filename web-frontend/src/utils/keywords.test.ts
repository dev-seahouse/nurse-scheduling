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

import {
  AUTO_GENERATED_ITEMS,
  LEAVE,
  LEAVE_CREDIT_MINUTES,
  OFF,
  getReservedKeywords,
  isReservedKeyword,
} from '@/utils/keywords';
import { DataType } from '@/types/scheduling';

describe('LEAVE reserved day-state keyword', () => {
  it('is an auto-generated shift-type item alongside OFF', () => {
    const ids = AUTO_GENERATED_ITEMS[DataType.SHIFT_TYPES].map(item => item.id);
    expect(ids).toContain(OFF);
    expect(ids).toContain(LEAVE);
  });

  it('is a reserved shift-type keyword (case-insensitive)', () => {
    expect(getReservedKeywords(DataType.SHIFT_TYPES)).toContain(LEAVE);
    expect(isReservedKeyword(DataType.SHIFT_TYPES, 'LEAVE')).toBe(true);
    expect(isReservedKeyword(DataType.SHIFT_TYPES, 'leave')).toBe(true);
  });

  it('is not reserved for people or dates', () => {
    expect(isReservedKeyword(DataType.PEOPLE, 'LEAVE')).toBe(false);
    expect(isReservedKeyword(DataType.DATES, 'LEAVE')).toBe(false);
  });

  it('credits a fixed 8h (480 minutes) for this pass', () => {
    expect(LEAVE_CREDIT_MINUTES).toBe(480);
  });
});
