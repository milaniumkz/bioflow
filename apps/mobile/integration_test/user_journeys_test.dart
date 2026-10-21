import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:bioflow_mobile/full_workspace.dart';
import 'package:bioflow_mobile/role_access.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bioflow_mobile/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  String? createdMobilePhone;
  Future<void> wait(WidgetTester tester, Finder finder) async {
    for (var n = 0; n < 225; n++) {
      await tester.pump(const Duration(milliseconds: 200));
      if (finder.evaluate().isNotEmpty) return;
    }
    expect(finder, findsWidgets);
  }

  Future<void> ready(WidgetTester tester) async {
    for (var n = 0; n < 225; n++) {
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
    // Android PixelCopy can still see the preceding frame after Flutter has
    // completed its widget pumps. Wait for the platform to present this state.
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();
    await binding.takeScreenshot(name);
  }

  Future<void> queueScreen(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.sync));
    await wait(tester, find.text('Команды текущего пользователя'));
    await tester.pumpAndSettle();
  }

  Future<void> saveForm(WidgetTester tester) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await tester.pumpAndSettle();
    // ListView builds fields lazily, and native keyboard hiding updates its
    // viewport asynchronously. Scroll the actual form before finding Save.
    await tester.drag(find.byType(ListView).last, const Offset(0, -1000));
    await tester.pumpAndSettle();
    await wait(tester, find.text('Сохранить'));
    await tester.ensureVisible(find.text('Сохранить'));
    await tester.tap(find.text('Сохранить'));
  }

  Future<void> selectReferences(WidgetTester tester) async {
    for (final label in ['Подрядчик', 'Место добычи', 'Материал']) {
      final field = find.byWidgetPredicate((widget) =>
          widget is DropdownButtonFormField<String> &&
          widget.decoration.labelText == label);
      await wait(tester, field);
      final dropdown = find.descendant(
          of: field, matching: find.byType(DropdownButton<String>));
      for (var n = 0; n < 225; n++) {
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
  }

  Future<void> webWait(
      WidgetTester tester, FullWorkspaceState state, String condition) async {
    for (var n = 0; n < 200; n++) {
      Object? value;
      await tester.runAsync(() async {
        value = await state.controller
            .runJavaScriptReturningResult('Boolean($condition)');
        await Future<void>.delayed(const Duration(milliseconds: 200));
      });
      await tester.pump();
      if (value == true || value == 'true') return;
    }
    fail('Mobile WebView condition not satisfied: $condition');
  }

  Future<void> webAction(
      WidgetTester tester, FullWorkspaceState state, String script) async {
    await tester.runAsync(() async {
      await state.controller.runJavaScript(script);
    });
    await tester.pump(const Duration(milliseconds: 300));
  }

  Future<void> nativeShot(WidgetTester tester, String name) async {
    int? status;
    await tester.runAsync(() async {
      final c = HttpClient();
      try {
        final r = await c.postUrl(Uri.parse('http://10.0.2.2:4200/screenshot'));
        r.headers.set('X-Bioflow-Test', 'isolated-android-ui');
        r.headers.contentType = ContentType.json;
        final body = utf8.encode(jsonEncode({'name': name}));
        r.contentLength = body.length;
        r.add(body);
        final response = await r.close();
        status = response.statusCode;
        await response.drain<void>();
      } finally {
        c.close(force: true);
      }
    });
    expect(status, 200);
  }

  Future<void> nativeDocument(WidgetTester tester, String path,
      Future<void> Function() openDialog) async {
    Future<Map<String, dynamic>> control(String endpoint,
        {bool post = false}) async {
      final c = HttpClient()..connectionTimeout = const Duration(seconds: 3);
      try {
        final uri = Uri.parse('http://10.0.2.2:4200/$endpoint');
        final r = post ? await c.postUrl(uri) : await c.getUrl(uri);
        r.headers.set('X-Bioflow-Test', 'isolated-android-ui');
        final response = await r.close().timeout(const Duration(seconds: 5));
        final text = await utf8.decoder.bind(response).join();
        if (response.statusCode != (post ? 202 : 200)) {
          throw StateError(
              'Native document controller: ${response.statusCode}');
        }
        return Map<String, dynamic>.from(jsonDecode(text));
      } finally {
        c.close(force: true);
      }
    }

    Map<String, dynamic>? armed;
    await tester.runAsync(() async {
      armed = await control(path, post: true);
    });
    expect(armed?['state'], 'PENDING');
    await openDialog();
    Map<String, dynamic>? result;
    final deadline = DateTime.now().add(const Duration(seconds: 90));
    while (DateTime.now().isBefore(deadline)) {
      await tester.runAsync(() async {
        try {
          result = await control('document-status');
        } on IOException {
          // Retry only controller I/O while Android has backgrounded this app.
        } on TimeoutException {
          // The host worker continues independently and records PASS/FAIL.
        }
        await Future<void>.delayed(const Duration(milliseconds: 300));
      });
      await tester.pump();
      if (result?['state'] == 'PASS' || result?['state'] == 'FAIL') break;
    }
    expect(result?['id'], armed?['id']);
    expect(result?['state'], 'PASS');
    expect(result?['bytes'], greaterThan(0));
    await tester.pump(const Duration(milliseconds: 300));
  }

  Future<void> fullCabinet(WidgetTester tester, String role) async {
    expect(find.textContaining(roleNames[role]!), findsWidgets);
    await tester.tap(find.byTooltip('Разделы моей роли'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Партии и операции'));
    await wait(tester, find.byType(FullWorkspace));
    final state = tester.state<FullWorkspaceState>(find.byType(FullWorkspace));
    await webWait(tester, state,
        'document.querySelector("main h1")?.textContent === "Партии и операции"');
    expect(state.authenticated, true);
    await nativeShot(tester, 'full-cabinet-$role');
    if (role == 'OWNER') {
      await webAction(tester, state,
          'window.dispatchEvent(new CustomEvent("bioflow:mobile-section", {detail:"users"}));');
      await webWait(tester, state,
          'document.body.innerText.includes("Новый пользователь")');
      final email =
          'mobile-full-${DateTime.now().millisecondsSinceEpoch}@uat.local';
      createdMobilePhone =
          "+7${DateTime.now().millisecondsSinceEpoch.toString().substring(3)}";
      final fields = {
        'ФИО': 'Мобильный пользователь',
        'Email': email,
        'Телефон': createdMobilePhone!
      };
      for (final field in fields.entries) {
        await webAction(tester, state,
            '(function(){const el=document.querySelector("input[placeholder="+CSS.escape(${jsonEncode(field.key)})+"]");el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${jsonEncode(field.value)});el.dispatchEvent(new Event("input",{bubbles:true}));})()');
      }
      await webAction(tester, state,
          'document.querySelector("main form button[type=submit], main form button").focus();document.querySelector("main form button[type=submit], main form button").click();');
      await webWait(tester, state,
          'document.querySelector("table")?.innerText.includes(${jsonEncode(email)})');
      for (final name in ['Администратор', 'Наблюдатель/аудитор']) {
        await webAction(tester, state,
            '(function(){const el=[...document.querySelectorAll(".role-choice")].find(x=>x.querySelector("strong")?.textContent===${jsonEncode(name)}).querySelector("input");el.focus();el.click();})()');
      }
      await webAction(tester, state,
          'document.querySelectorAll("main form")[1].querySelector("button").focus();document.querySelectorAll("main form")[1].querySelector("button").click();');
      await webWait(
          tester, state, 'document.body.innerText.includes("Роли назначены")');
      await nativeShot(tester, 'full-cabinet-users-and-russian-roles');
      await webAction(tester, state,
          'window.dispatchEvent(new CustomEvent("bioflow:mobile-section", {detail:"reports"}));');
      await webWait(
          tester, state, 'document.body.innerText.includes("Скачать CSV")');
      await nativeShot(tester, 'full-cabinet-reports');
      await nativeDocument(
          tester,
          'save-document',
          () => webAction(tester, state,
              '[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Скачать CSV").click();'));
      await nativeShot(tester, 'full-cabinet-report-saved');
      await webAction(tester, state,
          'window.dispatchEvent(new CustomEvent("bioflow:mobile-section", {detail:"ledger"}));');
      await webWait(tester, state,
          'document.querySelector("details summary")?.textContent === "Новая партия добычи"');
      await webAction(
          tester, state, 'document.querySelector("details summary").click();');
      await webAction(tester, state,
          '[...document.querySelectorAll("details form select")].forEach(el=>{el.focus();Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,el.options[1].value);el.dispatchEvent(new Event("change",{bubbles:true}));});');
      for (final field in {
        'quantity': '0.123',
        'measurementMethod': 'Android full cabinet QR',
        'measuredAt': '2026-10-21T16:30'
      }.entries) {
        await webAction(tester, state,
            '(function(){const el=document.querySelector("details form input[name="+CSS.escape(${jsonEncode(field.key)})+"]");el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,${jsonEncode(field.value)});el.dispatchEvent(new Event("input",{bubbles:true}));})()');
      }
      await webAction(tester, state,
          'document.querySelector("details form button").focus();document.querySelector("details form button").click();');
      await webWait(
          tester, state, 'document.querySelector("dialog[open] img") != null');
      await nativeDocument(
          tester,
          'print-to-pdf',
          () => webAction(tester, state,
              '[...document.querySelectorAll("dialog button")].find(x=>x.textContent.trim()==="Печать QR").click();'));
      await webAction(tester, state,
          '[...document.querySelectorAll("dialog button")].find(x=>x.textContent.trim()==="Закрыть").click();');
    } else if (!app.api.can('users.manage')) {
      await webAction(tester, state,
          'window.dispatchEvent(new CustomEvent("bioflow:mobile-section", {detail:"users"}));');
      await webWait(tester, state,
          'document.querySelector("main h1")?.textContent === "Партии и операции"');
      expect(
          await state.controller.runJavaScriptReturningResult(
              'document.body.innerText.includes("Новый пользователь")'),
          false);
    }
    await tester.tap(find.byTooltip('Назад'));
    await wait(tester, find.byType(NavigationBar));
  }

  testWidgets('Android: forms, offline account queue and all roles through UI',
      (tester) async {
    app.main();
    await tester.pumpAndSettle();
    await binding.convertFlutterSurfaceToImage();
    await tester.pump();
    await tester.tap(find.text('Войти'));
    await wait(tester, find.text('Укажите номер телефона и пароль'));
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
    await tester.tap(find.byTooltip('Назад').first);
    await tester.pumpAndSettle();
    expect(find.text('Оставить несохранённые изменения?'), findsOneWidget);
    await shot(tester, 'draft-back-warning');
    await tester.tap(find.text('Продолжить ввод'));
    await tester.pumpAndSettle();
    expect(find.text('Android unsaved draft'), findsOneWidget);
    await tester.tap(find.byTooltip('Назад').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Выйти без сохранения'));
    await wait(tester, find.byType(NavigationBar));

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await selectReferences(tester);
    final quantity = find.widgetWithText(TextFormField, 'Количество, т');
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '-1');
    final method = find.widgetWithText(TextFormField, 'Способ измерения');
    await tester.ensureVisible(method);
    await tester.enterText(method, 'Android emulator UI');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await saveForm(tester);
    await wait(tester, find.text('Недопустимая масса'));
    await shot(tester, 'batch-negative-mass');
    await tester.ensureVisible(quantity);
    await tester.enterText(quantity, '1.001');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await saveForm(tester);
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

    final control = HttpClient();
    final controlRequest =
        await control.postUrl(Uri.parse('http://10.0.2.2:4200/offline'));
    controlRequest.headers.set('X-Bioflow-Test', 'isolated-android-ui');
    final controlResponse = await controlRequest.close();
    expect(controlResponse.statusCode, 200);
    await controlResponse.drain<void>();
    control.close(force: true);
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(seconds: 3)));
    final healthClient = HttpClient()
      ..connectionTimeout = const Duration(seconds: 3);
    var disconnected = false;
    try {
      final request = await healthClient
          .getUrl(Uri.parse('http://10.0.2.2:4100/api/v1/health'));
      final response =
          await request.close().timeout(const Duration(seconds: 3));
      await response.drain<void>();
    } catch (_) {
      disconnected = true;
    } finally {
      healthClient.close(force: true);
    }
    expect(disconnected, isTrue,
        reason: 'Offline test must use a genuinely disconnected emulator');
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await selectReferences(tester);
    await tester
        .ensureVisible(find.widgetWithText(TextFormField, 'Количество, т'));
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Количество, т'), '2.002');
    await tester
        .ensureVisible(find.widgetWithText(TextFormField, 'Способ измерения'));
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Способ измерения'),
        'Android offline queue');
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
    await saveForm(tester);
    await wait(tester, find.text('Сохранено офлайн'));
    await shot(tester, 'offline-command-queued');
    await tester.tap(find.text('Закрыть'));
    await wait(tester, find.byType(NavigationBar));
    await queueScreen(tester);
    await wait(tester, find.text('/ledger/batches'));
    await shot(tester, 'offline-owner-queue');
    await tester.tap(find.byTooltip('Назад').first);
    await tester.pumpAndSettle();
    for (var n = 0; n < 19; n++) {
      await tester
          .runAsync(() => Future<void>.delayed(const Duration(seconds: 5)));
    }
    await logout(tester);
    await login(tester, 'ADMIN');
    await queueScreen(tester);
    await wait(tester, find.text('Очередь пуста'));
    expect(find.text('/ledger/batches'), findsNothing);
    await shot(tester, 'offline-other-account-empty');
    await tester.tap(find.byTooltip('Назад').first);
    await tester.pumpAndSettle();
    await logout(tester);
    await login(tester, 'OWNER');
    await queueScreen(tester);
    await wait(tester, find.text('/ledger/batches'));
    await tester.tap(find.text('Синхронизировать'));
    await wait(tester, find.text('Очередь пуста'));
    await tester.tap(find.text('Синхронизировать'));
    await tester.pumpAndSettle();
    expect(find.text('Очередь пуста'), findsOneWidget);
    await shot(tester, 'offline-owner-synced');
    await tester.tap(find.byTooltip('Назад').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(NavigationDestination, 'Рейсы'));
    await ready(tester);
    await tester.tap(find.widgetWithText(NavigationDestination, 'Добыча'));
    await ready(tester);
    expect(find.textContaining('Доступно к распределению 2.002 т'),
        findsOneWidget);
    await shot(tester, 'offline-batch-persisted-once');

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
      await fullCabinet(tester, role);
      await logout(tester);
      // Keep the real backend's rate limit enabled during the role sweep.
      await tester
          .runAsync(() => Future<void>.delayed(const Duration(seconds: 6)));
    }

    expect(createdMobilePhone, isNotNull);
    await tester.enterText(find.byType(TextField).at(0), createdMobilePhone!);
    await tester.enterText(find.byType(TextField).at(1), '123456');
    await tester.tap(find.text('Войти'));
    await wait(tester, find.text('Смена временного пароля'));
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Текущий пароль'), '123456');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Новый пароль'), '123456');
    await saveForm(tester);
    expect(find.text('Пароль должен содержать не менее 8 символов'),
        findsOneWidget);
    await nativeShot(tester, 'first-password-short-rejected');
    await tester.enterText(find.widgetWithText(TextFormField, 'Новый пароль'),
        'UpdatedMobile2026!');
    await saveForm(tester);
    await wait(tester, find.text('Сохранено'));
    await tester.tap(find.text('Закрыть'));
    await wait(tester, find.text('Войти'));
    await tester.enterText(find.byType(TextField).at(0), createdMobilePhone!);
    await tester.enterText(find.byType(TextField).at(1), 'UpdatedMobile2026!');
    await tester.tap(find.text('Войти'));
    await wait(tester, find.byType(NavigationBar));
    await ready(tester);
    expect(find.textContaining('Администратор'), findsWidgets);
    expect(find.textContaining('Наблюдатель/аудитор'), findsWidgets);
    await nativeShot(
        tester, 'full-cabinet-multiple-roles-after-password-change');
    await tester.tap(find.byTooltip('Разделы моей роли'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).last, const Offset(0, -1200));
    await tester.pumpAndSettle();
    expect(find.text('Пользователи'), findsWidgets);
  });
}
