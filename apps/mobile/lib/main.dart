import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() => runApp(const ProviderScope(child: BioflowApp()));

const navy950 = Color(0xFF061225);
const navy900 = Color(0xFF0A1C35);
const blue = Color(0xFF2F7DF6);
const platinum = Color(0xFFD8DEE8);

final secureStorageProvider = Provider((_) => const FlutterSecureStorage());

final apiProvider = Provider((ref) {
  final dio = Dio(BaseOptions(baseUrl: const String.fromEnvironment('API_URL', defaultValue: 'http://localhost:4000/api/v1')));
  dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) async {
    final token = await ref.read(secureStorageProvider).read(key: 'accessToken');
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }));
  return dio;
});

final routerProvider = Provider((ref) => GoRouter(routes: [
      GoRoute(path: '/', builder: (_, __) => const LoginScreen()),
      ShellRoute(
        builder: (_, __, child) => AppShell(child: child),
        routes: [
          GoRoute(path: '/home', builder: (_, __) => const DashboardScreen()),
          GoRoute(path: '/operations', builder: (_, __) => const OperationsScreen()),
          GoRoute(path: '/qr', builder: (_, __) => const QrScanScreen()),
          GoRoute(path: '/accept/:id', builder: (_, state) => AcceptanceScreen(waybillId: state.pathParameters['id']!)),
          GoRoute(path: '/warehouses', builder: (_, __) => const WarehousesScreen()),
          GoRoute(path: '/more', builder: (_, __) => const MoreScreen()),
        ],
      ),
    ]));

class BioflowApp extends ConsumerWidget {
  const BioflowApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'BIOFLOW',
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: navy950,
        colorScheme: const ColorScheme.dark(primary: blue, secondary: platinum, surface: navy900),
      ),
      routerConfig: ref.watch(routerProvider),
    );
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final email = TextEditingController(text: 'owner@bioflow.local');
  final password = TextEditingController(text: 'Bioflow123!');
  bool loading = false;
  String? error;

  Future<void> login() async {
    setState(() { loading = true; error = null; });
    try {
      final res = await ref.read(apiProvider).post('/auth/login', data: {'email': email.text, 'password': password.text, 'platform': 'mobile'});
      await ref.read(secureStorageProvider).write(key: 'accessToken', value: res.data['accessToken']);
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => error = 'Не удалось войти');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Spacer(),
            const Text('BIOFLOW', style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            const Text('Контроль добычи, приёмки и переработки', style: TextStyle(color: platinum)),
            const SizedBox(height: 28),
            TextField(controller: email, decoration: const InputDecoration(labelText: 'Email')),
            const SizedBox(height: 12),
            TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Пароль')),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: Colors.redAccent))),
            const SizedBox(height: 18),
            FilledButton(onPressed: loading ? null : login, child: Text(loading ? 'Вход...' : 'Войти')),
            const Spacer(),
          ]),
        ),
      ),
    );
  }
}

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: ['/home', '/operations', '/warehouses', '/more'].indexOf(path).clamp(0, 3),
        onDestinationSelected: (index) => context.go(['/home', '/operations', '/warehouses', '/more'][index]),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Главная'),
          NavigationDestination(icon: Icon(Icons.qr_code_scanner), label: 'Операции'),
          NavigationDestination(icon: Icon(Icons.warehouse_outlined), label: 'Склады'),
          NavigationDestination(icon: Icon(Icons.more_horiz), label: 'Ещё'),
        ],
      ),
    );
  }
}

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ApiListScreen(title: 'Главная', path: '/dashboard', ref: ref);
}

class OperationsScreen extends ConsumerWidget {
  const OperationsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ApiListScreen(
        title: 'Операции',
        path: '/waybills',
        ref: ref,
        action: FilledButton.icon(
          onPressed: () => context.go('/qr'),
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('Сканировать QR'),
        ),
        onRowTap: (row) => context.go('/accept/${row['id']}'),
      );
}

class WarehousesScreen extends ConsumerWidget {
  const WarehousesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ApiListScreen(title: 'Склады', path: '/warehouses', ref: ref);
}

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Ещё')),
        body: ListView(children: [
          const ListTile(title: Text('Контрагенты')),
          const ListTile(title: Text('Автомобили')),
          const ListTile(title: Text('Уведомления')),
          const ListTile(title: Text('Профиль')),
          const ListTile(title: Text('Настройки')),
          ListTile(
            title: const Text('Оффлайн-очередь'),
            subtitle: const Text('Отправить незавершённые приёмки'),
            trailing: const Icon(Icons.sync),
            onTap: () => syncOfflineQueue(context, ref),
          ),
        ]),
      );
}

class ApiListScreen extends StatelessWidget {
  const ApiListScreen({super.key, required this.title, required this.path, required this.ref, this.action, this.onRowTap});
  final String title;
  final String path;
  final WidgetRef ref;
  final Widget? action;
  final ValueChanged<Map<String, dynamic>>? onRowTap;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Response<dynamic>>(
      future: ref.read(apiProvider).get(path),
      builder: (context, snap) {
        final data = snap.data?.data;
        final rows = data is Map && data['data'] is List ? data['data'] as List : data is List ? data : <dynamic>[];
        return Scaffold(
          appBar: AppBar(title: Text(title), actions: action == null ? null : [Padding(padding: const EdgeInsets.only(right: 12), child: action!)]),
          body: RefreshIndicator(
            onRefresh: () async {},
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (snap.connectionState == ConnectionState.waiting) const LinearProgressIndicator(),
                if (snap.hasError) const _StateCard(title: 'Ошибка', body: 'Проверьте соединение и повторите'),
                if (!snap.hasError && rows.isEmpty && snap.connectionState != ConnectionState.waiting) const _StateCard(title: 'Пусто', body: 'Данных пока нет'),
                ...rows.map((row) {
                  final item = Map<String, dynamic>.from(row as Map);
                  return Card(
                    child: ListTile(
                      title: Text('${item['name'] ?? item['number'] ?? item['id']}'),
                      subtitle: Text('${item['status'] ?? item['state'] ?? ''}'),
                      onTap: onRowTap == null ? null : () => onRowTap!(item),
                    ),
                  );
                }),
              ],
            ),
          ),
        );
      },
    );
  }
}

class SimpleScreen extends StatelessWidget {
  const SimpleScreen({super.key, required this.title, required this.children});
  final String title;
  final List<String> children;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(title)), body: ListView(children: children.map((e) => ListTile(title: Text(e))).toList()));
}

class _StateCard extends StatelessWidget {
  const _StateCard({required this.title, required this.body});
  final String title;
  final String body;
  @override
  Widget build(BuildContext context) => Card(child: ListTile(title: Text(title), subtitle: Text(body)));
}

class QrScanScreen extends ConsumerStatefulWidget {
  const QrScanScreen({super.key});
  @override
  ConsumerState<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends ConsumerState<QrScanScreen> {
  final token = TextEditingController();
  bool resolving = false;
  String? error;

  Future<void> resolve(String value) async {
    if (resolving || value.isEmpty) return;
    setState(() { resolving = true; error = null; });
    try {
      final res = await ref.read(apiProvider).post('/qr/resolve', data: {'token': value});
      if (mounted) context.go('/accept/${res.data['id']}');
    } catch (_) {
      setState(() => error = 'QR не найден или уже недоступен');
    } finally {
      if (mounted) setState(() => resolving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('QR приёмки')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          SizedBox(
            height: 320,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: MobileScanner(onDetect: (capture) {
                final value = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
                if (value != null) resolve(value);
              }),
            ),
          ),
          const SizedBox(height: 16),
          TextField(controller: token, decoration: const InputDecoration(labelText: 'QR token вручную')),
          const SizedBox(height: 12),
          FilledButton(onPressed: resolving ? null : () => resolve(token.text), child: Text(resolving ? 'Проверка...' : 'Проверить')),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: Colors.redAccent))),
        ]),
      );
}

class AcceptanceScreen extends ConsumerStatefulWidget {
  const AcceptanceScreen({super.key, required this.waybillId});
  final String waybillId;
  @override
  ConsumerState<AcceptanceScreen> createState() => _AcceptanceScreenState();
}

class _AcceptanceScreenState extends ConsumerState<AcceptanceScreen> {
  final actualWeight = TextEditingController();
  final reason = TextEditingController();
  String? warehouseId;
  bool submitting = false;
  String? message;

  Future<void> submit(String? status) async {
    if (status != 'ARRIVED') {
      setState(() => message = 'Сначала переведите накладную в ARRIVED');
      return;
    }
    if (submitting || warehouseId == null || actualWeight.text.isEmpty) return;
    setState(() { submitting = true; message = null; });
    final payload = {
      'waybillId': widget.waybillId,
      'warehouseId': warehouseId,
      'actualWeight': actualWeight.text,
      'reason': reason.text.isEmpty ? null : reason.text,
      'idempotencyKey': DateTime.now().microsecondsSinceEpoch.toString(),
    };
    try {
      final online = await Connectivity().checkConnectivity();
      if (online.contains(ConnectivityResult.none)) {
        await enqueueAcceptance(ref, payload);
        setState(() => message = 'Нет сети. Приёмка сохранена в очередь');
        return;
      }
      await postAcceptance(ref, payload);
      setState(() => message = 'Приёмка выполнена');
    } catch (_) {
      await enqueueAcceptance(ref, payload);
      setState(() => message = 'Ошибка сети. Приёмка сохранена в очередь');
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<Response<dynamic>>>(
        future: Future.wait([
          ref.read(apiProvider).get('/warehouses'),
          ref.read(apiProvider).get('/waybills/${widget.waybillId}'),
        ]),
        builder: (context, snap) {
          final warehouseData = snap.data?[0].data;
          final waybill = snap.data?[1].data as Map<String, dynamic>?;
          final status = waybill?['status'] as String?;
          final rows = warehouseData is Map && warehouseData['data'] is List ? warehouseData['data'] as List : <dynamic>[];
          return Scaffold(
            appBar: AppBar(title: const Text('Приёмка')),
            body: ListView(padding: const EdgeInsets.all(16), children: [
              Text('Накладная: ${widget.waybillId}', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text('Статус: ${status ?? '...'}'),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: warehouseId,
                decoration: const InputDecoration(labelText: 'Склад'),
                items: rows.map((row) => DropdownMenuItem<String>(value: row['id'], child: Text('${row['name']}'))).toList(),
                onChanged: (value) => setState(() => warehouseId = value),
              ),
              const SizedBox(height: 12),
              TextField(controller: actualWeight, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Фактический вес')),
              const SizedBox(height: 12),
              TextField(controller: reason, decoration: const InputDecoration(labelText: 'Причина расхождения')),
              const SizedBox(height: 18),
              FilledButton(onPressed: submitting || status != 'ARRIVED' ? null : () => submit(status), child: Text(submitting ? 'Отправка...' : 'Принять')),
              if (message != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(message!)),
            ]),
          );
        },
      );
}

Future<void> postAcceptance(WidgetRef ref, Map<String, dynamic> payload) async {
  await ref.read(apiProvider).post('/waybills/${payload['waybillId']}/accept', data: {
    'warehouseId': payload['warehouseId'],
    'actualWeight': payload['actualWeight'],
    'reason': payload['reason'],
    'idempotencyKey': payload['idempotencyKey'],
  });
}

Future<void> enqueueAcceptance(WidgetRef ref, Map<String, dynamic> payload) async {
  final storage = ref.read(secureStorageProvider);
  final raw = await storage.read(key: 'offlineAcceptances');
  final queue = raw == null ? <dynamic>[] : jsonDecode(raw) as List<dynamic>;
  queue.add(payload);
  await storage.write(key: 'offlineAcceptances', value: jsonEncode(queue));
}

Future<void> syncOfflineQueue(BuildContext context, WidgetRef ref) async {
  final storage = ref.read(secureStorageProvider);
  final raw = await storage.read(key: 'offlineAcceptances');
  final queue = raw == null ? <dynamic>[] : jsonDecode(raw) as List<dynamic>;
  var sent = 0;
  final failed = <dynamic>[];
  for (final item in queue) {
    try {
      await postAcceptance(ref, Map<String, dynamic>.from(item as Map));
      sent++;
    } catch (_) {
      failed.add(item);
    }
  }
  await storage.write(key: 'offlineAcceptances', value: jsonEncode(failed));
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Отправлено: $sent, осталось: ${failed.length}')));
  }
}
