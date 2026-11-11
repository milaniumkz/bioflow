package kz.milanium.bioflow_mobile

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Finish uploading an offline trip even after the user has stopped GPS collection. */
class DriverUploadJob : JobService() {
    @Volatile private var cancelled = false
    override fun onStartJob(params: JobParameters): Boolean {
        cancelled = false
        Thread {
            var retry = false
            try {
                val sessions = mutableListOf<Pair<String, String>>()
                stopsDatabase(this).use { db ->
                    db.rawQuery("SELECT token, api FROM pending_stops", null).use { c ->
                        while (c.moveToNext()) sessions.add(c.getString(0) to c.getString(1))
                    }
                }
                for ((token, api) in sessions) {
                    var drained = false
                    for (batch in 1..100) {
                        if (cancelled) return@Thread
                        val ids = mutableListOf<Long>()
                        val points = JSONArray()
                        DriverLocationService.database(this).use { db ->
                            db.query("queue", arrayOf("id", "payload"), "token = ?", arrayOf(token), null, null, "id ASC", "100").use { c ->
                                while (c.moveToNext()) { ids.add(c.getLong(0)); points.put(JSONObject(c.getString(1))) }
                            }
                        }
                        if (ids.isEmpty()) { drained = true; break }
                        val code = DriverLocationService.post(api + "/driver-tracking/points", token, JSONObject().put("points", points).toString())
                        if (code in 200..299) {
                            DriverLocationService.database(this).use { it.delete("queue", "id IN (${ids.joinToString(",")})", null) }
                        } else {
                            // Keep unsent locations on disk, including rejected uploads, for recovery.
                            getSharedPreferences("driver", MODE_PRIVATE).edit().putString("error", "Не отправленные координаты сохранены на телефоне. Ответ сервера: $code").apply()
                            retry = true
                            break
                        }
                    }
                    if (drained) {
                        val code = DriverLocationService.post(api + "/driver-tracking/stop", token, "{}")
                        if (code in 200..299 || code == 401) stopsDatabase(this).use { it.delete("pending_stops", "token = ?", arrayOf(token)) }
                        else retry = true
                    } else retry = true
                }
            } catch (_: Exception) { retry = true }
            if (!cancelled) jobFinished(params, retry)
        }.start()
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { cancelled = true; return true }
    companion object {
        private fun stopsDatabase(context: Context): android.database.sqlite.SQLiteDatabase {
            val db = DriverLocationService.database(context)
            db.execSQL("CREATE TABLE IF NOT EXISTS pending_stops (token TEXT PRIMARY KEY, api TEXT NOT NULL)")
            return db
        }
        fun enqueueStop(context: Context, api: String, token: String) {
            if (token.isEmpty()) return
            stopsDatabase(context).use { db ->
                val values = ContentValues().apply { put("token", token); put("api", api) }
                db.insertWithOnConflict("pending_stops", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
            }
            val job = JobInfo.Builder(7411, ComponentName(context, DriverUploadJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1000)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build()
            (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).schedule(job)
        }
    }
}
