import 'dart:convert';
import 'dart:io';
import 'package:bioflow_mobile/client.dart';
import 'package:bioflow_mobile/collection_design.dart';
import 'package:bioflow_mobile/role_home.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'role_home_test.dart' show HomeAdapter;
import 'collection_design_test.dart' show capture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final profiles =
      jsonDecode(File('test/fixtures/role_profiles.json').readAsStringSync())
          as List;
  setUpAll(() async {
    final loader = FontLoader('Open Sans')
      ..addFont(rootBundle.load('assets/fonts/OpenSans-Regular.ttf'));
    await loader.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('collection/driver-location'),
      (call) async => call.method == 'status' ? {'running': false} : false,
    );
  });
  tearDown(() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
          const MethodChannel('collection/driver-location'), null));
  for (final profile in profiles) {
    final role = (profile['roles'] as List).single;
    for (final large in [false, true]) {
      testWidgets(
          '$role home and profile, ${large ? '320px large text' : '390px'}',
          (tester) async {
        tester.view.physicalSize = Size(large ? 320 : 390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final client = BioflowClient()
          ..profile = Map<String, dynamic>.from(profile);
        client.dio.httpClientAdapter = HomeAdapter();
        final key = GlobalKey();
        await tester.pumpWidget(MaterialApp(
            theme: CollectionDesign.theme(),
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(large ? 2 : 1)),
                child: child!),
            home: RepaintBoundary(
                key: key, child: RoleHome(client: client, onLogout: () {}))));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await capture(
            tester, key, 'native-$role-${large ? '320-large' : '390'}-home');
        await tester.tap(find.text('Профиль').last);
        await tester.pumpAndSettle();
        expect(find.text('+70000000999'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await capture(
            tester, key, 'native-$role-${large ? '320-large' : '390'}-profile');
        await tester.tap(find.text('Главная').last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pumpAndSettle();
      });
    }
  }
}
