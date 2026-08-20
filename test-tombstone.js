const extractTombstoneIds = (mapOrArr) => {
  if (!mapOrArr) return [];
  if (Array.isArray(mapOrArr)) {
    return mapOrArr.map((x) => String(x ?? '').trim()).filter((s) => s && s !== 'null' && s !== 'undefined' && !/^\d+$/.test(s));
  }
  if (typeof mapOrArr === 'object') {
    const ids = [];
    for (const [k, v] of Object.entries(mapOrArr)) {
      const cleanK = String(k ?? '').trim();
      if (/^\d+$/.test(cleanK)) {
        if (typeof v === 'string') ids.push(v.trim());
      } else {
        ids.push(cleanK);
      }
    }
    return ids.filter((s) => s && s !== 'null' && s !== 'undefined' && !/^\d+$/.test(s));
  }
  return [];
};
console.log(extractTombstoneIds({'med_log_bmi_init_1787182235314': 1787182235314}));
