import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bioflow_mobile/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> wait(WidgetTester tester, Finder finder) async {
    for (var n = 0; n < 150; n++) {
      await tester.pump(const Duration(milliseconds: 200));
      if (finder.evaluate().isNotEmpty) return;
    }
    expect(finder, findsWidgets);
  }

  Future<void> ready(WidgetTester tester) async {
    for (var n = 0; n < 150; n++) {
      await tester.pump(const Duration(milliseconds: 200));
      if (find.byType(LinearProgressIndicator).evaluate().isEmpty) {
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.takeException(), isNull);
        return;
      }
    }
    fail('Screen did not finish loading');
  }

  Future<void> login(WidgetTester tester, String role) async {
    await wait(tester, find.text('Войти'));
    await tester.enterText(find.byType(TextField).at(0),
        'android-${role.toLowerCase()}@uat.local');
    await tester.enterText(
        find.byType(TextField).at(1), 'IntegrationOnly2026!');
    await tester.tap(find.text('Войти'));
    await wait(tester, find.byType(NavigationBar));
    await ready(tester);
  }

  Future<void> logout(WidgetTester tester) async {
    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Выйти'));
    await wait(tester, find.text('Войти'));
  }

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await binding.takeScreenshot(name);
  }

  testWidgets(
      'Android: login errors, draft protection and all roles through UI',
      (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();
    await tester.pump();
    await tester.tap(find.text('Войти'));
    await wait(tester, find.textContaining('email'));
    await shot(tester, 'login-empty-error');
    await login(tester, 'OWNER');
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).last, const Offset(0, -1400));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(find.text('Выберите значение'), findsWidgets);
    await shot(tester, 'batch-required-fields');
    final measurement = find.widgetWithText(TextFormField, 'Способ измерения');
    await tester.ensureVisible(measurement);
    await tester.enterText(measurement, 'Android unsaved draft');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Оставить несохранённые изменения?'), findsOneWidget);
    await shot(tester, 'draft-back-warning');
    await tester.tap(find.text('Продолжить ввод'));
    await tester.pumpAndSettle();
    expect(find.text('Android unsaved draft'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Выйти без сохранения'));
    await wait(tester, find.byType(NavigationBar));

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    for (final label in ['Подрядчик', 'Место добычи', 'Материал']) {
      final field = find.byWidgetPredicate((widget) =>
          widget is DropdownButtonFormField<String> &&
          widget.decoration.labelText == label);
      await wait(tester, field);
      final dropdown = find.descendant(
          of: field, matching: find.byType(DropdownButton<String>));
      for (var n = 0; n < 100; n++) {
        if (tester.widget<DropdownButton<String>>(dropdown).items?.isNotEmpty ==
            true) {
          break;
        }
        await tester.pump(const Duration(milliseconds: 200));
      }
      await tester.ensureVisible(field);
      final option = tester
          .widget<DropdownButton<String>>(dropdown)
          .items!
          .first
          .child as Text;
      await tester.tap(field);
      await tester.pumpAndSettle();
      await tester.tap(find.text(option.data!).last);
      await tester.pumpAndSettle();
    }
    final quantity = find.widgetWithText(TextFormField, 'Количество, т');
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '-1');
    final method = find.widgetWithText(TextFormField, 'Способ измерения');
    await tester.ensureVisible(method);
    await tester.enterText(method, 'Android emulator UI');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.ensureVisible(find.text('Сохранить'));
    await tester.tap(find.text('Сохранить'));
    await wait(tester, find.text('Недопустимая масса'));
    await shot(tester, 'batch-negative-mass');
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '1.001');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.ensureVisible(find.text('Сохранить'));
    await tester.tap(find.text('Сохранить'));
    await wait(tester, find.text('Сохранено'));
    final savedNumber = tester
        .widgetList<SelectableText>(find.byType(SelectableText))
        .first
        .data!;
    await shot(tester, 'batch-created');
    await tester.tap(find.text('Закрыть'));
    await wait(tester, find.byType(NavigationBar));
    await wait(tester, find.text(savedNumber));
    await shot(tester, 'batch-in-list');

    const roles = [
      'OWNER',
      'ADMIN',
      'CONTRACTOR_REP',
      'RECEIVER',
      'WASH_OPERATOR',
      'PRODUCTION_OPERATOR',
      'DISPATCHER',
      'EXTRACTION_OPERATOR',
      'LOADING_OPERATOR',
      'WAREHOUSE_OPERATOR',
      'AUDITOR'
    ];
    for (final role in roles) {
      if (role != 'OWNER') await login(tester, role);
      for (final tab in ['Добыча', 'Рейсы', 'Склады', 'Операции', 'События']) {
        await tester.tap(find.widgetWithText(NavigationDestination, tab));
        await ready(tester);
        expect(find.textContaining('Ошибка 403'), findsNothing);
        expect(find.textContaining('Ошибка 500'), findsNothing);
        await shot(tester, '$role-$tab');
      }
      await logout(tester);
      // Keep the real backend's rate limit enabled during the role sweep.
      await tester
          .runAsync(() => Future<void>.delayed(const Duration(seconds: 6)));
    }
  });
}
