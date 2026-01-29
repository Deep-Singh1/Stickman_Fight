// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import NetGameCanvas from "./game/NetGameCanvas";

export default function App() {
  // connection + game state
  const wsRef = useRef(null);
  const [room, setRoom] = useState("");
  const [name, setName] = useState("Player");
  const [joined, setJoined] = useState(false);
  const [game, setGame] = useState({ players: [] });
  const [slot, setSlot] = useState(null);


  // ping (latency) in ms
  const [pingMs, setPingMs] = useState(null);

  // input we send to the server
  const pressedRef = useRef({
    left: false,
    right: false,
    up: false,
    light: false,
    heavy: false,
    block: false,
  });

  // ---- WebSocket + ping/pong ----
  useEffect(() => {
    const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";
    const ws = new WebSocket(WS_URL);

    wsRef.current = ws;

    ws.onopen = () => console.log("[WS] open");

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === "hello") {
          // ignore
        } else if (msg.type === "joined") {
          console.log("Joined room:", msg.room, "slot:", msg.slot);
          setJoined(true);
          setSlot(msg.slot);
        } else if (msg.type === "state") {
          setGame({
            players: msg.players || [],
            ko: !!msg.ko,
            koReason: msg.koReason || "",
            timer: typeof msg.timer === "number" ? msg.timer : 0,
          });
        } else if (msg.type === "pong" && typeof msg.ts === "number") {
          // round-trip time (ms)
          setPingMs(Date.now() - msg.ts);
        } else if (msg.type === "error") {
          alert("Server error: " + msg.reason);
        }
      } catch (err) {
        console.error("Bad JSON:", e.data);
      }
    };

    ws.onerror = (e) => console.error("[WS] error", e);
    ws.onclose = () => console.log("[WS] closed");

    // send ping every 2 seconds
    const pingIv = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const ts = Date.now();
        ws.send(JSON.stringify({ type: "ping", ts }));
      }
    }, 2000);

    return () => {
      clearInterval(pingIv);
      ws.close();
    };
  }, []);

  // helper to send any message
  function send(obj) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function onJoin(e) {
    e.preventDefault();
    if (!room.trim()) {
      alert("Enter a room name");
      return;
    }
    send({ type: "join", room: room.trim(), name: name.trim() || "Player" });
  }

  // ---- Key handling + input sending (20 Hz) ----
  useEffect(() => {
    function onKeyDown(e) {
      const k = e.key;
      const p = pressedRef.current;
      let changed = false;
      if (k === "ArrowLeft" && !p.left) { p.left = true; changed = true; }
      if (k === "ArrowRight" && !p.right) { p.right = true; changed = true; }
      if (k === "ArrowUp" && !p.up) { p.up = true; changed = true; }
      if (k === "z" && !p.light) { p.light = true; changed = true; }
      if (k === "x" && !p.heavy) { p.heavy = true; changed = true; }
      if (k === "c" && !p.block) { p.block = true; changed = true; }
      if (changed) e.preventDefault();
    }
    function onKeyUp(e) {
      const k = e.key;
      const p = pressedRef.current;
      let changed = false;
      if (k === "ArrowLeft" && p.left) { p.left = false; changed = true; }
      if (k === "ArrowRight" && p.right) { p.right = false; changed = true; }
      if (k === "ArrowUp" && p.up) { p.up = false; changed = true; }
      if (k === "z" && p.light) { p.light = false; changed = true; }
      if (k === "x" && p.heavy) { p.heavy = false; changed = true; }
      if (k === "c" && p.block) { p.block = false; changed = true; }
      if (changed) e.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // send inputs to server every 50ms (20Hz)
    const iv = setInterval(() => {
      if (!joined) return;
      send({ type: "input", pressed: pressedRef.current });
    }, 50);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      clearInterval(iv);
    };
  }, [joined]);

  // ---- UI ----
  return (
    <div style={{ margin: 0, padding: 0 }}>
      {!joined && (
        <form
          onSubmit={onJoin}
          style={{
            position: "fixed",
            top: 20,
            left: 20,
            background: "#222",
            color: "#fff",
            padding: 12,
            borderRadius: 8,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <label>Room:&nbsp;</label>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. test1"
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Name:&nbsp;</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player"
            />
          </div>
          <button type="submit">Join</button>
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
            Open this page in a 2nd browser window, join the same room to see both players.
          </div>
        </form>
      )}

      {joined && (
  <NetGameCanvas game={game} pingMs={pingMs} slot={slot} />
)}
    </div>
  );
}
