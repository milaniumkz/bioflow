import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'client.dart';

class CollectionRegistration extends StatefulWidget {
  const CollectionRegistration({super.key, required this.client});
  final BioflowClient client;
  @override
  State<CollectionRegistration> createState() => _CollectionRegistrationState();
}

class _CollectionRegistrationState extends State<CollectionRegistration> {
  final form = GlobalKey<FormState>();
  final name = TextEditingController();
  final phone = TextEditingController();
  final password = TextEditingController();
  String role = 'COLLECTOR';
  String? locationId;
  List<Map<String, dynamic>> locations = [];
  bool loaded = false, busy = false;
  String error = '';

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response =
          await widget.client.dio.get('/collection/registration/options');
      if (!mounted) return;
      setState(() {
        locations = (response.data['locations'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        loaded = true;
        error = '';
      });
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'Не удалось загрузить список. Проверьте интернет и повторите.');
      }
    }
  }

  Future<void> submit() async {
    if (!form.currentState!.validate()) return;
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await widget.client.dio.post('/collection/registration', data: {
        'fullName': name.text.trim(),
        'phone': phone.text.trim(),
        'password': password.text,
        'role': role,
        if (role != 'COLLECTOR') 'locationId': locationId,
      });
      await widget.client.login(phone.text, password.text);
      if (mounted) Navigator.pop(context, true);
    } on DioException catch (e) {
      if (!mounted) return;
      final message =
          e.response?.data is Map ? e.response?.data['message'] : null;
      setState(() => error = message is String
          ? message
          : message is List
              ? message.join('\n')
              : 'Не удалось зарегистрироваться. Проверьте интернет.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Регистрация')),
        body: Center(
            child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Form(
                      key: form,
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            DropdownButtonFormField<String>(
                                initialValue: role,
                                decoration: const InputDecoration(
                                    labelText: 'Ваша роль'),
                                items: const [
                                  DropdownMenuItem(
                                      value: 'COLLECTOR',
                                      child: Text('Сборщик')),
                                  DropdownMenuItem(
                                      value: 'WAREHOUSE_MANAGER',
                                      child: Text('Мойка')),
                                  DropdownMenuItem(
                                      value: 'FACTORY_MANAGER',
                                      child: Text('Завод')),
                                ],
                                onChanged: busy
                                    ? null
                                    : (v) => setState(() {
                                          role = v!;
                                          locationId = null;
                                        })),
                            if (role != 'COLLECTOR')
                              DropdownButtonFormField<String>(
                                  key: ValueKey(role),
                                  initialValue: locationId,
                                  decoration: InputDecoration(
                                      labelText: role == 'WAREHOUSE_MANAGER'
                                          ? 'Выберите мойку'
                                          : 'Выберите завод'),
                                  items: locations
                                      .where((l) =>
                                          l['kind'] ==
                                          (role == 'WAREHOUSE_MANAGER'
                                              ? 'WAREHOUSE'
                                              : 'FACTORY'))
                                      .map((l) => DropdownMenuItem(
                                          value: l['id'] as String,
                                          child: Text(l['name'] as String)))
                                      .toList(),
                                  onChanged: busy
                                      ? null
                                      : (v) => setState(() => locationId = v),
                                  validator: (v) =>
                                      v == null ? 'Выберите объект' : null),
                            TextFormField(
                                controller: name,
                                enabled: !busy,
                                decoration:
                                    const InputDecoration(labelText: 'ФИО'),
                                autofillHints: const [AutofillHints.name],
                                maxLength: 120,
                                validator: (v) => (v?.trim().length ?? 0) < 2
                                    ? 'Введите ФИО'
                                    : null),
                            TextFormField(
                                controller: phone,
                                enabled: !busy,
                                decoration: const InputDecoration(
                                    labelText: 'Номер телефона'),
                                keyboardType: TextInputType.phone,
                                autofillHints: const [
                                  AutofillHints.telephoneNumber
                                ],
                                validator: (v) => (v?.trim().isEmpty ?? true)
                                    ? 'Введите телефон'
                                    : null),
                            TextFormField(
                                controller: password,
                                enabled: !busy,
                                decoration: const InputDecoration(
                                    labelText: 'Придумайте пароль'),
                                obscureText: true,
                                autofillHints: const [
                                  AutofillHints.newPassword
                                ],
                                maxLength: 128,
                                validator: (v) => (v?.length ?? 0) < 6
                                    ? 'Минимум 6 символов'
                                    : null),
                            const SizedBox(height: 24),
                            FilledButton(
                                onPressed: loaded && !busy ? submit : null,
                                child: Text(busy
                                    ? 'Создаём аккаунт…'
                                    : 'Зарегистрироваться и войти')),
                            if (error.isNotEmpty)
                              Text(error,
                                  style: const TextStyle(color: Colors.red)),
                            if (!loaded)
                              TextButton(
                                  onPressed: load,
                                  child: const Text('Повторить загрузку')),
                          ])),
                ))),
      );
}
