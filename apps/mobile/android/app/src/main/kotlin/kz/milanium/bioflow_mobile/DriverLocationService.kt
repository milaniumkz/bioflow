package kz.milanium.bioflow_mobile

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Explicitly started location foreground service. No hidden tracking or boot receiver.
class DriverLocationService : Service(), LocationListener {
    private val lock = Any()
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private lateinit var locations: LocationManager
    private var config: JSONObject? = null
    private var queue = JSONArray()
    private var lastSample = 0L
    private var message = "Ожидаем точный GPS-сигнал"
    private var stopping = false
    private val prefs by lazy { getSharedPreferences("collection-driver", MODE_PRIVATE) }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("collection-driver-v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("collection-driver-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun save(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, Base64.encodeToString(data, Base64.NO_WRAP)).commit())
    }
    private fun read(name: String): String? {
        val raw = prefs.getString(name, null) ?: return null
        val bytes = Base64.decode(raw, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
    private fun queueKey(c: JSONObject) = "queue:${c.getString("userId")}:${c.getString("tripId")}"
    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, DriverLocationService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this,"driver-route") else Notification.Builder(this)
        return builder.setContentTitle("Collection · геолокация рейса").setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentIntent(open).setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel,"Остановить передачу",stop).build()
    }
    private fun update(text: String) {
        if(stopping)return
        message = text
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(7308,notification(text))
        prefs.edit().putString("status",text).apply()
    }
    override fun onCreate() {
        super.onCreate()
        locations = getSystemService(LOCATION_SERVICE) as LocationManager
        if (Build.VERSION.SDK_INT>=26) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel("driver-route","Геолокация активного рейса",NotificationManager.IMPORTANCE_LOW))
        startForeground(7308,notification(message))
        worker.scheduleWithFixedDelay({ try { flush() } catch (_:Exception) { if(!stopping)update("Нет связи · точки сохраняются на телефоне") } }, 5,30,TimeUnit.SECONDS)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if(intent?.action=="finish"){try{locations.removeUpdates(this)}catch(_:Exception){};worker.execute {try{flush()}catch(_:Exception){if(!stopping)update("Сохранённый маршрут ожидает отправки")}};return START_NOT_STICKY}
        if(intent?.action=="stop") { stopTracking(); return START_NOT_STICKY }
        try {
            synchronized(lock) {
                val incoming=intent?.getStringExtra("config")
                val c=if(incoming!=null)JSONObject(incoming) else config?:read("config")?.let { JSONObject(it) }
                if(c==null){stopSelf();return START_NOT_STICKY}
                if(config==null||incoming!=null){config=c;queue=JSONArray(read(queueKey(c))?:"[]");save("config",c.toString())}
            }
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){update("Разрешите точную геолокацию в приложении");stopTracking();return START_NOT_STICKY}
            for(provider in listOf(LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER))if(locations.isProviderEnabled(provider))locations.requestLocationUpdates(provider,30_000L,0f,this,Looper.getMainLooper())
            prefs.edit().putBoolean("running",true).apply()
            return START_STICKY
        } catch(_:Exception){update("Не удалось включить GPS. Откройте приложение");stopTracking();return START_NOT_STICKY}
    }
    override fun onLocationChanged(location: Location) {
        if(stopping)return
        if(location.accuracy>50f||!location.hasAccuracy()){update("Ожидаем GPS с точностью до 50 м");return}
        val age=(SystemClock.elapsedRealtimeNanos()-location.elapsedRealtimeNanos)/1_000_000
        if(age<0||age>60_000)return
        if(Build.VERSION.SDK_INT>=31 && location.isMock){update("Обнаружена подмена GPS. Отключите фиктивное местоположение");return}
        if(SystemClock.elapsedRealtime()-lastSample<25_000)return
        lastSample=SystemClock.elapsedRealtime()
        synchronized(lock){
            val c=config?:return
            if(queue.length()>=10000){update("Очередь GPS заполнена. Подключите интернет");locations.removeUpdates(this);return}
            val date=java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.US).apply { timeZone=java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(location.time))
            queue.put(JSONObject().put("id",UUID.randomUUID().toString()).put("recordedAt",date).put("latitude",location.latitude).put("longitude",location.longitude).put("accuracy",location.accuracy.toDouble()))
            save(queueKey(c),queue.toString())
        }
    }
    private fun request(c: JSONObject, path: String, body: JSONObject? = null, auth: Boolean = true): Pair<Int, JSONObject> {
        val connection=(URL(c.getString("apiUrl").trimEnd('/')+path).openConnection() as HttpURLConnection)
        connection.connectTimeout=15000;connection.readTimeout=20000
        connection.setRequestProperty("Accept","application/json")
        if(auth)connection.setRequestProperty("Authorization","Bearer "+c.getString("accessToken"))
        if(body!=null){connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }}
        return try { val code=connection.responseCode;val text=(if(code<400)connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }?:"{}";code to JSONObject(text) } finally { connection.disconnect() }
    }
    private fun authenticated(c: JSONObject, path: String, body: JSONObject?=null): Pair<Int,JSONObject> {
        var r=request(c,path,body)
        if(r.first==401){val refreshed=request(c,"/auth/refresh",JSONObject().put("refreshToken",c.getString("refreshToken")),false)
            if(refreshed.first !in 200..299){update("Сессия завершена. Войдите в приложение");stopTracking();return r}
            c.put("accessToken",refreshed.second.getString("accessToken")).put("refreshToken",refreshed.second.getString("refreshToken"))
            synchronized(lock){if(config!==c||stopping)return r;save("config",c.toString())}
            r=request(c,path,body)
        }
        if(r.first==401||r.first==403){update("Нет доступа. Откройте приложение и войдите заново");stopTracking()}
        return r
    }
    private fun flush() {
        val c=synchronized(lock){if(stopping)return;config?:return}
        val trip=c.getString("tripId")
        val state=authenticated(c,"/tracking/trips/$trip/state")
        if(state.first !in 200..299){if(state.first==404)stopTracking();return}
        val active=state.second.optString("status")=="IN_TRANSIT"
        if(!active){
            Handler(Looper.getMainLooper()).post { locations.removeUpdates(this) }
            val closed=state.second.optString("arrivedAt").takeUnless { it.isBlank() || it=="null" }?:state.second.optString("acceptedAt")
            if(!closed.isBlank() && closed!="null") synchronized(lock){
                val parser=java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.US).apply {timeZone=java.util.TimeZone.getTimeZone("UTC")}
                val cutoff=parser.parse(closed)!!.time
                val allowed=JSONArray();for(i in 0 until queue.length()){val p=queue.getJSONObject(i);if(parser.parse(p.getString("recordedAt"))!!.time<=cutoff)allowed.put(p)}
                queue=allowed;save(queueKey(c),queue.toString())
            }
        }
        while(!stopping){
            val batch=synchronized(lock){JSONArray().also{out->for(i in 0 until minOf(100,queue.length()))out.put(queue.getJSONObject(i))}}
            if(batch.length()==0)break
            val result=authenticated(c,"/tracking/trips/$trip/points",JSONObject().put("points",batch))
            if(result.first !in 200..299){update(if(result.first==409)"Рейс закрыт. Откройте приложение для сверки GPS" else "GPS ожидает отправки. Проверьте соединение");return}
            synchronized(lock){if(config!==c)return;val rest=JSONArray();for(i in batch.length() until queue.length())rest.put(queue.getJSONObject(i));queue=rest;save(queueKey(c),queue.toString())}
        }
        if(!active){stopTracking();return}
        if(lastSample==0L||SystemClock.elapsedRealtime()-lastSample>120000)update("Нет свежей геолокации. Включите GPS и проверьте разрешения") else update("Маршрут передаётся · ожидающих точек: "+synchronized(lock){queue.length()})
    }
    private fun stopTracking(){
        synchronized(lock){if(stopping)return;stopping=true;prefs.edit().remove("config").putBoolean("running",false).apply()}
        Handler(Looper.getMainLooper()).post{try{locations.removeUpdates(this)}catch(_:Exception){};stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}
    }
    override fun onDestroy(){stopping=true;try{locations.removeUpdates(this)}catch(_:Exception){};worker.shutdownNow();prefs.edit().putBoolean("running",false).apply();super.onDestroy()}
    override fun onBind(intent:Intent?):IBinder?=null
}
