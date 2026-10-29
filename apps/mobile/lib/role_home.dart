import 'dart:async';
import 'package:flutter/material.dart';
import 'client.dart';
import 'collection_design.dart';
import 'driver_tracking.dart';
import 'full_workspace.dart';
import 'qr_scan.dart';
import 'role_access.dart';
import 'push.dart';

bool hasRoleHome(BioflowClient api) => api.profile != null;

class RoleHome extends StatefulWidget {
  const RoleHome(
      {super.key,
      required this.client,
      required this.onLogout,
      this.legacyBuilder,
      this.legacyQrBuilder,
      this.queueBuilder,
      this.passwordBuilder});
  final BioflowClient client;
  final VoidCallback onLogout;
  final WidgetBuilder? legacyBuilder, queueBuilder, passwordBuilder;
  final Widget Function(BuildContext, String)? legacyQrBuilder;
  @override
  State<RoleHome> createState() => _RoleHomeState();
}

class _RoleHomeState extends State<RoleHome> with WidgetsBindingObserver {
  int tab = 0;
  List<dynamic> trips = [], notices = [];
  Map<String, dynamic> tracking = {};
  String? error;
  bool busy = false, loading = true;
  Map<String, dynamic>? overview;
  bool locationGranted = false, autoAttempted = false;
  Timer? timer;
  final listScroll = ScrollController();
  void changeTab(int next) {
    if (listScroll.hasClients) listScroll.jumpTo(0);
    setState(() => tab = next);
  }

  BioflowClient get api => widget.client;
  List<dynamic> get todayDispatches {
    final now = DateTime.now();
    return trips.where((t) {
      final time =
          DateTime.tryParse('${t['departedAt'] ?? t['createdAt']}')?.toLocal();
      return time != null &&
          time.year == now.year &&
          time.month == now.month &&
          time.day == now.day;
    }).toList();
  }

  String get sentToday => todayDispatches
      .fold<double>(
          0, (sum, t) => sum + (double.tryParse('${t['declaredWeight']}') ?? 0))
      .toStringAsFixed(3);
  bool get driver => (api.profile?['roles'] as List? ?? []).contains('DRIVER');
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    configurePush(api).catchError((_) {});
    if (driver) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        try {
          final owner = api.owner;
          final consent = await api.storage.read(key: 'gps-consent:$owner');
          final stopped = await api.storage.read(key: 'gps-stop:$owner');
          if (consent != 'yes' || stopped == 'yes') {
            autoAttempted = stopped == 'yes';
            return;
          }
          final nativeState = await driverTrackingStatus();
          if (nativeState['manualPaused'] == true) {
            autoAttempted = true;
            return;
          }
          final allowed =
              await driverLocation.invokeMethod<bool>('hasPermission') ?? false;
          if (allowed && mounted && api.owner == owner) {
            locationGranted = true;
            await tryAutoTracking();
          }
        } catch (_) {}
      });
    }
    load();
    timer = Timer.periodic(const Duration(seconds: 20), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    listScroll.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) load();
  }

  Future<void> load() async {
    try {
      final status = await driverTrackingStatus();
      final data = driver
          ? await api.get('/tracking/trips?pageSize=100')
          : api.can('collection.manage')
              ? await api.get('/collection/trips?pageSize=100')
              : null;
      final totals = api.can('processing.overview')
          ? await api.get('/processing/overview')
          : null;
      final alerts = api.can('notifications.read')
          ? await api.get('/notifications?pageSize=10')
          : null;
      if (mounted) {
        setState(() {
          loading = false;
          error = null;
          if (totals is Map) overview = Map<String, dynamic>.from(totals);
          tracking = status;
          if (status["running"] == true || status["manualPaused"] == true) {
            autoAttempted = true;
          }
          if (data != null) trips = data['data'] as List? ?? [];
          if (alerts != null) notices = alerts['data'] as List? ?? [];
        });
        await tryAutoTracking();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = errorText(e);
          loading = false;
        });
      }
    }
  }

  Future<bool> requestLocation() async {
    final owner = api.owner;
    final accepted = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('Где находится груз'),
                content: const Text(
                    'Collection передаёт точное местоположение только для вашего активного рейса. Сборщик этой отправки и владелец видят маршрут, время в пути и остановки. В фоне Android показывает постоянное уведомление. Вы можете отказать или остановить передачу в профиле; остальные разрешённые действия останутся доступны.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Пока без геолокации')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('Разрешить геолокацию'))
                ]));
    if (accepted != true || !mounted || api.owner != owner) return false;
    final allowed =
        await driverLocation.invokeMethod<bool>('permission') ?? false;
    if (!allowed || !mounted || api.owner != owner) return false;
    await api.storage.write(key: 'gps-consent:$owner', value: 'yes');
    await api.storage.delete(key: 'gps-stop:$owner');
    locationGranted = true;
    return true;
  }

  Future<void> pauseTracking() async {
    autoAttempted = true;
    locationGranted = false;
    try {
      await api.storage.write(key: 'gps-stop:${api.owner}', value: 'yes');
    } finally {
      await stopDriverTracking();
    }
  }

  Future<void> tryAutoTracking() async {
    final state = WidgetsBinding.instance.lifecycleState;
    if ([
      AppLifecycleState.paused,
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.detached
    ].contains(state)) {
      return;
    }
    if (!mounted ||
        !driver ||
        !locationGranted ||
        autoAttempted ||
        busy ||
        tracking['running'] == true) {
      return;
    }
    final active = trips.where((t) => t['status'] == 'IN_TRANSIT').toList();
    if (active.length != 1) return;
    autoAttempted = true;
    try {
      await startDriverTracking(api, '${active.single['id']}');
      if (mounted) {
        final state = await driverTrackingStatus();
        if (mounted) setState(() => tracking = state);
      }
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    }
  }

  Future<void> open(String section, {String? qr}) async {
    final signedOut = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
            builder: (_) =>
                FullWorkspace(client: api, section: section, initialQr: qr)));
    if (!mounted) return;
    if (signedOut == true) {
      await logout();
      return;
    }
    await load();
  }

  Future<void> logout() async {
    final pending = await api.pending();
    if (pending.isNotEmpty && mounted) {
      final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
                  title: const Text('Есть неотправленные операции'),
                  content: const Text(
                      'Они останутся на этом устройстве в очереди вашего аккаунта. Перед выходом можно вернуться и синхронизировать их.'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('Остаться')),
                    FilledButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Выйти без отправки'))
                  ]));
      if (leave != true) return;
    }
    await stopDriverTracking();
    await api.logout();
    if (mounted) widget.onLogout();
  }

  Future<void> scan() async {
    if (!api.can('processing.read') &&
        !driver &&
        !api.can('inventory.read') &&
        !api.can('waybills.accept') &&
        !api.can('batches.manage')) {
      setState(() => error =
          'Нет доступа к работе с QR. Обратитесь к администратору для назначения роли.');
      return;
    }
    final qr = await Navigator.push<String>(
        context, MaterialPageRoute(builder: (_) => const PartyQrScanner()));
    if (qr != null && mounted) {
      if (api.can('processing.read')) {
        await open('processing', qr: qr);
      } else if (driver) {
        await command(() async {
          final trip =
              await api.send('/tracking/scan', {'token': qr}, queue: false);
          await load();
          if (mounted) {
            setState(() {
              trips.sort((a, b) => a['id'] == trip['id']
                  ? -1
                  : b['id'] == trip['id']
                      ? 1
                      : 0);
            });
            ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Открыт ваш рейс ${trip['number']}')));
          }
        });
      } else if (widget.legacyQrBuilder != null) {
        await Navigator.push(
            context,
            MaterialPageRoute(
                builder: (context) => widget.legacyQrBuilder!(context, qr)));
      }
    }
    if (mounted) setState(() => tab = 0);
  }

  Future<void> command(Future<void> Function() work) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await work();
      await load();
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget tile(String title, String detail, IconData icon, String section) =>
      Card(
          child: ListTile(
              minVerticalPadding: 20,
              leading: Icon(icon, size: 32, color: CollectionDesign.green),
              title: Text(title,
                  style: const TextStyle(
                      fontSize: 19, fontWeight: FontWeight.w600)),
              subtitle: Text(detail),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => open(section)));
  Widget tripCard(dynamic trip) {
    final id = '${trip['id']}', status = trip['status'];
    return Card(
        child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('${trip['vehicle']?['plateNumber'] ?? ''}',
                      style: const TextStyle(
                          fontSize: 24, fontWeight: FontWeight.bold)),
                  Text('${trip['number']}'),
                  Text('Куда: ${trip['destinationWarehouse']?['name'] ?? ''}'),
                  Text(
                      '${trip['bagCount'] ?? '—'} мешков · ${trip['declaredWeight']} т'),
                  const SizedBox(height: 16),
                  if (trip['loadedAt'] != null)
                    Text(
                        'Загрузился: ${DateTime.tryParse(trip['loadedAt'].toString())?.toLocal() ?? trip['loadedAt']}'),
                  if (trip['departedAt'] != null)
                    Text(
                        'Выехал: ${DateTime.tryParse(trip['departedAt'].toString())?.toLocal() ?? trip['departedAt']}'),
                  if (trip['arrivedAt'] != null)
                    Text(
                        'Прибыл: ${DateTime.tryParse(trip['arrivedAt'].toString())?.toLocal() ?? trip['arrivedAt']}'),
                  Text(status == 'IN_TRANSIT'
                      ? 'В пути'
                      : status == 'CREATED'
                          ? 'Ожидает загрузки'
                          : status == 'LOADED'
                              ? 'Готов к выезду'
                              : 'Рейс завершён'),
                  if (status == 'CREATED' && trip['bagCount'] != null) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: busy
                          ? null
                          : () => command(() async {
                                if (!await requestLocation()) {
                                  throw StateError(
                                      'Разрешите точное местоположение перед началом рейса.');
                                }
                                await api.send('/tracking/trips/$id/status',
                                    {'status': 'LOADED'},
                                    queue: false);
                              }),
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Загрузился'),
                    ),
                  ],
                  if (['LOADED', 'IN_TRANSIT'].contains(status)) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                        onPressed: busy
                            ? null
                            : () => command(() async {
                                  final allowed = await requestLocation();
                                  if (!allowed) {
                                    throw StateError(
                                        'Разрешите точную геолокацию перед началом рейса.');
                                  }
                                  if (status == 'LOADED') {
                                    await api.send('/tracking/trips/$id/status',
                                        {'status': 'IN_TRANSIT'},
                                        queue: false);
                                  }
                                  autoAttempted = true;
                                  await startDriverTracking(api, id,
                                      resumeManually: true);
                                }),
                        icon: const Icon(Icons.location_on),
                        label: Text(status == 'LOADED'
                            ? 'Выехал · включить геолокацию'
                            : 'Включить / продолжить геолокацию')),
                    if (status == 'IN_TRANSIT')
                      OutlinedButton(
                          onPressed: busy
                              ? null
                              : () => command(() async {
                                    final confirm = await showDialog<bool>(
                                        context: context,
                                        builder: (context) => AlertDialog(
                                                title:
                                                    const Text('Вы прибыли?'),
                                                content: const Text(
                                                    'Рейс будет отмечен прибывшим, запись новой геолокации остановится.'),
                                                actions: [
                                                  TextButton(
                                                      onPressed: () =>
                                                          Navigator.pop(
                                                              context, false),
                                                      child: const Text(
                                                          'Ещё в пути')),
                                                  FilledButton(
                                                      onPressed: () =>
                                                          Navigator.pop(
                                                              context, true),
                                                      child:
                                                          const Text('Прибыл'))
                                                ]));
                                    if (confirm == true) {
                                      await api.send(
                                          '/tracking/trips/$id/status',
                                          {'status': 'ARRIVED'},
                                          queue: false);
                                      await driverLocation
                                          .invokeMethod<void>('finish');
                                    }
                                  }),
                          child: const Text('Прибыл на место')),
                  ],
                ])));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const CollectionBrand(compact: true), actions: [
        IconButton(
            onPressed: load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Обновить'),
        Padding(
            padding: const EdgeInsets.only(right: 16),
            child: IconButton.filledTonal(
                onPressed: () => changeTab(2),
                icon: const Icon(Icons.person_outline),
                tooltip: 'Мой профиль'))
      ]),
      body: RefreshIndicator(
          onRefresh: load,
          child: ListView(
              controller: listScroll,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(20),
              children: [
                if (error != null)
                  Card(
                      child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(error!,
                              style:
                                  const TextStyle(color: Colors.redAccent)))),
                if (tab == 2) ...[
                  const Text('Профиль', style: TextStyle(fontSize: 28)),
                  Text('${api.profile?['phone'] ?? ''}'),
                  Text(roleSummary(api.profile)),
                  const SizedBox(height: 24),
                  if (widget.passwordBuilder != null)
                    OutlinedButton.icon(
                        onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: widget.passwordBuilder!)),
                        icon: const Icon(Icons.lock_outline),
                        label: const Text('Сменить пароль')),
                  if (widget.queueBuilder != null)
                    OutlinedButton.icon(
                        onPressed: () => Navigator.push(context,
                            MaterialPageRoute(builder: widget.queueBuilder!)),
                        icon: const Icon(Icons.sync),
                        label: const Text('Офлайн-очередь')),
                  const SizedBox(height: 16),
                  const Text('Все разделы моей роли',
                      style:
                          TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
                  ...roleSections.entries
                      .where((e) => canOpenSection(e.key, api.profile))
                      .map((e) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(e.value),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => open(e.key))),
                  if (widget.legacyBuilder != null)
                    OutlinedButton(
                        onPressed: () => Navigator.push(context,
                            MaterialPageRoute(builder: widget.legacyBuilder!)),
                        child: const Text('Учёт и офлайн')),
                  if (tracking['running'] == true)
                    OutlinedButton(
                        onPressed: () => command(() async {
                              await pauseTracking();
                            }),
                        child: const Text('Остановить передачу геолокации')),
                  OutlinedButton(
                      onPressed: () => open('sessions'),
                      child: const Text('Мои сессии')),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: logout, child: const Text('Выйти')),
                ] else ...[
                  Text(
                      'Здравствуйте, ${api.profile?['fullName'] ?? 'сотрудник'}',
                      style: const TextStyle(
                          fontSize: 27,
                          height: 1.2,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -.65)),
                  const SizedBox(height: 10),
                  Text(roleSummary(api.profile),
                      style: const TextStyle(
                          color: CollectionDesign.muted, fontSize: 15)),
                  const SizedBox(height: 18),
                  Card(
                      color: CollectionDesign.green,
                      child: Padding(
                          padding: const EdgeInsets.all(22),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                    api.can('collection.manage')
                                        ? 'ОТПРАВЛЕНО СЕГОДНЯ · ПО ПОСЛЕДНИМ 100 РЕЙСАМ'
                                        : 'РАБОЧЕЕ ПРОСТРАНСТВО',
                                    style: const TextStyle(
                                        color: Color(0xffc1e2d6),
                                        fontSize: 11,
                                        letterSpacing: 1.1)),
                                const SizedBox(height: 18),
                                Text(
                                    driver
                                        ? (loading
                                            ? 'Загрузка рейсов…'
                                            : error != null
                                                ? 'Данные недоступны'
                                                : '${trips.where((t) => t['status'] == 'IN_TRANSIT').length} в пути')
                                        : api.can('collection.manage')
                                            ? (loading
                                                ? 'Загрузка отправок…'
                                                : error != null
                                                    ? 'Данные недоступны'
                                                    : '$sentToday т')
                                            : overview != null
                                                ? '${overview!['driversInTransit']} водителей в пути'
                                                : 'Всё движение.\nВ одной системе.',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 30,
                                        height: 1.2,
                                        fontWeight: FontWeight.w600)),
                                const SizedBox(height: 14),
                                const Text(
                                    'Операции по QR · доступ по вашей роли',
                                    style: TextStyle(color: Color(0xffc1e2d6)))
                              ]))),
                  const SizedBox(height: 12),
                  if (api.can('processing.overview'))
                    tile(
                        'Всё предприятие',
                        'Этапы, остатки, водители и маршруты',
                        Icons.dashboard,
                        'control'),
                  if (api.can('users.manage'))
                    tile(
                        'Сотрудники и роли',
                        'Телефоны, доступы и временные пароли',
                        Icons.group_outlined,
                        'users'),
                  if (api.can('inventory.read') && widget.legacyBuilder != null)
                    Card(
                        child: ListTile(
                            minVerticalPadding: 20,
                            leading: const Icon(Icons.inventory_2_outlined),
                            title: const Text('Остатки и сохранённые действия'),
                            subtitle:
                                const Text('Партии, склад и офлайн-очередь'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: widget.legacyBuilder!)))),
                  if (!driver &&
                      !api.can('collection.manage') &&
                      !api.can('processing.read') &&
                      !api.can('processing.overview'))
                    ...roleSections.entries
                        .where((e) =>
                            canOpenSection(e.key, api.profile) &&
                            !['sessions', 'notifications'].contains(e.key))
                        .take(4)
                        .map((e) => tile(
                            e.value,
                            'Доступные данные и действия вашей роли',
                            Icons.apps_outlined,
                            e.key)),
                  if (api.can('collection.manage'))
                    FilledButton.icon(
                        onPressed: () => open('collection'),
                        icon: const Icon(Icons.add),
                        label: const Text('Новая отправка')),
                  if (api.can('collection.manage') && trips.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const Text('Последние отправки',
                        style: TextStyle(
                            fontSize: 19, fontWeight: FontWeight.w600)),
                    ...trips.take(3).map((t) => Card(
                        child: ListTile(
                            leading: const Icon(Icons.local_shipping_outlined),
                            title: Text('${t['number']}'),
                            subtitle: Text(
                                '${t['declaredWeight']} т · ${t['bagCount'] ?? '—'} мешков'),
                            trailing: Text(t['status'] == 'IN_TRANSIT'
                                ? 'В пути'
                                : 'Завершён'))))
                  ],
                  if (api.can('processing.read'))
                    tile(
                        'Открыть партию',
                        'Сканируйте QR и выполните своё действие',
                        Icons.qr_code_scanner,
                        'processing'),
                  if (api.can('tracking.read'))
                    tile('Водители на карте', 'Маршруты, остановки, задержки',
                        Icons.map_outlined, 'fleet'),
                  if (driver) ...[
                    const Padding(
                        padding: EdgeInsets.all(12),
                        child:
                            Text('Мои рейсы', style: TextStyle(fontSize: 24))),
                    if (tracking['running'] == true)
                      Card(
                          child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text('${tracking['message']}'))),
                    const Padding(
                        padding: EdgeInsets.all(12),
                        child: Text(
                            'Геолокация передаётся только после вашего разрешения и начала рейса. Android показывает постоянное уведомление.')),
                    if (trips.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(20),
                          child: Text(
                              'Назначенных рейсов пока нет. Обратитесь к сборщику.')),
                    ...trips.map(tripCard)
                  ],
                  if (notices.isNotEmpty) ...[
                    const Padding(
                        padding: EdgeInsets.all(12),
                        child: Text('Уведомления',
                            style: TextStyle(fontSize: 24))),
                    ...notices.map((n) => Card(
                        child: ListTile(
                            title: Text('${n['title']}'),
                            subtitle: Text('${n['body']}'),
                            trailing: n['readAt'] == null
                                ? const Icon(Icons.circle,
                                    size: 10, color: Colors.orange)
                                : null,
                            onTap: () => command(() async {
                                  await api.send(
                                      '/notifications/${n['id']}/read', {},
                                      queue: false);
                                }))))
                  ],
                ]
              ])),
      bottomNavigationBar: NavigationBar(
          height: MediaQuery.textScalerOf(context).scale(12) > 18 ? 112 : 80,
          selectedIndex: tab,
          onDestinationSelected: (i) {
            if (i == 1) {
              scan();
            } else {
              changeTab(i);
            }
          },
          destinations: const [
            NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home),
                label: 'Главная'),
            NavigationDestination(
                icon: DecoratedBox(
                    decoration: BoxDecoration(
                        color: CollectionDesign.green,
                        borderRadius: BorderRadius.all(Radius.circular(14))),
                    child: Padding(
                        padding: EdgeInsets.all(12),
                        child: Icon(Icons.qr_code_scanner,
                            size: 26, color: Colors.white))),
                label: 'Сканировать'),
            NavigationDestination(
                icon: Icon(Icons.person_outline),
                selectedIcon: Icon(Icons.person),
                label: 'Профиль')
          ]));
}
