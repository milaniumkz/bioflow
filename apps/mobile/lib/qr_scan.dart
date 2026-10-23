import 'package:flutter/material.dart';
import 'collection_design.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class PartyQrScanner extends StatefulWidget {
  const PartyQrScanner({super.key});
  @override
  State<PartyQrScanner> createState() => _PartyQrScannerState();
}

class _PartyQrScannerState extends State<PartyQrScanner> {
  final controller = MobileScannerController(formats: [BarcodeFormat.qrCode]);
  bool taken = false, enteringManually = false;
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('Сканировать партию')),
      body: SafeArea(
          top: false,
          child: Column(children: [
            const Padding(
                padding: EdgeInsets.all(20),
                child: Text('Наведите камеру на QR партии или биг-бэга')),
            Expanded(
                child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: Stack(fit: StackFit.expand, children: [
                          MobileScanner(
                              controller: controller,
                              errorBuilder: (context, error, child) => const Center(
                                  child: Padding(
                                      padding: EdgeInsets.all(24),
                                      child: Text(
                                          "Не удалось открыть камеру. Разрешите доступ к камере в настройках или введите QR вручную ниже."))),
                              onDetect: (capture) {
                                for (final barcode in capture.barcodes) {
                                  final value = barcode.rawValue;
                                  if (!taken &&
                                      !enteringManually &&
                                      value != null &&
                                      value.isNotEmpty &&
                                      value.length <= 512) {
                                    taken = true;
                                    Navigator.pop(context, value);
                                    break;
                                  }
                                }
                              }),
                          IgnorePointer(
                              child: Center(
                                  child: Container(
                                      width: 230,
                                      height: 230,
                                      decoration: BoxDecoration(
                                          border: Border.all(
                                              color: CollectionDesign.mint,
                                              width: 3),
                                          borderRadius:
                                              BorderRadius.circular(20)))))
                        ])))),
            Padding(
                padding: const EdgeInsets.all(20),
                child: TextButton(
                    onPressed: enteringManually
                        ? null
                        : () async {
                            setState(() => enteringManually = true);
                            final qr = await showDialog<String>(
                                context: context,
                                builder: (_) => const _ManualQrDialog());
                            if (!mounted) return;
                            setState(() => enteringManually = false);
                            if (qr != null && qr.isNotEmpty && !taken) {
                              taken = true;
                              Navigator.pop(this.context, qr);
                            }
                          },
                    child: const Text('Ввести код вручную')))
          ])));
}

// The dialog owns its controller until its closing animation has completed.
class _ManualQrDialog extends StatefulWidget {
  const _ManualQrDialog();
  @override
  State<_ManualQrDialog> createState() => _ManualQrDialogState();
}

class _ManualQrDialogState extends State<_ManualQrDialog> {
  final input = TextEditingController();
  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  void submit() {
    final qr = input.text.trim();
    if (qr.isNotEmpty) Navigator.pop(context, qr);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
          title: const Text('Ввести QR вручную'),
          scrollable: true,
          content: TextField(
              controller: input,
              maxLength: 512,
              autofocus: true,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(labelText: 'QR-код'),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => submit()),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Отмена')),
            FilledButton(
                onPressed: input.text.trim().isEmpty ? null : submit,
                child: const Text('Открыть'))
          ]);
}
