import { pushSummary } from "./push-summary";
test("locked-screen GPS push omits phone and exact location; details remain in the in-app record", () => {
  const notice = {
    type: "DRIVER_GPS_STALE",
    title: "Нет GPS",
    body: "Телефон: +79990000000; 43.200000,76.900000",
  };
  const payload = pushSummary(notice);
  expect(payload.body).not.toContain("+7999");
  expect(payload.body).not.toContain("43.2");
  expect(notice.body).toContain("43.2");
});
test("ordinary notifications keep their actual content", () =>
  expect(
    pushSummary({ type: "INVENTORY", title: "Остаток", body: "Низкий остаток" })
      .body,
  ).toBe("Низкий остаток"));
