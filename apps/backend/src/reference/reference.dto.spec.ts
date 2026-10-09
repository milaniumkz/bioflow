import { ValidationPipe } from "@nestjs/common";
import { UpsertSettingDto } from "./reference.dto";

it("accepts the setting value under the actual strict whitelist policy", async () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const input = {
    key: "acceptance.differenceThresholdPercent",
    value: 4,
    reason: "Review",
  };
  await expect(
    pipe.transform(input, { type: "body", metatype: UpsertSettingDto }),
  ).resolves.toMatchObject(input);
  await expect(
    pipe.transform(
      { ...input, organizationId: "foreign" },
      { type: "body", metatype: UpsertSettingDto },
    ),
  ).rejects.toThrow();
});
