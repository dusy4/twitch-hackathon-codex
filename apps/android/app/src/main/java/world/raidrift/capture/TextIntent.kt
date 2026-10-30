package world.raidrift.capture

/** Small offline intent compiler. Only complete supported instructions cause actions; ordinary
 * conversation stays chat. No model, network call, arbitrary code or other-player authority. */
object TextIntent {
    fun parse(input: String): List<String>? {
        if (!input.trim().startsWith("!") && input.trim().lowercase() in setOf("w", "a", "s", "d")) return null
        val text = input.trim().lowercase(java.util.Locale.ROOT)
            .replace(Regex("^!(rift|ourapp)\\s+"), "").removePrefix("!")
            .replace(Regex("[.!?,]+$"), "").trim()
        if (text.length > 300 || text.contains('@')) return null
        val clauses = text.split(Regex("\\s*(?:;|,?\\s+then\\s+|\\s+and then\\s+|\\s+потім\\s+|\\s+а потім\\s+|\\s+затем\\s+)\\s*"))
        if (clauses.size > 4) return null
        val result = clauses.map { raw ->
            val s = raw.replace(Regex("^(please|could you|can you|будь ласка|пожалуйста)\\s+"), "")
                .replace(Regex("\\s+(please|будь ласка|пожалуйста)$"), "").trim()
            when {
                s in setOf("join", "join in", "i want to join", "приєднатись", "приєднатися", "приєднайся") -> "join"
                s.matches(Regex("(?:(?:walk|go|move|step|head|run|sprint)\\s+)?(?:to the )?left")) || s.matches(Regex("(?:(?:йди|іди|піди|рухайся|біжи|иди)\\s+)?(?:ліворуч|наліво|вліво|налево)")) -> if (s.startsWith("run ") || s.startsWith("sprint ") || s.startsWith("біжи ")) "run left" else "left"
                s.matches(Regex("(?:(?:walk|go|move|step|head|run|sprint)\\s+)?(?:to the )?right")) || s.matches(Regex("(?:(?:йди|іди|піди|рухайся|біжи|иди)\\s+)?(?:праворуч|направо|вправо)")) -> if (s.startsWith("run ") || s.startsWith("sprint ") || s.startsWith("біжи ")) "run right" else "right"
                s in setOf("w", "up", "forward", "go forward", "walk forward", "move forward", "walk away", "go away", "відійди", "йди вперед", "іди вперед", "вперед") -> "forward"
                s in setOf("s", "down", "back", "backward", "go back", "walk back", "move back", "come closer", "come here", "walk towards me", "підійди ближче", "підійди сюди", "йди назад", "іди назад", "назад") -> "back"
                s == "a" -> "left"
                s == "d" -> "right"
                s in setOf("jump", "hop", "jump up", "do a jump", "стрибни", "підстрибни", "пригни", "прыгни") -> "jump"
                s in setOf("dance", "start dancing", "do a dance", "танцюй", "потанцюй", "танцуй") -> "dance"
                s in setOf("wave", "say hello", "wave hello", "wave at me", "помахай", "помахай рукою", "привітайся") -> "wave"
                s in setOf("sit", "sit down", "сядь", "сідай") -> "sit"
                s in setOf("stop", "stop moving", "stand", "stand up", "stay here", "стій", "зупинись", "зупинися", "встань", "стоп") -> "stop"
                s in setOf("turn left", "face left", "поверни ліворуч", "повернись ліворуч") -> "turn_left"
                s in setOf("turn right", "face right", "поверни праворуч", "повернись праворуч") -> "turn_right"
                s in setOf("turn around", "turn back", "повернись", "повернися", "розвернись", "розвернися") -> "turn_around"
                else -> return null
            }
        }
        return result.takeUnless { it.size > 1 && "join" in it }
    }
}
