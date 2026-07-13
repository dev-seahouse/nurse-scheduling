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
  getUnitMinutes,
  isHoursContractUnit,
  parseHoursContract,
  HOURS_CONTRACT_UNITS,
  HALF_HOUR_UNIT_MINUTES,
  HOUR_UNIT_MINUTES,
} from '@/utils/countShiftTypeCoefficients';
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
      const result = autoFillCoefficientsFromDurations(
        ['D', 'AM', LEAVE],
        [],
        durationShiftTypeData,
        HALF_HOUR_UNIT_MINUTES
      );
      expect(result).toEqual([['D', 25], ['AM', 16], [LEAVE, 16]]);
    });

    it('fills coefficients in hour units', () => {
      const result = autoFillCoefficientsFromDurations(
        ['AM', LEAVE],
        [],
        durationShiftTypeData,
        HOUR_UNIT_MINUTES
      );
      expect(result).toEqual([['AM', 8], [LEAVE, 8]]);
    });

    it('preserves the current value for shift types without a duration', () => {
      const noDurationData = { items: [{ id: 'X', description: 'No duration' }], groups: [] };
      const result = autoFillCoefficientsFromDurations(['X'], [['X', 4]], noDurationData, HALF_HOUR_UNIT_MINUTES);
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
    it('credits 16 half-hour units and 8 hour units for an 8h leave day', () => {
      expect(getLeaveCreditCoefficient('half-hour')).toBe(16);
      expect(getLeaveCreditCoefficient('hour')).toBe(8);
    });
  });

  describe('hours-contract unit mapping', () => {
    it('exposes exactly the supported units', () => {
      expect(HOURS_CONTRACT_UNITS).toEqual(['half-hour', 'hour']);
    });

    it('maps each unit to its minutes through the single owner', () => {
      expect(getUnitMinutes('half-hour')).toBe(HALF_HOUR_UNIT_MINUTES);
      expect(getUnitMinutes('hour')).toBe(HOUR_UNIT_MINUTES);
    });

    it('recognizes only the supported unit strings', () => {
      expect(isHoursContractUnit('half-hour')).toBe(true);
      expect(isHoursContractUnit('hour')).toBe(true);
      expect(isHoursContractUnit('minutes')).toBe(false);
      expect(isHoursContractUnit('')).toBe(false);
      expect(isHoursContractUnit(undefined)).toBe(false);
      expect(isHoursContractUnit(30)).toBe(false);
      // Prototype keys must not leak through the guard.
      expect(isHoursContractUnit('constructor')).toBe(false);
      expect(isHoursContractUnit('toString')).toBe(false);
    });
  });

  describe('parseHoursContract', () => {
    it('accepts the exact { unit } shape', () => {
      expect(parseHoursContract({ unit: 'half-hour' })).toEqual({ unit: 'half-hour' });
      expect(parseHoursContract({ unit: 'hour' })).toEqual({ unit: 'hour' });
    });

    it('rejects empty, unknown-unit, and extra-key objects', () => {
      expect(parseHoursContract({})).toBeUndefined();
      expect(parseHoursContract({ unit: 'minutes' })).toBeUndefined();
      expect(parseHoursContract({ unit: 'hour', extra: 1 })).toBeUndefined();
    });

    it('rejects non-object and array values', () => {
      expect(parseHoursContract(null)).toBeUndefined();
      expect(parseHoursContract(undefined)).toBeUndefined();
      expect(parseHoursContract('hour')).toBeUndefined();
      expect(parseHoursContract(['hour'])).toBeUndefined();
      expect(parseHoursContract([{ unit: 'hour' }])).toBeUndefined();
    });
  });
});
