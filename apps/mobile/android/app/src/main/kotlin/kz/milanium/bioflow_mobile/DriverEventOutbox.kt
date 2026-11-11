package kz.milanium.bioflow_mobile

import android.content.ContentValues
import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

object DriverEventOutbox {
    private fun database(context: Context): android.database.sqlite.SQLiteDatabase {
        val db = DriverLocationService.database(context)
        db.execSQL("CREATE TABLE IF NOT EXISTS driver_events (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, payload TEXT NOT NULL)")
        db.execSQL("CREATE TABLE IF NOT EXISTS driver_stage (token TEXT PRIMARY KEY, stage TEXT NOT NULL)")
        return db
    }
    fun begin(context: Context, token: String, stage: String) {
        database(context).use { db ->
            val values = ContentValues().apply { put("token", token); put("stage", if(stage == "IN_TRANSIT") "DEPARTED" else stage) }
            db.insertWithOnConflict("driver_stage", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_IGNORE)
        }
    }
    fun stage(context: Context, token: String): String = database(context).use { db ->
        db.rawQuery("SELECT stage FROM driver_stage WHERE token = ?", arrayOf(token)).use { cursor -> if(cursor.moveToFirst()) cursor.getString(0) else "CREATED" }
    }
    fun enqueue(context: Context, token: String, type: String) {
        require(type in listOf("LOADED", "DEPARTED", "ARRIVED"))
        database(context).use { db ->
            db.beginTransaction()
            try {
                val current = db.rawQuery("SELECT stage FROM driver_stage WHERE token = ?", arrayOf(token)).use { cursor -> if(cursor.moveToFirst()) cursor.getString(0) else "CREATED" }
                val expected = mapOf("LOADED" to "CREATED", "DEPARTED" to "LOADED", "ARRIVED" to "DEPARTED")[type]
                check(current == expected) { "Сначала отметьте предыдущий этап рейса" }
                val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone=TimeZone.getTimeZone("UTC") }
                val payload=JSONObject().put("requestId", UUID.randomUUID().toString()).put("type", type).put("recordedAt", format.format(Date()))
                db.insertOrThrow("driver_events", null, ContentValues().apply { put("token", token); put("payload", payload.toString()) })
                db.insertWithOnConflict("driver_stage", null, ContentValues().apply { put("token", token); put("stage", type) }, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
        }
    }
    fun flush(context: Context, api: String, token: String): Boolean {
        val events=mutableListOf<Pair<Long,String>>()
        database(context).use { db ->
            db.query("driver_events", arrayOf("id","payload"), "token = ?", arrayOf(token), null,null,"id ASC").use { cursor -> while(cursor.moveToNext()) events.add(cursor.getLong(0) to cursor.getString(1)) }
        }
        for((id,payload) in events) {
            val code=DriverLocationService.post(api+"/events",token,payload)
            if(code !in 200..299) return false
            database(context).use { it.delete("driver_events","id = ?",arrayOf(id.toString())) }
        }
        return true
    }
    fun count(context: Context): Int = database(context).use { db -> db.rawQuery("SELECT COUNT(*) FROM driver_events",null).use { c -> c.moveToFirst();c.getInt(0) } }
}
