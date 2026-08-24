/* ============================================================
   RowBot — ambient particle field
   Adapted from a connected-particle-network pen. Changes made for
   running behind a live app rather than on a blank page:
     - hues constrained to the brand green instead of full rainbow
     - listeners live on window, not the canvas, so the field reacts to
       the cursor while the canvas stays pointer-events:none and every
       button underneath stays clickable
     - mousemove ripples throttled (one per frame + distance gated)
     - resize debounced (it rebuilds every particle)
     - loop parks itself when the tab is hidden
     - honours prefers-reduced-motion with a single static frame
   ============================================================ */

/* Brand green #70e000 === hsl(90, 100%, 44%). Everything hues around that. */
const BASE_HUE = 90;
const HUE_SPREAD = 20;      // ± drift, keeps it green rather than rainbow
const LINK_DIST_SQ = 10000; // 100px
const MOUSE_FIELD_SQ = 22500; // 150px

export function initParticles(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const particles = [];
  const dustParticles = [];
  const fireworkParticles = [];
  const ripples = [];
  const techRipples = [];

  const mouse = {
    x: null,
    y: null,
    set(x, y) { this.x = x; this.y = y; },
    reset() { this.x = null; this.y = null; },
  };

  let bgPhase = 0;
  let frameCount = 0;
  let autoDrift = true;
  let rafId = null;
  let glow = 0;

  // A stronger, screen-wide version of the mouse field, driven from outside
  // (the logo uses it to make the whole field swarm toward one point).
  let attractor = null;

  /* ---------- sizing ---------- */
  function particleCount() {
    // Scale with area so a laptop isn't drawing a phone's worth of links,
    // and a phone isn't melting under a desktop's.
    const area = canvas.width * canvas.height;
    return Math.round(Math.max(38, Math.min(120, area / 14000)));
  }

  function dustCount() {
    const area = canvas.width * canvas.height;
    return Math.round(Math.max(50, Math.min(140, area / 11000)));
  }

  /* ---------- entities ---------- */
  class Particle {
    constructor(x, y, isFirework = false) {
      const baseSpeed = isFirework
        ? Math.random() * 2 + 1
        : Math.random() * 0.5 + 0.3;

      this.isFirework = isFirework;
      this.x = x;
      this.y = y;
      const dir = Math.random() * Math.PI * 2;
      this.vx = Math.cos(dir) * baseSpeed;
      this.vy = Math.sin(dir) * baseSpeed;
      this.size = isFirework ? Math.random() * 2 + 2 : Math.random() * 2.4 + 1;
      this.alpha = 1;
      this.sizeDirection = Math.random() < 0.5 ? -1 : 1;
      this.huePhase = Math.random() * Math.PI * 2;
      this.hue = BASE_HUE;
      this.trail = [];
    }

    update() {
      const distSq = mouse.x !== null
        ? (mouse.x - this.x) ** 2 + (mouse.y - this.y) ** 2
        : 0;

      if (!this.isFirework) {
        const force = distSq && distSq < MOUSE_FIELD_SQ
          ? (MOUSE_FIELD_SQ - distSq) / MOUSE_FIELD_SQ
          : 0;

        if (mouse.x === null && autoDrift) {
          this.vx += (Math.random() - 0.5) * 0.03;
          this.vy += (Math.random() - 0.5) * 0.03;
        }

        if (distSq) {
          const d = Math.sqrt(distSq);
          this.vx += ((mouse.x - this.x) / d) * force * 0.1;
          this.vy += ((mouse.y - this.y) / d) * force * 0.1;
        }

        this.vx *= mouse.x !== null ? 0.99 : 0.998;
        this.vy *= mouse.y !== null ? 0.99 : 0.998;

        if (attractor) {
          const ax = attractor.x - this.x;
          const ay = attractor.y - this.y;
          const ad = Math.hypot(ax, ay) || 1;
          const pull = attractor.strength;
          // Radial pull plus a tangential component, so they spiral in and
          // orbit rather than piling up dead centre.
          this.vx += (ax / ad) * pull + (-ay / ad) * pull * 0.42;
          this.vy += (ay / ad) * pull + (ax / ad) * pull * 0.42;
          this.vx *= 0.93;
          this.vy *= 0.93;
        }
      } else {
        // Sparks: fast out, decelerating, gone quickly. Without drag and a
        // brisk fade they drift at constant speed and the burst reads as slow.
        this.alpha -= 0.05;
        this.vx *= 0.91;
        this.vy *= 0.91;
      }

      this.x += this.vx;
      this.y += this.vy;

      // Sparks fly off the edge and die; only the ambient field bounces.
      if (!this.isFirework) {
        if (this.x <= 0 || this.x >= canvas.width - 1) this.vx *= -0.9;
        if (this.y <= 0 || this.y >= canvas.height - 1) this.vy *= -0.9;
        // Keep strays inside after a bounce, or they stick to the wall.
        this.x = Math.max(0, Math.min(canvas.width - 1, this.x));
        this.y = Math.max(0, Math.min(canvas.height - 1, this.y));
      }

      this.size += this.sizeDirection * 0.06;
      if (this.size > 3.4 || this.size < 1) this.sizeDirection *= -1;

      // Oscillate inside the green band instead of cycling all 360°.
      this.huePhase += 0.01;
      this.hue = BASE_HUE + Math.sin(this.huePhase) * HUE_SPREAD;

      if (frameCount % 2 === 0 && (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1)) {
        this.trail.push({ x: this.x, y: this.y, hue: this.hue, alpha: this.alpha });
        if (this.trail.length > 12) this.trail.shift();
      }
    }

    draw() {
      const a = Math.max(this.alpha, 0);
      const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
      gradient.addColorStop(0, `hsla(${this.hue}, 95%, 65%, ${a})`);
      gradient.addColorStop(1, `hsla(${this.hue + 12}, 90%, 32%, ${a})`);

      ctx.fillStyle = gradient;
      ctx.shadowBlur = glow;
      ctx.shadowColor = `hsl(${this.hue}, 95%, 55%)`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (this.trail.length > 1) {
        ctx.beginPath();
        ctx.lineWidth = 1.2;
        for (let i = 0; i < this.trail.length - 1; i++) {
          const p1 = this.trail[i];
          const p2 = this.trail[i + 1];
          ctx.strokeStyle = `hsla(${p1.hue}, 90%, 55%, ${Math.max(p1.alpha, 0) * 0.35})`;
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
      }
    }

    isDead() { return this.isFirework && this.alpha <= 0; }
  }

  class DustParticle {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 1.4 + 0.4;
      this.vx = (Math.random() - 0.5) * 0.05;
      this.vy = (Math.random() - 0.5) * 0.05;
      this.hue = BASE_HUE + (Math.random() - 0.5) * 30;
      this.alpha = Math.random() * 0.16 + 0.06;
    }

    update() {
      this.x = (this.x + this.vx + canvas.width) % canvas.width;
      this.y = (this.y + this.vy + canvas.height) % canvas.height;
    }

    draw() {
      ctx.fillStyle = `hsla(${this.hue}, 60%, 70%, ${this.alpha})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  class Ripple {
    constructor(x, y, maxRadius = 30, fade = 0.014) {
      this.x = x;
      this.y = y;
      this.radius = 0;
      this.maxRadius = maxRadius;
      this.alpha = 0.28;
      this.fade = fade;
      this.hue = BASE_HUE;
    }

    update() {
      this.radius += 1.5;
      this.alpha -= this.fade;
    }

    draw() {
      ctx.strokeStyle = `hsla(${this.hue}, 90%, 55%, ${Math.max(this.alpha, 0)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    isDone() { return this.alpha <= 0 || this.radius > this.maxRadius * 2.5; }
  }

  /* ---------- setup ---------- */
  function createParticles() {
    particles.length = 0;
    dustParticles.length = 0;

    const n = particleCount();
    for (let i = 0; i < n; i++) {
      particles.push(new Particle(Math.random() * canvas.width, Math.random() * canvas.height));
    }
    const d = dustCount();
    for (let i = 0; i < d; i++) dustParticles.push(new DustParticle());
  }

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Glow is the most expensive per-particle op — only on roomy screens.
    glow = canvas.width > 900 ? 8 : 0;
    createParticles();
  }

  /* ---------- drawing ---------- */
  function drawBackground() {
    // Near-black, drifting between a cold and a warm-green cast.
    bgPhase += 0.0016;
    const shift = Math.sin(bgPhase) * 14;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `hsl(${150 + shift}, 30%, 3.5%)`);
    gradient.addColorStop(1, `hsl(${95 + shift}, 34%, 6.5%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Spatial hash so this stays O(n) instead of O(n²).
  function connectParticles() {
    const gridSize = 120;
    const grid = new Map();

    for (const p of particles) {
      const key = `${Math.floor(p.x / gridSize)},${Math.floor(p.y / gridSize)}`;
      let cell = grid.get(key);
      if (!cell) grid.set(key, (cell = []));
      cell.push(p);
    }

    ctx.lineWidth = 1;
    for (const p of particles) {
      const gx = Math.floor(p.x / gridSize);
      const gy = Math.floor(p.y / gridSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;

          for (const n of cell) {
            // Only draw each pair once — the original drew every line twice.
            if (n === p || n.x < p.x) continue;
            const distSq = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
            if (distSq >= LINK_DIST_SQ) continue;

            const opacity = (1 - Math.sqrt(distSq) / 100) * 0.5;
            ctx.strokeStyle = `hsla(${(p.hue + n.hue) / 2}, 90%, 55%, ${opacity})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        }
      }
    }

    // Link the cursor into the web too.
    if (mouse.x !== null) {
      for (const p of particles) {
        const distSq = (mouse.x - p.x) ** 2 + (mouse.y - p.y) ** 2;
        if (distSq >= LINK_DIST_SQ * 1.8) continue;
        const opacity = (1 - Math.sqrt(distSq) / 134) * 0.55;
        ctx.strokeStyle = `hsla(${BASE_HUE}, 100%, 62%, ${opacity})`;
        ctx.beginPath();
        ctx.moveTo(mouse.x, mouse.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // Everything caught in the swarm gets tethered to its centre, which is
    // what makes the gather read as one object rather than drifting dots.
    if (attractor) {
      const reach = 340;
      for (const p of particles) {
        const d = Math.hypot(attractor.x - p.x, attractor.y - p.y);
        if (d >= reach) continue;
        ctx.strokeStyle = `hsla(${BASE_HUE}, 100%, 65%, ${(1 - d / reach) * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(attractor.x, attractor.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  function drawFrame() {
    drawBackground();

    for (const arr of [dustParticles, particles, ripples, techRipples, fireworkParticles]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const obj = arr[i];
        obj.update();
        obj.draw();
        if (obj.isDone?.() || obj.isDead?.()) arr.splice(i, 1);
      }
    }

    connectParticles();
    frameCount++;
  }

  function loop() {
    drawFrame();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId === null) rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ---------- input ----------
     On window, not the canvas: the canvas is pointer-events:none so the UI
     on top stays usable, which means it never receives pointer events itself. */
  let pendingMove = null;
  let lastRippleX = 0;
  let lastRippleY = 0;

  function onPointerMove(e) {
    pendingMove = { x: e.clientX, y: e.clientY };
    autoDrift = false;
  }

  // Coalesce to one update per frame — mousemove fires far faster than 60Hz.
  function flushPointer() {
    if (pendingMove) {
      mouse.set(pendingMove.x, pendingMove.y);
      // Ripple only after real travel, or fast movement floods the array.
      const moved = (pendingMove.x - lastRippleX) ** 2 + (pendingMove.y - lastRippleY) ** 2;
      if (moved > 900 && techRipples.length < 24) {
        techRipples.push(new Ripple(pendingMove.x, pendingMove.y, 30));
        lastRippleX = pendingMove.x;
        lastRippleY = pendingMove.y;
      }
      pendingMove = null;
    }
    requestAnimationFrame(flushPointer);
  }

  // Don't fire an explosion behind a button the user is actually trying to press.
  const INTERACTIVE = "button, input, a, label, textarea, select, .chip, .dropzone";

  function onClick(e) {
    // target isn't always an Element (document, SVG edge cases) — guard both.
    if (e.target?.closest?.(INTERACTIVE)) return;

    const x = e.clientX;
    const y = e.clientY;
    ripples.push(new Ripple(x, y, 60, 0.01));

    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 1;
      const p = new Particle(x, y, true);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      fireworkParticles.push(p);
    }
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 180);
  }

  /* ---------- boot ---------- */
  resizeCanvas();

  if (reduced) {
    // One static frame: the texture without the motion.
    drawFrame();
    // Resizing clears the canvas, so repaint the single frame after it.
    let staticResize;
    window.addEventListener("resize", () => {
      clearTimeout(staticResize);
      staticResize = setTimeout(() => { resizeCanvas(); drawFrame(); }, 180);
    });
    // Same shape as the live API so callers never need to feature-check.
    return { start() {}, stop() {}, focus() {}, release() {}, burst() {}, trail() {} };
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("click", onClick);
  document.addEventListener("mouseleave", () => { mouse.reset(); autoDrift = true; });
  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : start();
  });

  requestAnimationFrame(flushPointer);
  start();

  return {
    start,
    stop,

    /** Pull the whole field toward a viewport point. */
    focus(x, y, strength = 0.5) {
      attractor = { x, y, strength };
    },

    /** Let go, and kick everything outward from where the swarm was. */
    release(force = 7) {
      if (!attractor) return;
      const { x, y } = attractor;
      attractor = null;
      for (const p of particles) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.hypot(dx, dy) || 1;
        // Closest particles get the hardest shove, so it reads as a shockwave.
        const kick = force * (1 - Math.min(d / 420, 0.82));
        p.vx += (dx / d) * kick;
        p.vy += (dy / d) * kick;
      }
      ripples.push(new Ripple(x, y, 220, 0.008));
    },

    /** Light spark trail — safe to call every few frames, unlike burst(). */
    trail(x, y, count = 2) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.2 + 0.6;
        const p = new Particle(x, y, true);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.size = Math.random() * 1.5 + 0.7;
        fireworkParticles.push(p);
      }
    },

    /** Spark burst at a point. Snappy: high launch speed, drag does the rest. */
    burst(x, y, count = 24) {
      ripples.push(new Ripple(x, y, 140, 0.03));
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const speed = Math.random() * 12 + 8;
        const p = new Particle(x, y, true);
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        fireworkParticles.push(p);
      }
    },
  };
}
