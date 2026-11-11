// Real Driver UI, native service and embedded WebView on a disposable emulator.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bioflow_mobile/main_driver.dart' as app;

class TutorialTouches extends StatefulWidget {
  const TutorialTouches({super.key, required this.child});
  final Widget child;
  @override
  State<TutorialTouches> createState() => _TutorialTouchesState();
}

class _TutorialTouchesState extends State<TutorialTouches> {
  Offset? point;
  int serial = 0;
  Timer? timer;
  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Directionality(
      textDirection: TextDirection.ltr,
      child: Listener(
          onPointerDown: (e) {
            timer?.cancel();
            setState(() {
              point = e.position;
              serial++;
            });
            timer = Timer(const Duration(milliseconds: 900), () {
              if (mounted) setState(() => point = null);
            });
          },
          child: Stack(children: [
            widget.child,
            if (point != null)
              Positioned(
                  left: point!.dx - 28,
                  top: point!.dy - 28,
                  child: IgnorePointer(
                      child: TweenAnimationBuilder<double>(
                          key: ValueKey(serial),
                          tween: Tween(begin: 0, end: 1),
                          duration: const Duration(milliseconds: 850),
                          builder: (_, t, __) => Opacity(
                              opacity: 1 - t,
                              child: Container(
                                  width: 56,
                                  height: 56,
                                  decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: const Color(0x44ffb632),
                                      border: Border.all(
                                          color: const Color(0xffffb632),
                                          width: 4)))))))
          ])));
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  testWidgets('Record each Driver action without accessing a live database',
      (tester) async {
    Future<dynamic> control(String path, [Map<String, dynamic>? body]) async {
      dynamic answer;
      await tester.runAsync(() async {
        final client = HttpClient();
        try {
          final req = await client.openUrl(body == null ? 'GET' : 'POST',
              Uri.parse('http://127.0.0.1:4200$path'));
          if (body != null) {
            req.headers.contentType = ContentType.json;
            final encoded = utf8.encode(jsonEncode(body));
            req.contentLength = encoded.length;
            req.add(encoded);
          }
          final r = await req.close();
          final text = await utf8.decoder.bind(r).join();
          if (r.statusCode != 200) {
            throw StateError('Tutorial control failed $path: $text');
          }
          answer = jsonDecode(text);
        } finally {
          client.close(force: true);
        }
      });
      if (answer == null) {
        throw StateError('Tutorial controller returned no result: $path');
      }
      return answer;
    }

    final setup = Map<String, dynamic>.from(await control('/'));
    final durations = Map<String, dynamic>.from(setup['timings']);
    Future<void> pause(double seconds) async {
      await tester.runAsync(() => Future<void>.delayed(
          Duration(milliseconds: (seconds * 1000).round())));
      // fullyLive renders frames; manual pumps can wait forever under native dialogs.
    }

    Future<void> waitFor(Finder finder, {int timeout = 45}) async {
      for (var i = 0; i < timeout * 5; i++) {
        if (finder.evaluate().isNotEmpty) return;
        await pause(.2);
      }
      throw StateError('Driver control unavailable: $finder');
    }

    Future<void> tapText(String text) async {
      final f = find.text(text);
      await waitFor(f);
      await tester.ensureVisible(f.last);
      await tester.tap(f.last);
      await pause(.5);
    }

    Future<void> type(Finder field, String text) async {
      await tester.ensureVisible(field);
      await tester.tap(field);
      for (var i = 1; i <= text.length; i++) {
        await tester.enterText(field, text.substring(0, i));
        await pause(.05);
      }
    }

    Future<void> record(
        String id, List<Future<void> Function()> actions) async {
      await control('/start', {'id': id});
      await pause(1.2);
      final measured = <double>[];
      for (var i = 0; i < actions.length; i++) {
        // ignore: avoid_print
        print('Tutorial step $id $i begin');
        final clock = Stopwatch()..start();
        await actions[i]();
        final minimum = (durations[id][i] as num).toDouble() + .8;
        final remain = minimum - clock.elapsedMilliseconds / 1000;
        if (remain > 0) await pause(remain);
        measured.add(clock.elapsedMilliseconds / 1000);
      }
      await control('/stop', {'durations': measured});
    }

    Future<void> identity() async {
      await waitFor(find.byType(TextFormField));
      await type(find.byType(TextFormField).at(0), '001 ABC 01');
      await type(find.byType(TextFormField).at(1), '+70000000100');
      await tapText('Начать рейс');
      await waitFor(find.text('Загрузился'));
    }

    Future<void> connect(String token) async {
      await tapText('Сканировать QR и начать');
      await tapText('Разрешить и продолжить');
      await control('/permissions', {});
      await waitFor(find.text('Вставить код QR вручную'));
      await tapText('Вставить код QR вручную');
      await type(find.byKey(const Key('manualQrCode')), token);
      await tapText('Продолжить');
      await identity();
    }

    await tester
        .pumpWidget(const TutorialTouches(child: app.CollectionDriver()));
    await pause(2);
    await record('driver--start', [
      () => tapText('Сканировать QR и начать'),
      () async {
        await tapText('Разрешить и продолжить');
        await control('/permissions', {});
        await waitFor(find.text('Вставить код QR вручную'));
      },
      () async {
        await tapText('Вставить код QR вручную');
        await type(find.byKey(const Key('manualQrCode')),
            setup['fixture']['nativeTrip']['qrToken'] as String);
        await tapText('Продолжить');
      },
      identity,
    ]);
    await record('driver--loaded', [
      () => pause(1),
      () => tapText('Загрузился'),
      () => waitFor(find.text('Выехал'))
    ]);
    await record('driver--depart', [
      () => tapText('Выехал'),
      () async {
        await control('/background', {});
        await pause(3);
      },
      () async {
        await control('/resume', {});
        await waitFor(find.text('Прибыл'));
      },
    ]);
    await record('driver--offline', [
      () async {
        await control('/offline', {});
        await pause(12);
      },
      () async {
        await pause(13);
      },
      () async {
        await control('/online', {});
        for (var i = 0; i < 40; i++) {
          await pause(1);
          if (find.text('В очереди: 0').evaluate().isNotEmpty) break;
        }
      },
    ]);
    await record('driver--route', [
      () async {
        await tapText('Маршрут на карте');
        await pause(3);
      },
      () async {
        await control('/web-tap', {'text': 'Весь маршрут'});
      },
      () async {
        await control('/web-tap', {'text': 'Последняя позиция'});
      },
    ]);
    await tester.pageBack();
    await pause(1);
    await record('driver--arrive',
        [() => pause(1), () => tapText('Прибыл'), () => pause(2)]);
    final trip = Map<String, dynamic>.from(await control('/new-trip', {}));
    await connect(trip['qrToken'] as String);
    await record('driver--stop', [
      () => pause(1),
      () => tapText('Остановить отслеживание'),
      () => tapText('Остановить')
    ]);
    await control('/prepare-help', {});
    await record('driver--help', [
      () async {
        await tapText('Видеоинструкции');
        await pause(3);
      },
      () async {
        await control('/web-tap', {'video': true});
        await pause(2);
      },
      () async {
        await control('/web-tap', {'text': 'Скачать MP4'});
        await pause(1);
        await control('/save-video', {});
        await pause(1);
      },
    ]);
    await tester.pageBack();
    await pause(1);
    await control('/new-trip', {});
    await record('driver--photo', [
      () async {
        await tapText('Сканировать QR и начать');
        await tapText('Разрешить и продолжить');
        await waitFor(find.text('Сканировать QR с фото'));
      },
      () async {
        await tapText('Сканировать QR с фото');
        await pause(1);
        await control('/photo', {});
        await waitFor(find.byType(TextFormField));
      },
      identity,
    ]);
    await const MethodChannel('collection/driver-tracking')
        .invokeMethod('stop');
  }, timeout: const Timeout(Duration(minutes: 20)));
}
