import 'embedded_video.dart';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Driver-only help/route pages stay inside the app. No tokens enter URLs.
class DriverWebPage extends StatefulWidget {
  const DriverWebPage(
      {super.key, required this.path, required this.title, this.sessionToken});
  final String path, title;
  final String? sessionToken;
  @override
  State<DriverWebPage> createState() => _DriverWebPageState();
}

class _DriverWebPageState extends State<DriverWebPage> {
  static const web = String.fromEnvironment('WEB_URL',
      defaultValue: 'https://release.109.235.118.171.sslip.io');
  late final WebViewController controller;
  bool loading = true;
  String? error;
  bool trusted(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        (uri.scheme == "https" || uri.scheme == "http") &&
        uri.origin == Uri.parse(web).origin;
  }

  @override
  void initState() {
    super.initState();
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..addJavaScriptChannel('BioflowMobile',
          onMessageReceived: (message) async {
        try {
          final data = jsonDecode(message.message) as Map<String, dynamic>;
          if (data['action'] != 'saveFile' ||
              data['mime'] != 'video/mp4' ||
              !(data['filename'] as String? ?? '').endsWith('.mp4') ||
              (data['data'] as String? ?? '').length > 28 * 1024 * 1024) {
            return;
          }
          final saved = await const MethodChannel('bioflow/mobile-files')
              .invokeMethod<bool>('saveFile', {
            'data': data['data'],
            'mime': 'video/mp4',
            'filename': data['filename']
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text(saved == true
                    ? 'Видео сохранено'
                    : 'Сохранение отменено')));
          }
        } catch (_) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Не удалось сохранить видео')));
          }
        }
      })
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) => trusted(request.url)
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
        onPageFinished: (url) async {
          if (trusted(url) &&
              Uri.parse(url).path == '/collection/driver-map' &&
              widget.sessionToken != null) {
            await controller.runJavaScript(
                'window.collectionDriverToken=${jsonEncode(widget.sessionToken)};window.dispatchEvent(new Event("collection:driver-token"));');
          }
          if (mounted) setState(() => loading = false);
        },
        onWebResourceError: (e) {
          if (e.isForMainFrame == true && mounted) {
            setState(() =>
                error = 'Страница недоступна. Проверьте интернет и повторите.');
          }
        },
      ))
      ..loadRequest(Uri.parse('$web${widget.path}')
          .replace(queryParameters: {'mobile': '1'}));
    configureEmbeddedVideo(controller, context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Stack(children: [
        WebViewWidget(controller: controller),
        if (loading) const Center(child: CircularProgressIndicator()),
        if (error != null)
          Center(
              child: Card(
                  child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(error!),
                        TextButton(
                            onPressed: () {
                              setState(() {
                                error = null;
                                loading = true;
                              });
                              controller.reload();
                            },
                            child: const Text('Повторить'))
                      ]))))
      ]));
}
