import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bioflow_mobile/client.dart';
import 'package:bioflow_mobile/role_home.dart';

class HomeAdapter implements HttpClientAdapter {
  HomeAdapter({this.trips = const []});
  final List<dynamic> trips;
  final paths = <String>[];
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancel) async {
    paths.add(options.path);
    requests.add(options);
    return ResponseBody.fromString(
        jsonEncode({
          'data': options.path.startsWith('/tracking/trips') ? trips : [],
          'total': 0
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json']
        });
  }

  @override
  void close({bool force = false}) {}
}

class AutoDriverClient extends BioflowClient {
  @override
  Future<dynamic> workspaceSession({bool driver = false}) async =>
      {'accessToken': 'synthetic-access', 'refreshToken': 'synthetic-refresh'};
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('collection/driver-location');
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, null));
  for (final entry in <String, List<String>>{
    'COLLECTOR': ['collection.manage', 'processing.read'],
    'PACKER': ['processing.pack', 'processing.read'],
    'OWNER': [
      'processing.overview',
      'processing.read',
      'tracking.read',
      'users.manage'
    ]
  }.entries) {
    testWidgets('${entry.key} has a simple home/QR/profile navigation',
        (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
              channel,
              (call) async =>
                  call.method == 'status' ? {'running': false} : true);
      final client = BioflowClient()
        ..profile = {
          'id': 'widget-user',
          'fullName': 'Тестовый сотрудник',
          'phone': '+79990000111',
          'roles': [entry.key],
          'permissions': entry.value
        };
      client.dio.httpClientAdapter = HomeAdapter();
      await tester.pumpWidget(
          MaterialApp(home: RoleHome(client: client, onLogout: () {})));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationDestination), findsNWidgets(3));
      expect(find.text('Главная'), findsOneWidget);
      expect(find.text('Сканировать'), findsOneWidget);
      expect(find.text('Профиль'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Открыть партию'), 160,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('Открыть партию'), findsOneWidget);
      if (entry.key == 'PACKER') {
        expect(find.text('Новая отправка'), findsNothing);
        expect(find.text('Всё предприятие'), findsNothing);
      }
      if (entry.key == 'OWNER') {
        expect(find.text('Всё предприятие'), findsOneWidget);
        expect(find.text('Сотрудники и роли'), findsOneWidget);
      }
      await tester.tap(find.text('Профиль'));
      await tester.pumpAndSettle();
      expect(find.text('+79990000111'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    });
  }
  testWidgets(
      'new driver trip offers loading before departure and requests location',
      (tester) async {
    var starts = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') return {'running': false};
      if (call.method == 'start') {
        starts++;
        return null;
      }
      return true;
    });
    final adapter = HomeAdapter(trips: [
      {
        'id': 'new-trip',
        'number': 'WB-NEW',
        'status': 'CREATED',
        'bagCount': 10,
        'declaredWeight': '1',
        'vehicle': {'plateNumber': 'TEST'},
        'destinationWarehouse': {'name': 'Мойка'}
      }
    ]);
    final client = BioflowClient()
      ..profile = {
        'id': 'new-driver',
        'fullName': 'Водитель',
        'roles': ['DRIVER'],
        'permissions': ['tracking.write']
      };
    client.dio.httpClientAdapter = adapter;
    await tester.pumpWidget(
        MaterialApp(home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    expect(find.text('Прибыл'), findsNothing);
    expect(find.text('Выехал · включить геолокацию'), findsNothing);
    await tester.scrollUntilVisible(find.text('Загрузился'), 180,
        scrollable: find.byType(Scrollable).first);
    await tester.drag(find.byType(ListView).first, const Offset(0, -220));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Загрузился'));
    await tester.pumpAndSettle();
    expect(find.text('Разрешить геолокацию'), findsOneWidget);
    await tester.tap(find.text('Разрешить геолокацию'));
    await tester.pumpAndSettle();
    expect(
        adapter.requests
            .where((r) => r.path.endsWith('/status'))
            .single
            .data['status'],
        'LOADED');
    expect(starts, 0);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  testWidgets('denied precise location does not start a trip or tracking',
      (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            channel,
            (call) async =>
                call.method == 'status' ? {'running': false} : false);
    final adapter = HomeAdapter(trips: [
      {
        'id': 'trip-one',
        'number': 'WB-001',
        'status': 'LOADED',
        'vehicle': {'plateNumber': 'TEST'},
        'destinationWarehouse': {'name': 'Мойка'},
        'bagCount': 10,
        'declaredWeight': '1'
      }
    ]);
    final client = BioflowClient()
      ..profile = {
        'id': 'widget-driver',
        'fullName': 'Тест водитель',
        'roles': ['DRIVER'],
        'permissions': ['tracking.write']
      };
    client.dio.httpClientAdapter = adapter;
    await tester.pumpWidget(
        MaterialApp(home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
        find.text('Выехал · включить геолокацию'), 180,
        scrollable: find.byType(Scrollable).first);
    await tester.drag(find.byType(ListView).first, const Offset(0, -180));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Выехал · включить геолокацию'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Разрешить геолокацию'));
    await tester.pumpAndSettle();
    expect(adapter.paths.any((p) => p.endsWith('/status')), false);
    await tester.drag(find.byType(ListView).first, const Offset(0, 1200));
    await tester.pumpAndSettle();
    expect(find.textContaining('перед началом рейса'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  testWidgets(
      'one assigned active trip starts after permission and explicit stop is respected',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'gps-consent:driver-auto': 'yes'});
    var running = false, starts = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') return {'running': running};
      if (['permission', 'hasPermission'].contains(call.method)) return true;
      if (call.method == 'start') {
        running = true;
        starts++;
        return null;
      }
      if (call.method == 'stop') {
        running = false;
        return null;
      }
      return null;
    });
    final client = AutoDriverClient()
      ..profile = {
        'id': 'driver-auto',
        'fullName': 'Водитель',
        'roles': ['DRIVER'],
        'permissions': ['tracking.write']
      };
    client.dio.httpClientAdapter = HomeAdapter(trips: [
      {
        'id': 'trip-auto',
        'number': 'WB-AUTO',
        'status': 'IN_TRANSIT',
        'vehicle': {'plateNumber': 'TEST'},
        'destinationWarehouse': {'name': 'Мойка'},
        'bagCount': 10,
        'declaredWeight': '1'
      }
    ]);
    await tester.pumpWidget(
        MaterialApp(home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    expect(starts, 1);
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Остановить передачу геолокации'));
    await tester.pumpAndSettle();
    expect(running, false);
    await tester.pump(const Duration(seconds: 21));
    await tester.pumpAndSettle();
    expect(starts, 1);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await tester.pumpWidget(
        MaterialApp(home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    expect(starts, 1, reason: 'manual stop survives rebuilding the app home');
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  testWidgets('native notification stop blocks automatic restart',
      (tester) async {
    FlutterSecureStorage.setMockInitialValues(
        {'gps-consent:driver-native-stop': 'yes'});
    var starts = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') {
        return {'running': false, 'manualPaused': true};
      }
      if (call.method == 'start') {
        starts++;
        return null;
      }
      return true;
    });
    final client = AutoDriverClient()
      ..profile = {
        'id': 'driver-native-stop',
        'fullName': 'Водитель',
        'roles': ['DRIVER'],
        'permissions': ['tracking.write']
      };
    client.dio.httpClientAdapter = HomeAdapter(trips: [
      {
        'id': 'trip-native-stop',
        'number': 'WB-STOP',
        'status': 'IN_TRANSIT',
        'vehicle': {'plateNumber': 'TEST'},
        'destinationWarehouse': {'name': 'Мойка'},
        'bagCount': 1,
        'declaredWeight': '1'
      }
    ]);
    await tester.pumpWidget(
        MaterialApp(home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 21));
    await tester.pumpAndSettle();
    expect(starts, 0);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  for (final role in ['ADMIN', 'AUDITOR', 'CONTRACTOR_REP', 'NO_ROLE']) {
    testWidgets(
        '$role uses the common home without manufacturing elevated actions',
        (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
              channel,
              (call) async =>
                  call.method == 'status' ? {'running': false} : false);
      final permissions = role == 'ADMIN'
          ? ['users.manage', 'references.read', 'inventory.read']
          : role == 'NO_ROLE'
              ? <String>[]
              : ['inventory.read', 'references.read', 'reports.read'];
      final client = BioflowClient()
        ..profile = {
          'id': 'synthetic-$role',
          'fullName': 'Тест $role',
          'roles': role == 'NO_ROLE' ? [] : [role],
          'permissions': permissions
        };
      client.dio.httpClientAdapter = HomeAdapter();
      await tester.pumpWidget(
          MaterialApp(home: RoleHome(client: client, onLogout: () {})));
      await tester.pumpAndSettle();
      expect(find.byType(NavigationDestination), findsNWidgets(3));
      expect(find.text('Новая отправка'), findsNothing);
      expect(find.text('Всё предприятие'), findsNothing);
      if (role == 'NO_ROLE') {
        await tester.tap(find.text('Сканировать'));
        await tester.pumpAndSettle();
        expect(
            find.textContaining('Нет доступа к работе с QR'), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    });
  }
}
