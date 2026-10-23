const nullableFields = {
  counterparties: ["bin", "phone", "email"],
  vehicles: ["model", "capacity", "tareWeight"],
  drivers: ["phone"],
  "extraction-sites": ["location"],
  warehouses: ["address", "lowStockLimit", "capacity"],
  plants: ["address"],
};

export function referencePayload(entity, values, update = false) {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (value === "")
        return update && nullableFields[entity]?.includes(key)
          ? [[key, null]]
          : [];
      return [
        [
          key,
          ["capacity", "tareWeight", "lowStockLimit"].includes(key)
            ? value.trim().replace(",", ".")
            : value,
        ],
      ];
    }),
  );
}
