const roleNames: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  CONTRACTOR_REP: "Представитель контрагента",
  RECEIVER: "Кладовщик/приёмщик",
  WASH_OPERATOR: "Оператор мойки",
  PRODUCTION_OPERATOR: "Оператор производства",
  DISPATCHER: "Диспетчер/логист",
  EXTRACTION_OPERATOR: "Оператор добычи",
  LOADING_OPERATOR: "Весовщик/оператор погрузки",
  WAREHOUSE_OPERATOR: "Кладовщик",
  AUDITOR: "Наблюдатель/аудитор",
};
export function roleLabel(role: { code: string; name?: string }) {
  return role.name && role.name !== role.code
    ? role.name
    : (roleNames[role.code] ?? "Пользовательская роль");
}
export function roleDescription(code: string) {
  const descriptions: Record<string, string> = {
    OWNER: "Полный доступ к управлению системой.",
    ADMIN:
      "Управление пользователями и справочниками, просмотр данных и журнала действий.",
    CONTRACTOR_REP: "Работа с перевозками и просмотр остатков.",
    RECEIVER: "Приёмка перевозок и просмотр остатков.",
    WASH_OPERATOR: "Работа с операциями переработки и просмотр остатков.",
    PRODUCTION_OPERATOR: "Работа с операциями переработки и просмотр остатков.",
    DISPATCHER: "Организация перевозок и просмотр остатков.",
    EXTRACTION_OPERATOR: "Работа с партиями добычи и просмотр остатков.",
    LOADING_OPERATOR: "Погрузка, взвешивание и просмотр остатков.",
    WAREHOUSE_OPERATOR: "Управление складскими остатками.",
    AUDITOR: "Просмотр данных, отчётов и журнала действий.",
  };
  return descriptions[code] ?? "Права этой роли определяются её настройками.";
}
