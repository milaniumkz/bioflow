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
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream,
      Future<void>? cancel) async {
    paths.add(options.path);
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
      expect(find.text('QR'), findsOneWidget);
      expect(find.text('Профиль'), findsOneWidget);
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
    await tester.tap(find.text('Выезжаю · включить геолокацию'));
    await tester.pumpAndSettle();
    expect(adapter.paths.any((p) => p.endsWith('/status')), false);
    expect(find.textContaining('перед началом рейса'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  testWidgets(
      'one assigned active trip starts after permission and explicit stop is respected',
      (tester) async {
    var running = false, starts = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') return {'running': running};
      if (call.method == 'permission') return true;
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
  });
}
