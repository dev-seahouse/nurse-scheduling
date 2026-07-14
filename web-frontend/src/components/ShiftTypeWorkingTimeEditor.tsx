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

"use client";

import { useEffect, useState } from "react";
import {
  formatWorkingMinutes,
  parseWorkingTime,
  proposeBareToClock,
  proposeClockToBare,
  serializeWorkingTime,
  type WorkingTimeFields,
  type WorkingTimeShape,
} from "@/utils/shiftWorkingTime";

type WorkingTimeMode = "cleared" | "bare" | "clock";
type Conversion = "to-clock" | "to-bare" | null;

interface ShiftTypeWorkingTimeEditorProps {
  initialFields: WorkingTimeFields;
  onChange: (fields: WorkingTimeFields, error: string) => void;
}

interface InitialEditorState {
  mode: WorkingTimeMode;
  fields: WorkingTimeFields;
  durationHours: string;
  durationMinutes: string;
  startTime: string;
  endTime: string;
  restMinutes: string;
  error: string;
}

const inputClasses = "block w-28 px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:border-blue-500 focus:ring-blue-200 hover:border-gray-400";
const secondaryButtonClasses = "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50";
const primaryButtonClasses = "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700";

const restOptions = Array.from({ length: 47 }, (_, index) => (index + 1) * 30);

function errorMessage(shape: Extract<WorkingTimeShape, { kind: "invalid" }>): string {
  switch (shape.code) {
    case "start_end_paired":
    case "clock_format":
      return "Enter complete start and end times on the 30-minute grid.";
    case "equal_times":
      return "Start and end time must be different.";
    case "rest_integer":
    case "rest_grid":
      return "Rest must use 30-minute steps.";
    case "rest_too_large":
      return "Rest must be less than the shift span.";
    case "rest_without_clock":
      return "Rest requires complete start and end times.";
    case "duration_required":
      return "Working time requires a paid duration.";
    case "duration_mismatch":
      return "The stored paid duration does not match the clock span minus rest.";
    case "duration_integer":
    case "duration_grid":
      return "Paid duration must use 30-minute steps.";
    case "duration_positive":
      return "Paid duration must be greater than zero.";
  }
}

function modeForFields(fields: WorkingTimeFields, shape: WorkingTimeShape): WorkingTimeMode {
  if (shape.kind !== "invalid") {
    return shape.kind;
  }
  if (fields.startTime !== undefined || fields.endTime !== undefined || fields.restMinutes !== undefined) {
    return "clock";
  }
  return fields.durationMinutes !== undefined ? "bare" : "cleared";
}

function initialEditorState(fields: WorkingTimeFields): InitialEditorState {
  const shape = parseWorkingTime(fields);
  const mode = modeForFields(fields, shape);
  const canonicalFields = shape.kind === "invalid" ? fields : serializeWorkingTime(shape);
  const duration = fields.durationMinutes;
  return {
    mode,
    fields: canonicalFields,
    durationHours: duration === undefined ? "" : String(Math.floor(duration / 60)),
    durationMinutes: duration === undefined ? "0" : String(duration % 60),
    startTime: fields.startTime ?? "",
    endTime: fields.endTime ?? "",
    restMinutes: fields.restMinutes === undefined || fields.restMinutes === 0
      ? ""
      : String(fields.restMinutes),
    error: shape.kind === "invalid" ? errorMessage(shape) : "",
  };
}

function parseDuration(hoursValue: string, minutesValue: string): WorkingTimeShape {
  if (!/^\d+$/.test(hoursValue)) {
    return { kind: "invalid", path: "durationMinutes", code: "duration_integer" };
  }
  const durationMinutes = Number(hoursValue) * 60 + Number(minutesValue);
  return parseWorkingTime({ durationMinutes });
}

export default function ShiftTypeWorkingTimeEditor({
  initialFields,
  onChange,
}: ShiftTypeWorkingTimeEditorProps) {
  const [initial] = useState(() => initialEditorState(initialFields));
  const [mode, setMode] = useState<WorkingTimeMode>(initial.mode);
  const [fields, setFields] = useState<WorkingTimeFields>(initial.fields);
  const [durationHours, setDurationHours] = useState(initial.durationHours);
  const [durationMinutes, setDurationMinutes] = useState(initial.durationMinutes);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [restMinutes, setRestMinutes] = useState(initial.restMinutes);
  const [error, setError] = useState(initial.error);
  const [conversion, setConversion] = useState<Conversion>(null);
  const [conversionStartTime, setConversionStartTime] = useState("");
  const [conversionEndTime, setConversionEndTime] = useState("");
  const [conversionRestMinutes, setConversionRestMinutes] = useState("");
  const [conversionError, setConversionError] = useState("");

  useEffect(() => {
    onChange(initial.fields, initial.error);
  }, [initial, onChange]);

  const publishShape = (shape: WorkingTimeShape) => {
    if (shape.kind === "invalid") {
      const nextError = errorMessage(shape);
      setError(nextError);
      onChange(fields, nextError);
      return false;
    }
    const nextFields = serializeWorkingTime(shape);
    setFields(nextFields);
    setError("");
    onChange(nextFields, "");
    return true;
  };

  const publishBare = (hoursValue: string, minutesValue: string) => {
    publishShape(parseDuration(hoursValue, minutesValue));
  };

  const publishClock = (nextStartTime: string, nextEndTime: string, nextRestMinutes: string) => {
    publishShape(proposeBareToClock(
      nextStartTime,
      nextEndTime,
      nextRestMinutes === "" ? undefined : Number(nextRestMinutes),
    ));
  };

  const startClockConversion = () => {
    setConversion("to-clock");
    setConversionStartTime("");
    setConversionEndTime("");
    setConversionRestMinutes("");
    setConversionError("");
    onChange(fields, "Confirm or cancel the working-time conversion before saving.");
  };

  const startBareConversion = () => {
    const shape = parseWorkingTime(fields);
    if (shape.kind !== "clock") {
      if (shape.kind === "invalid") {
        const nextError = errorMessage(shape);
        setError(nextError);
        onChange(fields, nextError);
      }
      return;
    }
    setConversion("to-bare");
    setConversionError("");
    onChange(fields, "Confirm or cancel the working-time conversion before saving.");
  };

  const cancelConversion = () => {
    setConversion(null);
    setConversionError("");
    onChange(fields, error);
  };

  const confirmClockConversion = () => {
    const shape = proposeBareToClock(
      conversionStartTime,
      conversionEndTime,
      conversionRestMinutes === "" ? undefined : Number(conversionRestMinutes),
    );
    if (shape.kind === "invalid") {
      setConversionError(errorMessage(shape));
      return;
    }
    if (shape.kind !== "clock") {
      return;
    }
    setMode("clock");
    setStartTime(shape.startTime);
    setEndTime(shape.endTime);
    setRestMinutes(shape.restMinutes === undefined ? "" : String(shape.restMinutes));
    setConversion(null);
    setConversionError("");
    publishShape(shape);
  };

  const confirmBareConversion = () => {
    const shape = proposeClockToBare(parseWorkingTime(fields));
    if (shape.kind === "invalid") {
      setConversionError(errorMessage(shape));
      return;
    }
    if (shape.kind !== "bare") {
      return;
    }
    setMode("bare");
    setDurationHours(String(Math.floor(shape.durationMinutes / 60)));
    setDurationMinutes(String(shape.durationMinutes % 60));
    setConversion(null);
    setConversionError("");
    publishShape(shape);
  };

  const chooseBare = () => {
    setMode("bare");
    setDurationHours("");
    setDurationMinutes("0");
    const nextError = "Enter a paid duration in 30-minute steps.";
    setError(nextError);
    onChange({}, nextError);
  };

  const chooseClock = () => {
    setMode("clock");
    setStartTime("");
    setEndTime("");
    setRestMinutes("");
    const nextError = "Enter complete start and end times on the 30-minute grid.";
    setError(nextError);
    onChange({}, nextError);
  };

  const clearAll = () => {
    setMode("cleared");
    setFields({});
    setError("");
    setConversion(null);
    onChange({}, "");
  };

  const validShape = error === "" ? parseWorkingTime(fields) : null;
  const summary = validShape && (validShape.kind === "bare" || validShape.kind === "clock")
    ? formatWorkingMinutes(validShape.durationMinutes)
    : "";

  const restSelect = (
    value: string,
    onValueChange: (value: string) => void,
    id: string,
  ) => (
    <select
      id={id}
      aria-label="Rest"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={inputClasses}
    >
      <option value="">No rest</option>
      {restOptions.map((minutes) => (
        <option key={minutes} value={minutes}>
          {formatWorkingMinutes(minutes)}
        </option>
      ))}
    </select>
  );

  const clockInputs = (
    currentStartTime: string,
    currentEndTime: string,
    currentRestMinutes: string,
    onStartChange: (value: string) => void,
    onEndChange: (value: string) => void,
    onRestChange: (value: string) => void,
    idPrefix: string,
  ) => (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-start`} className="block text-sm text-gray-600">Start</label>
        <input
          id={`${idPrefix}-start`}
          aria-label={idPrefix === "working-time" ? "Start time" : "Conversion start time"}
          type="time"
          step="1800"
          value={currentStartTime}
          onChange={(event) => onStartChange(event.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-end`} className="block text-sm text-gray-600">End</label>
        <input
          id={`${idPrefix}-end`}
          aria-label={idPrefix === "working-time" ? "End time" : "Conversion end time"}
          type="time"
          step="1800"
          value={currentEndTime}
          onChange={(event) => onEndChange(event.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-rest`} className="block text-sm text-gray-600">Rest</label>
        {restSelect(currentRestMinutes, onRestChange, `${idPrefix}-rest`)}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-800">Working time</h3>
          <p className="text-xs text-gray-500">Optional authoring metadata. Times and rest use 30-minute steps.</p>
        </div>
        {mode !== "cleared" && conversion === null ? (
          <button type="button" onClick={clearAll} className={secondaryButtonClasses}>Clear working time</button>
        ) : null}
      </div>

      {mode === "cleared" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={chooseBare} className={secondaryButtonClasses}>Enter paid duration</button>
          <button type="button" onClick={chooseClock} className={secondaryButtonClasses}>Enter clock times</button>
        </div>
      ) : null}

      {mode === "bare" && conversion === null ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="working-time-duration-hours" className="block text-sm text-gray-600">Paid duration</label>
              <div className="flex items-center gap-2">
                <input
                  id="working-time-duration-hours"
                  aria-label="Paid duration hours"
                  type="number"
                  min="0"
                  step="1"
                  value={durationHours}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDurationHours(nextValue);
                    publishBare(nextValue, durationMinutes);
                  }}
                  className={inputClasses}
                />
                <span className="text-sm text-gray-600">hours</span>
                <select
                  aria-label="Paid duration minutes"
                  value={durationMinutes}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDurationMinutes(nextValue);
                    publishBare(durationHours, nextValue);
                  }}
                  className={inputClasses}
                >
                  <option value="0">0 min</option>
                  <option value="30">30 min</option>
                </select>
              </div>
            </div>
          </div>
          <button type="button" onClick={startClockConversion} className={secondaryButtonClasses}>Convert to clock times</button>
        </div>
      ) : null}

      {mode === "clock" && conversion === null ? (
        <div className="space-y-3">
          {clockInputs(
            startTime,
            endTime,
            restMinutes,
            (value) => {
              setStartTime(value);
              publishClock(value, endTime, restMinutes);
            },
            (value) => {
              setEndTime(value);
              publishClock(startTime, value, restMinutes);
            },
            (value) => {
              setRestMinutes(value);
              publishClock(startTime, endTime, value);
            },
            "working-time",
          )}
          <button type="button" onClick={startBareConversion} className={secondaryButtonClasses}>Convert to duration only</button>
        </div>
      ) : null}

      {conversion === "to-clock" ? (
        <div className="space-y-3 rounded-md border border-blue-200 bg-white p-3">
          <p className="text-sm text-gray-700">Enter the new clock shape. Its paid duration will replace the current duration after confirmation.</p>
          {clockInputs(
            conversionStartTime,
            conversionEndTime,
            conversionRestMinutes,
            setConversionStartTime,
            setConversionEndTime,
            setConversionRestMinutes,
            "working-time-conversion",
          )}
          {conversionError ? <p className="text-xs text-red-600" role="alert">{conversionError}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={confirmClockConversion} className={primaryButtonClasses}>Confirm conversion</button>
            <button type="button" onClick={cancelConversion} className={secondaryButtonClasses}>Cancel conversion</button>
          </div>
        </div>
      ) : null}

      {conversion === "to-bare" ? (
        <div className="space-y-3 rounded-md border border-blue-200 bg-white p-3">
          <p className="text-sm text-gray-700">Keep the paid duration of {summary} and remove start, end, and rest?</p>
          {conversionError ? <p className="text-xs text-red-600" role="alert">{conversionError}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={confirmBareConversion} className={primaryButtonClasses}>Confirm conversion</button>
            <button type="button" onClick={cancelConversion} className={secondaryButtonClasses}>Cancel conversion</button>
          </div>
        </div>
      ) : null}

      {conversion === null && error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
      {conversion === null && summary ? <p className="text-sm font-medium text-gray-700">Paid working time: {summary}</p> : null}
    </div>
  );
}
