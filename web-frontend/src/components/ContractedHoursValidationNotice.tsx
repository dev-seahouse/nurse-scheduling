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

import Link from "next/link";
import { FiAlertCircle } from "react-icons/fi";

import { ContractedHoursDiagnostic } from "@/utils/contractedHoursBoundary";

export default function ContractedHoursValidationNotice({
  diagnostic,
}: {
  diagnostic: ContractedHoursDiagnostic;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <div className="flex items-start gap-2">
        <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Contracted Hours needs attention</p>
          <p className="mt-1">{diagnostic.message}</p>
          <p className="mt-1 font-mono text-xs">{diagnostic.path}</p>
          <p className="mt-2">{diagnostic.repair}</p>
          <Link
            href={diagnostic.navigationHref}
            className="mt-3 inline-flex font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
          >
            {diagnostic.navigationLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
