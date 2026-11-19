package kz.milanium.bioflow_mobile

import org.junit.Assert.*
import org.junit.Test

class DriverPointPolicyTest {
    @Test fun cachedCoordinatesRespectTheSessionWindow() {
        val now = 1_000_000L
        val started = now - 10_000
        val expires = now + 3_600_000
        assertTrue(DriverPointPolicy.accepts(now, started, expires, now))
        assertTrue(DriverPointPolicy.accepts(now - 70_000, started, expires, now))
        assertFalse(DriverPointPolicy.accepts(now - 70_001, started, expires, now))
        assertFalse(DriverPointPolicy.accepts(now - 120_001, now - 1_000_000, expires, now))
        assertTrue(DriverPointPolicy.accepts(now + 60_000, started, expires, now))
        assertFalse(DriverPointPolicy.accepts(now + 60_001, started, expires, now))
        assertTrue(DriverPointPolicy.accepts(now, started, now, now))
        assertFalse(DriverPointPolicy.accepts(now + 1, started, now, now))
    }

    @Test fun aRejectedBatchIsSplitBeforeAnyPointIsQuarantined() {
        assertEquals(DriverPointPolicy.Recovery.SPLIT, DriverPointPolicy.recovery(400, 100))
        assertEquals(DriverPointPolicy.Recovery.QUARANTINE, DriverPointPolicy.recovery(400, 1))
        for (code in listOf(0, 200, 401, 403, 409, 429, 500, 503)) {
            assertEquals(DriverPointPolicy.Recovery.RETRY, DriverPointPolicy.recovery(code, 1))
        }
    }
}
