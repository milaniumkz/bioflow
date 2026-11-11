package kz.milanium.bioflow_mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.content.Context
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

class DriverTrackingBridge(private val activity: Activity, messenger: BinaryMessenger) {
    private var pending: MethodChannel.Result? = null
    private fun allowed() = activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    init {
        MethodChannel(messenger, "collection/driver-tracking").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "permission" -> {
                        if (pending != null) result.error("busy", "Подтвердите разрешение", null)
                        else if (allowed()) result.success(true)
                        else {
                            pending = result
                            val permissions = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                            if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                            activity.requestPermissions(permissions.toTypedArray(), 7401)
                        }
                    }
                    "start" -> {
                        check(allowed()) { "Разрешите точную геолокацию" }
                        val lm = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                        check(lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) { "Включите геолокацию телефона" }
                        val token = call.argument<String>("token") ?: error("Нет токена рейса")
                        val api = call.argument<String>("api") ?: error("Нет адреса сервера")
                        require(api.startsWith("https://") || (activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 && api.startsWith("http://")))
                        val prefs = activity.getSharedPreferences("driver", Context.MODE_PRIVATE)
                        check(!prefs.getBoolean("active", false)) { "Сначала остановите текущий рейс" }
                        prefs.edit().putString("token", token).putString("api", api)
                            .putString("number", call.argument<String>("number"))
                            .putString("destination", call.argument<String>("destination"))
                            .putString("lastToken", token)
                            .putLong("expires", call.argument<Number>("expires")!!.toLong())
                            .putBoolean("active", true).putString("error", "").putLong("sent", 0).putInt("sequence", 0).commit()
                        DriverEventOutbox.begin(activity, token, call.argument<String>("stage") ?: "CREATED")
                        val intent = Intent(activity, DriverLocationService::class.java)
                        if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
                        result.success(true)
                    }
                    "event" -> {
                        val p=activity.getSharedPreferences("driver",Context.MODE_PRIVATE)
                        check(p.getBoolean("active",false)) { "Сначала начните рейс" }
                        val token=p.getString("token","")!!
                        val type=call.argument<String>("type") ?: error("Нет этапа")
                        DriverEventOutbox.enqueue(activity,token,type)
                        if(type == "ARRIVED") {
                            val api=p.getString("api","")!!
                            p.edit().putBoolean("active",false).remove("token").commit()
                            activity.stopService(Intent(activity,DriverLocationService::class.java))
                            DriverUploadJob.enqueueStop(activity,api,token)
                        }
                        result.success(true)
                    }
                    "stop" -> {
                        val prefs = activity.getSharedPreferences("driver", Context.MODE_PRIVATE)
                        val api = prefs.getString("api", "")!!
                        val token = prefs.getString("token", "")!!
                        // Stop collection immediately; server expiry also bounds disconnected sessions.
                        prefs.edit().putBoolean("active", false).remove("token").commit()
                        activity.stopService(Intent(activity, DriverLocationService::class.java))
                        DriverUploadJob.enqueueStop(activity, api, token)
                        result.success(true)
                    }
                    "resume" -> {
                        val p = activity.getSharedPreferences("driver", Context.MODE_PRIVATE)
                        if (p.getBoolean("active", false)) {
                            if (p.getLong("expires", 0) <= System.currentTimeMillis() || !allowed()) {
                                p.edit().putBoolean("active", false).remove("token").putString("error", "Рейс истёк или разрешение геолокации отозвано").commit()
                                activity.stopService(Intent(activity, DriverLocationService::class.java))
                            } else {
                                val intent = Intent(activity, DriverLocationService::class.java)
                                if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
                            }
                        }
                        result.success(true)
                    }
                    "mapSession" -> {
                        val p=activity.getSharedPreferences("driver",Context.MODE_PRIVATE)
                        result.success(p.getString("lastToken",p.getString("token",null)))
                    }
                    "status" -> {
                        val p = activity.getSharedPreferences("driver", Context.MODE_PRIVATE)
                        result.success(mapOf("active" to p.getBoolean("active", false), "number" to p.getString("number", ""), "sent" to p.getLong("sent", 0), "error" to p.getString("error", ""), "expires" to p.getLong("expires", 0), "queued" to (DriverLocationService.queueCount(activity) + DriverEventOutbox.count(activity)), "stage" to DriverEventOutbox.stage(activity, p.getString("lastToken", "")!!), "destination" to p.getString("destination", "")))
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) { result.error("tracking", e.message ?: "Не удалось включить отслеживание", null) }
        }
    }
    fun permissionsResult(code: Int) {
        if (code == 7401) { pending?.success(allowed()); pending = null }
    }
}
