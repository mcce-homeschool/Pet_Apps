// vocab.js — controlled vocabulary for document types, and which optional
// fields each type shows on the add/edit form (guide §4.2, §17 "exact per-type
// field sets" — tuned here, in one place, same discipline as KennelOS's vocab.js).

export const DOC_TYPES = [
  { value: 'pedigree',     label: 'Pedigree' },
  { value: 'health_test',  label: 'Health test' },
  { value: 'registration', label: 'Registration' },
  { value: 'contract',     label: 'Contract' },
  { value: 'other',        label: 'Other' }
];

// Which optional fields (beyond title/doc_date/notes, which every type shows)
// appear on the form for a given doc_type.
const FIELDS_BY_TYPE = {
  pedigree:     ['issuer_or_lab', 'registry', 'registration_number'],
  health_test:  ['issuer_or_lab', 'result'],
  registration: ['issuer_or_lab', 'registry', 'registration_number'],
  contract:     ['issuer_or_lab'],
  other:        ['issuer_or_lab']
};

export function fieldsFor(docType) {
  return FIELDS_BY_TYPE[docType] || FIELDS_BY_TYPE.other;
}

export function docTypeLabel(value) {
  return DOC_TYPES.find((t) => t.value === value)?.label || value || 'Other';
}

// A small emoji badge per type, for the list when a document has no photo
// thumbnail (uploaded PDFs).
const ICON_BY_TYPE = {
  pedigree: '🌳',
  health_test: '🩺',
  registration: '📜',
  contract: '✍️',
  other: '📄'
};
export function docTypeIcon(value) {
  return ICON_BY_TYPE[value] || '📄';
}
