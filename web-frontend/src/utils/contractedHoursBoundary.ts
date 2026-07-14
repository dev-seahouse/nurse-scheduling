/*
 * This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
 *
 * Copyright (C) 2023-2026 Johnson Sun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 */

import { Preference } from "@/types/scheduling";
import {
  ContractedHoursErrorCode,
  ContractedHoursScenario,
  validateContractedHoursScenario,
} from "@/utils/contractedHours";

export type ContractedHoursBoundary =
  | "yaml-import"
  | "yaml-download"
  | "clipboard-copy"
  | "anonymized-yaml-download"
  | "optimize"
  | "anonymized-optimize"
  | "scenario-serializer";

export interface ContractedHoursBoundaryScenario extends ContractedHoursScenario {
  preferences: Preference[];
}

export interface ContractedHoursDiagnostic {
  boundary: ContractedHoursBoundary;
  code: ContractedHoursErrorCode;
  message: string;
  detail: string;
  path: string;
  preferenceIndex?: number;
  preferenceDescription?: string;
  repair: string;
  navigationHref: "/shift-counts";
  navigationLabel: "Review Contracted Hours";
}

export type ContractedHoursBoundaryResult =
  | { ok: true }
  | { ok: false; diagnostic: ContractedHoursDiagnostic };

function getPreferenceDescription(
  scenario: ContractedHoursBoundaryScenario,
  preferenceIndex: number | undefined,
): string | undefined {
  if (preferenceIndex === undefined) {
    return undefined;
  }
  const description = scenario.preferences[preferenceIndex]?.description?.trim();
  return description || undefined;
}

function describePreference(
  preferenceIndex: number | undefined,
  preferenceDescription: string | undefined,
): string {
  if (preferenceIndex === undefined) {
    return "Contracted Hours";
  }
  const label = `Contracted Hours preference ${preferenceIndex + 1}`;
  return preferenceDescription ? `${label} (${preferenceDescription})` : label;
}

export function validateContractedHoursBoundary(
  scenario: ContractedHoursBoundaryScenario,
  boundary: ContractedHoursBoundary,
): ContractedHoursBoundaryResult {
  const result = validateContractedHoursScenario(scenario);
  if (result.ok) {
    return { ok: true };
  }

  const preferenceDescription = getPreferenceDescription(
    scenario,
    result.error.preferenceIndex,
  );
  const preferenceLabel = describePreference(
    result.error.preferenceIndex,
    preferenceDescription,
  );
  const path = result.error.path ?? (
    result.error.preferenceIndex === undefined
      ? "preferences"
      : `preferences[${result.error.preferenceIndex}]`
  );

  return {
    ok: false,
    diagnostic: {
      boundary,
      code: result.error.code,
      message: `${preferenceLabel}: ${result.error.message}`,
      detail: result.error.message,
      path,
      ...(result.error.preferenceIndex === undefined
        ? {}
        : { preferenceIndex: result.error.preferenceIndex }),
      ...(preferenceDescription ? { preferenceDescription } : {}),
      repair: boundary === "yaml-import"
        ? "Correct the YAML at the reported path, or remove hoursContract to import it as a generic Shift Count."
        : "Open Contracted Hours, repair or refresh the rule, then retry this action.",
      navigationHref: "/shift-counts",
      navigationLabel: "Review Contracted Hours",
    },
  };
}

export class ContractedHoursBoundaryError extends Error {
  readonly diagnostic: ContractedHoursDiagnostic;

  constructor(diagnostic: ContractedHoursDiagnostic) {
    super(`${diagnostic.message} (${diagnostic.path}) ${diagnostic.repair}`);
    this.name = "ContractedHoursBoundaryError";
    this.diagnostic = diagnostic;
  }
}

export function assertContractedHoursBoundary(
  scenario: ContractedHoursBoundaryScenario,
  boundary: ContractedHoursBoundary,
): void {
  const result = validateContractedHoursBoundary(scenario, boundary);
  if (!result.ok) {
    throw new ContractedHoursBoundaryError(result.diagnostic);
  }
}

export function isContractedHoursBoundaryError(
  error: unknown,
): error is ContractedHoursBoundaryError {
  return error instanceof ContractedHoursBoundaryError;
}
