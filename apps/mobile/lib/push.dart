import 'dart:async';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'client.dart';

const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const firebaseSender = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
const firebaseProject = String.fromEnvironment('FIREBASE_PROJECT_ID');
StreamSubscription<String>? _tokenSubscription;
StreamSubscription<RemoteMessage>? _messageSubscription;
StreamSubscription<RemoteMessage>? _openSubscription;
void disposePush() {
  _tokenSubscription?.cancel();
  _messageSubscription?.cancel();
  _openSubscription?.cancel();
  _tokenSubscription = null;
  _messageSubscription = null;
  _openSubscription = null;
}

Future<void> configurePush(BioflowClient api,
    {void Function(String)? onMessage,
    void Function(String)? onError,
    void Function(Map<String, dynamic>)? onOpen,
    void Function(String, Map<String, dynamic>)? onNotification}) async {
  disposePush();
  final identity = api.owner;
  if ([firebaseApiKey, firebaseAppId, firebaseSender, firebaseProject]
      .any((x) => x.isEmpty)) {
    throw StateError(
        'Push не настроен в этой сборке. Уведомления доступны во вкладке «События».');
  }
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
        options: const FirebaseOptions(
            apiKey: firebaseApiKey,
            appId: firebaseAppId,
            messagingSenderId: firebaseSender,
            projectId: firebaseProject));
  }
  final messaging = FirebaseMessaging.instance;
  final permission = await messaging.requestPermission();
  if (permission.authorizationStatus == AuthorizationStatus.denied) {
    throw StateError('Разрешите уведомления в настройках телефона.');
  }
  Future<void> register(String token) async {
    if (api.owner != identity || identity.isEmpty) return;
    await api.send(
        '/auth/devices',
        {
          'deviceId': await api.storage.read(key: 'deviceId'),
          'platform': Platform.isIOS ? 'ios' : 'android',
          'pushToken': token,
        },
        queue: false);
  }

  if (Platform.isIOS) {
    // APNs registration is asynchronous, even after permission is granted.
    for (var attempt = 0; ; attempt++) {
      if (api.owner != identity || identity.isEmpty) return;
      if (await messaging.getAPNSToken() != null) break;
      if (attempt == 19) {
        throw StateError('Не удалось получить токен APNs. Проверьте связь.');
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
  }
  if (api.owner != identity || identity.isEmpty) return;
  final token = await messaging.getToken();
  if (token == null) {
    throw StateError('Не удалось получить push-токен устройства.');
  }
  await register(token);
  if (api.owner != identity) return;
  _tokenSubscription = messaging.onTokenRefresh.listen((token) {
    register(token).catchError((Object e) {
      onError?.call('Не удалось обновить push-токен. Проверьте связь.');
    });
  });
  void open(RemoteMessage message) {
    if (api.owner != identity ||
        (message.data['recipientId'] != null &&
            message.data['recipientId'] != identity)) {
      return;
    }
    onOpen?.call(message.data);
  }

  _openSubscription = FirebaseMessaging.onMessageOpenedApp.listen(open);
  final initial = await messaging.getInitialMessage();
  if (initial != null) open(initial);
  _messageSubscription = FirebaseMessaging.onMessage.listen((message) {
    if (api.owner != identity) return;
    final text = [message.notification?.title, message.notification?.body]
        .whereType<String>()
        .join('\n');
    onMessage?.call(text);
    onNotification?.call(text, message.data);
  });
}
