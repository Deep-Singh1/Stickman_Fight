package com.stickfight.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;

@Component
public class GameHandler extends TextWebSocketHandler {
    // ---- Physics/Arena constants ----
    private static final int TICK_MS = 50;         // 20 Hz
    private static final double GRAVITY = 0.8;
    private static final double JUMP_POWER = 17.0;
    private static final double FRICTION = 0.80;
    private static final double WALK_SPEED = 5.0;
    // Arena in server coordinates: center = 0; we clamp X within these bounds
    private static final int ARENA_HALF_WIDTH = 600;  // ~ screen width/2 on client
    private static final int LEFT_BOUND = -ARENA_HALF_WIDTH + 50;
    private static final int RIGHT_BOUND = +ARENA_HALF_WIDTH - 50;




    // ----- JSON -----
    private final ObjectMapper om = new ObjectMapper();

    // ----- Rooms and Sessions -----
    // roomId -> Room
    private final ConcurrentMap<String, Room> rooms = new ConcurrentHashMap<>();
    // sessionId -> roomId
    private final ConcurrentMap<String, String> sessionToRoom = new ConcurrentHashMap<>();

    // ----- Server Tick -----
    // One scheduler for all rooms. Each tick we update & broadcast every room.
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    public GameHandler() {
        // 20 Hz tick (~50ms)
        scheduler.scheduleAtFixedRate(this::tickAllRooms, 50, 50, TimeUnit.MILLISECONDS);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        // Say hello
        ObjectNode hello = om.createObjectNode();
        hello.put("type", "hello");
        hello.put("ts", Instant.now().toString());
        session.sendMessage(new TextMessage(hello.toString()));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode msg = om.readTree(message.getPayload());
        String type = msg.path("type").asText("");

        switch (type) {
            case "join" -> handleJoin(session, msg);
            case "input" -> handleInput(session, msg);
            case "leave" -> handleLeave(session);
            case "ping" -> handlePing(session, msg);

            default -> {
                ObjectNode err = om.createObjectNode();
                err.put("type", "error");
                err.put("reason", "unknown_type");
                session.sendMessage(new TextMessage(err.toString()));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        handleLeave(session);
    }

    private void handleJoin(WebSocketSession session, JsonNode msg) throws IOException {
        String roomId = msg.path("room").asText("").trim();
        String name = msg.path("name").asText("Player");

        if (roomId.isEmpty()) {
            ObjectNode err = om.createObjectNode();
            err.put("type", "error");
            err.put("reason", "room_required");
            session.sendMessage(new TextMessage(err.toString()));
            return;
        }

        Room room = rooms.computeIfAbsent(roomId, rid -> new Room(rid));
        boolean joined = room.addPlayer(session, name);
        if (!joined) {
            ObjectNode full = om.createObjectNode();
            full.put("type", "error");
            full.put("reason", "room_full");
            session.sendMessage(new TextMessage(full.toString()));
            return;
        }

        sessionToRoom.put(session.getId(), roomId);

        // reply joined with your slot (1 or 2)
        ObjectNode joinedMsg = om.createObjectNode();
        joinedMsg.put("type", "joined");
        joinedMsg.put("room", roomId);
        joinedMsg.put("slot", room.getSlotOf(session));
        session.sendMessage(new TextMessage(joinedMsg.toString()));

        // notify others
        room.broadcastExcept(session, json(j -> {
            j.put("type", "peer_joined");
            j.put("name", name);
            j.put("slot", room.getSlotOf(session));
        }));
    }

    private void handleInput(WebSocketSession session, JsonNode msg) {
        String roomId = sessionToRoom.get(session.getId());
        if (roomId == null) return;
        Room room = rooms.get(roomId);
        if (room == null) return;

        // payload: { pressed: {left,right,up,light,heavy,block} }
        JsonNode pressed = msg.path("pressed");
        room.updateInput(session, pressed);
    }
    private void handlePing(WebSocketSession session, JsonNode msg) throws IOException {
        // Echo back the same timestamp field "ts" the client sent
        ObjectNode pong = om.createObjectNode();
        pong.put("type", "pong");
        // pass through original client timestamp if present
        if (msg.has("ts")) pong.put("ts", msg.get("ts").asLong());
        // (optional) include server time too
        pong.put("serverTs", System.currentTimeMillis());
        session.sendMessage(new TextMessage(pong.toString()));
    }

    private void handleLeave(WebSocketSession session) {
        String roomId = sessionToRoom.remove(session.getId());
        if (roomId == null) return;
        Room room = rooms.get(roomId);
        if (room == null) return;

        int slot = room.removePlayer(session);
        if (slot != 0) {
            room.broadcast(json(j -> {
                j.put("type", "peer_left");
                j.put("slot", slot);
            }));
        }

        if (room.isEmpty()) {
            rooms.remove(roomId);
        }
    }

    private void tickAllRooms() {
        try {
            for (Room room : rooms.values()) {
                room.tickAndBroadcast(om);
            }
        } catch (Exception ignored) {
        }
    }

    // small helper for building JSON
    private String json(java.util.function.Consumer<ObjectNode> f) {
        ObjectNode n = om.createObjectNode();
        f.accept(n);
        return n.toString();
    }

    // -------------------------- Room class --------------------------
    private static class Room {
        // add in Room fields:
        boolean ko = false;
        int koTicks = 0;
        // count ticks since KO to auto-reset
        int roundTimerTicks = 90 * 20; // 90 seconds * 20 ticks (display-only, no logic yet)
        String koReason = ""; // "hp" or "timeout" ("" means no KO)


        final String id;
        // exactly two slots (1 and 2)
        volatile WebSocketSession p1;
        volatile WebSocketSession p2;

        // inputs and state
        final PlayerState s1 = new PlayerState(-120, 0, 1);
        final PlayerState s2 = new PlayerState(+120, 0, -1);

        // last pressed keys for each player (very simple booleans)
        final Pressed k1 = new Pressed();
        final Pressed k2 = new Pressed();

        Room(String id) { this.id = id; }

        synchronized boolean addPlayer(WebSocketSession s, String name) {
            try {
                if (p1 == null) { p1 = s; s1.name = name; return true; }
                if (p2 == null) { p2 = s; s2.name = name; return true; }
                return false;
            } finally { /* nothing */ }
        }

        synchronized int getSlotOf(WebSocketSession s) {
            if (s == null) return 0;
            if (p1 != null && p1.getId().equals(s.getId())) return 1;
            if (p2 != null && p2.getId().equals(s.getId())) return 2;
            return 0;
        }

        synchronized int removePlayer(WebSocketSession s) {
            int slot = getSlotOf(s);
            if (slot == 1) { p1 = null; resetState1(); }
            if (slot == 2) { p2 = null; resetState2(); }
            return slot;
        }

        synchronized boolean isEmpty() {
            return p1 == null && p2 == null;
        }

        synchronized void updateInput(WebSocketSession s, JsonNode pressed) {
            int slot = getSlotOf(s);
            if (slot == 1) k1.update(pressed);
            else if (slot == 2) k2.update(pressed);
        }

        synchronized void tickAndBroadcast(ObjectMapper om) {
            // If KO, wait ~3s (60 ticks) then reset round
            // ===== ROUND TIMER =====
            if (roundTimerTicks > 0) {
                roundTimerTicks--; // always tick down
            } else if (!ko) {
                // time's up → KO by timeout (draw)
                ko = true;
                koTicks = 0;
                koReason = "timeout";
            }

// ===== KO HANDLING =====
            if (ko) {
                koTicks++;
                if (koTicks >= 60) {
                    resetState1();
                    resetState2();
                    ko = false;
                    koTicks = 0;
                    roundTimerTicks = 90 * 20; // reset timer
                    koReason = "";
                }
                // still broadcast state so clients can draw overlay
                broadcastState(om);
                return;
            }


            // ===== 1) READ INPUT -> INTENT (movement, facing, start actions) =====
            boolean p1Locked = s1.action.equals("light") || s1.action.equals("heavy") || s1.action.equals("block");
            boolean p2Locked = s2.action.equals("light") || s2.action.equals("heavy") || s2.action.equals("block");

            // Player 1
            if (!p1Locked) {
                if (k1.left)  { s1.vx = -WALK_SPEED; s1.facing = -1; if (s1.onGround && !s1.action.equals("jump")) s1.action = "run"; }
                else if (k1.right) { s1.vx = WALK_SPEED; s1.facing = 1; if (s1.onGround && !s1.action.equals("jump")) s1.action = "run"; }
                else { s1.vx *= 0.8; if (s1.onGround && s1.action.equals("run")) s1.action = "idle"; }
            } else {
                s1.vx *= 0.9;
            }
            if (k1.up && s1.onGround && !p1Locked) {
                s1.vy = -JUMP_POWER; s1.onGround = false; s1.action = "jump";
            }
            if (k1.light && s1.onGround && s1.actionTimer == 0) { s1.action = "light"; s1.actionTimer = 10; s1.didHitThisAction = false; }
            if (k1.heavy && s1.onGround && s1.actionTimer == 0) { s1.action = "heavy"; s1.actionTimer = 18; s1.didHitThisAction = false; }
            if (k1.block && s1.onGround && !s1.action.equals("block")) { s1.action = "block"; s1.actionTimer = 14; }
            if (!k1.block && s1.action.equals("block")) { s1.actionTimer = 0; s1.action = (s1.onGround && (k1.left || k1.right)) ? "run" : "idle"; }

            // Player 2
            if (!p2Locked) {
                if (k2.left)  { s2.vx = -WALK_SPEED; s2.facing = -1; if (s2.onGround && !s2.action.equals("jump")) s2.action = "run"; }
                else if (k2.right) { s2.vx = WALK_SPEED; s2.facing = 1; if (s2.onGround && !s2.action.equals("jump")) s2.action = "run"; }
                else { s2.vx *= 0.8; if (s2.onGround && s2.action.equals("run")) s2.action = "idle"; }
            } else {
                s2.vx *= 0.9;
            }
            if (k2.up && s2.onGround && !p2Locked) {
                s2.vy = -JUMP_POWER; s2.onGround = false; s2.action = "jump";
            }
            if (k2.light && s2.onGround && s2.actionTimer == 0) { s2.action = "light"; s2.actionTimer = 10; s2.didHitThisAction = false; }
            if (k2.heavy && s2.onGround && s2.actionTimer == 0) { s2.action = "heavy"; s2.actionTimer = 18; s2.didHitThisAction = false; }
            if (k2.block && s2.onGround && !s2.action.equals("block")) { s2.action = "block"; s2.actionTimer = 14; }
            if (!k2.block && s2.action.equals("block")) { s2.actionTimer = 0; s2.action = (s2.onGround && (k2.left || k2.right)) ? "run" : "idle"; }

            // ===== 2) PHYSICS =====
            // gravity
            s1.vy += GRAVITY;
            s2.vy += GRAVITY;

            // apply velocity
            s1.x += s1.vx; s1.y += s1.vy;
            s2.x += s2.vx; s2.y += s2.vy;

            // ground collision (ground is y=0)
            if (s1.y > 0) { s1.y = 0; s1.vy = 0; s1.onGround = true; if (!(s1.action.equals("light")||s1.action.equals("heavy")||s1.action.equals("block")) && !(k1.left||k1.right)) s1.action = "idle"; }
            else { s1.onGround = false; }
            if (s2.y > 0) { s2.y = 0; s2.vy = 0; s2.onGround = true; if (!(s2.action.equals("light")||s2.action.equals("heavy")||s2.action.equals("block")) && !(k2.left||k2.right)) s2.action = "idle"; }
            else { s2.onGround = false; }

            // bounds
            if (s1.x < LEFT_BOUND) s1.x = LEFT_BOUND;
            if (s1.x > RIGHT_BOUND) s1.x = RIGHT_BOUND;
            if (s2.x < LEFT_BOUND) s2.x = LEFT_BOUND;
            if (s2.x > RIGHT_BOUND) s2.x = RIGHT_BOUND;

            // friction on ground
            if (s1.onGround) s1.vx *= FRICTION;
            if (s2.onGround) s2.vx *= FRICTION;

            // ===== 3) HIT DETECTION =====
            applyHitIfInRange(s1, s2); // P1 hits P2
            applyHitIfInRange(s2, s1); // P2 hits P1

            // ===== 4) ACTION TIMERS =====
            if (s1.actionTimer > 0) {
                s1.actionTimer--;
                if (s1.actionTimer == 0 && !"jump".equals(s1.action)) {
                    s1.action = (s1.onGround && (k1.left || k1.right)) ? "run" : "idle";
                }
            }
            if (s2.actionTimer > 0) {
                s2.actionTimer--;
                if (s2.actionTimer == 0 && !"jump".equals(s2.action)) {
                    s2.action = (s2.onGround && (k2.left || k2.right)) ? "run" : "idle";
                }
            }

            // ===== 5) KO CHECK =====
            if (s1.hp <= 0 || s2.hp <= 0) {
                ko = true;
                koTicks = 0;
                koReason = "hp";
            }

            // ===== 6) BROADCAST =====
            broadcastState(om);
        }


        synchronized void broadcast(String json) {
            sendSafe(p1, json);
            sendSafe(p2, json);
        }

        synchronized void broadcastExcept(WebSocketSession except, String json) {
            if (p1 != null && !p1.getId().equals(except.getId())) sendSafe(p1, json);
            if (p2 != null && !p2.getId().equals(except.getId())) sendSafe(p2, json);
        }

        private void sendSafe(WebSocketSession s, String json) {
            if (s == null || !s.isOpen()) return;
            try { s.sendMessage(new TextMessage(json)); } catch (IOException ignored) {}
        }

        private void resetState1() {
            s1.resetForNewRound(-120, 0, 1);
            k1.clear();
        }

        private void resetState2() {
            s2.resetForNewRound(+120, 0, -1);
            k2.clear();
        }

        synchronized void broadcastState(ObjectMapper om) {
            try {
                ObjectNode out = om.createObjectNode();
                out.put("timer", Math.max(0, roundTimerTicks / 20));  // seconds remaining
                if (ko) out.put("koReason", koReason);                // "hp" or "timeout"

                out.put("type", "state");
                out.put("room", id);
                out.put("ko", ko);

                ObjectNode p1n = om.createObjectNode();
                p1n.put("x", s1.x);
                p1n.put("y", s1.y);
                p1n.put("hp", s1.hp);
                p1n.put("facing", s1.facing);
                p1n.put("action", s1.action);
                p1n.put("name", s1.name);

                ObjectNode p2n = om.createObjectNode();
                p2n.put("x", s2.x);
                p2n.put("y", s2.y);
                p2n.put("hp", s2.hp);
                p2n.put("facing", s2.facing);
                p2n.put("action", s2.action);
                p2n.put("name", s2.name);

                out.set("players", om.createArrayNode().add(p1n).add(p2n));
                out.put("timer", Math.max(0, roundTimerTicks / 20)); // whole seconds remaining

                broadcast(out.toString());
            } catch (Exception ignored) {}
        }

    }

    // ---------------------- Simple State Classes ----------------------
    private static class PlayerState {
        // position (x relative to arena center, y=0 is ground)
        double x, y;
        // velocity
        double vx = 0, vy = 0;
        // state
        int hp = 100;
        int facing;                 // 1 or -1
        String action = "idle";     // idle | run | jump | light | heavy | block
        int actionTimer = 0;        // ticks remaining for current action
        boolean onGround = true;
        boolean didHitThisAction = false;
        String name = "Player";

        PlayerState(int x, int y, int facing) {
            this.x = x; this.y = y; this.facing = facing;
        }

        void resetForNewRound(int x, int y, int facing) {
            this.x = x; this.y = y;
            vx = vy = 0;
            hp = 100;
            this.facing = facing;
            action = "idle";
            actionTimer = 0;
            onGround = true;
            didHitThisAction = false;
        }
    }


    private static class Pressed {
        boolean left, right, up, light, heavy, block;
        void update(JsonNode p) {
            if (p.has("left")) left = p.get("left").asBoolean(false);
            if (p.has("right")) right = p.get("right").asBoolean(false);
            if (p.has("up")) up = p.get("up").asBoolean(false);
            if (p.has("light")) light = p.get("light").asBoolean(false);
            if (p.has("heavy")) heavy = p.get("heavy").asBoolean(false);
            if (p.has("block")) block = p.get("block").asBoolean(false);
        }
        void clear() { left=right=up=light=heavy=block=false; }
    }
    // Return {x,y} fist position in server coords for a player currently attacking
    private static double[] fistPos(PlayerState s) {
        // Stickman proportions used on client; we mirror them here.
        // We don't need head radius and such; only arm length & shoulder Y relative to hips.
        double bodyLen = 40.0;
        double armLen = 30.0;
        double shoulderY = s.y - bodyLen + 10.0; // s.y is 0 on ground; negative is up

        double attackAngle = -1.2;
        if ("light".equals(s.action) || "heavy".equals(s.action)) {
            attackAngle = (s.facing == 1) ? -0.2 : -2.94;
        }
        double fx = s.x + Math.cos(attackAngle) * armLen;
        double fy = shoulderY + Math.sin(attackAngle) * armLen;
        return new double[]{fx, fy};
    }

    private static void applyHitIfInRange(PlayerState attacker, PlayerState defender) {
        if (!("light".equals(attacker.action) || "heavy".equals(attacker.action))) return;
        if (attacker.didHitThisAction) return;

        double[] fist = fistPos(attacker);

        // Defender torso target roughly mid-body
        double bodyLen = 40.0;
        double tx = defender.x;
        double ty = defender.y - bodyLen / 2.0;

        double dx = fist[0] - tx;
        double dy = fist[1] - ty;
        double dist = Math.hypot(dx, dy);

        double reach = 20.0;
        if (dist <= reach) {
            int dmg = "light".equals(attacker.action) ? 8 : 18;

            // If defender is blocking and facing attacker, reduce damage
            boolean attackerOnRight = attacker.x > defender.x;
            boolean defenderFacingAttacker = attackerOnRight ? defender.facing == 1 : defender.facing == -1;
            if ("block".equals(defender.action) && defenderFacingAttacker) {
                dmg = (int)Math.round(dmg * 0.4); // 60% damage reduction
            }

            defender.hp = Math.max(0, defender.hp - dmg);

            // small knockback
            int dir = attackerOnRight ? 1 : -1;
            defender.vx += 2.0 * dir;
            if (defender.onGround) defender.vy = -3.0;

            attacker.didHitThisAction = true;
        }
    }

}

