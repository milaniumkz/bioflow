import 'dart:async';
import 'package:flutter/material.dart';
import 'client.dart';
import 'driver_tracking.dart';
import 'full_workspace.dart';
import 'qr_scan.dart';
import 'role_access.dart';
import 'push.dart';

bool hasRoleHome(BioflowClient api) => [
      'collection.manage',
      'processing.read',
      'processing.overview',
      'tracking.write'
    ].any(api.can);

class RoleHome extends StatefulWidget {
  const RoleHome(
      {super.key,
      required this.client,
      required this.onLogout,
      this.legacyBuilder});
  final BioflowClient client;
  final VoidCallback onLogout;
  final WidgetBuilder? legacyBuilder;
  @override
  State<RoleHome> createState() => _RoleHomeState();
}

class _RoleHomeState extends State<RoleHome> with WidgetsBindingObserver {
  int tab = 0;
  List<dynamic> trips = [], notices = [];
  Map<String, dynamic> tracking = {};
  String? error;
  bool busy = false;
  bool locationGranted = false, autoAttempted = false;
  Timer? timer;
  BioflowClient get api => widget.client;
  bool get driver => (api.profile?['roles'] as List? ?? []).contains('DRIVER');
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    configurePush(api).catchError((_) {});
    if (driver) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        try {
          final allowed =
              await driverLocation.invokeMethod<bool>('permission') ?? false;
          if (allowed && mounted) {
            locationGranted = true;
            await tryAutoTracking();
          }
          if (!allowed && mounted) {
            setState(() => error = 'Для маршрута разрешите точную геолокацию.');
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
      final data =
          driver ? await api.get('/tracking/trips?pageSize=100') : null;
      final alerts = api.can('notifications.read')
          ? await api.get('/notifications?pageSize=10')
          : null;
      if (mounted) {
        setState(() {
          tracking = status;
          if (status["running"] == true) autoAttempted = true;
          if (data != null) trips = data['data'] as List? ?? [];
          if (alerts != null) notices = alerts['data'] as List? ?? [];
        });
        await tryAutoTracking();
      }
    } catch (e) {
      if (mounted) setState(() => error = errorText(e));
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
    await stopDriverTracking();
    await api.logout();
    if (mounted) widget.onLogout();
  }

  Future<void> scan() async {
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
              leading: Icon(icon, size: 32, color: const Color(0xff42d3b2)),
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
                  Text(status == 'IN_TRANSIT'
                      ? 'В пути'
                      : status == 'LOADED'
                          ? 'Готов к выезду'
                          : 'Рейс завершён'),
                  if (['LOADED', 'IN_TRANSIT'].contains(status)) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                        onPressed: busy
                            ? null
                            : () => command(() async {
                                  final allowed = await driverLocation
                                          .invokeMethod<bool>('permission') ??
                                      false;
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
                                  await startDriverTracking(api, id);
                                }),
                        icon: const Icon(Icons.location_on),
                        label: Text(status == 'LOADED'
                            ? 'Выезжаю · включить геолокацию'
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
      appBar: AppBar(
          title:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(api.profile?['fullName'] ?? 'Collection',
                style: const TextStyle(fontSize: 19)),
            Text(roleSummary(api.profile), style: const TextStyle(fontSize: 12))
          ]),
          actions: [
            IconButton(
                onPressed: load,
                icon: const Icon(Icons.refresh),
                tooltip: 'Обновить')
          ]),
      body: RefreshIndicator(
          onRefresh: load,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            if (error != null)
              Card(
                  child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(error!,
                          style: const TextStyle(color: Colors.redAccent)))),
            if (tab == 2) ...[
              const Text('Профиль', style: TextStyle(fontSize: 28)),
              Text('${api.profile?['phone'] ?? ''}'),
              Text(roleSummary(api.profile)),
              const SizedBox(height: 24),
              if (tracking['running'] == true)
                OutlinedButton(
                    onPressed: () => command(() async {
                          await stopDriverTracking();
                        }),
                    child: const Text('Остановить передачу геолокации')),
              OutlinedButton(
                  onPressed: () => open('sessions'),
                  child: const Text('Мои сессии')),
              const SizedBox(height: 16),
              FilledButton(onPressed: logout, child: const Text('Выйти')),
            ] else ...[
              if (api.can('processing.overview'))
                tile('Всё предприятие', 'Этапы, остатки, водители и маршруты',
                    Icons.dashboard, 'control'),
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
                        subtitle: const Text('Партии, склад и офлайн-очередь'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: widget.legacyBuilder!)))),
              if (api.can('collection.manage'))
                tile('Новая отправка', 'Машина, водитель, мешки, вес и QR',
                    Icons.add_circle_outline, 'collection'),
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
                    child: Text('Мои рейсы', style: TextStyle(fontSize: 24))),
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
                    child: Text('Уведомления', style: TextStyle(fontSize: 24))),
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
          selectedIndex: tab,
          onDestinationSelected: (i) {
            if (i == 1) {
              scan();
            } else {
              setState(() => tab = i);
            }
          },
          destinations: const [
            NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home),
                label: 'Главная'),
            NavigationDestination(
                icon: Icon(Icons.qr_code_scanner, size: 32), label: 'QR'),
            NavigationDestination(
                icon: Icon(Icons.person_outline),
                selectedIcon: Icon(Icons.person),
                label: 'Профиль')
          ]));
}
