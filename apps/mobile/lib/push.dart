import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'client.dart';

const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const firebaseSender = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
const firebaseProject = String.fromEnvironment('FIREBASE_PROJECT_ID');
StreamSubscription<String>? _tokenSubscription;
StreamSubscription<RemoteMessage>? _messageSubscription;
void disposePush() {
  _tokenSubscription?.cancel();
  _messageSubscription?.cancel();
  _tokenSubscription = null;
  _messageSubscription = null;
}

Future<void> configurePush(BioflowClient api,
    {void Function(String)? onMessage, void Function(String)? onError}) async {
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
    throw StateError('Разрешите уведомления в настройках Android.');
  }
  Future<void> register(String token) async {
    if (api.owner != identity || identity.isEmpty) return;
    await api.send(
        '/auth/devices',
        {
          'deviceId': await api.storage.read(key: 'deviceId'),
          'platform': 'android',
          'pushToken': token,
        },
        queue: false);
  }

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
  _messageSubscription = FirebaseMessaging.onMessage.listen((message) {
    if (api.owner != identity) return;
    onMessage?.call([message.notification?.title, message.notification?.body]
        .whereType<String>()
        .join('\n'));
  });
}
