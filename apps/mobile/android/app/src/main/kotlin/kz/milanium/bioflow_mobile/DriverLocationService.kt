package kz.milanium.bioflow_mobile

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.database.sqlite.SQLiteDatabase
import android.location.*
import android.os.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Native foreground location service: independent of Flutter's UI/isolate lifetime. */
class DriverLocationService : Service(), LocationListener {
    private val prefs by lazy { getSharedPreferences("driver", MODE_PRIVATE) }
    private val manager by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var started = false
    private var sessionToken = ""
    private var sessionApi = ""
    private val queueLock = Any()
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { finishTracking(); return START_NOT_STICKY }
        if (!prefs.getBoolean("active", false) || System.currentTimeMillis() >= prefs.getLong("expires", 0)) {
            finishTracking(); return START_NOT_STICKY
        }
        if (started) return START_STICKY
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putString("error", "Разрешение геолокации отозвано").apply()
            finishTracking(); return START_NOT_STICKY
        }
        sessionToken = prefs.getString("token", "")!!
        sessionApi = prefs.getString("api", "")!!
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("driver", "Отслеживание рейса", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, DriverLocationService::class.java).setAction("STOP"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "driver") else Notification.Builder(this)
        val notification = builder.setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Collection Driver · " + prefs.getString("number", "Рейс"))
            .setContentText("Геолокация передаётся владельцу. Нажмите, чтобы открыть.")
            .setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Остановить", stop).build()).build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(7410, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(7410, notification)
            started = true
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (manager.allProviders.contains(provider)) manager.requestLocationUpdates(provider, 15_000L, 10f, this, Looper.getMainLooper())
            }
            worker.scheduleWithFixedDelay({ sync() }, 0, 15, TimeUnit.SECONDS)
        } catch (e: Exception) {
            prefs.edit().putString("error", "Не удалось запустить GPS: проверьте разрешения").apply()
            finishTracking()
        }
        return START_STICKY
    }
    override fun onLocationChanged(location: Location) {
        if (!prefs.getBoolean("active", false)) return
        if (System.currentTimeMillis() >= prefs.getLong("expires", 0)) { finishTracking(); return }
        if (!location.hasAccuracy() || location.time < System.currentTimeMillis() - 120_000) return
        synchronized(queueLock) {
            val seq = prefs.getInt("sequence", 0) + 1
            prefs.edit().putInt("sequence", seq).commit()
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val point = JSONObject().put("sequence", seq).put("latitude", location.latitude)
                .put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble())
                .put("recordedAt", format.format(Date(location.time)))
            database(this).use { db ->
                val values = ContentValues().apply { put("token", sessionToken); put("payload", point.toString()) }
                db.insertOrThrow("queue", null, values)

            }
        }
    }
    private fun sync() {
        if (!prefs.getBoolean("active", false)) return
        if (System.currentTimeMillis() >= prefs.getLong("expires", 0)) { main.post { finishTracking() }; return }
        try {
            val ids = mutableListOf<Long>()
            val points = JSONArray()
            database(this).use { db ->
                db.query("queue", arrayOf("id", "payload"), "token = ?", arrayOf(sessionToken), null, null, "id ASC", "100").use { cursor ->
                    while (cursor.moveToNext()) { ids.add(cursor.getLong(0)); points.put(JSONObject(cursor.getString(1))) }
                }
            }
            if (ids.isEmpty()) { DriverEventOutbox.flush(this, sessionApi, sessionToken); return }
            val code = post(sessionApi + "/points", sessionToken, JSONObject().put("points", points).toString())
            if (code in 200..299) {
                database(this).use { db -> db.delete("queue", "id IN (${ids.joinToString(",")})", null) }
                DriverEventOutbox.flush(this, sessionApi, sessionToken)
                prefs.edit().putLong("sent", System.currentTimeMillis()).putString("error", "").apply()
            } else if (code == 401 || code == 403) {
                prefs.edit().putString("error", "Рейс завершён или доступ отозван").apply()
                main.post { finishTracking() }
            } else {
                prefs.edit().putString("error", "Сервер недоступен ($code). Координаты сохранены на телефоне").apply()
            }
        } catch (_: Exception) {
            prefs.edit().putString("error", "Нет связи. Координаты сохранены на телефоне").apply()
        }
    }
    private fun finishTracking() {
        val api = prefs.getString("api", "")!!
        val token = prefs.getString("token", "")!!
        prefs.edit().putBoolean("active", false).remove("token").commit()
        if (token.isNotEmpty()) DriverUploadJob.enqueueStop(this, api, token)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onProviderDisabled(provider: String) { prefs.edit().putString("error", "GPS отключён. Включите геолокацию телефона").apply() }
    override fun onProviderEnabled(provider: String) { prefs.edit().putString("error", "").apply() }
    @Deprecated("Legacy Android location callback")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onDestroy() {
        manager.removeUpdates(this)
        worker.shutdownNow()
        super.onDestroy()
    }
    companion object {
        fun database(context: Context): SQLiteDatabase {
            val db = context.openOrCreateDatabase("driver-locations.db", Context.MODE_PRIVATE, null)
            db.execSQL("CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, payload TEXT NOT NULL)")
            return db
        }
        fun queueCount(context: Context): Int = database(context).use { db ->
            db.rawQuery("SELECT COUNT(*) FROM queue", null).use { c -> c.moveToFirst(); c.getInt(0) }
        }
        fun post(url: String, token: String, body: String): Int {
            val connection = URI(url).toURL().openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                return connection.responseCode
            } finally { connection.disconnect() }
        }
    }
}
