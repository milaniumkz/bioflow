import 'dart:convert';
import 'package:flutter/services.dart';
import 'client.dart';

const driverLocation = MethodChannel('collection/driver-location');
Future<void> stopDriverTracking() async {
  try {
    await driverLocation.invokeMethod<void>('stop');
  } on MissingPluginException {/* Widget tests and unsupported platforms. */}
}

Future<Map<String, dynamic>> driverTrackingStatus() async {
  try {
    return Map<String, dynamic>.from(
        await driverLocation.invokeMapMethod<String, dynamic>('status') ?? {});
  } on MissingPluginException {
    return {'running': false, 'message': 'Геолокация доступна в Android'};
  }
}

Future<void> startDriverTracking(BioflowClient api, String tripId) async {
  final epochUser = api.owner;
  final granted =
      await driverLocation.invokeMethod<bool>('permission') ?? false;
  if (!granted) {
    throw StateError(
        'Разрешите точное местоположение, чтобы передавать маршрут рейса.');
  }
  if (api.owner != epochUser) throw StateError('Сессия изменилась');
  final tokens = await api.workspaceSession(driver: true);
  if (api.owner != epochUser) throw StateError('Сессия изменилась');
  await driverLocation.invokeMethod<void>('start', {
    'config': jsonEncode({
      'apiUrl': api.dio.options.baseUrl,
      'userId': api.owner,
      'tripId': tripId,
      'accessToken': tokens['accessToken'],
      'refreshToken': tokens['refreshToken']
    })
  });
}
