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

// A form component for adding and editing a single item or group and managing its relationships.
'use client';

import { FormInput } from '@/components/FormInput';
import { CheckboxList } from '@/components/CheckboxList';
import { Item, Group } from '@/types/scheduling';
import { Mode } from '@/constants/modes';

interface AddEditItemGroupFormProps<T extends Item, G extends Group> {
  mode: Mode.ADDING | Mode.EDITING;
  draft: {
    id: string;
    description: string;
    groups: string[];
    members: string[];
    isItem: boolean;
  };
  items: T[];
  groups: G[];
  itemLabel: string;
  itemLabelPlural: string;
  error: string;
  filterItemGroups: (items: T[] | G[]) => T[] | G[];
  renderGroupMemberSelector?: (props: {
    items: T[];
    selectedIds: string[];
    onToggle: (id: string) => void;
  }) => React.ReactNode;
  onIdChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMemberToggle: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  // Shift-type items only: optional authoring-only duration (minutes).
  showDurationField?: boolean;
  durationValue?: string;
  onDurationChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function AddEditItemGroupForm<T extends Item, G extends Group>({
  mode,
  draft,
  items,
  groups,
  itemLabel,
  itemLabelPlural,
  error,
  filterItemGroups,
  renderGroupMemberSelector,
  onIdChange,
  onDescriptionChange,
  onMemberToggle,
  onSave,
  onCancel,
  showDurationField = false,
  durationValue = '',
  onDurationChange,
}: AddEditItemGroupFormProps<T, G>) {
  const isItem = draft.isItem;
  const durationField = showDurationField && isItem ? (
    <div className="space-y-2">
      <label htmlFor="shift-type-duration" className="block text-sm font-medium text-gray-700">
        Duration (minutes)
      </label>
      <input
        id="shift-type-duration"
        type="number"
        min="1"
        step="1"
        value={durationValue}
        onChange={onDurationChange}
        placeholder="e.g. 480 for an 8h shift"
        className="block w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:border-blue-500 focus:ring-blue-200 hover:border-gray-400"
      />
      <p className="text-xs text-gray-500 italic">
        Optional. Feeds &quot;auto-fill from durations&quot; in Shift Counts; not sent to the solver.
      </p>
    </div>
  ) : null;
  const title = `${mode === Mode.ADDING ? 'Add New' : 'Edit'} ${isItem ? itemLabel : "Group"}`;
  const placeholder = `Enter ${isItem ? itemLabel.toLowerCase() : "group"} ID`;
  const filteredItems = filterItemGroups(items) as T[];
  const filteredGroups = filterItemGroups(groups) as G[];
  const memberSelector = filteredItems.length === 0 ? (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-700">Members</h3>
      <div className="text-sm text-gray-500 italic p-4 text-center border border-gray-200 rounded-lg bg-gray-50">
        No {itemLabelPlural.toLowerCase()} available. Please set up {itemLabelPlural.toLowerCase()} first.
      </div>
    </div>
  ) : renderGroupMemberSelector ? renderGroupMemberSelector({
    items: filteredItems,
    selectedIds: draft.members,
    onToggle: onMemberToggle,
  }) : (
    <CheckboxList
      items={filteredItems}
      selectedIds={draft.members}
      onToggle={onMemberToggle}
      label="Members"
    />
  );
  const groupSelector = filteredGroups.length === 0 ? (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-700">Groups</h3>
      <div className="text-sm text-gray-500 italic p-4 text-center border border-gray-200 rounded-lg bg-gray-50">
        No groups available.
      </div>
    </div>
  ) : (
    <CheckboxList
      items={filteredGroups}
      selectedIds={draft.groups}
      onToggle={onMemberToggle}
      label="Groups"
    />
  );

  return (
    <div className="mb-6 bg-white shadow-md rounded-lg overflow-hidden">
      <div className="px-6 py-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">{title}</h2>
        <FormInput
          itemValue={draft.id}
          itemPlaceholder={placeholder}
          onItemChange={onIdChange}
          descriptionValue={draft.description}
          descriptionPlaceholder={`Enter ${isItem ? itemLabel.toLowerCase() : "group"} description (optional)`}
          onDescriptionChange={onDescriptionChange}
          error={error}
          onAction={onSave}
          onCancel={onCancel}
          actionText={mode === Mode.ADDING ? 'Add' : 'Update'}
        >
          {!draft.isItem ? memberSelector : (
            <>
              {durationField}
              {groupSelector}
            </>
          )}
        </FormInput>
      </div>
    </div>
  );
}
