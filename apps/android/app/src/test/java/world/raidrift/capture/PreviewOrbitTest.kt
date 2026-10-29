package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sqrt

class PreviewOrbitTest {
    @Test fun orbitMovesAroundTheCharacterWithoutChangingDistance() {
        val orbit = PreviewOrbit()
        val front = orbit.eye()
        orbit.drag(260f, 0f)
        val side = orbit.eye()
        assertTrue(side.x > 1.4f)
        assertTrue(kotlin.math.abs(side.z) < .05f)
        fun distance(p: FootPosition) = sqrt(p.x*p.x + (p.y-.15f)*(p.y-.15f) + p.z*p.z)
        assertEquals(distance(front), distance(side), .0001f)
    }
    @Test fun zoomAndElevationStayBoundedAndRejectInvalidInput() {
        val orbit = PreviewOrbit()
        repeat(10) { orbit.zoom(10f); orbit.drag(0f, 1000f) }
        assertEquals(.5f, orbit.radius, 0f)
        assertEquals(75f, orbit.pitch, 0f)
        val previous = orbit.eye()
        orbit.zoom(Float.NaN); orbit.drag(Float.POSITIVE_INFINITY, 1f)
        assertEquals(previous, orbit.eye())
        repeat(10) { orbit.zoom(.1f); orbit.drag(0f, -1000f) }
        assertEquals(5f, orbit.radius, 0f)
        assertEquals(-35f, orbit.pitch, 0f)
    }
}
