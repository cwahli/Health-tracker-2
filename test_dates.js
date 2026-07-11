function normalizeDate(d) {
  if (!d) return d;
  const match1 = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match1) return `${match1[1]}-${match1[2].padStart(2, '0')}-${match1[3].padStart(2, '0')}`;
  const match2 = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match2) return `${match2[3]}-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
  return d;
}
console.log(normalizeDate("2026-06-05"));
console.log(normalizeDate("05-06-2026"));
