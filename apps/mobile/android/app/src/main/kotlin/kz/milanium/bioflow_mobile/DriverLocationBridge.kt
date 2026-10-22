package kz.milanium.bioflow_mobile
import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject
class DriverLocationBridge(private val activity:Activity, messenger:BinaryMessenger) {
    private var permission:MethodChannel.Result?=null
    init { MethodChannel(messenger,"collection/driver-location").setMethodCallHandler { call,result ->
        try { when(call.method){
            "permission" -> {
                if(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)result.success(true)
                else if(permission!=null)result.error("busy","Разрешение уже запрошено",null)
                else {permission=result;val names=mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION);if(Build.VERSION.SDK_INT>=33)names.add(Manifest.permission.POST_NOTIFICATIONS);activity.requestPermissions(names.toTypedArray(),7310)}
            }
            "start" -> {
                require(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)
                val text=call.argument<String>("config")?:throw IllegalArgumentException()
                val config=JSONObject(text);require(config.getString("tripId").matches(Regex("[A-Za-z0-9_-]{1,100}")))
                val uri=android.net.Uri.parse(config.getString("apiUrl"));require(uri.scheme in setOf("https","http") && !uri.host.isNullOrBlank() && uri.userInfo==null)
                val prefs=activity.getSharedPreferences("collection-driver",Context.MODE_PRIVATE)
                if(prefs.getBoolean("running",false)&&prefs.getString("activeTrip",null)!=config.getString("tripId"))throw IllegalStateException("Другой рейс уже отслеживается")
                prefs.edit().putString("activeTrip",config.getString("tripId")).apply()
                val intent=Intent(activity,DriverLocationService::class.java).putExtra("config",text)
                if(Build.VERSION.SDK_INT>=26)activity.startForegroundService(intent) else activity.startService(intent)
                result.success(null)
            }
            "finish" -> {if(activity.getSharedPreferences("collection-driver",Context.MODE_PRIVATE).getBoolean("running",false))activity.startService(Intent(activity,DriverLocationService::class.java).setAction("finish"));result.success(null)}
            "stop" -> {activity.stopService(Intent(activity,DriverLocationService::class.java));activity.getSharedPreferences("collection-driver",Context.MODE_PRIVATE).edit().remove("config").putBoolean("running",false).apply();result.success(null)}
            "status" -> {val p=activity.getSharedPreferences("collection-driver",Context.MODE_PRIVATE);result.success(mapOf("running" to p.getBoolean("running",false),"tripId" to p.getString("activeTrip",null),"message" to p.getString("status","Геолокация не включена")))}
            else -> result.notImplemented()
        }}catch(_:Exception){result.error("driver_location","Не удалось включить геолокацию. Проверьте разрешение точного местоположения и активный рейс.",null)}
    }}
    fun onRequestPermissionsResult(code:Int):Boolean {if(code!=7310)return false;val result=permission;permission=null;result?.success(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED);return true}
}
