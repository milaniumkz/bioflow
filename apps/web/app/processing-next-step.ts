type RecordData = Record<string, any>;
function nextStep(item: RecordData, permissions: string[]) {
  const b = item.batch,
    bag = b.bigBag,
    t = item.trip;
  const step = (
    title: string,
    permission: string,
    role: string,
    detail: string,
  ) => ({ title, detail, available: permissions.includes(permission), role });
  if (bag?.soldAt)
    return {
      title: "Материал отпущен покупателю",
      detail:
        "Доставка и её подтверждение доступны в разделе «Доставка продукции». История партии сохранена.",
      available: false,
      role: "Владелец",
    };
  if (bag && !b.stocks?.some((s: RecordData) => Number(s.quantity) > 0))
    return {
      title: "Биг-бэг уже использован",
      detail:
        "Откройте историю партии, чтобы найти следующие биг-бэги и их QR.",
      available: false,
      role: "",
    };
  if (
    bag?.stage === "WASHED" &&
    !bag.factoryStartedAt &&
    permissions.includes("processing.sell") &&
    !permissions.includes("processing.dry")
  )
    return step(
      "Продажа мытого материала",
      "processing.sell",
      "Сотрудник продаж",
      "Укажите покупателя и документ отпуска. Мытый биг-бэг можно продать до передачи на завод.",
    );
  if (
    bag?.stage === "WASHED" &&
    !bag.factoryStartedAt &&
    permissions.includes("processing.dispatch") &&
    !permissions.includes("processing.dry")
  )
    return step(
      "Отправить на завод или продать с мойки",
      "processing.dispatch",
      "Оператор мойки",
      "Выберите склад завода или укажите покупателя и документ для продажи мытого биг-бэга.",
    );
  if (bag?.stage === "WASHED")
    return bag.factoryStartedAt
      ? step(
          "Выход после завода",
          "processing.dry",
          "Оператор завода",
          "Сканируйте входные биг-бэги этой партии, затем укажите вес каждого выходного биг-бэга.",
        )
      : step(
          "Приём на завод",
          "processing.dry",
          "Оператор завода",
          "Примите биг-бэг на завод. Продажа мытого материала также доступна сотруднику с правом продажи.",
        );
  if (bag?.stage === "DRIED") {
    if (!bag.receivedAt)
      return step(
        "Склад готовой продукции",
        "processing.finished",
        "Приёмщик готовой продукции",
        "Подтвердите приёмку этого биг-бэга на склад.",
      );
    if (!bag.packedAt)
      return step(
        "Упаковка",
        "processing.pack",
        "Упаковщик",
        "После приёмки упаковщик сканирует QR. Готовый биг-бэг можно отпустить покупателю только после упаковки.",
      );
    return step(
      "Отпуск готовой продукции",
      "processing.sell",
      "Сотрудник продаж",
      "Укажите покупателя и документ отпуска этого биг-бэга.",
    );
  }
  if (!t?.receivedWeight && !item.preparedBatchId)
    return step(
      "Приёмка на мойку",
      "processing.receive",
      "Приёмщик мойки",
      "После прибытия рейса подтвердите фактически принятый вес и количество мешков.",
    );
  if (!item.analyses?.length)
    return step(
      "Лабораторный анализ",
      "laboratory.manage",
      "Лаборант",
      "До обработки нужно сохранить влажность, осадок и фактическое количество мешков.",
    );
  if (!item.preparedBatchId)
    return step(
      "Взвесить перед мойкой",
      "processing.wash",
      "Оператор мойки",
      "Укажите фактический вес перед мойкой. После подтверждения здесь откроется «Выход с мойки».",
    );
  if (item.preparedAvailable)
    return step(
      "Выход с мойки",
      "processing.wash",
      "Оператор мойки",
      "Добавьте по строке на каждый получившийся биг-бэг и укажите его вес. После подтверждения каждый получит отдельный QR.",
    );
  return {
    title: "Мойка этой партии завершена",
    detail:
      "Дальнейшие действия выполняются по QR получившихся биг-бэгов. Откройте историю партии, чтобы найти их.",
    available: false,
    role: "",
  };
}

export function processingNextStep(
  item: RecordData,
  permissions: string[],
  roles: string[] = [],
) {
  if (item.requiresBagQr)
    return {
      title: "Нужен QR биг-бэга",
      detail:
        "Этот QR относится к исходной партии. Дальше сканируйте отдельный QR конкретного биг-бэга, полученного после мойки или завода.",
      available: false,
      role: "",
    };
  if (item.readOnly)
    return {
      title:
        roles.includes("PACKER") && item.batch.bigBag?.stage !== "DRIED"
          ? "Партия ещё не дошла до упаковки"
          : "Партия ожидает передачи на ваш этап",
      detail: `Текущий этап: ${item.stageLabel}. Действия появятся после передачи на закреплённый за вами склад.`,
      available: false,
      role: "",
    };
  const next = nextStep(item, permissions);
  if (
    roles.includes("PACKER") &&
    !roles.includes("OWNER") &&
    !roles.includes("OPERATIONS_MANAGER")
  ) {
    if (item.batch.bigBag?.soldAt) return next;
    const bag = item.batch.bigBag;
    if (!bag || bag.stage !== "DRIED" || !bag.receivedAt)
      return {
        title: "Партия ещё не дошла до упаковки",
        detail: `Сейчас ожидается: ${next.title.toLowerCase()}. Упаковка будет доступна после приёмки готового биг-бэга на склад.`,
        available: false,
        role: "",
      };
    if (!bag.packedAt)
      return {
        title: "Упаковка по QR",
        detail:
          "Проверьте дату и смену, затем отсканируйте QR этого принятого биг-бэга. Упаковка будет записана за вами.",
        available: permissions.includes("processing.pack"),
        role: "Упаковщик",
      };
    if (bag.packedAt)
      return {
        title: "Биг-бэг уже упакован",
        detail:
          "Повторное сканирование не увеличивает счётчик. Отсканируйте следующий биг-бэг.",
        available: false,
        role: "",
      };
  }
  return next;
}
