import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:image_picker/image_picker.dart';
import 'client.dart';
import 'push.dart';

const navy950 = Color(0xFF061225),
    navy900 = Color(0xFF0A1C35),
    blue = Color(0xFF2F7DF6),
    platinum = Color(0xFFD8DEE8);
final api = BioflowClient();
void main() => runApp(const BioflowApp());

class BioflowApp extends StatelessWidget {
  const BioflowApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
      title: 'BIOFLOW',
      theme: ThemeData.dark(useMaterial3: true).copyWith(
          scaffoldBackgroundColor: navy950,
          colorScheme: const ColorScheme.dark(
              primary: blue, secondary: platinum, surface: navy900)),
      home: const LoginScreen());
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginState();
}

class _LoginState extends State<LoginScreen> {
  final email = TextEditingController(), password = TextEditingController();
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    api.restore().then((ok) {
      if (ok && mounted) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute(
                builder: (_) => api.profile?['mustChangePassword'] == true
                    ? const CommandForm(
                        title: 'Смена временного пароля',
                        path: '/auth/change-password',
                        fields: [
                          Field('currentPassword', 'Текущий пароль',
                              secret: true),
                          Field('newPassword', 'Новый пароль', secret: true)
                        ],
                        logoutAfter: true)
                    : const Workspace()));
      }
    });
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> login() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await api.login(email.text, password.text);
      if (mounted) {
        Navigator.pushReplacement(
            context,
            MaterialPageRoute(
                builder: (_) => api.profile?['mustChangePassword'] == true
                    ? const CommandForm(
                        title: 'Смена временного пароля',
                        path: '/auth/change-password',
                        fields: [
                          Field('currentPassword', 'Текущий пароль',
                              secret: true),
                          Field('newPassword', 'Новый пароль', secret: true)
                        ],
                        logoutAfter: true)
                    : const Workspace()));
      }
    } catch (e) {
      setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      body: SafeArea(
          child: Center(
              child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('BIOFLOW',
                                style: TextStyle(
                                    fontSize: 36, fontWeight: FontWeight.bold)),
                            const Text('Контроль движения биоматериала'),
                            const SizedBox(height: 24),
                            TextField(
                                controller: email,
                                decoration:
                                    const InputDecoration(labelText: 'Email'),
                                keyboardType: TextInputType.emailAddress),
                            TextField(
                                controller: password,
                                decoration:
                                    const InputDecoration(labelText: 'Пароль'),
                                obscureText: true),
                            const SizedBox(height: 20),
                            FilledButton(
                                onPressed: busy ? null : login,
                                child: Text(busy ? 'Вход…' : 'Войти')),
                            if (error != null)
                              Text(error!,
                                  style:
                                      const TextStyle(color: Colors.redAccent))
                          ]))))));
}

const labels = {
  'DIRTY': 'Сырьё',
  'WASHED': 'Мытое',
  'FINISHED': 'Готовая продукция',
  'DRAFT': 'Черновик',
  'CONFIRMED': 'Подтверждено',
  'CREATED': 'Создана',
  'LOADED': 'Погружена',
  'IN_TRANSIT': 'В пути',
  'ARRIVED': 'Прибыла',
  'ACCEPTED': 'Принята',
  'ACCEPTED_WITH_DIFFERENCE': 'Принята с расхождением',
  'PARTIALLY_ACCEPTED': 'Частичная приёмка',
  'UNLOADED': 'Разгружена',
  'COMPLETED': 'Завершена',
  'CANCELLED': 'Отменена',
  'REVIEW': 'На проверке',
  'REJECTED': 'Отказ',
  'WASHING': 'Мойка',
  'PRODUCTION': 'Производство',
  'TRANSFER': 'Перемещение',
  'WRITE_OFF': 'Списание',
  'SHIPMENT': 'Отгрузка',
  'RESERVE': 'Резерв',
  'RELEASE': 'Снять резерв',
  'CORRECTION': 'Корректировка',
  'INVENTORY': 'Инвентаризация',
  'RETURN': 'Возврат'
};

class Workspace extends StatefulWidget {
  const Workspace({super.key});
  @override
  State<Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<Workspace> {
  int tab = 0, page = 1, loadVersion = 0;
  String search = '';
  bool busy = false;
  String? error;
  List<dynamic> rows = [];
  int total = 0;
  final paths = [
    '/ledger/batches',
    '/ledger/waybills',
    '/ledger/stocks',
    '/ledger/operations',
    '/notifications'
  ];
  final titles = ['Добыча', 'Перевозки', 'Остатки', 'Операции', 'Уведомления'];
  @override
  void initState() {
    super.initState();
    configurePush(api).catchError((_) {});
    load();
  }

  Future<void> load() async {
    final version = ++loadVersion;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await api.get(
          '${paths[tab]}?page=$page&pageSize=20&search=${Uri.encodeQueryComponent(search)}');
      if (!mounted || version != loadVersion) return;
      setState(() {
        rows = data is List ? data : data['data'] as List? ?? [];
        total =
            data is List ? data.length : data['total'] as int? ?? rows.length;
      });
    } catch (e) {
      if (mounted && version == loadVersion) {
        setState(() => error = errorText(e));
      }
    } finally {
      if (mounted && version == loadVersion) setState(() => busy = false);
    }
  }

  Future<void> openForm(String title, String path, List<Field> fields,
      {Map<String, dynamic> initial = const {}, bool operation = false}) async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => CommandForm(
                title: title,
                path: path,
                fields: fields,
                initial: initial,
                operation: operation)));
    load();
  }

  Future<void> action(Map row, String suffix, Map<String, dynamic> body,
      {bool reason = false}) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: Text('$suffix: ${row['number'] ?? row['id']}'),
                content: reason
                    ? TextField(
                        controller: c,
                        decoration: const InputDecoration(labelText: 'Причина'))
                    : const Text('Подтвердить операцию?'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Назад')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Подтвердить'))
                ]));
    if (ok != true) return;
    if (reason && c.text.trim().isEmpty) return;
    try {
      final x = await api.send('${paths[tab]}/${row['id']}/$suffix',
          {...body, if (reason) 'reason': c.text});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(x['queued'] == true
                ? 'Сохранено в офлайн-очереди'
                : 'Сохранено')));
      }
      await load();
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      c.dispose();
    }
  }

  Widget card(dynamic value) {
    final r = Map<String, dynamic>.from(value as Map);
    final status = r['status'];
    final children = <Widget>[
      Text('${r['number'] ?? r['batch']?['number'] ?? r['title'] ?? r['id']}',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
      Text(labels[status] ?? labels[r['batch']?['state']] ?? '${status ?? ''}'),
      SelectableText('ID: ${r['batchId'] ?? r['id']}'),
      if (r['quantity'] != null)
        Text(
            'Остаток ${r['quantity']} т · резерв ${r['reserved']} т · свободно ${r['available']} т'),
      if (r['availableSourceQuantity'] != null)
        Text('Доступно к распределению ${r['availableSourceQuantity']} т'),
      if (r['declaredWeight'] != null)
        Text(
            'Отправлено ${r['declaredWeight']} т · принято ${r['receivedWeight'] ?? '—'} т'),
      if (r['body'] != null) Text(r['body'])
    ];
    if (tab == 0 && api.can('batches.manage')) {
      if (status == 'DRAFT') {
        children.add(TextButton(
            onPressed: () => action(r, 'confirm', {}, reason: true),
            child: const Text('Подтвердить')));
      }
      children.add(TextButton(
          onPressed: () => action(r, 'close', {}, reason: true),
          child: const Text('Закрыть')));
      if (status != 'CANCELLED' && status != 'CLOSED') {
        children.add(TextButton(
            onPressed: () => action(r, 'cancel', {}, reason: true),
            child: const Text('Отменить')));
      }
    }
    if (tab == 0 || tab == 2) {
      children.add(TextButton(
          onPressed: () async {
            try {
              final x = await api
                  .get('/ledger/batches/${r['batchId'] ?? r['id']}/trace');
              if (mounted) {
                Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => Scaffold(
                            appBar: AppBar(
                                title: const Text('Происхождение партии')),
                            body: SingleChildScrollView(
                                padding: const EdgeInsets.all(16),
                                child: SelectableText(
                                    const JsonEncoder.withIndent('  ')
                                        .convert(x))))));
              }
            } catch (e) {
              setState(() => error = errorText(e));
            }
          },
          child: const Text('Происхождение')));
    }
    if (tab == 1) {
      if (status == 'CREATED' && api.can('loading.manage')) {
        children.add(TextButton(
            onPressed: () => openForm(
                'Погрузка', '/ledger/waybills/${r['id']}/load', weightFields),
            child: const Text('Погрузить')));
      }
      if (status == 'LOADED' && api.can('waybills.manage')) {
        children.add(TextButton(
            onPressed: () => action(r, 'status', {'status': 'IN_TRANSIT'}),
            child: const Text('В путь')));
      }
      if (status == 'IN_TRANSIT' && api.can('waybills.manage')) {
        children.add(TextButton(
            onPressed: () => action(r, 'status', {'status': 'ARRIVED'}),
            child: const Text('Прибыла')));
      }
      if (['ARRIVED', 'PARTIALLY_ACCEPTED'].contains(status) &&
          api.can('waybills.accept')) {
        children.add(TextButton(
            onPressed: () =>
                openForm('Приёмка', '/ledger/waybills/${r['id']}/receipt', [
                  const Field('warehouseId', 'Склад приёмки',
                      reference: 'warehouses'),
                  ...weightFields,
                  const Field('partial', 'Частичная приёмка',
                      boolean: true, required: false)
                ], initial: {
                  'warehouseId': r['destinationWarehouseId']
                }),
            child: const Text('Принять')));
      }
      if (['ACCEPTED', 'ACCEPTED_WITH_DIFFERENCE'].contains(status) &&
          api.can('waybills.accept')) {
        children.add(TextButton(
            onPressed: () => action(r, 'unload', {}),
            child: const Text('Разгрузить')));
      }
      if (status == 'UNLOADED' && api.can('waybills.manage')) {
        children.add(TextButton(
            onPressed: () => action(r, 'status', {'status': 'COMPLETED'}),
            child: const Text('Завершить')));
      }
      if (api.can('waybills.manage')) {
        children.add(TextButton(
            onPressed: () =>
                action(r, 'status', {'status': 'CANCELLED'}, reason: true),
            child: const Text('Отменить')));
      }
    }
    if (tab == 3 &&
        (api.can('inventory.manage') || api.can('operations.manage'))) {
      if (status == 'DRAFT') {
        children.add(TextButton(
            onPressed: () => action(r, 'confirm', {}),
            child: const Text('Подтвердить')));
      }
      if (status != 'CANCELLED') {
        children.add(TextButton(
            onPressed: () => action(r, 'cancel', {}, reason: true),
            child: const Text('Отменить')));
      }
    }
    if (tab == 2 &&
        (api.can('inventory.manage') || api.can('operations.manage'))) {
      children.add(TextButton(
          onPressed: () => openForm('Операция с ${r['batch']['number']}',
              '/ledger/operations', operationFields,
              initial: {
                'kind': 'TRANSFER',
                'fromWarehouseId': r['warehouseId'],
                '_batchId': r['batchId']
              },
              operation: true),
          child: const Text('Операция с партией')));
    }
    if (tab == 4) {
      children.add(TextButton(
          onPressed: () async {
            await api.send('/notifications/${r['id']}/read', {}, queue: false);
            load();
          },
          child: const Text('Прочитано')));
    }
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: children)));
  }

  void create() {
    if (tab == 0) openForm('Партия добычи', '/ledger/batches', batchFields);
    if (tab == 1) openForm('Перевозка', '/ledger/waybills', tripFields);
    if (tab == 3) {
      openForm('Операция', '/ledger/operations', operationFields,
          initial: {'kind': 'TRANSFER'}, operation: true);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text(titles[tab]), actions: [
        IconButton(
            onPressed: () => Navigator.push(
                context, MaterialPageRoute(builder: (_) => const Scanner())),
            icon: const Icon(Icons.qr_code_scanner)),
        IconButton(
            onPressed: () async {
              await Navigator.push(context,
                  MaterialPageRoute(builder: (_) => const QueueScreen()));
              load();
            },
            icon: const Icon(Icons.sync)),
        PopupMenuButton<String>(
            onSelected: (x) async {
              if (x == 'logout') {
                await api.logout();
                if (context.mounted) {
                  Navigator.pushReplacement(context,
                      MaterialPageRoute(builder: (_) => const LoginScreen()));
                }
              } else if (x == 'password') {
                openForm('Смена пароля', '/auth/change-password', [
                  const Field('currentPassword', 'Текущий пароль',
                      secret: true),
                  const Field('newPassword', 'Новый пароль', secret: true)
                ]);
              } else if (x == 'reports') {
                Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const ReportScreen()));
              }
            },
            itemBuilder: (_) => [
                  if (api.can('reports.read'))
                    const PopupMenuItem(
                        value: 'reports', child: Text('Отчёты')),
                  const PopupMenuItem(
                      value: 'password', child: Text('Смена пароля')),
                  const PopupMenuItem(value: 'logout', child: Text('Выйти'))
                ])
      ]),
      body: Column(children: [
        Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
                decoration: const InputDecoration(labelText: 'Поиск по номеру'),
                onSubmitted: (v) {
                  search = v;
                  page = 1;
                  load();
                })),
        if (busy) const LinearProgressIndicator(),
        if (error != null)
          Text(error!, style: const TextStyle(color: Colors.redAccent)),
        Expanded(
            child: RefreshIndicator(
                onRefresh: load,
                child: ListView(children: [
                  if (rows.isEmpty && !busy)
                    const ListTile(title: Text('Нет записей')),
                  ...rows.map(card)
                ]))),
        if ([0, 1, 3].contains(tab))
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            TextButton(
                onPressed: page > 1
                    ? () {
                        page--;
                        load();
                      }
                    : null,
                child: const Text('Назад')),
            Text('$page · всего $total'),
            TextButton(
                onPressed: page * 20 < total
                    ? () {
                        page++;
                        load();
                      }
                    : null,
                child: const Text('Далее'))
          ])
      ]),
      floatingActionButton: (tab == 0 && api.can('batches.manage') ||
              tab == 1 && api.can('waybills.manage') ||
              tab == 3 &&
                  (api.can('inventory.manage') || api.can('operations.manage')))
          ? FloatingActionButton(
              onPressed: create, child: const Icon(Icons.add))
          : null,
      bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) {
            setState(() {
              tab = i;
              page = 1;
              search = '';
              rows = [];
            });
            load();
          },
          destinations: const [
            NavigationDestination(icon: Icon(Icons.water), label: 'Добыча'),
            NavigationDestination(
                icon: Icon(Icons.local_shipping), label: 'Рейсы'),
            NavigationDestination(icon: Icon(Icons.warehouse), label: 'Склады'),
            NavigationDestination(icon: Icon(Icons.factory), label: 'Операции'),
            NavigationDestination(
                icon: Icon(Icons.notifications), label: 'События')
          ]));
}

class Field {
  const Field(this.key, this.label,
      {this.reference,
      this.numeric = false,
      this.boolean = false,
      this.secret = false,
      this.required = true,
      this.choices});
  final String key, label;
  final String? reference;
  final bool numeric, boolean, secret, required;
  final Map<String, String>? choices;
}

const weightFields = [
  Field('grossWeight', 'Брутто, т', numeric: true),
  Field('tareWeight', 'Тара, т', numeric: true),
  Field('reason', 'Причина расхождения', required: false)
];
const batchFields = [
  Field('counterpartyId', 'Подрядчик', reference: 'counterparties'),
  Field('extractionSiteId', 'Место добычи', reference: 'extraction-sites'),
  Field('materialTypeId', 'Материал', reference: 'material-types'),
  Field('quantity', 'Количество, т', numeric: true),
  Field('measurementMethod', 'Способ измерения'),
  Field('measuredAt', 'Дата измерения ISO8601')
];
const tripFields = [
  Field('batchId', 'Партия добычи', reference: 'ledger/batches'),
  Field('vehicleId', 'Транспорт', reference: 'vehicles'),
  Field('driverId', 'Водитель', reference: 'drivers', required: false),
  Field('destinationWarehouseId', 'Склад назначения', reference: 'warehouses'),
  Field('quantity', 'Количество, т', numeric: true),
  Field('documentDate', 'Дата документа ISO8601')
];
const operationFields = [
  Field('kind', 'Операция', choices: {
    'WASHING': 'Мойка',
    'PRODUCTION': 'Производство',
    'TRANSFER': 'Перемещение',
    'WRITE_OFF': 'Списание',
    'SHIPMENT': 'Отгрузка',
    'RESERVE': 'Резерв',
    'RELEASE': 'Снять резерв',
    'CORRECTION': 'Корректировка',
    'INVENTORY': 'Инвентаризация',
    'RETURN': 'Возврат'
  }),
  Field('fromWarehouseId', 'Исходный склад', reference: 'warehouses'),
  Field('toWarehouseId', 'Склад назначения',
      reference: 'warehouses', required: false),
  Field('outputQuantity', 'Выход, т', numeric: true, required: false),
  Field('wasteQuantity', 'Отходы, т', numeric: true, required: false),
  Field('lossQuantity', 'Потери, т', numeric: true, required: false),
  Field('defectQuantity', 'Брак, т', numeric: true, required: false),
  Field('productTypeId', 'Продукция',
      reference: 'product-types', required: false),
  Field('shift', 'Смена', required: false),
  Field('line', 'Линия', required: false),
  Field('packaging', 'Упаковка', required: false),
  Field('recipient', 'Получатель', required: false),
  Field('vehicleId', 'Транспорт', reference: 'vehicles', required: false),
  Field('documentNumber', 'Документ отгрузки', required: false),
  Field('reversesOperationId', 'ID отгрузки для возврата', required: false),
  Field('reason', 'Причина / комментарий', required: false)
];

class CommandForm extends StatefulWidget {
  const CommandForm(
      {super.key,
      required this.title,
      required this.path,
      required this.fields,
      this.initial = const {},
      this.operation = false,
      this.logoutAfter = false});
  final String title, path;
  final List<Field> fields;
  final Map<String, dynamic> initial;
  final bool operation, logoutAfter;
  @override
  State<CommandForm> createState() => _CommandFormState();
}

class _CommandFormState extends State<CommandForm> {
  final form = GlobalKey<FormState>();
  final values = <String, dynamic>{};
  final refs = <String, List<dynamic>>{};
  final files = <String>[];
  final inputs = <Map<String, dynamic>>[
    {'batchId': '', 'quantity': ''}
  ];
  bool busy = false, dirty = false, leaving = false;
  String? error;
  final id = commandId();
  @override
  void initState() {
    super.initState();
    values.addAll(widget.initial);
    if (values.containsKey("_batchId")) {
      inputs.first["batchId"] = values.remove("_batchId");
    }
    for (final f in widget.fields) {
      if (['measuredAt', 'documentDate'].contains(f.key)) {
        values[f.key] = DateTime.now().toUtc().toIso8601String();
      }
      if (f.reference != null) {
        api.get('/${f.reference}?pageSize=100').then((x) {
          if (mounted) {
            setState(() =>
                refs[f.reference!] = x is List ? x : x['data'] as List? ?? []);
          }
        }).catchError((e) {
          if (mounted) setState(() => error = errorText(e));
        });
      }
    }
  }

  Future<void> attach() async {
    try {
      final photo = await ImagePicker()
          .pickImage(source: ImageSource.camera, imageQuality: 85);
      if (photo == null) return;
      setState(() => busy = true);
      final file =
          await api.upload(photo.name, await photo.readAsBytes(), 'image/jpeg');
      if (mounted) {
        setState(() {
          dirty = true;
          files.add(file);
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> submit() async {
    if (busy) return;
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = {...values}..removeWhere((k, v) => v == null || v == '');
      if (widget.path.startsWith('/ledger/')) data['idempotencyKey'] = id;
      if (widget.operation) data['inputs'] = inputs;
      if (files.isNotEmpty) data['fileIds'] = files;
      final result = await api.send(widget.path, data,
          queue: widget.path.startsWith('/ledger/'));
      if (!mounted) return;
      setState(() => dirty = false);
      await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
                  title: Text(result['queued'] == true
                      ? 'Сохранено офлайн'
                      : 'Сохранено'),
                  content: Column(mainAxisSize: MainAxisSize.min, children: [
                    if (result['number'] != null)
                      SelectableText('${result['number']}'),
                    if (result['qrImage'] != null)
                      Image.memory(
                          base64Decode(result['qrImage'].split(',').last),
                          width: 220,
                          height: 220),
                    if (result['qrToken'] != null)
                      SelectableText('QR: ${result['qrToken']}')
                    else if (result['queued'] == true)
                      const Text(
                          'Команда будет отправлена после синхронизации. Проверка остатка выполняется сервером.')
                    else if (result['number'] == null)
                      SelectableText('${result['id'] ?? 'Готово'}')
                  ]),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Закрыть'))
                  ]));
      if (widget.logoutAfter) {
        await api.logout();
        if (mounted) {
          Navigator.pushAndRemoveUntil(
              context,
              MaterialPageRoute(builder: (_) => const LoginScreen()),
              (_) => false);
        }
      } else if (mounted) {
        setState(() => leaving = true);
        await WidgetsBinding.instance.endOfFrame;
        if (mounted) Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget field(Field f) {
    if (['measuredAt', 'documentDate'].contains(f.key)) {
      return TextFormField(
          key: ValueKey(values[f.key]),
          initialValue: DateTime.tryParse(values[f.key] ?? '')
              ?.toLocal()
              .toString()
              .split('.')
              .first,
          readOnly: true,
          decoration: InputDecoration(
              labelText: f.label, suffixIcon: const Icon(Icons.calendar_today)),
          onTap: () async {
            final date = await showDatePicker(
                context: context,
                initialDate: DateTime.now(),
                firstDate: DateTime(2000),
                lastDate: DateTime(2100));
            if (date != null && mounted) {
              setState(() {
                dirty = true;
                values[f.key] = date.toUtc().toIso8601String();
              });
            }
          });
    }
    if (f.boolean) {
      return CheckboxListTile(
          title: Text(f.label),
          value: values[f.key] == true,
          onChanged: (v) => setState(() => values[f.key] = v));
    }
    if (f.reference != null || f.choices != null) {
      final options = f.choices ??
          {
            for (final x in refs[f.reference] ?? [])
              '${x['id']}':
                  '${x['name'] ?? x['plateNumber'] ?? x['fullName'] ?? x['number']}'
          };
      return DropdownButtonFormField<String>(
          initialValue:
              options.containsKey(values[f.key]) ? values[f.key] : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: f.label),
          items: options.entries
              .map((x) => DropdownMenuItem(
                  value: x.key,
                  child: Text(x.value, overflow: TextOverflow.ellipsis)))
              .toList(),
          onChanged: (v) => setState(() => values[f.key] = v),
          validator: (v) => f.required && (v == null || v.isEmpty)
              ? 'Выберите значение'
              : null);
    }
    return TextFormField(
        initialValue: values[f.key]?.toString(),
        decoration: InputDecoration(labelText: f.label),
        keyboardType: f.numeric
            ? const TextInputType.numberWithOptions(decimal: true, signed: true)
            : TextInputType.text,
        obscureText: f.secret,
        onChanged: (v) =>
            values[f.key] = f.numeric ? v.replaceAll(',', '.') : v,
        validator: (v) {
          if (f.required && (v == null || v.trim().isEmpty)) {
            return 'Заполните поле';
          }
          if (f.numeric &&
              v != null &&
              v.isNotEmpty &&
              !RegExp(r'^-?\d+(?:[.,]\d{1,3})?$').hasMatch(v)) {
            return 'Масса с точностью до 0,001 т';
          }
          return null;
        });
  }

  Future<void> leave(bool didPop) async {
    if (didPop || busy) return;
    final discard = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Оставить несохранённые изменения?'),
                content: const Text('Введённые данные будут потеряны.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Продолжить ввод')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Выйти без сохранения'))
                ]));
    if (discard == true && mounted) {
      setState(() => leaving = true);
      await WidgetsBinding.instance.endOfFrame;
      if (mounted) Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: leaving || (!dirty && !busy),
      onPopInvokedWithResult: (didPop, result) => leave(didPop),
      child: Scaffold(
          appBar: AppBar(title: Text(widget.title)),
          body: Form(
              key: form,
              onChanged: () {
                if (!dirty) setState(() => dirty = true);
              },
              child: ListView(padding: const EdgeInsets.all(20), children: [
                const Text('Масса в тоннах · точность 0,001'),
                ...widget.fields.map((f) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: field(f))),
                if (widget.operation) ...[
                  const Text('Входные партии'),
                  ...inputs.asMap().entries.map((entry) => Row(children: [
                        Expanded(
                            child: TextFormField(
                                initialValue: entry.value['batchId'],
                                decoration:
                                    const InputDecoration(labelText: 'Партия'),
                                onChanged: (v) => entry.value['batchId'] = v,
                                validator: (v) => v == null || v.isEmpty
                                    ? 'Обязательное поле'
                                    : null)),
                        const SizedBox(width: 12),
                        Expanded(
                            child: TextFormField(
                                decoration: const InputDecoration(
                                    labelText: 'Количество, т'),
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                        decimal: true, signed: true),
                                onChanged: (v) => entry.value['quantity'] =
                                    v.replaceAll(',', '.'),
                                validator: (v) => v == null ||
                                        !RegExp(r'^-?\d+(?:[.,]\d{1,3})?$')
                                            .hasMatch(v)
                                    ? 'Укажите массу'
                                    : null)),
                        if (entry.key > 0)
                          IconButton(
                              onPressed: () =>
                                  setState(() => inputs.removeAt(entry.key)),
                              icon: const Icon(Icons.remove_circle_outline))
                      ])),
                  TextButton(
                      onPressed: () => setState(
                          () => inputs.add({'batchId': '', 'quantity': ''})),
                      child: const Text('Ещё партия'))
                ],
                if (widget.path.startsWith('/ledger/'))
                  OutlinedButton.icon(
                      onPressed: busy ? null : attach,
                      icon: const Icon(Icons.camera_alt),
                      label: Text('Фото документа: ${files.length}')),
                if (error != null)
                  Text(error!, style: const TextStyle(color: Colors.redAccent)),
                const SizedBox(height: 20),
                FilledButton(
                    onPressed: busy ? null : submit,
                    child: Text(busy ? 'Сохранение…' : 'Сохранить'))
              ]))));
}

class Scanner extends StatefulWidget {
  const Scanner({super.key});
  @override
  State<Scanner> createState() => _ScannerState();
}

class _ScannerState extends State<Scanner> {
  bool busy = false;
  String? error;
  final input = TextEditingController();
  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  Future<void> resolve(String token) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final x =
          await api.send('/ledger/qr/resolve', {'token': token}, queue: false);
      if (!mounted) return;
      if (x['entityType'] == 'MaterialBatch') {
        await showDialog<void>(
            context: context,
            builder: (ctx) => AlertDialog(
                    title: Text('Партия ${x['number']}'),
                    content: Text('Доступно ${x['availableSourceQuantity']} т'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('Закрыть'))
                    ]));
        return;
      }
      Navigator.pop(context);
      Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) => CommandForm(
                      title: 'Приёмка ${x['number']}',
                      path: '/ledger/waybills/${x['id']}/receipt',
                      fields: [
                        const Field('warehouseId', 'Склад',
                            reference: 'warehouses'),
                        ...weightFields,
                        const Field('partial', 'Частичная приёмка',
                            boolean: true, required: false)
                      ],
                      initial: {
                        'warehouseId': x['destinationWarehouseId']
                      })));
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('QR перевозки')),
      body: Column(children: [
        Expanded(child: MobileScanner(onDetect: (capture) {
          final v = capture.barcodes.firstOrNull?.rawValue;
          if (v != null) resolve(v);
        })),
        TextField(
            controller: input,
            decoration: const InputDecoration(labelText: 'QR-токен вручную')),
        FilledButton(
            onPressed: busy ? null : () => resolve(input.text),
            child: const Text('Найти')),
        if (error != null) Text(error!)
      ]));
}

class QueueScreen extends StatefulWidget {
  const QueueScreen({super.key});
  @override
  State<QueueScreen> createState() => _QueueState();
}

class _QueueState extends State<QueueScreen> {
  List<dynamic> rows = [];
  bool busy = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final x = await api.pending();
    if (mounted) setState(() => rows = x);
  }

  Future<void> sync() async {
    setState(() => busy = true);
    try {
      await api.sync();
      await load();
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Офлайн-очередь')),
      body: ListView(children: [
        const ListTile(
            title: Text('Команды текущего пользователя'),
            subtitle:
                Text('Конфликтные операции остаются в очереди до проверки.')),
        FilledButton(
            onPressed: busy ? null : sync,
            child: const Text('Синхронизировать')),
        if (rows.isEmpty) const ListTile(title: Text('Очередь пуста')),
        ...rows.map((x) => ListTile(
            title: Text(x['path']),
            subtitle: Text('${x['status']} · ${x['error'] ?? x['createdAt']}'),
            trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () async {
                  final ok = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                              title:
                                  const Text('Удалить неотправленную команду?'),
                              actions: [
                                TextButton(
                                    onPressed: () => Navigator.pop(ctx, false),
                                    child: const Text('Назад')),
                                TextButton(
                                    onPressed: () => Navigator.pop(ctx, true),
                                    child: const Text('Удалить'))
                              ]));
                  if (ok == true) {
                    await api.discard(x['data']['idempotencyKey']);
                    load();
                  }
                })))
      ]));
}

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});
  @override
  State<ReportScreen> createState() => _ReportState();
}

class _ReportState extends State<ReportScreen> {
  String type = 'inventory', text = '', error = '';
  final types = [
    'extraction',
    'waybills',
    'discrepancies',
    'movements',
    'inventory',
    'turnover',
    'washing',
    'production',
    'losses',
    'transfers',
    'shipments',
    'reconciliation',
    'audit'
  ];
  Future<void> load() async {
    try {
      final x = await api.get('/ledger/reports/$type');
      if (mounted) {
        setState(() => text = const JsonEncoder.withIndent('  ').convert(x));
      }
    } catch (e) {
      setState(() => error = errorText(e));
    }
  }

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Отчёты')),
      body: Column(children: [
        DropdownButton<String>(
            value: type,
            items: types
                .map((x) => DropdownMenuItem(value: x, child: Text(x)))
                .toList(),
            onChanged: (x) {
              setState(() => type = x!);
              load();
            }),
        if (error.isNotEmpty) Text(error),
        Expanded(
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(16), child: SelectableText(text)))
      ]));
}
