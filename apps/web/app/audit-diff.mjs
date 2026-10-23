function flatten(value, path = "", result = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value))
      flatten(item, path ? `${path}.${key}` : key, result);
  } else if (
    Array.isArray(value) &&
    value.some((v) => v && typeof v === "object")
  ) {
    value.forEach((item, i) => flatten(item, `${path}.${i + 1}`, result));
  } else if (path || value != null) result.set(path || "value", value);
  return result;
}
export function auditDiff(before, after) {
  const old = flatten(before),
    next = flatten(after);
  return [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .filter(
      (key) => JSON.stringify(old.get(key)) !== JSON.stringify(next.get(key)),
    )
    .map((field) => ({
      field,
      before: old.get(field),
      after: next.get(field),
    }));
}
