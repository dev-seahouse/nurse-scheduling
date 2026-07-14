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
  autoFillCoefficientsFromDurations,
  getCoefficientShiftTypeIds,
  getLeaveCreditCoefficient,
  syncCoefficientPairs,
  updateCoefficientPair,
  upsertCoefficientPair,
  validateCoefficientPairs,
  parseHoursContract,
  HALF_HOUR_UNIT_MINUTES,
  LEAVE_CREDIT_HALF_HOUR_UNITS,
} from '@/utils/countShiftTypeCoefficients';
import * as countModule from '@/utils/countShiftTypeCoefficients';
import { LEAVE } from '@/utils/keywords';

const shiftTypeData = {
  items: [
    { id: 'D', description: 'Day' },
    { id: 'N', description: 'Night' },
  ],
  groups: [{ id: 'WORK', members: ['D', 'N'], description: 'Working shifts' }],
};

describe('countShiftTypeCoefficients', () => {
  it('drops deselected coefficients and preserves selected coefficients', () => {
    const afterDeselect = syncCoefficientPairs(['N'], [['D', 3], ['N', 2]], shiftTypeData);
    const afterReselect = syncCoefficientPairs(['N', 'D'], afterDeselect, shiftTypeData);

    expect(afterDeselect).toEqual([['N', 2]]);
    expect(afterReselect).toEqual([['D', ''], ['N', 2], ['WORK', '']]);
  });

  it('uses selected item coverage to include fully covered groups', () => {
    expect(getCoefficientShiftTypeIds(['D', 'N'], shiftTypeData)).toEqual(['D', 'N', 'WORK']);
  });

  it('expands selected groups into coefficient item options', () => {
    expect(syncCoefficientPairs(['WORK'], [['D', 2]], shiftTypeData)).toEqual([
      ['D', 2],
      ['N', ''],
      ['WORK', ''],
    ]);
  });

  it('leaves missing coefficients blank and omits them from output', () => {
    expect(validateCoefficientPairs(['D', 'N'], [], shiftTypeData)).toEqual({
      coefficients: [],
      errorsById: {},
      overlapError: undefined,
    });
  });

  it('updates one coefficient while preserving selected pairs', () => {
    expect(updateCoefficientPair(['D', 'N'], [['D', 1], ['N', 2]], 'D', 4)).toEqual([
      ['D', 4],
      ['N', 2],
    ]);
  });

  it('returns field errors before checking overlap', () => {
    expect(validateCoefficientPairs(['D', 'WORK'], [['D', 0], ['WORK', 3]], shiftTypeData)).toEqual({
      coefficients: [],
      errorsById: {
        D: 'Coefficient for D must be an integer of at least 1',
      },
    });
  });

  it('detects overlap among explicit coefficients', () => {
    expect(validateCoefficientPairs(['D', 'WORK'], [['D', 2], ['WORK', 3]], shiftTypeData)).toEqual({
      coefficients: [['D', 2], ['WORK', 3]],
      errorsById: {},
      overlapError: 'Shift type coefficients overlap: D, WORK include D',
    });
  });

  it('keeps explicit coefficient one and detects overlap against containing groups', () => {
    expect(validateCoefficientPairs(['D', 'WORK'], [['D', 1], ['WORK', 2]], shiftTypeData)).toEqual({
      coefficients: [['D', 1], ['WORK', 2]],
      errorsById: {},
      overlapError: 'Shift type coefficients overlap: D, WORK include D',
    });
  });

  describe('autoFillCoefficientsFromDurations', () => {
    const durationShiftTypeData = {
      items: [
        { id: 'D', description: 'Day', durationMinutes: 750 },  // 12.5h
        { id: 'AM', description: 'Morning', durationMinutes: 480 },  // 8h
        { id: LEAVE, description: 'Paid leave' },
      ],
      groups: [],
    };

    it('fills coefficients from durations in half-hour units, crediting LEAVE 8h', () => {
      const result = autoFillCoefficientsFromDurations(['D', 'AM', LEAVE], [], durationShiftTypeData);
      expect(result).toEqual([['D', 25], ['AM', 16], [LEAVE, 16]]);
    });

    it('preserves the current value for shift types without a duration', () => {
      const noDurationData = { items: [{ id: 'X', description: 'No duration' }], groups: [] };
      const result = autoFillCoefficientsFromDurations(['X'], [['X', 4]], noDurationData);
      expect(result).toEqual([['X', 4]]);
    });
  });

  describe('upsertCoefficientPair', () => {
    it('appends a new pair, preserving all existing pairs in order', () => {
      const result = upsertCoefficientPair([['D', 25], ['AM', 16]], LEAVE, 16);
      expect(result).toEqual([['D', 25], ['AM', 16], [LEAVE, 16]]);
    });

    it('updates an existing pair in place without disturbing the others', () => {
      const result = upsertCoefficientPair([['D', 25], [LEAVE, 8], ['AM', 16]], LEAVE, 16);
      expect(result).toEqual([['D', 25], [LEAVE, 16], ['AM', 16]]);
    });

    it('does not mutate the input array', () => {
      const pairs: [string, number | string][] = [['D', 25]];
      upsertCoefficientPair(pairs, LEAVE, 16);
      expect(pairs).toEqual([['D', 25]]);
    });
  });

  describe('getLeaveCreditCoefficient', () => {
    it('credits a fixed 16 half-hour units for an 8h leave day', () => {
      expect(getLeaveCreditCoefficient()).toBe(16);
      expect(LEAVE_CREDIT_HALF_HOUR_UNITS).toBe(16);
      expect(HALF_HOUR_UNIT_MINUTES).toBe(30);
    });
  });

  it('no longer exposes the retired unit-picker/conversion machinery (WT3 cleanup)', () => {
    // The fixed half-hour unit means no unit picker, minutes map, or conversion.
    expect('HOURS_CONTRACT_UNITS' in countModule).toBe(false);
    expect('getUnitMinutes' in countModule).toBe(false);
    expect('HOUR_UNIT_MINUTES' in countModule).toBe(false);
    expect('isHoursContractUnit' in countModule).toBe(false);
  });

  describe('parseHoursContract (structural, WT3)', () => {
    it('accepts exactly the fixed { unit: "half-hour", policy } marker', () => {
      expect(parseHoursContract({ unit: 'half-hour', policy: 'exact' })).toEqual({
        ok: true,
        value: { unit: 'half-hour', policy: 'exact' },
      });
      expect(parseHoursContract({ unit: 'half-hour', policy: 'range' })).toEqual({
        ok: true,
        value: { unit: 'half-hour', policy: 'range' },
      });
    });

    it('rejects retired hour/minute units clearly (never silently normalized)', () => {
      expect(parseHoursContract({ unit: 'hour', policy: 'exact' }).ok).toBe(false);
      expect(parseHoursContract({ unit: 'minute', policy: 'range' }).ok).toBe(false);
      // A bare legacy { unit } marker (no policy) is rejected, not upgraded.
      expect(parseHoursContract({ unit: 'half-hour' }).ok).toBe(false);
      expect(parseHoursContract({ unit: 'hour' }).ok).toBe(false);
    });

    it('rejects missing/invalid policy, extra keys, and non-object values', () => {
      expect(parseHoursContract({ unit: 'half-hour', policy: 'soft' }).ok).toBe(false);
      expect(parseHoursContract({ unit: 'half-hour', policy: 'exact', extra: 1 }).ok).toBe(false);
      expect(parseHoursContract({}).ok).toBe(false);
      expect(parseHoursContract(null).ok).toBe(false);
      expect(parseHoursContract(undefined).ok).toBe(false);
      expect(parseHoursContract('half-hour').ok).toBe(false);
      expect(parseHoursContract([{ unit: 'half-hour', policy: 'exact' }]).ok).toBe(false);
    });
  });
});
