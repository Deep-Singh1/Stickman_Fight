// src/game/NetGameCanvas.jsx
import React, { useEffect, useRef } from "react";

export default function NetGameCanvas({ game, pingMs, slot }) {
  const canvasRef = useRef(null);

  // keep last snapshot + last update time for interpolation
  const prevStateRef = useRef(null);
  const lastUpdateRef = useRef(performance.now());

  // store latest props in refs so the RAF loop always uses fresh data
  const latestGameRef = useRef(game);
  const latestPingRef = useRef(pingMs);
  const latestSlotRef = useRef(slot);

  // update refs whenever props change
  useEffect(() => {
    // shift current -> prev BEFORE replacing latest
    prevStateRef.current = latestGameRef.current;
    latestGameRef.current = game;
    lastUpdateRef.current = performance.now();
  }, [game]);

  useEffect(() => {
    latestPingRef.current = pingMs;
  }, [pingMs]);

  useEffect(() => {
    latestSlotRef.current = slot;
  }, [slot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function drawWorld() {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const gy = Math.floor(canvas.height * 0.8);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(canvas.width, gy);
      ctx.stroke();
      return gy;
    }

    function drawStick(px, py, facing, action, name) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      const headR = 15,
        bodyLen = 40,
        armLen = 30,
        legLen = 35;
      const shoulderY = py - bodyLen + 10;

      // head
      ctx.beginPath();
      ctx.arc(px, py - bodyLen - headR, headR, 0, Math.PI * 2);
      ctx.stroke();

      // body
      ctx.beginPath();
      ctx.moveTo(px, py - bodyLen);
      ctx.lineTo(px, py);
      ctx.stroke();

      // arms
      let attackAngle = -1.2;
      if (action === "light" || action === "heavy")
        attackAngle = facing === 1 ? -0.2 : -2.94;
      const otherArmAngle = -2.0;

      ctx.beginPath();
      ctx.moveTo(px, shoulderY);
      ctx.lineTo(
        px + Math.cos(attackAngle) * armLen,
        shoulderY + Math.sin(attackAngle) * armLen
      );
      ctx.moveTo(px, shoulderY);
      ctx.lineTo(
        px + Math.cos(otherArmAngle) * armLen,
        shoulderY + Math.sin(otherArmAngle) * armLen
      );
      ctx.stroke();

      // legs
      const legSpread = action === "block" ? 10 : 8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - legSpread, py + legLen);
      ctx.moveTo(px, py);
      ctx.lineTo(px + legSpread, py + legLen);
      ctx.stroke();

      // fist dot
      if (action === "light" || action === "heavy") {
        ctx.fillStyle = "#fff";
        const fx = px + Math.cos(attackAngle) * armLen;
        const fy = shoulderY + Math.sin(attackAngle) * armLen;
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // block shield
      if (action === "block") {
        ctx.strokeStyle = "#0ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sx = px + (facing === 1 ? 18 : -18);
        const sy = shoulderY;
        ctx.arc(sx, sy, 12, -Math.PI / 3, Math.PI / 3);
        ctx.stroke();
      }

      // name tag
      if (name) {
        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        const w = ctx.measureText(name).width;
        ctx.fillText(name, px - w / 2, py - bodyLen - headR - 10);
      }
    }

    function drawHP(x, y, label, hp) {
      const barW = 240,
        barH = 16;
      ctx.fillStyle = "#fff";
      ctx.font = "16px Arial";
      ctx.fillText(label, x, y);
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(x, y + 10, barW, barH);

      ctx.fillStyle = "#0f0";
      const pct = Math.max(0, Math.min(1, (hp ?? 100) / 100));
      ctx.fillRect(x, y + 10, barW * pct, barH);
    }

    let rafId;

    const loop = () => {
      rafId = requestAnimationFrame(loop);

      const currentGame = latestGameRef.current;
      const prevGame = prevStateRef.current;
      const currentSlot = latestSlotRef.current;
      const currentPing = latestPingRef.current;

      const gy = drawWorld();
      const cx = canvas.width / 2;

      const players = currentGame?.players || [];

      // ✅ FIX: map "me" vs "enemy" based on slot
      const myIndex = currentSlot === 2 ? 1 : 0; // default slot 1
      const enemyIndex = currentSlot === 2 ? 0 : 1;

      const me = players[myIndex];
      const enemy = players[enemyIndex];

      // ✅ HP bars (correct in both windows)
      if (me) drawHP(40, 40, "Player HP", me.hp);
      if (enemy) {
        const barW = 240;
        drawHP(canvas.width - 40 - barW, 40, "Enemy HP", enemy.hp);
      }

      // === Interpolated drawing ===
      const now = performance.now();
      const dt = Math.min((now - lastUpdateRef.current) / 50, 1);

      if (prevGame?.players && players.length === prevGame.players.length) {
        for (let i = 0; i < players.length; i++) {
          const oldP = prevGame.players[i];
          const newP = players[i];

          const ix = oldP.x + (newP.x - oldP.x) * dt;
          const iy = oldP.y + (newP.y - oldP.y) * dt;

          const px = cx + ix;
          const py = gy + iy;
          drawStick(px, py, newP.facing, newP.action, newP.name);
        }
      } else {
        for (const p of players) {
          const px = cx + p.x;
          const py = gy + p.y;
          drawStick(px, py, p.facing, p.action, p.name);
        }
      }

      // Timer from server
      const seconds = Math.max(0, currentGame?.timer ?? 0);
      ctx.fillStyle = "#fff";
      ctx.font = "20px Arial";
      const timerText = `Time: ${seconds.toString().padStart(2, "0")}`;
      const tw = ctx.measureText(timerText).width;
      ctx.fillText(timerText, canvas.width / 2 - tw / 2, 40);

      // Ping HUD
      ctx.fillStyle = "#fff";
      ctx.font = "14px Arial";
      const ptxt = `Ping: ${currentPing == null ? "..." : currentPing + " ms"}`;
      ctx.fillText(ptxt, 12, 20);

      // ✅ KO overlay: show Win/Lose based on ME vs ENEMY
      const koFlag =
        currentGame?.ko || (me?.hp != null && me.hp <= 0) || (enemy?.hp != null && enemy.hp <= 0);

      if (koFlag) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#fff";
        ctx.font = "48px Arial";

        let msg;
        if (currentGame?.koReason === "timeout") {
          msg = "Time Up!";
        } else if (me?.hp != null && me.hp <= 0) {
          msg = "You Lose";
        } else if (enemy?.hp != null && enemy.hp <= 0) {
          msg = "You Win!";
        } else {
          msg = "KO!";
        }

        const w = ctx.measureText(msg).width;
        ctx.fillText(msg, canvas.width / 2 - w / 2, canvas.height / 2 - 10);

        ctx.font = "20px Arial";
        const sub = "Next round in 3 seconds...";
        const w2 = ctx.measureText(sub).width;
        ctx.fillText(sub, canvas.width / 2 - w2 / 2, canvas.height / 2 + 30);
      }
    };

    // start rendering
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []); // ✅ run once; we use refs to get latest game/slot/ping

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100vw",
        height: "100vh",
        background: "#111",
      }}
    />
  );
}
