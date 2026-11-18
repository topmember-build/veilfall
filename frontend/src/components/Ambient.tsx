"use client";

import { useEffect, useRef } from "react";

interface P {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
}

/** Slow drifting specks behind everything: embers in the night, light motes by day. */
export function Ambient() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts: P[] = [];

    const make = (): P => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 2.2,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -(0.1 + Math.random() * 0.35),
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.4,
    });

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, (w * h) / 22000));
      parts = Array.from({ length: count }, make);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (t: number) => {
      const day = document.documentElement.dataset.theme === "day";
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx + Math.sin(t / 2600 + p.phase) * 0.15;
        p.y += day ? p.vy * 0.5 : p.vy;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        const tw = 0.5 + 0.5 * Math.sin(t / 1000 * p.speed + p.phase);
        const a = (day ? 0.28 : 0.55) * tw;
        const rad = p.r * (day ? 2.4 : 1.6);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 4);
        const c = day ? "214, 40, 75" : p.r > 1.8 ? "255, 196, 107" : "255, 106, 134";
        g.addColorStop(0, `rgba(${c}, ${a})`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
