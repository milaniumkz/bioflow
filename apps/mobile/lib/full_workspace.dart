import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'client.dart';
import 'role_access.dart';

const mobileFiles = MethodChannel('bioflow/mobile-files');

Future<void> printMobileQr(String image) =>
    mobileFiles.invokeMethod<void>('printQr', {'image': image});

class FullWorkspace extends StatefulWidget {
  const FullWorkspace({super.key, required this.client, required this.section});
  final BioflowClient client;
  final String section;
  @override
  FullWorkspaceState createState() => FullWorkspaceState();
}

class FullWorkspaceState extends State<FullWorkspace> {
  late final WebViewController controller;
  late final String identity;
  late final Uri webUri;
  String? childSession, error;
  List<MapEntry<String, String>>? webSections;
  bool authenticating = false, authenticated = false, leaving = false;
  Timer? readiness;
  int pageGeneration = 0;
  bool queuedReady = false;

  bool trusted(String? value) {
    final uri = Uri.tryParse(value ?? '');
    return uri != null &&
        uri.scheme == webUri.scheme &&
        uri.host == webUri.host &&
        uri.port == webUri.port &&
        uri.userInfo.isEmpty &&
        uri.path == '/' &&
        uri.queryParameters['mobile'] == '1';
  }

  @override
  void initState() {
    super.initState();
    identity = widget.client.owner;
    const configured = String.fromEnvironment('WEB_URL');
    final origin = configured.isEmpty
        ? Uri.parse(widget.client.dio.options.baseUrl).origin
        : configured;
    webUri =
        Uri.parse(origin).replace(path: '/', query: 'mobile=1', fragment: '');
    controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF061225))
      ..addJavaScriptChannel('BioflowMobile', onMessageReceived: receive)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (r) => trusted(r.url)
            ? NavigationDecision.navigate
            : NavigationDecision.prevent,
        onPageStarted: (_) {
          pageGeneration++;
          queuedReady = false;
          if (mounted) {
            setState(() {
              authenticated = false;
              error = null;
            });
          }
          readiness?.cancel();
          readiness = Timer(const Duration(seconds: 25), () {
            if (mounted && !authenticated) {
              setState(() => error =
                  'Не удалось открыть кабинет. Проверьте соединение и повторите попытку.');
            }
          });
        },
        onWebResourceError: (e) {
          if (mounted && e.isForMainFrame == true) {
            setState(
                () => error = 'Нет связи с кабинетом. Проверьте интернет.');
          }
        },
      ))
      ..setOnJavaScriptConfirmDialog((r) async =>
          await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                      title: const Text('Подтвердите действие'),
                      content: Text(r.message),
                      actions: [
                        TextButton(
                            onPressed: () => Navigator.pop(ctx, false),
                            child: const Text('Отмена')),
                        FilledButton(
                            onPressed: () => Navigator.pop(ctx, true),
                            child: const Text('Подтвердить')),
                      ])) ??
          false)
      ..setOnJavaScriptAlertDialog((r) async {
        await showDialog<void>(
            context: context,
            builder: (ctx) => AlertDialog(content: Text(r.message), actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Закрыть'))
                ]));
      })
      ..setOnJavaScriptTextInputDialog((r) async {
        final input = TextEditingController(text: r.defaultText);
        final value = await showDialog<String>(
            context: context,
            builder: (ctx) => AlertDialog(
                    title: Text(r.message),
                    content: TextField(controller: input, autofocus: true),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx, ''),
                          child: const Text('Отмена')),
                      FilledButton(
                          onPressed: () => Navigator.pop(ctx, input.text),
                          child: const Text('Продолжить')),
                    ]));
        // Dispose after the dialog's closing animation no longer uses the field.
        Future<void>.delayed(const Duration(seconds: 1), input.dispose);
        return value ?? '';
      });
    if (controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      android.setAllowFileAccess(false);
      android.setOnShowFileSelector((params) async {
        if (!mounted || widget.client.owner != identity) return [];
        return await mobileFiles.invokeListMethod<String>('pickFiles',
                {'multiple': params.mode == FileSelectorMode.openMultiple}) ??
            [];
      });
    }
    controller.loadRequest(webUri);
  }

  Future<void> authenticate() async {
    if (authenticating || !mounted || widget.client.owner != identity) return;
    authenticating = true;
    final generation = pageGeneration;
    try {
      await widget.client.refreshProfile();
      if (!canOpenSection(widget.section, widget.client.profile)) {
        throw StateError('Недостаточно прав');
      }
      await revokeChild();
      final tokens = await widget.client.workspaceSession();
      final claim = jsonDecode(utf8.decode(base64Url.decode(base64Url
          .normalize((tokens['accessToken'] as String).split('.')[1])))) as Map;
      final issued = claim['sessionId'] as String?;
      if (issued != null &&
          RegExp(r'^[A-Za-z0-9_-]{1,100}$').hasMatch(issued)) {
        childSession = issued;
      }
      final currentUrl = await controller.currentUrl();
      if (!mounted ||
          leaving ||
          generation != pageGeneration ||
          widget.client.owner != identity ||
          !trusted(currentUrl)) {
        await revokeChild();
        return;
      }
      final payload = jsonEncode(
          {...Map<String, dynamic>.from(tokens), 'section': widget.section});
      await controller.runJavaScript(
          'window.dispatchEvent(new CustomEvent("bioflow:mobile-login", {detail: $payload}));');
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'Не удалось войти в кабинет. Проверьте соединение и доступ к разделу.');
      }
    } finally {
      authenticating = false;
      if (queuedReady &&
          mounted &&
          !leaving &&
          widget.client.owner == identity) {
        queuedReady = false;
        unawaited(authenticate());
      }
    }
  }

  Future<void> revokeChild() async {
    final id = childSession;
    childSession = null;
    if (id == null || widget.client.owner != identity) return;
    try {
      await widget.client.send('/auth/sessions/$id/revoke', {}, queue: false);
    } catch (_) {
      /* Already expired or offline. Tokens never persist in the WebView. */
    }
  }

  Future<void> receive(JavaScriptMessage message) async {
    if (!mounted || leaving || widget.client.owner != identity) return;
    final currentUrl = await controller.currentUrl();
    if (!mounted ||
        leaving ||
        widget.client.owner != identity ||
        !trusted(currentUrl)) {
      return;
    }
    try {
      final data = jsonDecode(message.message) as Map<String, dynamic>;
      switch (data['action']) {
        case 'ready':
          if (authenticating) {
            queuedReady = true;
          } else {
            await authenticate();
          }
        case 'session':
          final id = data['sessionId'] as String?;
          if (id != null && RegExp(r'^[A-Za-z0-9_-]{1,100}$').hasMatch(id)) {
            childSession = id;
          }
        case 'profileReady':
          if (data['userId'] != identity) throw StateError('Identity changed');
          webSections = (data['sections'] as List? ?? [])
              .map((x) => MapEntry(x['id'] as String, x['title'] as String))
              .toList();
          readiness?.cancel();
          if (mounted) {
            setState(() {
              authenticated = true;
              error = null;
            });
          }
        case 'signedOut':
          await finish(true);
        case 'sessionEnded':
          await finish(false);
        case 'close':
          await finish(false);
        case 'saveFile':
          if (!authenticated) return;
          final saved = await mobileFiles.invokeMethod<bool>('saveFile', {
            'data': data['data'],
            'filename': data['filename'],
            'mime': data['mime']
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text(
                    saved == true ? 'Файл сохранён' : 'Сохранение отменено')));
          }
        case 'printQr':
          if (authenticated) await printMobileQr(data['image'] as String);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content:
                Text('Не удалось выполнить действие. Повторите попытку.')));
      }
    }
  }

  Future<void> finish(bool signedOut) async {
    if (!mounted || leaving) return;
    setState(() => leaving = true);
    await WidgetsBinding.instance.endOfFrame;
    if (mounted) Navigator.pop(context, signedOut);
  }

  Future<void> close() async {
    if (leaving) return;
    if (!authenticated) {
      await finish(false);
      return;
    }
    await controller.runJavaScript(
        'if (window.dispatchEvent(new Event("bioflow:navigate", {cancelable:true}))) BioflowMobile.postMessage(JSON.stringify({action:"close"}));');
  }

  @override
  void dispose() {
    leaving = true;
    readiness?.cancel();
    unawaited(revokeChild());
    // Session credentials live only in this document's memory, never URL/cookies/storage.
    unawaited(controller
        .runJavaScript('window.dispatchEvent(new Event("bioflow:expired"));')
        .catchError((_) {}));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: leaving,
        onPopInvokedWithResult: (popped, _) async {
          if (popped) return;
          if (authenticated && await controller.canGoBack()) {
            await controller.goBack();
          } else {
            await close();
          }
        },
        child: Scaffold(
          appBar: AppBar(
            leading: IconButton(
                onPressed: close,
                tooltip: 'Назад',
                icon: const Icon(Icons.arrow_back)),
            title:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.client.profile?['fullName'] ?? 'BIOFLOW',
                  style: const TextStyle(fontSize: 16),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
              Text(roleSummary(widget.client.profile),
                  style: const TextStyle(fontSize: 11),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
            ]),
            actions: [
              PopupMenuButton<String>(
                  tooltip: 'Разделы моей роли',
                  onSelected: (id) => controller.runJavaScript(
                      'window.dispatchEvent(new CustomEvent("bioflow:mobile-section", {detail:${jsonEncode(id)}}));'),
                  itemBuilder: (_) => (webSections ??
                          roleSections.entries
                              .where((e) =>
                                  canOpenSection(e.key, widget.client.profile))
                              .toList())
                      .map((e) =>
                          PopupMenuItem(value: e.key, child: Text(e.value)))
                      .toList()),
            ],
          ),
          body: Stack(children: [
            if (controller.platform is AndroidWebViewController)
              WebViewWidget.fromPlatformCreationParams(
                  params: AndroidWebViewWidgetCreationParams(
                      controller: controller.platform,
                      displayWithHybridComposition: true))
            else
              WebViewWidget(controller: controller),
            if (!authenticated || error != null)
              Positioned.fill(
                  child: ColoredBox(
                      color: const Color(0xFF061225),
                      child: Center(
                          child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: error == null
                                  ? const Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                          CircularProgressIndicator(),
                                          SizedBox(height: 20),
                                          Text('Открываем ваш кабинет…')
                                        ])
                                  : Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                          Text(error!,
                                              textAlign: TextAlign.center),
                                          FilledButton(
                                              onPressed: () => controller
                                                  .loadRequest(webUri),
                                              child: const Text('Повторить'))
                                        ]))))),
          ]),
        ),
      );
}
