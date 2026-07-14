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

// Shift-type working-time math (WT4). A Shift Type may be authored with a
// time-in / time-out clock span and an unpaid rest; the paid working minutes
// that feed the coefficient auto-fill (WT5) are `span − rest`. Times are stored
// as "HH:MM" 24h strings and round-trip durably; overnight shifts (end < start)
// span midnight (+24h). Everything here is pure so the editor and its tests
// share one derivation.

export const MINUTES_PER_DAY = 24 * 60;

// Parse an "HH:MM" 24-hour clock string to minutes-since-midnight in [0, 1439],
// or null when the string is not a valid clock time.
export function parseClockTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

// Clock span in minutes from start to end. An end at or before the start is
// read as crossing midnight (+24h), so 20:00 → 08:00 is 12h. An end equal to
// the start stays 0 (rejected upstream) rather than becoming a 24h shift.
export function computeClockSpanMinutes(startMinutes: number, endMinutes: number): number {
  const raw = endMinutes - startMinutes;
  return raw < 0 ? raw + MINUTES_PER_DAY : raw;
}

export interface WorkingTimeDerivation {
  spanMinutes?: number;
  // Paid working minutes = span − rest. Present only when the inputs are valid.
  workingMinutes?: number;
  error?: string;
}

// Derive paid working minutes from the authored clock times and rest. Returns a
// single inline `error` string when the inputs cannot yield a positive result.
export function deriveWorkingMinutes(
  startTime: string,
  endTime: string,
  restMinutes: number
): WorkingTimeDerivation {
  const start = parseClockTimeToMinutes(startTime);
  const end = parseClockTimeToMinutes(endTime);
  if (start === null || end === null) {
    return { error: 'Enter start and end time as HH:MM.' };
  }

  const spanMinutes = computeClockSpanMinutes(start, end);
  if (spanMinutes <= 0) {
    return { error: 'End time must differ from start time.' };
  }

  if (!Number.isFinite(restMinutes) || restMinutes < 0) {
    return { spanMinutes, error: 'Rest must be zero or more.' };
  }
  if (restMinutes >= spanMinutes) {
    return { spanMinutes, error: 'Rest must be less than the shift length.' };
  }

  return { spanMinutes, workingMinutes: spanMinutes - restMinutes };
}

// Human-readable duration, e.g. 460 → "7h 40m", 480 → "8h", 45 → "45m".
export function formatWorkingMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}
