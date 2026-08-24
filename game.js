/* ============================================================
   RowBot — "Rogue Rows"
   A small Asteroids-alike for the cold-start wait. Vector outlines to match
   the neon look, and big explosions are handed to the background particle
   field so the game and the page share one visual language.

   Controls are DIRECT AIM, not classic rotate-and-thrust: the arrows set a
   heading, the ship swings to it and flies. Rotate-and-thrust meant pressing
   Down and firing shot upward, because Down wasn't bound to anything and the
   ship never turned. Direct aim makes "shoot down" mean shoot down.

   Frame-based (not delta-timed) to match particles.js — both loops are rAF
   capped and the tuning below assumes ~60fps.
   ============================================================ */

const KEY_LEFT   = new Set(["ArrowLeft", "KeyA"]);
const KEY_RIGHT  = new Set(["ArrowRight", "KeyD"]);
const KEY_UP     = new Set(["ArrowUp", "KeyW"]);
const KEY_DOWN   = new Set(["ArrowDown", "KeyS"]);
const KEY_FIRE   = new Set(["Space"]);

const SHIP_R = 15;
const TURN_RATE = 0.24;        // rad/frame toward the pressed heading
const ACCEL = 0.16;
const DRAG = 0.986;
const MAX_SPEED = 7.6;
const BULLET_SPEED = 9.5;
const FIRE_COOLDOWN = 9;
const RAPID_COOLDOWN = 4;
const START_GRACE = 90;

const ROCK_R = { 3: 46, 2: 26, 1: 14 };
const ROCK_SCORE = { 3: 20, 2: 50, 1: 100 };

/* Four powers. Duration in frames — 1800 = 30s at 60fps. */
const POWER_DURATION = 1800;
const POWERS = {
  spread: { label: "SPREAD", color: "#00e5ff", glyph: "W", duration: POWER_DURATION },
  rapid:  { label: "RAPID",  color: "#ffd400", glyph: "R", duration: POWER_DURATION },
  pierce: { label: "PIERCE", color: "#ff2d95", glyph: "P", duration: POWER_DURATION },
  homing: { label: "HOMING", color: "#b16cff", glyph: "H", duration: POWER_DURATION },
};
const POWER_KEYS = Object.keys(POWERS);
const DROP_CHANCE = 0.2;
/* On-field lifetime. Longer than before because there's no magnet now — you
   have to fly over and get it, which takes time on a wide screen. */
const POWERUP_LIFE = 900;

export function createGame({ field, onExit } = {}) {
  let root = null;
  let canvas = null;
  let ctx = null;
  let hud = {};
  let open = false;
  let rafId = null;

  const keys = new Set();
  let state = null;

  /* ---------- DOM ---------- */
  function build() {
    root = document.createElement("div");
    root.className = "game";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Rogue Rows — a game for the wait");
    root.innerHTML = `
      <canvas class="game__canvas"></canvas>
      <div class="game__hud">
        <div class="game__stats">
          <span class="game__stat">ROWS <b data-score>0</b></span>
          <span class="game__stat">WAVE <b data-wave>1</b></span>
          <span class="game__stat game__stat--power">POWER <b data-power>—</b></span>
          <span class="game__stat game__stat--best">BEST <b data-best>0</b></span>
        </div>
        <button class="game__exit" type="button">Esc to leave</button>
      </div>
      <div class="game__banner" data-banner hidden></div>
      <div class="game__overlay" data-overlay>
        <p class="game__title">ROGUE ROWS</p>
        <p class="game__blurb">
          Bad rows got loose while the server naps. Shoot them.
          One ship, no spares — so mind the big ones.
        </p>
        <p class="game__keys">
          <b>&larr;</b><b>&uarr;</b><b>&darr;</b><b>&rarr;</b> aim &amp; fly &nbsp;
          <b>space</b> fire &nbsp; <b>esc</b> leave
        </p>
        <p class="game__cta" data-cta>Press <b>space</b> to start</p>
      </div>
    `;
    document.body.appendChild(root);

    canvas = root.querySelector(".game__canvas");
    ctx = canvas.getContext("2d");
    hud = {
      score: root.querySelector("[data-score]"),
      wave: root.querySelector("[data-wave]"),
      power: root.querySelector("[data-power]"),
      best: root.querySelector("[data-best]"),
      banner: root.querySelector("[data-banner]"),
      overlay: root.querySelector("[data-overlay]"),
      cta: root.querySelector("[data-cta]"),
    };

    root.querySelector(".game__exit").addEventListener("click", () => close());
    hud.best.textContent = bestScore();
  }

  /* ---------- persistence (best-effort; private mode can throw) ---------- */
  function bestScore() {
    try {
      return Number(localStorage.getItem("rowbot.rogueRows.best") || 0);
    } catch {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem("rowbot.rogueRows.best", String(v));
    } catch { /* nothing depends on it */ }
  }

  /* ---------- geometry ---------- */
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function wrap(o) {
    if (o.x < 0) o.x += canvas.width;
    else if (o.x > canvas.width) o.x -= canvas.width;
    if (o.y < 0) o.y += canvas.height;
    else if (o.y > canvas.height) o.y -= canvas.height;
  }

  const held = (set) => {
    for (const k of keys) if (set.has(k)) return true;
    return false;
  };

  function makeRock(size, x, y) {
    const r = ROCK_R[size];
    const points = 9 + Math.floor(Math.random() * 4);
    const verts = Array.from({ length: points }, (_, i) => ({
      a: (i / points) * Math.PI * 2,
      r: r * (0.72 + Math.random() * 0.42),
    }));
    // Smaller fragments travel faster, so splitting raises the pressure.
    const speed = (0.9 + Math.random() * 1.3) * (1 + (3 - size) * 0.45);
    const dir = Math.random() * Math.PI * 2;
    return {
      size, x, y, r,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.035,
      verts,
    };
  }

  function spawnWave(n) {
    const rocks = [];
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do {
        x = Math.random() * canvas.width;
        y = Math.random() * canvas.height;
        tries++;
      } while (tries < 40 && Math.hypot(x - canvas.width / 2, y - canvas.height / 2) < 170);
      rocks.push(makeRock(3, x, y));
    }
    return rocks;
  }

  /** Density scaled to the viewport — 4 rocks on a 27" display is empty space. */
  function waveCount() {
    const area = canvas.width * canvas.height;
    const base = Math.round(Math.max(5, Math.min(11, area / 150000)));
    return base + Math.min(state.wave - 1, 6);
  }

  function reset() {
    state = {
      ship: {
        x: canvas.width / 2,
        y: canvas.height / 2,
        angle: -Math.PI / 2,
        vx: 0, vy: 0,
        thrusting: false,
        grace: START_GRACE,
      },
      bullets: [],
      rocks: [],
      sparks: [],
      powerups: [],
      power: null,          // { type, left }
      score: 0,
      wave: 0,
      cooldown: 0,
      frame: 0,
      flash: 0,
      running: false,
      over: false,
    };
    hud.score.textContent = "0";
    setPowerHud();
    nextWave();
    paint();
  }

  function nextWave() {
    state.wave += 1;
    state.rocks = spawnWave(waveCount());
    hud.wave.textContent = state.wave;
  }

  function setPowerHud() {
    const p = state.power;
    if (!p) {
      hud.power.textContent = "—";
      hud.power.style.color = "";
      return;
    }
    hud.power.textContent = `${POWERS[p.type].label} ${Math.ceil(p.left / 60)}s`;
    hud.power.style.color = POWERS[p.type].color;
  }

  /* ---------- explosions ---------- */
  function boom(x, y, count, big) {
    if (big) field?.burst(x, y, count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 4.2 + 1;
      state.sparks.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        hue: 95 + Math.random() * 40,
      });
    }
  }

  /* ---------- simulation ---------- */
  function step() {
    state.frame += 1;
    const { ship } = state;

    if (state.power) {
      state.power.left -= 1;
      if (state.power.left <= 0) state.power = null;
      if (state.frame % 10 === 0 || !state.power) setPowerHud();
    }

    if (state.running && !state.over) {
      // Direct aim: the pressed arrows form a heading, the ship swings to it.
      let dx = 0, dy = 0;
      if (held(KEY_LEFT)) dx -= 1;
      if (held(KEY_RIGHT)) dx += 1;
      if (held(KEY_UP)) dy -= 1;
      if (held(KEY_DOWN)) dy += 1;

      ship.thrusting = !!(dx || dy);
      if (ship.thrusting) {
        const target = Math.atan2(dy, dx);
        let diff = target - ship.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        ship.angle += Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));

        ship.vx += Math.cos(ship.angle) * ACCEL;
        ship.vy += Math.sin(ship.angle) * ACCEL;
        const sp = Math.hypot(ship.vx, ship.vy);
        if (sp > MAX_SPEED) {
          ship.vx = (ship.vx / sp) * MAX_SPEED;
          ship.vy = (ship.vy / sp) * MAX_SPEED;
        }
        if (Math.random() < 0.6) {
          state.sparks.push({
            x: ship.x - Math.cos(ship.angle) * SHIP_R,
            y: ship.y - Math.sin(ship.angle) * SHIP_R,
            vx: -Math.cos(ship.angle) * 2 + (Math.random() - 0.5),
            vy: -Math.sin(ship.angle) * 2 + (Math.random() - 0.5),
            life: 0.5,
            hue: 55,
          });
        }
      }

      ship.vx *= DRAG;
      ship.vy *= DRAG;
      ship.x += ship.vx;
      ship.y += ship.vy;
      wrap(ship);
      if (ship.grace > 0) ship.grace -= 1;

      if (state.cooldown > 0) state.cooldown -= 1;
      if (state.cooldown === 0 && held(KEY_FIRE)) fire();
    }

    stepBullets();
    stepRocks();
    stepPowerups();
    stepSparks();

    if (state.flash > 0) state.flash -= 0.045;
    if (!state.over) collide();
    if (state.running && !state.rocks.length) nextWave();
  }

  function fire() {
    const type = state.power?.type;
    const { ship } = state;
    const spread = type === "spread" ? [-0.2, 0, 0.2] : [0];

    // Long enough to cross the widest screen. A fixed frame count died
    // mid-flight on wide displays — horizontal shots vanished before the edge.
    const life = Math.round((Math.max(canvas.width, canvas.height) * 1.1) / BULLET_SPEED);

    for (const off of spread) {
      const a = ship.angle + off;
      state.bullets.push({
        x: ship.x + Math.cos(a) * SHIP_R,
        y: ship.y + Math.sin(a) * SHIP_R,
        vx: Math.cos(a) * BULLET_SPEED + ship.vx * 0.4,
        vy: Math.sin(a) * BULLET_SPEED + ship.vy * 0.4,
        life,
        maxLife: life,
        pierce: type === "pierce",
        homing: type === "homing",
        // Plain shots cycle the spectrum; a power stamps its own colour.
        hue: type ? null : (state.frame * 7) % 360,
        color: type ? POWERS[type].color : null,
      });
    }
    state.cooldown = type === "rapid" ? RAPID_COOLDOWN : FIRE_COOLDOWN;
  }

  function stepBullets() {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];

      if (b.homing && state.rocks.length) {
        let best = null, bestD = Infinity;
        for (const r of state.rocks) {
          const d = Math.hypot(r.x - b.x, r.y - b.y);
          if (d < bestD) { bestD = d; best = r; }
        }
        if (best && bestD < 420) {
          const want = Math.atan2(best.y - b.y, best.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const a = cur + Math.max(-0.14, Math.min(0.14, diff));
          b.vx = Math.cos(a) * BULLET_SPEED;
          b.vy = Math.sin(a) * BULLET_SPEED;
        }
      }

      b.x += b.vx;
      b.y += b.vy;
      b.life -= 1;

      // Bullets deliberately do NOT wrap. They used to, so a shot fired down
      // reappeared at the top of the screen and read as coming from the wrong
      // end. Rocks and the ship still wrap; shots just leave.
      const gone =
        b.x < -24 || b.x > canvas.width + 24 ||
        b.y < -24 || b.y > canvas.height + 24;
      if (b.life <= 0 || gone) state.bullets.splice(i, 1);
    }
  }

  function stepRocks() {
    for (const r of state.rocks) {
      r.x += r.vx;
      r.y += r.vy;
      r.angle += r.spin;
      wrap(r);
    }
  }

  function stepPowerups() {
    const { ship } = state;
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const u = state.powerups[i];
      u.spin += 0.03;
      u.life -= 1;

      // No magnet: the ship can fly, so going to get it is the decision.
      u.x += u.vx;
      u.y += u.vy;
      wrap(u);

      // Measured after the move so a fast pass-over still registers.
      const d = Math.hypot(ship.x - u.x, ship.y - u.y);
      if (d < SHIP_R + 16) {
        state.power = { type: u.type, left: POWERS[u.type].duration };
        setPowerHud();
        boom(u.x, u.y, 10, false);
        state.powerups.splice(i, 1);
        continue;
      }
      if (u.life <= 0) state.powerups.splice(i, 1);
    }
  }

  function stepSparks() {
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const s = state.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.94;
      s.vy *= 0.94;
      s.life -= 0.035;
      if (s.life <= 0) state.sparks.splice(i, 1);
    }
  }

  function splitRock(index) {
    const r = state.rocks[index];
    state.rocks.splice(index, 1);
    state.score += ROCK_SCORE[r.size];
    hud.score.textContent = state.score.toLocaleString();
    boom(r.x, r.y, r.size === 3 ? 18 : 12, r.size === 3);

    if (Math.random() < DROP_CHANCE) {
      state.powerups.push({
        x: r.x, y: r.y,
        vx: (Math.random() - 0.5) * 1.4,
        vy: (Math.random() - 0.5) * 1.4,
        type: POWER_KEYS[Math.floor(Math.random() * POWER_KEYS.length)],
        spin: 0,
        life: POWERUP_LIFE,
      });
    }

    if (r.size > 1) {
      state.rocks.push(makeRock(r.size - 1, r.x, r.y), makeRock(r.size - 1, r.x, r.y));
    }
  }

  function collide() {
    for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
      const b = state.bullets[bi];
      for (let ri = state.rocks.length - 1; ri >= 0; ri--) {
        const r = state.rocks[ri];
        if (Math.hypot(b.x - r.x, b.y - r.y) < r.r) {
          splitRock(ri);
          // Piercing shots carry on through; ordinary ones are spent.
          if (!b.pierce) {
            state.bullets.splice(bi, 1);
            break;
          }
        }
      }
    }

    if (!state.running || state.ship.grace > 0) return;
    for (const r of state.rocks) {
      if (Math.hypot(state.ship.x - r.x, state.ship.y - r.y) < r.r + SHIP_R * 0.62) {
        die();
        return;
      }
    }
  }

  /** One ship, no spares. Going out is meant to be an event. */
  function die() {
    const { x, y } = state.ship;
    state.over = true;
    state.running = false;
    state.flash = 1;

    field?.burst(x, y, 70);
    field?.burst(x, y, 40);
    boom(x, y, 70, false);
    state.bullets.length = 0;

    if (state.score > bestScore()) saveBest(state.score);
    hud.best.textContent = bestScore();

    // Let the blast be seen before the panel covers it.
    setTimeout(() => {
      if (!open || !state.over) return;
      hud.overlay.hidden = false;
      hud.overlay.querySelector(".game__title").textContent = "SHIP LOST";
      hud.cta.innerHTML =
        `You cleared <b>${state.score.toLocaleString()}</b> rows. Press <b>space</b> to go again`;
    }, 900);
  }

  /* ---------- rendering ---------- */
  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // rocks
    ctx.lineWidth = 1.6;
    for (const r of state.rocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      ctx.strokeStyle = "rgba(112,224,0,.85)";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(112,224,0,.5)";
      ctx.beginPath();
      r.verts.forEach((v, i) => {
        const px = Math.cos(v.a) * v.r;
        const py = Math.sin(v.a) * v.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    drawPowerups();
    drawBullets();

    // sparks
    for (const s of state.sparks) {
      ctx.fillStyle = `hsla(${s.hue ?? 95}, 100%, 62%, ${Math.max(0, s.life)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.running || state.over) drawShip();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(220,255,190,${Math.max(0, state.flash) * 0.5})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      // Plain shots cycle hue over their lifetime, so the stream is a rainbow.
      const col = b.color ?? `hsl(${(b.hue + (b.maxLife - b.life) * 6) % 360}, 100%, 66%)`;
      ctx.fillStyle = col;
      ctx.shadowBlur = 12;
      ctx.shadowColor = col;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.pierce ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawPowerups() {
    for (const u of state.powerups) {
      const { color, glyph } = POWERS[u.type];
      const fading = u.life < 120 && Math.floor(u.life / 8) % 2 === 0;
      if (fading) continue;         // blink out as it expires

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.spin);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.roundRect(-12, -12, 24, 24, 6);
      ctx.stroke();
      ctx.restore();

      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.font = "700 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, u.x, u.y + 0.5);
      ctx.shadowBlur = 0;
    }
  }

  function drawShip() {
    const { ship } = state;
    if (ship.grace > 0 && Math.floor(ship.grace / 6) % 2 === 0) return;
    if (state.over) return;

    const accent = state.power ? POWERS[state.power.type].color : "#9bff3d";

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle + Math.PI / 2);   // sprite drawn nose-up
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 12;
    ctx.shadowColor = accent;

    // Pointed nose — without it the robot head reads as facing the viewer
    // and there's no way to tell which way you're aiming.
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(0, -16);
    ctx.lineTo(8, -6);
    ctx.stroke();

    // body
    ctx.beginPath();
    ctx.roundRect(-10, -6, 20, 14, 4);
    ctx.stroke();

    // eyes, kept so it still reads as the mascot
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-4, 0, 1.5, 0, Math.PI * 2);
    ctx.arc(4, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (ship.thrusting) {
      ctx.strokeStyle = "#ffd400";
      ctx.beginPath();
      ctx.moveTo(-5, 8);
      ctx.lineTo(0, 15 + Math.random() * 5);
      ctx.lineTo(5, 8);
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  /* ---------- loop ---------- */
  function frame() {
    step();
    paint();
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function onKeyDown(e) {
    if (!open) return;

    if (e.code === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    keys.add(e.code);

    if (e.code === "Space" && !state.running) {
      if (state.over) reset();
      state.running = true;
      hud.overlay.hidden = true;
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onResize() {
    if (open) resize();
  }

  function onBlur() {
    keys.clear();
  }

  /* ---------- public ---------- */
  function openGame() {
    if (open) return;
    if (!root) build();

    open = true;
    root.hidden = false;
    document.body.classList.add("game-on");
    document.activeElement?.blur?.();

    resize();
    reset();
    keys.clear();

    hud.overlay.hidden = false;
    hud.overlay.querySelector(".game__title").textContent = "ROGUE ROWS";
    hud.cta.innerHTML = "Press <b>space</b> to start";
    hud.banner.hidden = true;

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);

    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  function close() {
    if (!open) return;
    open = false;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onBlur);
    keys.clear();

    if (state && state.score > bestScore()) saveBest(state.score);
    root.hidden = true;
    document.body.classList.remove("game-on");
    onExit?.();
  }

  /** Called when the backend wakes — never interrupts the run. */
  function notifyReady(message) {
    if (!open || !hud.banner) return;
    hud.banner.textContent = message;
    hud.banner.hidden = false;
  }

  return {
    open: openGame,
    close,
    notifyReady,
    isOpen: () => open,
    getState: () => state,     // used by the local dev probe
  };
}
