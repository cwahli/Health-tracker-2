export function getBiomarkerStore(): Record<string, any> {
  try {
    const raw = localStorage.getItem('biomarker_dictionary_store');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse biomarker_dictionary_store', e);
  }
  return {};
}

export function saveBiomarkerStore(store: Record<string, any>) {
  localStorage.setItem('biomarker_dictionary_store', JSON.stringify(store));
  window.dispatchEvent(new Event('biomarkerStoreUpdated'));
}

export function approvePendingBiomarker(biomarkerKey: string, targetCategory?: string) {
  const store = getBiomarkerStore();
  if (store[biomarkerKey]) {
    store[biomarkerKey].isPendingApproval = false;
    store[biomarkerKey].approved = true;
    delete store[biomarkerKey].needsApproval;
    if (targetCategory) {
      store[biomarkerKey].category = targetCategory;
    }
    saveBiomarkerStore(store);
  }
}
