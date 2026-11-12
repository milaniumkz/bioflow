import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'client.dart';
import 'collection_registration.dart';
import 'full_workspace.dart';
import 'push.dart';
import 'role_access.dart';

void main() => runApp(const CollectionApp());

class CollectionApp extends StatelessWidget {
  const CollectionApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Collection',
        debugShowCheckedModeBanner: false,
        locale: const Locale('ru'),
        supportedLocales: const [Locale('ru'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        theme: ThemeData(
            useMaterial3: true,
            colorScheme:
                ColorScheme.fromSeed(seedColor: const Color(0xff17684f)),
            scaffoldBackgroundColor: const Color(0xfff4f6f2)),
        home: const CollectionLogin(),
      );
}

class CollectionLogin extends StatefulWidget {
  const CollectionLogin({super.key});
  @override
  State<CollectionLogin> createState() => _CollectionLoginState();
}

class _CollectionLoginState extends State<CollectionLogin> {
  final client = BioflowClient();
  final workspaceKey = GlobalKey<FullWorkspaceState>();
  Map<String, dynamic>? pendingNotice;
  final phone = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  String error = '';
  @override
  void initState() {
    super.initState();
    restore();
  }

  Future<void> restore() async {
    if (await client.restore()) {
      try {
        await client.refreshProfile();
        if (mounted) await open();
      } catch (_) {}
    }
  }

  Future<void> open() async {
    if (!canOpenSection('collection', client.profile)) {
      throw StateError(
          'Этой учётной записи не назначена роль рабочего контура Collection.');
    }
    String? pushError;
    try {
      void openNotice(Map<String, dynamic> data) {
        final workspace = workspaceKey.currentState;
        if (workspace == null) {
          pendingNotice = data;
        } else {
          workspace.openNotification(data);
        }
      }

      await configurePush(client, onOpen: openNotice,
          onNotification: (text, data) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(text),
              action: SnackBarAction(
                  label: 'Открыть', onPressed: () => openNotice(data))));
        }
      });
    } catch (e) {
      pushError = e.toString().replaceFirst('Bad state: ', '');
    }
    if (!mounted) return;
    if (pushError != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(pushError)));
    }
    await Navigator.push(
        context,
        MaterialPageRoute<void>(
            builder: (_) => FullWorkspace(
                key: workspaceKey,
                initialNotification: pendingNotice,
                client: client,
                section: 'collection',
                path: '/collection')));
    disposePush();
    if (mounted) setState(() {});
  }

  Future<void> login() async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await client.login(phone.text, password.text);
      password.clear();
      await open();
    } on DioException catch (e) {
      final data = e.response?.data;
      setState(() => error = data is Map && data['message'] is String
          ? data['message'] as String
          : 'Не удалось подключиться. Проверьте адрес сервера и интернет.');
    } catch (e) {
      if (mounted) {
        setState(() => error = e.toString().replaceFirst('Bad state: ', ''));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    phone.dispose();
    password.dispose();
    disposePush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      body: SafeArea(
          child: Center(
              child: SingleChildScrollView(
                  padding: const EdgeInsets.all(28),
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text('collection',
                                style: TextStyle(
                                    fontSize: 44,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -2,
                                    color: Color(0xff17684f))),
                            const Text('Рабочий контур',
                                style: TextStyle(color: Colors.grey)),
                            const SizedBox(height: 40),
                            Text('Всё движение.\nВ одном месте.',
                                style:
                                    Theme.of(context).textTheme.headlineLarge),
                            const SizedBox(height: 24),
                            TextField(
                                controller: phone,
                                decoration: const InputDecoration(
                                    labelText: 'Телефон или email'),
                                keyboardType: TextInputType.emailAddress,
                                autofillHints: const [AutofillHints.username]),
                            const SizedBox(height: 16),
                            TextField(
                                controller: password,
                                decoration:
                                    const InputDecoration(labelText: 'Пароль'),
                                obscureText: true,
                                autofillHints: const [AutofillHints.password],
                                onSubmitted: (_) {
                                  if (!busy) login();
                                }),
                            const SizedBox(height: 24),
                            FilledButton(
                                onPressed: busy ? null : login,
                                child: Padding(
                                    padding: const EdgeInsets.all(14),
                                    child: Text(busy
                                        ? 'Входим…'
                                        : 'Войти в Collection'))),
                            TextButton(
                                onPressed: busy
                                    ? null
                                    : () async {
                                        final registered =
                                            await Navigator.push<bool>(
                                                context,
                                                MaterialPageRoute(
                                                    builder: (_) =>
                                                        CollectionRegistration(
                                                            client: client)));
                                        if (registered == true && mounted) {
                                          await open();
                                        }
                                      },
                                child: const Text('Создать аккаунт')),
                            if (error.isNotEmpty)
                              Padding(
                                  padding: const EdgeInsets.only(top: 18),
                                  child: Text(error,
                                      style:
                                          const TextStyle(color: Colors.red))),
                            const SizedBox(height: 24),
                            const Text(
                                'Кабинеты сборщика, склада, завода и владельца. Водитель использует отдельное приложение Collection Driver.',
                                style: TextStyle(color: Colors.grey)),
                          ]))))));
}
