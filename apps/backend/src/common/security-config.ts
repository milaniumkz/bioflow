export function corsOriginConfig(
  nodeEnv = process.env.NODE_ENV,
  webOrigin = process.env.WEB_ORIGIN,
) {
  if (webOrigin)
    return webOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  if (nodeEnv === "production")
    throw new Error("WEB_ORIGIN is required in production");
  return true;
}

export function assertProductionSecurityConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const requiredSecrets = [
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "QR_SIGNING_SECRET",
  ];
  requiredSecrets.forEach((key) => {
    const value = env[key];
    if (
      !value ||
      value.length < 32 ||
      value.startsWith("change-me") ||
      value.startsWith("replace-with") ||
      value.startsWith("dev-")
    ) {
      throw new Error(`${key} must be set to a strong production secret`);
    }
  });
}
