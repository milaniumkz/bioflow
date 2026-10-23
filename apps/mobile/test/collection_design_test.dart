import 'dart:io';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'dart:ui' as ui;
import 'package:bioflow_mobile/collection_design.dart';
import 'package:bioflow_mobile/main.dart';
import 'package:bioflow_mobile/role_home.dart';
import 'package:bioflow_mobile/client.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'role_home_test.dart' show HomeAdapter;

Future<void> capture(WidgetTester tester, GlobalKey key, String name) async {
  final directory = Platform.environment['COLLECTION_DESIGN_REPORT_DIR'];
  if (directory == null) return;
  await tester.runAsync(() async {
    final boundary =
        key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$directory/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

ThemeData testTheme() {
  final base = CollectionDesign.theme();
  if (Platform.environment['COLLECTION_TEST_FONT'] == null) return base;
  return base.copyWith(
      textTheme: base.textTheme.apply(fontFamily: 'CollectionTestFont'),
      primaryTextTheme:
          base.primaryTextTheme.apply(fontFamily: 'CollectionTestFont'),
      appBarTheme: base.appBarTheme.copyWith(
          titleTextStyle: const TextStyle(
              fontFamily: 'CollectionTestFont',
              color: CollectionDesign.ink,
              fontSize: 18)));
}

void main() {
  setUpAll(() async {
    // Optional screenshots use a supplied licensed test font rather than Ahem.
    // This is a widget-renderer aid, not approved production typography.
    final font = Platform.environment['COLLECTION_TEST_FONT'];
    if (font != null) {
      final loader = FontLoader('CollectionTestFont')
        ..addFont(File(font)
            .readAsBytes()
            .then((bytes) => ByteData.sublistView(bytes)));
      await loader.load();
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
    }
  });
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('collection/driver-location'),
            (call) async =>
                call.method == 'status' ? {'running': false} : false);
  });
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
          const MethodChannel('collection/driver-location'), null));
  for (final size in [
    const Size(320, 640),
    const Size(390, 844),
    const Size(768, 1000)
  ]) {
    testWidgets('login stays scrollable at $size with 200% text',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: testTheme(),
              builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context)
                      .copyWith(textScaler: TextScaler.linear(2)),
                  child: child!),
              home: const LoginScreen())));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Войти'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byType(TextField), findsNWidgets(2));
      if (size.width == 390) {
        await capture(tester, key, 'native-login-200-widget');
      }
    });
  }
  testWidgets('role home at 320 with 200% text keeps navigation usable',
      (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = BioflowClient()
      ..profile = {
        'id': 'synthetic-large-text',
        'fullName': 'Тестовый сотрудник',
        'roles': ['COLLECTOR'],
        'permissions': ['collection.manage', 'processing.read']
      };
    client.dio.httpClientAdapter = HomeAdapter();
    await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: testTheme(),
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(2)),
            child: child!),
        home: RoleHome(client: client, onLogout: () {})));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    expect(find.text('Все разделы моей роли'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('recovery validates passwords and does not fake SMS delivery',
      (tester) async {
    final calls = <String>[];
    final interceptor = InterceptorsWrapper(onRequest: (options, handler) {
      calls.add(options.path);
      handler.resolve(Response(
          requestOptions: options, statusCode: 200, data: <String, dynamic>{}));
    });
    api.dio.interceptors.add(interceptor);
    addTearDown(() => api.dio.interceptors.remove(interceptor));
    await tester.pumpWidget(
        MaterialApp(theme: testTheme(), home: const RecoveryScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(find.text('Укажите номер телефона'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '+79990000000');
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();
    expect(calls, ['/auth/forgot-password']);
    expect(find.textContaining('не подтверждает доставку SMS'), findsOneWidget);
    await tester.enterText(find.byType(TextField).at(1), 'test-code');
    await tester.enterText(find.byType(TextField).at(2), 'test-pass-one');
    await tester.enterText(find.byType(TextField).at(3), 'test-pass-two');
    await tester.ensureVisible(find.text('Изменить пароль'));
    await tester.tap(find.text('Изменить пароль'));
    await tester.pumpAndSettle();
    expect(calls, ['/auth/forgot-password']);
    expect(find.textContaining('два совпадающих'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('queue cancel preserves the local command and explains conflict',
      (tester) async {
    api.profile = {'id': 'queue-design-test'};
    FlutterSecureStorage.setMockInitialValues({
      'queue:queue-design-test': jsonEncode([
        {
          'path': '/ledger/operations',
          'data': {'idempotencyKey': 'synthetic-command'},
          'createdAt': '2026-10-22',
          'status': 'conflict',
          'error': 'Тестовый конфликт остатка'
        }
      ])
    });
    await tester
        .pumpWidget(MaterialApp(theme: testTheme(), home: const QueueScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Нужна проверка · конфликт с сервером'), findsOneWidget);
    await tester.ensureVisible(find.text('Удалить локальную команду'));
    await tester.tap(find.text('Удалить локальную команду'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Оставить'));
    await tester.pumpAndSettle();
    expect((await api.pending()).length, 1);
    expect(find.text('Складская операция'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    api.profile = null;
  });
  testWidgets('single role shell and scoped profile reset their scroll',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = BioflowClient()
      ..profile = {
        'id': 'synthetic-design-user',
        'fullName': 'Тестовый сборщик',
        'roles': ['COLLECTOR'],
        'permissions': ['collection.manage', 'processing.read'],
        'phone': 'Тестовый номер'
      };
    client.dio.httpClientAdapter = HomeAdapter();
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(
        key: key,
        child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: testTheme(),
            home: RoleHome(client: client, onLogout: () {}))));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationDestination), findsNWidgets(3));
    expect(find.text('Сканировать'), findsOneWidget);
    await capture(tester, key, 'native-collector-widget');
    await tester.drag(find.byType(ListView), const Offset(0, -350));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    expect(find.text('Тестовый номер').hitTestable(), findsOneWidget);
    expect(find.text('Сотрудники и роли'), findsNothing);
    expect(tester.takeException(), isNull);
    await capture(tester, key, 'native-profile-widget');
    await tester.pumpWidget(const SizedBox());
  });
}
