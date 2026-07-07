const parseTarget = (str, fallback) => {
  if (!str) return fallback;
  const match = str.toString().match(/\d+/);
  if (match) return parseInt(match[0]);
  return fallback;
};
