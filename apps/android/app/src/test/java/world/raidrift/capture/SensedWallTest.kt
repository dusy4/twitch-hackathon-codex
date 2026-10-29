package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class SensedWallTest {
    private fun wall() = SensedWall(FootPosition(.3f, 0f, 0f), FootPosition(0f, 0f, 1f), FootPosition(0f, 1f, 0f), FootPosition(1f, 0f, 0f), listOf(PlanePoint(-.5f, 0f), PlanePoint(.5f, 0f), PlanePoint(.5f, 1f), PlanePoint(-.5f, 1f)))
    @Test fun finiteWallBlocksCrossingButAllowsTravelAroundAndAboveIt() {
        val wall = wall()
        assertTrue(wall.blocks(FootPosition(0f, 0f, 0f), FootPosition(.6f, 0f, 0f)))
        assertTrue(wall.blocks(FootPosition(.6f, 0f, 0f), FootPosition(0f, 0f, 0f)))
        assertFalse(wall.blocks(FootPosition(0f, 0f, 1f), FootPosition(.6f, 0f, 1f)))
        assertFalse(wall.blocks(FootPosition(0f, 1.1f, 0f), FootPosition(.6f, 1.1f, 0f)))
        assertFalse("Moving away from a wall is allowed", wall.blocks(FootPosition(.26f, 0f, 0f), FootPosition(.2f, 0f, 0f)))
    }
    @Test fun motorStopsBeforeWallAndResumesWhenObservationDisappears() {
        val motor = SurfaceMotor(); val wall = wall()
        val goal = FootPosition(.6f, 0f, 0f)
        motor.update("viewer", FootPosition(0f, 0f, 0f), 0f) { 0f }
        var foot: FootPosition? = null
        repeat(180) { foot = motor.updateWithWalls("viewer", goal, 1f / 60, { a, b -> wall.blocks(a, b) }) { 0f } }
        assertTrue(foot!!.x <= .251f)
        repeat(180) { foot = motor.update("viewer", goal, 1f / 60) { 0f } }
        assertEquals(.6f, foot!!.x, .001f)
    }
    @Test fun invalidPlaneBasisIsRejected() {
        assertThrows(IllegalArgumentException::class.java) { SensedWall(FootPosition(0f, 0f, 0f), FootPosition(0f, 0f, 0f), FootPosition(0f, 1f, 0f), FootPosition(1f, 0f, 0f), listOf(PlanePoint(0f, 0f), PlanePoint(1f, 0f), PlanePoint(1f, 1f))) }
    }
}
