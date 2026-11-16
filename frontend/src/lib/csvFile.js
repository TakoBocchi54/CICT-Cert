const MAX_BYTES = 1024 * 1024;

// Checks and reads a chosen CSV into { name, csv } for a draft; used by the drop zone and the attendance step's Upload CSV.
export async function readCsvFile(file, onDraft, onError) {
  if (!file) return;
  if (file.size === 0 || file.size > MAX_BYTES) return onError('Choose a non-empty CSV file up to 1 MB.');
  try { onDraft({ name: file.name, csv: await file.text() }); }
  catch { onError('The file could not be read. Choose it again.'); }
}
