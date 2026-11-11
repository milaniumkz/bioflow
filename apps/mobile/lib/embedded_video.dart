import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// HTML video stays in the application, including Android's fullscreen view.
void configureEmbeddedVideo(
    WebViewController controller, BuildContext context) {
  if (controller.platform is! AndroidWebViewController) return;
  var showing = false;
  (controller.platform as AndroidWebViewController).setCustomWidgetCallbacks(
    onShowCustomWidget: (widget, callback) {
      if (!context.mounted || showing) {
        callback();
        return;
      }
      showing = true;
      Navigator.of(context)
          .push(MaterialPageRoute<void>(
              builder: (_) => Scaffold(
                  backgroundColor: Colors.black,
                  body: SafeArea(child: widget))))
          .whenComplete(() {
        showing = false;
        callback();
      });
    },
    onHideCustomWidget: () {
      if (showing && context.mounted) {
        showing = false;
        Navigator.of(context).pop();
      }
    },
  );
}
