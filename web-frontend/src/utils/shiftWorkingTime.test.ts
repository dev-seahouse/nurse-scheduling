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
  computeClockSpanMinutes,
  deriveWorkingMinutes,
  formatWorkingMinutes,
  parseClockTimeToMinutes,
} from '@/utils/shiftWorkingTime';

describe('parseClockTimeToMinutes', () => {
  it('parses valid HH:MM clock times to minutes since midnight', () => {
    expect(parseClockTimeToMinutes('00:00')).toBe(0);
    expect(parseClockTimeToMinutes('08:00')).toBe(480);
    expect(parseClockTimeToMinutes('20:30')).toBe(1230);
    expect(parseClockTimeToMinutes('23:59')).toBe(1439);
    expect(parseClockTimeToMinutes(' 08:00 ')).toBe(480);
  });

  it('returns null for malformed or out-of-range times', () => {
    expect(parseClockTimeToMinutes('')).toBeNull();
    expect(parseClockTimeToMinutes('8')).toBeNull();
    expect(parseClockTimeToMinutes('24:00')).toBeNull();
    expect(parseClockTimeToMinutes('08:60')).toBeNull();
    expect(parseClockTimeToMinutes('foo')).toBeNull();
  });
});

describe('computeClockSpanMinutes', () => {
  it('computes same-day spans', () => {
    expect(computeClockSpanMinutes(480, 960)).toBe(480); // 08:00 → 16:00
  });

  it('wraps overnight spans across midnight (+24h)', () => {
    expect(computeClockSpanMinutes(1200, 480)).toBe(720); // 20:00 → 08:00 = 12h
  });

  it('treats an equal start and end as zero, not a full day', () => {
    expect(computeClockSpanMinutes(480, 480)).toBe(0);
  });
});

describe('deriveWorkingMinutes', () => {
  it('derives paid minutes for a normal shift with rest', () => {
    // 08:00 → 16:00 span 480, rest 30 → 450 paid.
    expect(deriveWorkingMinutes('08:00', '16:00', 30)).toEqual({
      spanMinutes: 480,
      workingMinutes: 450,
    });
  });

  it('derives an off-grid 7h40m result', () => {
    // 08:00 → 16:00 span 480, rest 20 → 460 paid = 7h 40m.
    const result = deriveWorkingMinutes('08:00', '16:00', 20);
    expect(result.workingMinutes).toBe(460);
    expect(formatWorkingMinutes(result.workingMinutes!)).toBe('7h 40m');
  });

  it('derives paid minutes for an overnight shift', () => {
    // 22:00 → 06:00 span 480, rest 60 → 420 paid.
    expect(deriveWorkingMinutes('22:00', '06:00', 60)).toEqual({
      spanMinutes: 480,
      workingMinutes: 420,
    });
  });

  it('allows zero rest', () => {
    expect(deriveWorkingMinutes('09:00', '17:00', 0)).toEqual({
      spanMinutes: 480,
      workingMinutes: 480,
    });
  });

  it('rejects rest greater than or equal to the span', () => {
    expect(deriveWorkingMinutes('08:00', '12:00', 240).error).toMatch(/less than/i);
    expect(deriveWorkingMinutes('08:00', '12:00', 300).error).toMatch(/less than/i);
  });

  it('rejects an end equal to the start (non-positive span)', () => {
    expect(deriveWorkingMinutes('08:00', '08:00', 0).error).toMatch(/differ/i);
  });

  it('rejects malformed times', () => {
    expect(deriveWorkingMinutes('', '16:00', 0).error).toMatch(/HH:MM/);
    expect(deriveWorkingMinutes('08:00', '', 0).error).toMatch(/HH:MM/);
  });
});

describe('formatWorkingMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatWorkingMinutes(460)).toBe('7h 40m');
    expect(formatWorkingMinutes(480)).toBe('8h');
    expect(formatWorkingMinutes(45)).toBe('45m');
    expect(formatWorkingMinutes(0)).toBe('0m');
  });
});
