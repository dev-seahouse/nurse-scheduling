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
  formatWorkingMinutes,
  parseWorkingTime,
  serializeWorkingTime,
  proposeBareToClock,
  proposeClockToBare,
  clearWorkingTime,
} from '@/utils/shiftWorkingTime';

describe('formatWorkingMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatWorkingMinutes(510)).toBe('8h 30m');
    expect(formatWorkingMinutes(480)).toBe('8h');
    expect(formatWorkingMinutes(30)).toBe('30m');
    expect(formatWorkingMinutes(0)).toBe('0m');
  });
});

describe('working-time codec (WT3)', () => {
  describe('parseWorkingTime', () => {
    it('classifies no fields as cleared', () => {
      expect(parseWorkingTime({})).toEqual({ kind: 'cleared' });
    });

    it('treats null (and undefined) as absent, matching the backend Optional fields', () => {
      const nulled = { durationMinutes: null, startTime: null, endTime: null, restMinutes: null } as unknown as Parameters<typeof parseWorkingTime>[0];
      expect(parseWorkingTime(nulled)).toEqual({ kind: 'cleared' });
    });

    it('treats a present empty clock string as invalid, not absence (Finding 4)', () => {
      expect(parseWorkingTime({ startTime: '', endTime: '' })).toMatchObject({ kind: 'invalid', code: 'clock_format' });
      // A present empty start with an absent end is a partial (paired) failure.
      expect(parseWorkingTime({ startTime: '' })).toMatchObject({ kind: 'invalid', code: 'start_end_paired' });
      expect(parseWorkingTime({ startTime: '', endTime: '16:00', durationMinutes: 480 }))
        .toMatchObject({ kind: 'invalid', code: 'clock_format' });
    });

    it('accepts a bare positive grid duration', () => {
      expect(parseWorkingTime({ durationMinutes: 480 })).toEqual({ kind: 'bare', durationMinutes: 480 });
    });

    it('rejects a non-positive or off-grid bare duration', () => {
      expect(parseWorkingTime({ durationMinutes: 0 })).toMatchObject({ kind: 'invalid', code: 'duration_positive' });
      expect(parseWorkingTime({ durationMinutes: 460 })).toMatchObject({ kind: 'invalid', code: 'duration_grid' });
      expect(parseWorkingTime({ durationMinutes: 30.5 })).toMatchObject({ kind: 'invalid', code: 'duration_integer' });
    });

    it('accepts a clock shape with a matching duration and no rest', () => {
      expect(parseWorkingTime({ startTime: '08:00', endTime: '16:00', durationMinutes: 480 })).toEqual({
        kind: 'clock',
        startTime: '08:00',
        endTime: '16:00',
        durationMinutes: 480,
      });
    });

    it('treats an earlier end time as overnight (+24h)', () => {
      expect(parseWorkingTime({ startTime: '20:00', endTime: '08:00', durationMinutes: 720 })).toMatchObject({
        kind: 'clock',
        durationMinutes: 720,
      });
    });

    it('subtracts rest and keeps a positive rest', () => {
      expect(parseWorkingTime({ startTime: '08:00', endTime: '17:00', restMinutes: 60, durationMinutes: 480 })).toEqual({
        kind: 'clock',
        startTime: '08:00',
        endTime: '17:00',
        durationMinutes: 480,
        restMinutes: 60,
      });
    });

    it('canonicalizes explicit zero rest to omission', () => {
      const shape = parseWorkingTime({ startTime: '09:00', endTime: '17:00', restMinutes: 0, durationMinutes: 480 });
      expect(shape).toEqual({ kind: 'clock', startTime: '09:00', endTime: '17:00', durationMinutes: 480 });
      expect(shape).not.toHaveProperty('restMinutes');
    });

    it('rejects partial clock, equal times, off-grid clock, bad rest, and duration disagreement', () => {
      expect(parseWorkingTime({ startTime: '08:00' })).toMatchObject({ kind: 'invalid', code: 'start_end_paired' });
      expect(parseWorkingTime({ restMinutes: 30 })).toMatchObject({ kind: 'invalid', code: 'rest_without_clock' });
      expect(parseWorkingTime({ startTime: '08:00', endTime: '08:00', durationMinutes: 0 }))
        .toMatchObject({ kind: 'invalid', code: 'equal_times' });
      expect(parseWorkingTime({ startTime: '23:59', endTime: '08:00', durationMinutes: 480 }))
        .toMatchObject({ kind: 'invalid', code: 'clock_format' });
      expect(parseWorkingTime({ startTime: '08:00', endTime: '17:00', restMinutes: 20, durationMinutes: 520 }))
        .toMatchObject({ kind: 'invalid', code: 'rest_grid' });
      expect(parseWorkingTime({ startTime: '08:00', endTime: '09:00', restMinutes: 60, durationMinutes: 0 }))
        .toMatchObject({ kind: 'invalid', code: 'rest_too_large' });
      expect(parseWorkingTime({ startTime: '08:00', endTime: '16:00' }))
        .toMatchObject({ kind: 'invalid', code: 'duration_required' });
      expect(parseWorkingTime({ startTime: '08:00', endTime: '16:00', durationMinutes: 470 }))
        .toMatchObject({ kind: 'invalid', code: 'duration_mismatch' });
    });
  });

  describe('serializeWorkingTime', () => {
    it('omits zero/absent rest and empty fields', () => {
      expect(serializeWorkingTime({ kind: 'cleared' })).toEqual({});
      expect(serializeWorkingTime({ kind: 'bare', durationMinutes: 480 })).toEqual({ durationMinutes: 480 });
      expect(serializeWorkingTime({ kind: 'clock', startTime: '09:00', endTime: '17:00', durationMinutes: 480 }))
        .toEqual({ startTime: '09:00', endTime: '17:00', durationMinutes: 480 });
      expect(serializeWorkingTime({ kind: 'clock', startTime: '08:00', endTime: '17:00', durationMinutes: 480, restMinutes: 60 }))
        .toEqual({ startTime: '08:00', endTime: '17:00', durationMinutes: 480, restMinutes: 60 });
    });
  });

  describe('conversions', () => {
    it('bare → clock derives the paid duration and validates', () => {
      expect(proposeBareToClock('08:00', '17:00', 60)).toEqual({
        kind: 'clock',
        startTime: '08:00',
        endTime: '17:00',
        durationMinutes: 480,
        restMinutes: 60,
      });
      expect(proposeBareToClock('08:00', '08:00')).toMatchObject({ kind: 'invalid', code: 'equal_times' });
    });

    it('clock → bare retains the paid duration and drops clock/rest', () => {
      const clock = parseWorkingTime({ startTime: '08:00', endTime: '17:00', restMinutes: 60, durationMinutes: 480 });
      expect(proposeClockToBare(clock)).toEqual({ kind: 'bare', durationMinutes: 480 });
      // A non-clock shape is returned unchanged.
      expect(proposeClockToBare({ kind: 'bare', durationMinutes: 300 })).toEqual({ kind: 'bare', durationMinutes: 300 });
    });

    it('clear removes all fields', () => {
      expect(clearWorkingTime()).toEqual({ kind: 'cleared' });
      expect(serializeWorkingTime(clearWorkingTime() as { kind: 'cleared' })).toEqual({});
    });
  });
});
