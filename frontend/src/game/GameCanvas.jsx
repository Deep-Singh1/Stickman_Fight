// src/game/GameCanvas.jsx
import React, { useEffect, useRef } from "react"; // import React and two hooks

export default function GameCanvas() {           // our canvas component
  const canvasRef = useRef(null);                // a "ref" to directly access the <canvas> element

  useEffect(() => {    
    
    // runs once after the component appears on screen
    const canvas = canvasRef.current;            // get the actual <canvas> DOM node
    const ctx = canvas.getContext("2d");  

     // --- WORLD ---
let groundY = 0;                  // we'll calculate after sizing
const gravity = 0.8;              // pull down
const friction = 0.8;             // slow horizontal on ground
const speed = 5;                  // walk speed
const jumpPower = 17;             // how strong the jump is
let gameOver = false;


// --- PLAYER STATE ---
const player = {
   x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  onGround: true,
  facing: 1,         // 1 = right, -1 = left (we’ll flip when moving)
  action: "idle",    // idle | run | jump | light | heavy | block
  actionTimer: 0,    // frames remaining for current action
  hp: 100
};
const enemy = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  onGround: true,
  facing: -1,        // starts facing left (towards you)
  action: "idle",
  actionTimer: 0,
  hp: 100,
  ai: true           // we’ll keep AI super simple for now
};

// --- INPUT KEYS ---
const keys = {
  ArrowLeft: false,
  ArrowRight: false,
  ArrowUp: false,
  z: false,
  x: false,
  c: false,
  r: false
};

    // --- helper: draw a simple stickman at (px, py) ---
// px, py = hip position (where the legs start)
function drawStickman(px, py, state) {
  const facing = state.facing;
  const action = state.action;

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;

  // proportions
  const headR = 15;
  const bodyLen = 40;
  const armLen = 30;
  const legLen = 35;
  const shoulderY = py - bodyLen + 10;

  // head
  ctx.beginPath();
  ctx.arc(px, (py - bodyLen) - headR, headR, 0, Math.PI * 2);
  ctx.stroke();

  // body
  ctx.beginPath();
  ctx.moveTo(px, py - bodyLen);
  ctx.lineTo(px, py);
  ctx.stroke();

  // arms (attack pose changes angle)
  let attackAngle;
  if (action === "light" || action === "heavy") {
    attackAngle = facing === 1 ? -0.2 : -2.94; // punch direction
  } else {
    attackAngle = -1.2; // neutral
  }
  const otherArmAngle = -2.0;

  // arms
  ctx.beginPath();
  ctx.moveTo(px, shoulderY);
  ctx.lineTo(px + Math.cos(attackAngle) * armLen, shoulderY + Math.sin(attackAngle) * armLen);
  ctx.moveTo(px, shoulderY);
  ctx.lineTo(px + Math.cos(otherArmAngle) * armLen, shoulderY + Math.sin(otherArmAngle) * armLen);
  ctx.stroke();

  // legs (wider stance when blocking)
  const legSpread = action === "block" ? 10 : 8;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - legSpread, py + legLen);
  ctx.moveTo(px, py);
  ctx.lineTo(px + legSpread, py + legLen);
  ctx.stroke();

  // fist dot during attacks (visual tip)
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
}

function getFistPosition(px, py, state) {
  // returns {x,y} of the attacking fist when in an attack action
  const headR = 15;
  const bodyLen = 40;
  const armLen = 30;
  const shoulderY = py - bodyLen + 10;

  let attackAngle = -1.2;
  if (state.action === "light" || state.action === "heavy") {
    attackAngle = state.facing === 1 ? -0.2 : -2.94;
  }
  const fx = px + Math.cos(attackAngle) * armLen;
  const fy = shoulderY + Math.sin(attackAngle) * armLen;
  return { x: fx, y: fy };
}


       // get a 2D drawing context (the pen)

    // --- make canvas fill the whole browser window ---
    // --- size canvas and update ground line position ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  groundY = Math.floor(canvas.height * 0.8);
}

// --- draw background + ground ---
function drawWorld() {
  // background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ground
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(canvas.width, groundY);
  ctx.stroke();
}
function drawHUD() {
  ctx.fillStyle = "#fff";
  ctx.font = "16px Arial";
  ctx.fillText("Player HP", 40, 40);

  // Player HP bar (left)
  const barW = 240, barH = 16;
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(40, 50, barW, barH);
  ctx.fillStyle = "#0f0";
  ctx.fillRect(40, 50, barW * Math.max(0, Math.min(1, player.hp / 100)), barH);

  // Enemy HP bar (right)
  const rightX = canvas.width - 40 - barW;
  ctx.fillStyle = "#fff";
  ctx.fillText("Enemy HP", rightX, 40);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(rightX, 50, barW, barH);
  ctx.fillStyle = "#0f0";
  ctx.fillRect(rightX, 50, barW * Math.max(0, Math.min(1, enemy.hp / 100)), barH);

  // Timer (static for now)
  ctx.fillStyle = "#fff";
  ctx.font = "20px Arial";
  const txt = "Time: 90";
  ctx.fillText(txt, canvas.width / 2 - ctx.measureText(txt).width / 2, 40);
}

// initial size + place player in center on ground
resizeCanvas();
// place fighters apart
player.x = Math.floor(canvas.width / 2) - 120;
player.y = groundY;

enemy.x = Math.floor(canvas.width / 2) + 120;
enemy.y = groundY;


function update() {
  if (gameOver) return;

  // ===== PLAYER MOVEMENT =====
  const locked = player.action === "light" || player.action === "heavy" || player.action === "block";

  if (!locked) {
    if (keys.ArrowLeft) {
      player.vx = -speed;
      player.facing = -1;
      if (player.onGround && player.action !== "jump") player.action = "run";
    } else if (keys.ArrowRight) {
      player.vx = speed;
      player.facing = 1;
      if (player.onGround && player.action !== "jump") player.action = "run";
    } else {
      player.vx *= 0.8;
      if (player.onGround && player.action === "run") player.action = "idle";
    }
  } else {
    player.vx *= 0.9;
  }

  if (keys.ArrowUp && player.onGround && !locked) {
    player.vy = -jumpPower;
    player.onGround = false;
    player.action = "jump";
  }

  // ===== ENEMY "AI" =====
  enemyAI();

  // ===== PHYSICS (both) =====
  // gravity
  player.vy += gravity;
  enemy.vy += gravity;

  // apply velocity
  player.x += player.vx;
  player.y += player.vy;
  enemy.x += enemy.vx;
  enemy.y += enemy.vy;

  // ground collision
  if (player.y > groundY) {
    player.y = groundY; player.vy = 0; player.onGround = true;
    if (!(player.action === "light" || player.action === "heavy" || player.action === "block") && !(keys.ArrowLeft || keys.ArrowRight)) {
      player.action = "idle";
    }
  }
  if (enemy.y > groundY) {
    enemy.y = groundY; enemy.vy = 0; enemy.onGround = true;
    if (!(enemy.action === "light" || enemy.action === "heavy" || enemy.action === "block")) {
      enemy.action = "idle";
    }
  }

  // boundaries
  const leftBound = 50;
  const rightBound = canvas.width - 50;
  if (player.x < leftBound) player.x = leftBound;
  if (player.x > rightBound) player.x = rightBound;
  if (enemy.x < leftBound) enemy.x = leftBound;
  if (enemy.x > rightBound) enemy.x = rightBound;

  // ===== HIT DETECTION =====
  // player -> enemy
  handleHit(player, player.x, player.y, enemy, enemy.x, enemy.y);
  // (enemy attacking later; keep for symmetry)
  handleHit(enemy, enemy.x, enemy.y, player, player.x, player.y);

  // ===== ACTION TIMERS =====
  if (player.actionTimer > 0) {
    player.actionTimer--;
    if (player.actionTimer === 0 && player.action !== "jump") {
      player.action = (player.onGround && (keys.ArrowLeft || keys.ArrowRight)) ? "run" : "idle";
    }
  }
  if (enemy.actionTimer > 0) {
    enemy.actionTimer--;
    if (enemy.actionTimer === 0 && enemy.action !== "jump") {
      enemy.action = "idle";
    }
  }

  // ===== KO CHECK =====
  if (player.hp <= 0 || enemy.hp <= 0) {
    gameOver = true;
  }
}


function enemyAI() {
  // face the player
  enemy.facing = (player.x > enemy.x) ? 1 : -1;

  // (optional) tiny step to keep distance ~200px (commented for now)
  // const desired = 200;
  // const gap = Math.abs(player.x - enemy.x);
  // if (gap < desired - 10) {
  //   enemy.vx += (enemy.x > player.x) ? 0.5 : -0.5; // step back
  // } else if (gap > desired + 10) {
  //   enemy.vx += (enemy.x > player.x) ? -0.5 : 0.5; // step closer
  // }
}

function handleHit(attacker, attackerPosX, attackerPosY, defender, defenderPosX, defenderPosY) {
  // Only during attack animations; hit once per action
  if (!(attacker.action === "light" || attacker.action === "heavy")) return;
  if (attacker._didHit) return; // prevent multi-hits in same action

  // Get fist position in world space
  const fist = getFistPosition(attackerPosX, attackerPosY, attacker);

  // Defender torso target = midway on body
  const bodyLen = 40;
  const target = { x: defenderPosX, y: defenderPosY - bodyLen / 2 };

  const dx = fist.x - target.x;
  const dy = fist.y - target.y;
  const dist = Math.hypot(dx, dy);

  // hit if close enough
  const reach = 20; // small hit radius
  if (dist <= reach) {
    // damage
    let dmg = attacker.action === "light" ? 8 : 18;

    // block reduces damage if blocking and facing attacker
    const attackerOnRight = attackerPosX > defenderPosX;
    const defenderFacingAttacker = attackerOnRight ? defender.facing === 1 : defender.facing === -1;

    if (defender.action === "block" && defenderFacingAttacker) {
      dmg = Math.round(dmg * 0.4); // 60% reduction
    }

    defender.hp = Math.max(0, defender.hp - dmg);

    // small knockback
    const dir = attackerOnRight ? 1 : -1; // push away
    defender.vx += 2 * dir;
    if (defender.onGround) defender.vy = -3;

    attacker._didHit = true; // mark as hit this action
  }
}

function resetRound() {
  player.hp = 100;
  enemy.hp = 100;
  player.x = Math.floor(canvas.width / 2) - 120;
  player.y = groundY;
  player.vx = player.vy = 0;
  player.onGround = true;
  player.facing = 1;
  player.action = "idle";
  player.actionTimer = 0;
  player._didHit = false;

  enemy.x = Math.floor(canvas.width / 2) + 120;
  enemy.y = groundY;
  enemy.vx = enemy.vy = 0;
  enemy.onGround = true;
  enemy.facing = -1;
  enemy.action = "idle";
  enemy.actionTimer = 0;
  enemy._didHit = false;

  gameOver = false;
}




let rafId = null;
function loop() {
  update();

  drawWorld();
  drawHUD();

  // draw both fighters
  drawStickman(player.x, player.y, player);
  drawStickman(enemy.x, enemy.y, enemy);
  // ... after drawing both players and timer:

// KO overlay if any player HP <= 0 or server flag says ko
const koFlag = (game && game.ko) || (players[0]?.hp <= 0 || players[1]?.hp <= 0);
if (koFlag) {
  ctx.fillStyle = "rgba(0,0,0,0.5)");
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  ctx.font = "48px Arial";
  const msg = (players[0]?.hp <= 0) ? "You Lose" : "You Win!";
  const w3 = ctx.measureText(msg).width;
  ctx.fillText(msg, canvas.width / 2 - w3 / 2, canvas.height / 2 - 10);

  ctx.font = "20px Arial";
  const sub = "Next round in 3 seconds...";
  const w4 = ctx.measureText(sub).width;
  ctx.fillText(sub, canvas.width / 2 - w4 / 2, canvas.height / 2 + 30);
}


  // KO overlay
  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#fff";
    ctx.font = "48px Arial";
    const msg = (player.hp <= 0) ? "You Lose" : "You Win!";
    const w = ctx.measureText(msg).width;
    ctx.fillText(msg, canvas.width / 2 - w / 2, canvas.height / 2 - 10);

    ctx.font = "20px Arial";
    const sub = "Press R to Restart";
    const w2 = ctx.measureText(sub).width;
    ctx.fillText(sub, canvas.width / 2 - w2 / 2, canvas.height / 2 + 30);
  }

  rafId = requestAnimationFrame(loop);






                            // actually paint the line

    function onResize() {
  resizeCanvas();
  // keep player on ground and clamp X inside screen
  player.y = groundY;
  const leftBound = 50;
  const rightBound = canvas.width - 50;
  if (player.x < leftBound) player.x = leftBound;
  if (player.x > rightBound) player.x = rightBound;
}
window.addEventListener("resize", onResize);

    
    window.addEventListener("resize", onResize); // listen for browser window size changes
    function onKeyDown(e) {
  const k = e.key;
  if (k in keys) {
    keys[k] = true;
    e.preventDefault();
  }

  if (gameOver && k === "r") {
    resetRound();
    return;
  }

  // start actions on keydown if allowed
  const canAct = player.onGround && player.actionTimer === 0 && !gameOver;
  if (k === "z" && canAct) {
    player.action = "light";
    player.actionTimer = 10;
    player._didHit = false; // reset hit flag for this action
  } else if (k === "x" && canAct) {
    player.action = "heavy";
    player.actionTimer = 18;
    player._didHit = false;
  } else if (k === "c" && player.onGround && player.action !== "block" && !gameOver) {
    player.action = "block";
    player.actionTimer = 14;
  }
}


function onKeyUp(e) {
  const k = e.key;
  if (k in keys) {
    keys[k] = false;
    e.preventDefault();
  }
  if (k === "c" && player.action === "block") {
    player.actionTimer = 0;
    player.action = (player.onGround && (keys.ArrowLeft || keys.ArrowRight)) ? "run" : "idle";
  }
}



window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);


    // --- cleanup when component is removed (good habit) ---
    loop();

    return () => {
      window.removeEventListener("resize", onResize);
       cancelAnimationFrame(rafId);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", onResize);
    };
   [];                                        // empty array = run once

  // This is the actual canvas element we draw on
  return (
    <canvas
      ref={canvasRef}                            // connect our ref to this <canvas>
      style={{
        display: "block",                        // remove default gaps
        width: "100vw",                          // match viewport width
        height: "100vh",                         // match viewport height
        background: "#111",                      // fallback background (also drawn by code)
      }}
    />
  );

