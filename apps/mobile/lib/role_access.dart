const roleNames = {
  'COLLECTOR': 'Сборщик',
  'DRIVER': 'Водитель',
  'LAB_TECHNICIAN': 'Лаборант',
  'WASH_RECEIVER': 'Приёмщик мойки',
  'DRYING_OPERATOR': 'Оператор завода',
  'FINISHED_RECEIVER': 'Кладовщик готовой продукции',
  'PACKER': 'Упаковщик',
  'SALES_STOREKEEPER': 'Кладовщик отпуска и продаж',
  'OWNER': 'Владелец',
  'ADMIN': 'Администратор',
  'CONTRACTOR_REP': 'Представитель подрядчика',
  'RECEIVER': 'Приёмщик',
  'WASH_OPERATOR': 'Оператор мойки',
  'PRODUCTION_OPERATOR': 'Оператор завода',
  'DISPATCHER': 'Диспетчер',
  'EXTRACTION_OPERATOR': 'Оператор добычи',
  'LOADING_OPERATOR': 'Оператор погрузки',
  'WAREHOUSE_OPERATOR': 'Оператор склада',
  'AUDITOR': 'Наблюдатель/аудитор',
};

String roleSummary(Map<String, dynamic>? profile) {
  final roles = profile?['roles'] as List? ?? [];
  return roles.isEmpty
      ? 'Роли не назначены'
      : roles.map((x) => roleNames[x] ?? 'Дополнительная роль').join(', ');
}

const roleSections = {
  'driver': 'Мои рейсы',
  'control': 'Контроль и статистика',
  'collection': 'Сбор и отправка',
  'processing': 'Работа с партией по QR',
  'laboratory': 'Лаборатория',
  'big-bags': 'Биг-бэги и упаковка',
  'fleet': 'Водители и маршруты',
  'dashboard': 'Обзор',
  'ledger': 'Партии и операции',
  'waybills': 'Поставки',
  'counterparties': 'Контрагенты',
  'vehicles': 'Транспорт',
  'drivers': 'Водители',
  'extraction-sites': 'Места добычи',
  'warehouses': 'Склады',
  'plants': 'Заводы',
  'material-types': 'Материалы',
  'product-types': 'Продукция',
  'reference-values': 'Причины и единицы',
  'inventory': 'Движения',
  'transfers': 'Перемещения',
  'write-offs': 'Списания',
  'shipments': 'Отгрузки',
  'washing': 'Мойка',
  'production': 'Завод',
  'users': 'Пользователи',
  'roles': 'Роли',
  'sessions': 'Сессии',
  'notifications': 'Уведомления',
  'reports': 'Отчёты',
  'audit': 'Аудит',
  'settings': 'Настройки',
};

// Match Web navigation; the API independently enforces action/object access.
bool canOpenSection(String id, Map<String, dynamic>? profile) {
  if (profile == null) return false;
  final permissions = profile['permissions'] as List? ?? [];
  bool can(String p) => permissions.contains(p);
  final all = profile['accessAllObjects'] == true;
  if (id == 'driver') {
    return can('tracking.write') &&
        (profile['roles'] as List? ?? []).contains('DRIVER');
  }
  if (id == 'control') return can('processing.overview');
  if (id == 'collection') return can('collection.manage');
  if (['processing','laboratory','big-bags'].contains(id)) return can('processing.read');
  if (id == 'fleet') return can('tracking.read');
  if (id == 'plants') return can('references.read') && all;
  if (id == 'audit') return can('audit.read') && all;
  if (id == 'dashboard') return can('dashboard.read') && all;
  if (id == 'settings') return can('references.manage');
  if ([
    'ledger',
    'waybills',
    'inventory',
    'transfers',
    'write-offs',
    'shipments',
    'washing',
    'production'
  ].contains(id)) {
    return can('inventory.read');
  }
  if (id == 'reports') return can('reports.read');
  if (id == 'notifications') return can('notifications.read');
  if (id == 'sessions') return true;
  if (['users', 'roles'].contains(id)) return can('users.manage');
  return roleSections.containsKey(id) && can('references.read');
}
