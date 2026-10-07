import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'client.dart';

const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const firebaseSender = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
const firebaseProject = String.fromEnvironment('FIREBASE_PROJECT_ID');
Future<void> configurePush(BioflowClient api) async {
  if ([firebaseApiKey, firebaseAppId, firebaseSender, firebaseProject]
      .any((x) => x.isEmpty)) {
    return;
  }
  await Firebase.initializeApp(
      options: const FirebaseOptions(
          apiKey: firebaseApiKey,
          appId: firebaseAppId,
          messagingSenderId: firebaseSender,
          projectId: firebaseProject));
  final messaging = FirebaseMessaging.instance;
  await messaging.requestPermission();
  Future<void> register(String token) async {
    await api.send(
        '/auth/devices',
        {
          'deviceId': await api.storage.read(key: 'deviceId'),
          'platform': 'android',
          'pushToken': token
        },
        queue: false);
  }

  final token = await messaging.getToken();
  if (token != null) await register(token);
  messaging.onTokenRefresh.listen((token) => register(token));
}
