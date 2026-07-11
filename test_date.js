const normalizeDate = (d) => {
  if (!d) return d;
  const str = String(d).replace(/\//g, '-').replace(/\./g, '-').trim();
  const match1 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match1) return `${match1[1]}-${match1[2].padStart(2, '0')}-${match1[3].padStart(2, '0')}`;
  const match2 = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match2) return `${match2[3]}-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
  return str;
};
console.log(normalizeDate("2026-06-05T12:00:00Z"));
