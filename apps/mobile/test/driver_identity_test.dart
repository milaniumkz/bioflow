import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bioflow_mobile/main_driver.dart';

void main() {
  testWidgets('driver identity requires both fields and normalizes local phone',
      (tester) async {
    Map<String, String>? result;
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                    body: TextButton(
                  onPressed: () async {
                    result = await showDialog<Map<String, String>>(
                        context: context,
                        builder: (_) => const DriverIdentityDialog());
                  },
                  child: const Text('Scan result'),
                )))));
    await tester.tap(find.text('Scan result'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Начать рейс'));
    await tester.pumpAndSettle();
    expect(find.text('Укажите госномер машины'), findsOneWidget);
    expect(find.text('Укажите телефон с кодом страны'), findsOneWidget);
    expect(result, isNull);
    await tester.enterText(find.byType(TextFormField).at(0), '123 abc 01');
    await tester.enterText(
        find.byType(TextFormField).at(1), '8 (700) 123-45-67');
    await tester.tap(find.text('Начать рейс'));
    await tester.pumpAndSettle();
    expect(result, {'plateNumber': '123 ABC 01', 'phone': '+77001234567'});
  });
}
