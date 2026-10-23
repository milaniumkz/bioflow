import 'package:bioflow_mobile/qr_scan.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:mobile_scanner/src/mobile_scanner_view_attributes.dart';
import 'package:mobile_scanner/src/objects/start_options.dart';

class DeniedCamera extends MobileScannerPlatform {
  @override
  Stream<BarcodeCapture?> get barcodesStream => const Stream.empty();
  @override
  Stream<TorchState> get torchStateStream => const Stream.empty();
  @override
  Stream<double> get zoomScaleStateStream => const Stream.empty();
  @override
  Future<MobileScannerViewAttributes> start(StartOptions options) async =>
      throw const MobileScannerException(
          errorCode: MobileScannerErrorCode.permissionDenied);
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

void main() {
  late MobileScannerPlatform original;
  setUp(() {
    original = MobileScannerPlatform.instance;
    MobileScannerPlatform.instance = DeniedCamera();
  });
  tearDown(() {
    MobileScannerPlatform.instance = original;
  });
  testWidgets(
      'manual QR can be cancelled and reopened without controller errors',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PartyQrScanner()));
    await tester.pumpAndSettle();
    for (var n = 0; n < 2; n++) {
      await tester.tap(find.text('Ввести код вручную'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'test-party-qr');
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Сканировать партию'), findsOneWidget);
    }
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  testWidgets('manual QR rejects blank input and opens the entered party once',
      (tester) async {
    String? result;
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                  body: TextButton(
                      onPressed: () async {
                        result = await Navigator.push<String>(
                            context,
                            MaterialPageRoute(
                                builder: (_) => const PartyQrScanner()));
                      },
                      child: const Text('Начать сканирование')),
                ))));
    await tester.tap(find.text('Начать сканирование'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ввести код вручную'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Открыть'))
            .onPressed,
        isNull);
    await tester.enterText(find.byType(TextField), '  party-qr-123  ');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(result, 'party-qr-123');
    expect(find.text('Начать сканирование'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
