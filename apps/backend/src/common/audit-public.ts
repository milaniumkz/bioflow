/** Only outbound presentation is redacted; immutable audit evidence is retained. */
export function publicAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicAuditValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      !(key === "mustChangePassword" && typeof item === "boolean") &&
      /password|passphrase|token|secret|authorization|cookie|privatekey|apikey|recoverycode|resetcode|verificationcode|credential|otp/i.test(
        key.replace(/[^a-z0-9]/gi, ""),
      )
        ? "[скрыто]"
        : publicAuditValue(item),
    ]),
  );
}
