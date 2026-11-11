import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() => runApp(const CollectionDriver());

class CollectionDriver extends StatelessWidget {
  const CollectionDriver({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Collection Driver',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff147d64)),
          scaffoldBackgroundColor: const Color(0xfff4f7f5),
          useMaterial3: true,
        ),
        home: const DriverHome(),
      );
}

class DriverHome extends StatefulWidget {
  const DriverHome({super.key});
  @override
  State<DriverHome> createState() => _DriverHomeState();
}

class _DriverHomeState extends State<DriverHome> with WidgetsBindingObserver {
  static const bridge = MethodChannel('collection/driver-tracking');
  static const api = String.fromEnvironment('API_URL',
      defaultValue: 'https://release.109.235.118.171.sslip.io/api/v1');
  static const prefix = String.fromEnvironment('DRIVER_API_PREFIX',
      defaultValue: '/collection-driver');
  final dio = Dio(BaseOptions(
      baseUrl: api,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20)));
  Map<String, dynamic> status = {};
  Timer? timer;
  bool busy = false;
  String error = '';
  Map<String, dynamic>? pendingClaim;
  final storage = const FlutterSecureStorage();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    restore();
    timer = Timer.periodic(const Duration(seconds: 5), (_) => refresh());
  }

  Future<void> restore() async {
    try {
      final saved = await storage.read(key: 'driverPendingSession');
      if (saved != null) {
        pendingClaim = jsonDecode(saved) as Map<String, dynamic>;
      }
      await bridge.invokeMethod('resume');
      await refresh();
    } catch (e) {
      if (mounted) {
        setState(() => error =
            'Проверьте разрешения геолокации и повторно откройте приложение.');
      }
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    dio.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }

  Future<void> refresh() async {
    try {
      final data = await bridge.invokeMapMethod<String, dynamic>('status');
      if (mounted) setState(() => status = data ?? {});
    } on PlatformException catch (e) {
      if (mounted) {
        setState(() => error = e.message ?? 'Ошибка службы геолокации');
      }
    }
  }

  Future<void> start() async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      final consent = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Передача местоположения'),
          content: const Text(
              'Во время рейса Collection Driver передаёт владельцу перевозки ваше местоположение, в том числе при свёрнутом приложении и заблокированном экране. Отслеживание можно остановить здесь или в уведомлении. Максимальная длительность — 24 часа.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Отмена')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Разрешить и продолжить')),
          ],
        ),
      );
      if (consent != true) return;
      if (await bridge.invokeMethod<bool>('permission') != true) {
        throw StateError(
            'Разрешите точную геолокацию в настройках приложения и повторите запуск.');
      }
      if (!mounted) return;
      if (pendingClaim == null) {
        final savedDraft = await storage.read(key: 'driverClaimDraft');
        Map<String, dynamic> draft;
        if (savedDraft != null) {
          draft = jsonDecode(savedDraft) as Map<String, dynamic>;
        } else {
          if (!mounted) return;
          final token = await Navigator.push<String>(context,
              MaterialPageRoute(builder: (_) => const DriverScanner()));
          if (token == null) return;
          final random = Random.secure();
          final clientToken = base64UrlEncode(
                  List<int>.generate(32, (_) => random.nextInt(256)))
              .replaceAll('=', '');
          if (!mounted) return;
          final identity = await showDialog<Map<String, String>>(
            context: context,
            barrierDismissible: false,
            builder: (_) => const DriverIdentityDialog(),
          );
          if (identity == null) return;
          draft = {'token': token, 'clientToken': clientToken, ...identity};
          await storage.write(
              key: 'driverClaimDraft', value: jsonEncode(draft));
        }
        final response =
            await dio.post<Map<String, dynamic>>('$prefix/claim', data: draft);
        pendingClaim = response.data!;
        await storage.write(
            key: 'driverPendingSession', value: jsonEncode(pendingClaim));
      }
      final claim = pendingClaim!;
      await bridge.invokeMethod('start', {
        'token': claim['token'],
        'api': '$api$prefix',
        'destination': claim['warehouse'] ?? '',
        'stage': claim['status'] ?? 'CREATED',
        'number': claim['waybillNumber'],
        'expires':
            DateTime.parse(claim['expiresAt'] as String).millisecondsSinceEpoch,
      });
      pendingClaim = null;
      await storage.delete(key: 'driverPendingSession');
      await storage.delete(key: 'driverClaimDraft');
      await refresh();
    } on DioException catch (e) {
      if ([400, 409].contains(e.response?.statusCode)) {
        await storage.delete(key: 'driverClaimDraft');
      }
      final body = e.response?.data;
      final message = body is Map ? body['message'] : null;
      if (mounted) {
        setState(() => error = message is String
            ? message
            : 'Не удалось подключиться к серверу. Проверьте интернет и повторите.');
      }
    } catch (e) {
      if (mounted) {
        setState(() => error = e is PlatformException
            ? e.message ?? 'Не удалось запустить рейс'
            : e.toString().replaceFirst('Bad state: ', ''));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> stage(String type) async {
    setState(() {
      busy = true;
      error = '';
    });
    try {
      await bridge.invokeMethod('event', {'type': type});
      await refresh();
    } on PlatformException catch (e) {
      if (mounted) {
        setState(() => error = e.message ?? 'Не удалось сохранить этап рейса');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> stop() async {
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('Остановить отслеживание?'),
              content: const Text(
                  'Передача геолокации прекратится. Повторно использовать QR этого рейса нельзя.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Продолжить рейс')),
                TextButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Остановить'))
              ],
            ));
    if (confirmed != true) return;
    try {
      await bridge.invokeMethod('stop');
      await refresh();
    } on PlatformException catch (e) {
      if (mounted) setState(() => error = e.message ?? 'Ошибка остановки');
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = status['active'] == true;
    final currentStage = status['stage'] as String? ?? 'CREATED';
    final sent = (status['sent'] as num?)?.toInt() ?? 0;
    final serviceError = status['error'] as String? ?? '';
    return Scaffold(
      appBar: AppBar(
          title: const Text('Collection Driver'),
          backgroundColor: Colors.transparent),
      body: SafeArea(
          child: Center(
              child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 32),
                      Icon(
                          active
                              ? Icons.location_on
                              : Icons.local_shipping_outlined,
                          size: 76,
                          color: const Color(0xff147d64)),
                      const SizedBox(height: 24),
                      Text(
                          active
                              ? 'Вы на маршруте'
                              : currentStage == 'ARRIVED'
                                  ? 'Вы прибыли'
                                  : 'Готовы к рейсу?',
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineLarge
                              ?.copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 12),
                      Text(
                          active
                              ? 'Перевозка ${status['number'] ?? ''}'
                              : 'Сканируйте QR перевозки.\nРегистрация и пароль не нужны.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyLarge),
                      const SizedBox(height: 32),
                      Card(
                          child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                        active
                                            ? '● Отслеживание включено'
                                            : 'Отслеживание выключено',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.bold)),
                                    const SizedBox(height: 12),
                                    Text(active
                                        ? 'Можно свернуть приложение и заблокировать экран. Владелец видит последнюю переданную позицию.'
                                        : 'После сканирования разрешите доступ к точному местоположению. Во время рейса будет показано постоянное уведомление.'),
                                    if (active) ...[
                                      const SizedBox(height: 12),
                                      Text(sent == 0
                                          ? 'Ожидаем первую отправку GPS…'
                                          : 'Последняя отправка: ${TimeOfDay.fromDateTime(DateTime.fromMillisecondsSinceEpoch(sent)).format(context)}'),
                                      Text(
                                          'В очереди: ${status['queued'] ?? 0}'),
                                    ],
                                  ]))),
                      const SizedBox(height: 24),
                      if ((status['destination'] as String? ?? '').isNotEmpty)
                        Padding(
                            padding: const EdgeInsets.only(bottom: 20),
                            child: Text('Куда: ${status['destination']}',
                                textAlign: TextAlign.center)),
                      if (active && !busy) ...[
                        FilledButton.icon(
                          onPressed: () => stage(currentStage == 'CREATED'
                              ? 'LOADED'
                              : currentStage == 'LOADED'
                                  ? 'DEPARTED'
                                  : 'ARRIVED'),
                          icon: Icon(currentStage == 'CREATED'
                              ? Icons.inventory_2_outlined
                              : currentStage == 'LOADED'
                                  ? Icons.local_shipping_outlined
                                  : Icons.flag_outlined),
                          label: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text(currentStage == 'CREATED'
                                  ? 'Загрузился'
                                  : currentStage == 'LOADED'
                                      ? 'Выехал'
                                      : 'Прибыл')),
                        ),
                        const SizedBox(height: 12),
                        const Text(
                            'Этапы сохраняются и без интернета. После подключения они отправятся вместе с координатами.',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                      ],
                      if (busy)
                        const Center(child: CircularProgressIndicator())
                      else if (active)
                        OutlinedButton.icon(
                            onPressed: stop,
                            icon: const Icon(Icons.stop_circle_outlined),
                            label: const Text('Остановить отслеживание'))
                      else
                        FilledButton.icon(
                            onPressed: start,
                            icon: const Icon(Icons.qr_code_scanner),
                            label: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(pendingClaim == null
                                    ? 'Сканировать QR и начать'
                                    : 'Повторить запуск рейса'))),
                      if (error.isNotEmpty || serviceError.isNotEmpty)
                        Padding(
                            padding: const EdgeInsets.only(top: 20),
                            child: Text(error.isNotEmpty ? error : serviceError,
                                style: TextStyle(
                                    color:
                                        Theme.of(context).colorScheme.error))),
                      const SizedBox(height: 24),
                      const Text(
                          'При отсутствии интернета координаты сохраняются на телефоне и отправляются после восстановления связи. После принудительной остановки приложения или перезагрузки откройте его и проверьте статус рейса.',
                          textAlign: TextAlign.center),
                    ],
                  )))),
    );
  }
}

class DriverScanner extends StatefulWidget {
  const DriverScanner({super.key});
  @override
  State<DriverScanner> createState() => _DriverScannerState();
}

class _DriverScannerState extends State<DriverScanner> {
  final controller = MobileScannerController();
  bool done = false;
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('QR перевозки')),
        body: MobileScanner(
          controller: controller,
          errorBuilder: (context, error, child) => const Center(
              child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                      'Не удалось открыть камеру. Разрешите доступ к камере в настройках Collection Driver.'))),
          onDetect: (capture) {
            if (done) return;
            for (final barcode in capture.barcodes) {
              final raw = barcode.rawValue?.trim();
              if (raw != null &&
                  RegExp(r'^[A-Za-z0-9_-]{32,256}$').hasMatch(raw)) {
                done = true;
                Navigator.pop(context, raw);
                return;
              }
            }
          },
        ),
        bottomNavigationBar: const SafeArea(
            child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                    'Наведите камеру на QR перевозки из Collection. QR партии для запуска рейса не подходит.',
                    textAlign: TextAlign.center))),
      );
}

class DriverIdentityDialog extends StatefulWidget {
  const DriverIdentityDialog({super.key});
  @override
  State<DriverIdentityDialog> createState() => _DriverIdentityDialogState();
}

class _DriverIdentityDialogState extends State<DriverIdentityDialog> {
  final form = GlobalKey<FormState>();
  final plate = TextEditingController();
  final phone = TextEditingController(text: '+7');
  String normalizedPhone() {
    var digits = phone.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length == 11 && digits.startsWith('8')) {
      digits = '7${digits.substring(1)}';
    }
    return '+$digits';
  }

  @override
  void dispose() {
    plate.dispose();
    phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Данные водителя'),
        content: Form(
            key: form,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextFormField(
                  controller: plate,
                  textCapitalization: TextCapitalization.characters,
                  maxLength: 20,
                  decoration: const InputDecoration(
                      labelText: 'Госномер машины', hintText: '123 ABC 01'),
                  validator: (value) => (value?.trim().length ?? 0) < 3
                      ? 'Укажите госномер машины'
                      : null),
              TextFormField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  maxLength: 20,
                  decoration: const InputDecoration(
                      labelText: 'Номер телефона',
                      hintText: '+7 700 000 00 00'),
                  validator: (_) =>
                      RegExp(r'^\+[1-9]\d{6,14}$').hasMatch(normalizedPhone())
                          ? null
                          : 'Укажите телефон с кодом страны'),
              const SizedBox(height: 12),
              const Text(
                  'Госномер и телефон будут доступны владельцу перевозки. Номер телефона указывается без подтверждения по SMS.'),
            ])),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Отмена')),
          FilledButton(
              onPressed: () {
                if (form.currentState!.validate()) {
                  Navigator.pop(context, {
                    'plateNumber': plate.text.trim().toUpperCase(),
                    'phone': normalizedPhone()
                  });
                }
              },
              child: const Text('Начать рейс')),
        ],
      );
}
