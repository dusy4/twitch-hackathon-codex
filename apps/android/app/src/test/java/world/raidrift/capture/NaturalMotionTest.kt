package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class NaturalMotionTest {
    @Test fun ordinaryMessagesCompileWithoutPunctuationOrChatFalsePositives() {
        for ((text, expected) in listOf("please walk right" to "right", "йди ліворуч" to "left", "підійди ближче" to "back", "стрибни!" to "jump", "повернись" to "turn_around", "!jump" to "jump"))
            assertEquals(text, listOf(expected), TextIntent.parse(text))
        for (text in listOf("W", "join then dance", "great stream!", "I jump into games", "my dog can dance", "make @Bob jump", "everyone jump", "walk right then delete files", "jump then jump then jump then jump then jump")) assertNull(text, TextIntent.parse(text))
        assertEquals(listOf("right", "jump"), TextIntent.parse("walk right then jump"))
    }
    @Test fun promptQueueIsPerViewerInterruptibleAndPausesWithTracking() {
        val room = LocalPlayground(); room.viewers.forEach { room.send(it.id,"join",null,emptyList(),0) }
        val bob = room.world.heroes.first { it.name == "Bob" }
        assertTrue(room.send("stub-alice","walk left then jump",null,emptyList(),0).ok)
        assertEquals("walk",room.world.heroes.first { it.name == "Alice" }.animation)
        for (at in 0L..1000L step 100) room.tick(at)
        room.tick(50000,false)
        assertEquals("walk",room.world.heroes.first { it.name == "Alice" }.animation)
        for (at in 50100L..50700L step 100) room.tick(at)
        assertEquals("jump",room.world.heroes.first { it.name == "Alice" }.animation)
        assertEquals(bob,room.world.heroes.first { it.name == "Bob" })
        room.send("stub-alice","walk right then jump",null,emptyList(),51000)
        room.send("stub-alice","stop",null,emptyList(),51100)
        for(at in 51200L..53500L step 100) room.tick(at)
        assertEquals("stop",room.world.heroes.first { it.name == "Alice" }.animation)
    }
    @Test fun actualTravelHasIntermediatePositionsAndKeepsMeasuredSupport() {
        for (hz in listOf(30,60,120)) {
            val motor=SurfaceMotor(); motor.place("a",FootPosition(0f,0f,0f))
            val points=(0 until hz).map { motor.updateWithWalls("a",FootPosition(1f,0f,0f),1f/hz,{_,_->false},MotionState.WALK_SPEED){0f}!! }
            assertTrue(points.first().x < .01f)
            assertEquals(MotionState.WALK_SPEED,points.last().x,.002f)
            assertTrue(points.zipWithNext().all { (a,b) -> b.x>a.x && b.x-a.x < .01f })
            val last=points.last()
            assertEquals(last,motor.updateWithWalls("a",FootPosition(1f,0f,0f),.03f,{_,_->false},MotionState.WALK_SPEED){null})
        }
    }
    @Test fun jumpTakesOffOnceLandsAndCanBeRepeatedWithoutLooping() {
        for (hz in listOf(30,60,120)) {
            val motion=MotionState()
            val samples=(0..(hz*2)).map { motion.sample("a","jump",1,null,1f/hz) }
            assertEquals(0f,samples.first().lift,0f)
            assertTrue(samples.maxOf { it.lift } > .12f)
            assertTrue(samples.last().lift == 0f && !samples.last().jumping)
            assertTrue(samples.all { it.lift in 0f..0.131f })
            assertTrue(motion.sample("a","jump",2,null,.01f).jumping)
        }
    }
    @Test fun repeatedAirborneJumpCannotTeleportBackToGroundAndManyTurnsStayBounded() {
        val motion=MotionState()
        repeat(16) { motion.sample("a","jump",1,null,1f/30f) }
        val airborne=motion.sample("a","jump",1,null,1f/30f)
        val repeated=motion.sample("a","jump",2,null,1f/30f)
        assertTrue(airborne.lift > .1f && repeated.lift > .1f)
        repeat(12) { turn -> repeat(30) { motion.sample("a","turn_right",(3+turn).toLong(),null,1f/30f) } }
        val at=motion.sample("a","idle",20,null,.03f)
        assertTrue(at.yaw in -180f..180f)
        val next=motion.sample("a","walk",21,10f,.03f)
        val delta=(((next.yaw-at.yaw)%360f+540f)%360f)-180f
        assertTrue(kotlin.math.abs(delta) <= 16.3f)
    }
    @Test fun turnIsSmoothRelativeToLastWalkingHeadingAndNotReissuedEveryFrame() {
        val motion=MotionState()
        repeat(30) { motion.sample("a","walk",1,90f,1f/30f) }
        val first=motion.sample("a","turn_around",2,null,1f/30f)
        assertTrue(abs(first.yaw-90f) < 20f)
        var last=first
        repeat(60) { last=motion.sample("a","turn_around",2,null,1f/30f) }
        assertEquals(-90f,last.yaw,.01f)
        assertEquals(last.yaw,motion.sample("a","idle",2,null,.03f).yaw,.01f)
    }
}
