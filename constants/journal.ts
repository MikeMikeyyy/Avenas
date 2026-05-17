// Journal data contract.
//
// Note the underscore in the storage key (`@avenas_journal_entries`). Other
// keys use a slash (`@avenas/...`). The underscore is historical — do NOT
// migrate to `@avenas/journal_entries`, as that would orphan existing users'
// data. The same `_` vs `/` inconsistency exists for `@avenas_custom_exercises`.

export const JOURNAL_KEY = "@avenas_journal_entries";

export type JournalEntry = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
};
