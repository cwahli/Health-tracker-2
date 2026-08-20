const mergeDeleteMaps = (...maps) => {
  const merged = {};
  const add = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === 'string') {
          const k = item.trim();
          if (k && k !== 'undefined' && k !== 'null') {
            merged[k] = Math.max(merged[k] || 0, Date.now());
          }
        } else if (item && typeof item === 'object') {
          const k = String(item.id || item.key || '').trim();
          const ts = Number(item.ts ?? item.updated_at ?? item.deleted_at) || Date.now();
          if (k && k !== 'undefined' && k !== 'null') {
            merged[k] = Math.max(merged[k] || 0, ts);
          }
        }
      }
    } else if (typeof source === 'object') {
      for (const [k, v] of Object.entries(source)) {
        const cleanK = String(k ?? '').trim();
        if (!cleanK || cleanK === 'undefined' || cleanK === 'null') continue;
        if (/^\d+$/.test(cleanK) && typeof v === 'string') {
          const valK = v.trim();
          if (valK && valK !== 'undefined' && valK !== 'null') {
            merged[valK] = Math.max(merged[valK] || 0, Date.now());
          }
          continue;
        }
        const num = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(num) || num <= 0) continue;
        merged[cleanK] = Math.max(merged[cleanK] || 0, num);
      }
    }
  };
  maps.forEach(add);
  return merged;
};
console.log(mergeDeleteMaps({ "med_log_bmi_init_1724123456": 1724123457 }));
