package kz.milanium.bioflow_mobile

internal object DriverPointPolicy {
    enum class Recovery { RETRY, SPLIT, QUARANTINE }

    fun accepts(recordedAt: Long, startedAt: Long, expiresAt: Long, now: Long): Boolean =
        recordedAt >= startedAt - 60_000 && recordedAt > now - 120_000 &&
            recordedAt <= minOf(now + 60_000, expiresAt)

    fun recovery(status: Int, count: Int): Recovery = when {
        status != 400 -> Recovery.RETRY
        count > 1 -> Recovery.SPLIT
        else -> Recovery.QUARANTINE
    }
}
