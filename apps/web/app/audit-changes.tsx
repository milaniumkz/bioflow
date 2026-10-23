"use client";
import { auditDiff } from "./audit-diff.mjs";
import { roleLabel } from "./role-labels";
const labels: Record<string, string> = {
  accessAllObjects: "Все объекты",
  warehouseScopeIds: "Склады",
  extractionScopeIds: "Места добычи",
  counterpartyScopeId: "Контрагент",
  mustChangePassword: "Обязательная смена пароля",
  fullName: "Имя",
  phone: "Телефон",
  email: "Email",
  roles: "Роли",
  roleCodes: "Роли",
  roleIds: "Роли",
  isBlocked: "Блокировка",
  lossQuantity: "Потери, т",
  wasteQuantity: "Отходы, т",
  defectQuantity: "Брак, т",
  comparisonBaseQuantity: "База сравнения, т",
  shift: "Смена",
  lineLabel: "Линия",
  value: "Значение",
};
export function AuditChanges({
  before,
  after,
  scopeNames = {},
  label,
}: {
  before: unknown;
  after: unknown;
  scopeNames?: Record<string, Record<string, string>>;
  label: (key: string) => string;
}) {
  const rows = auditDiff(before, after).filter(
    (row) => row.before !== "[скрыто]" && row.after !== "[скрыто]",
  );
  function show(field: string, value: unknown): string {
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    if (Array.isArray(value))
      return value.length
        ? value.map((v) => show(field, v)).join(", ")
        : "Не назначены";
    const key = field.split(".").pop()!;
    if (scopeNames[key])
      return scopeNames[key][String(value)] ?? "Недоступный объект";
    if (["roles", "roleCodes"].includes(key))
      return roleLabel({ code: String(value) });
    return String(value);
  }
  return (
    <section aria-label="Изменения записи" className="audit-changes">
      <h3>Было / стало</h3>
      {rows.length ? (
        rows.map((row) => {
          const key = row.field.split(".").pop()!;
          return (
            <article className="audit-change" key={row.field}>
              <h4>{labels[key] ?? label(key)}</h4>
              <div className="audit-change-values">
                <div>
                  <span className="metric">Было</span>
                  <p>{show(row.field, row.before)}</p>
                </div>
                <div>
                  <span className="metric">Стало</span>
                  <p>{show(row.field, row.after)}</p>
                </div>
              </div>
            </article>
          );
        })
      ) : (
        <p className="notice">
          Снимки значений отсутствуют или доступные значения не изменились.
        </p>
      )}
    </section>
  );
}
